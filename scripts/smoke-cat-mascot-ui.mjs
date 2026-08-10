import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7101';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tanwuzhi-mascot-ui-'));
const screenshots = {
  grabbed: path.join(os.tmpdir(), 'tanwuzhi-mascot-grabbed.png'),
  sleeping: path.join(os.tmpdir(), 'tanwuzhi-mascot-sleeping.png'),
  bubble: path.join(os.tmpdir(), 'tanwuzhi-mascot-bubble.png'),
  component: path.join(os.tmpdir(), 'tanwuzhi-mascot-component.png'),
  chat: path.join(os.tmpdir(), 'tanwuzhi-mascot-chat-logo.png'),
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

let ws;
try {
  let debuggerPort;
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => {
    debuggerPort ||= chunk.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
  });
  for (let attempt = 0; attempt < 40 && !debuggerPort; attempt++) await wait(100);
  assert.ok(debuggerPort, 'Could not discover the Edge debugging port');

  const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  assert.ok(target, 'Could not find a browser page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return result.result.value;
  };
  const setViewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  });
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  });
  const screenshot = async (file) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  };
  const layout = () => evaluate(`(() => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const gesture = document.querySelector('.gesture-toggle');
    const rect = (node) => node ? ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }) : null;
    const a = rect(mascot); const b = rect(gesture);
    const overlaps = Boolean(a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y);
    return { ready: mascot?.dataset.ready, state: mascot?.dataset.state, tailAngle: Number(mascot?.dataset.tailAngle || 0), poseAngle: Number(mascot?.dataset.poseAngle || 0), anchorLocal: mascot?.dataset.anchorLocal, poseClipped: mascot?.dataset.poseClipped, direction: mascot?.dataset.direction, mascot: a, gesture: b, overlaps, panelOpen: document.querySelector('.agent-panel')?.classList.contains('open') || false, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await setViewport(1440, 900);
  await send('Page.navigate', { url: `${base}/#/craft/SHIH_0001` });
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await layout()).ready === 'true') break;
    await wait(150);
  }
  const desktop = await layout();
  assert.equal(desktop.ready, 'true', 'Mascot canvas did not become ready');
  assert.equal(desktop.overlaps, false, 'Mascot overlaps the gesture toggle on desktop');
  assert.equal(desktop.overflow, false, 'Mascot causes horizontal overflow on desktop');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.craft-page .workbench-col'))")) break;
    await wait(100);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('.craft-page .workbench-col'))"), true, 'Craft workbench did not become available for mascot landing');

  const lowerScreenBubble = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    mascot.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'tap' } }));
    setTimeout(() => {
      const outer = mascot.getBoundingClientRect();
      const bounds = mascot.dataset.visualBounds.split(',').map(Number);
      const scaleX = outer.width / mascot.offsetWidth;
      const scaleY = outer.height / mascot.offsetHeight;
      const anchor = { top: outer.top + bounds[1] * scaleY, bottom: outer.top + bounds[3] * scaleY };
      const bubble = document.querySelector('.mascot-bubble');
      const rect = bubble.getBoundingClientRect();
      resolve({ placement: bubble.dataset.placement, gap: anchor.top - rect.bottom, background: getComputedStyle(bubble).backgroundColor });
      bubble.classList.remove('is-visible');
    }, 260);
  }))()`);
  assert.equal(lowerScreenBubble.placement, 'above', 'Bubble should stay above a mascot in the lower half of the viewport');
  assert.ok(lowerScreenBubble.gap >= 16 && lowerScreenBubble.gap <= 20, `Lower bubble gap is unstable: ${lowerScreenBubble.gap}`);
  assert.match(lowerScreenBubble.background, /0\.6\)/, 'Bubble background should use 60% opacity');
  await evaluate("document.querySelector('.cat-mascot-fab')?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'reset' } }))");
  await wait(80);

  const componentLanding = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const host = document.querySelector('.agent-fab');
    const surface = document.querySelector('.craft-page .workbench-col');
    const start = mascot.getBoundingClientRect();
    const target = surface.getBoundingClientRect();
    const common = { bubbles: true, cancelable: true, pointerId: 914, pointerType: 'mouse', isPrimary: true, button: 0 };
    const startX = start.left + start.width / 2;
    const startY = start.top + start.height / 2;
    const targetX = target.left + target.width / 2;
    const targetY = startY + target.top - (innerHeight - 20);
    mascot.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: startX, clientY: startY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: targetX, clientY: targetY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: targetX, clientY: targetY, buttons: 0 }));
    setTimeout(() => resolve({ surface: host.dataset.catWalkSurface || '', state: mascot.dataset.state }), 80);
  }))()`);
  assert.match(componentLanding.surface, /workbench-col/, 'Mascot did not land on the selected page component');
  assert.ok(['falling', 'fallen'].includes(componentLanding.state), 'Mascot did not settle onto the component after release');
  await wait(1300);
  const upperScreenBubble = await evaluate(`(() => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const outer = mascot.getBoundingClientRect();
    const bounds = mascot.dataset.visualBounds.split(',').map(Number);
    const scaleY = outer.height / mascot.offsetHeight;
    const anchor = { top: outer.top + bounds[1] * scaleY, bottom: outer.top + bounds[3] * scaleY };
    const bubble = document.querySelector('.mascot-bubble');
    const rect = bubble.getBoundingClientRect();
    return { placement: bubble.dataset.placement, gap: rect.top - anchor.bottom };
  })()`);
  assert.equal(upperScreenBubble.placement, 'below', 'Bubble should stay below a mascot in the upper half of the viewport');
  assert.ok(upperScreenBubble.gap >= 16 && upperScreenBubble.gap <= 20, `Upper bubble gap is unstable: ${upperScreenBubble.gap}`);
  await screenshot(screenshots.component);

  const bottomLanding = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const host = document.querySelector('.agent-fab');
    const surface = document.querySelector('.craft-page .workbench-col').getBoundingClientRect();
    const start = mascot.getBoundingClientRect();
    const common = { bubbles: true, cancelable: true, pointerId: 915, pointerType: 'mouse', isPrimary: true, button: 0 };
    const startX = start.left + start.width / 2;
    const startY = start.top + start.height / 2;
    const targetY = startY + (innerHeight - 20) - surface.top;
    mascot.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: startX, clientY: startY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: startX, clientY: targetY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: startX, clientY: targetY, buttons: 0 }));
    setTimeout(() => resolve({ surface: host.dataset.catWalkSurface || '', bottom: getComputedStyle(host).bottom, state: mascot.dataset.state }), 80);
  }))()`);
  assert.equal(bottomLanding.surface, '', 'Mascot should return to the bottom rail when no component is hit');
  assert.equal(bottomLanding.bottom, '-6px', 'Mascot bottom rail should be 20px lower than before');
  assert.ok(['falling', 'fallen'].includes(bottomLanding.state), 'Mascot did not settle onto the bottom rail after release');
  await wait(1400);

  await evaluate("document.querySelector('.craft-page .ev-link')?.click()");
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.modal-mask .modal'))")) break;
    await wait(80);
  }
  await wait(350);
  const modalLanding = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const host = document.querySelector('.agent-fab');
    const modal = document.querySelector('.modal-mask .modal');
    const start = mascot.getBoundingClientRect();
    const target = modal.getBoundingClientRect();
    const common = { bubbles: true, cancelable: true, pointerId: 916, pointerType: 'mouse', isPrimary: true, button: 0 };
    const startX = start.left + start.width / 2;
    const startY = start.top + start.height / 2;
    const targetX = target.left + target.width / 2;
    const targetY = startY + target.top - (innerHeight - 20);
    mascot.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: startX, clientY: startY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: targetX, clientY: targetY, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: targetX, clientY: targetY, buttons: 0 }));
    setTimeout(() => resolve({ surface: host.dataset.catWalkSurface || '', zIndex: Number(getComputedStyle(host).zIndex), modalTop: target.top, workbenchTop: document.querySelector('.workbench-col')?.getBoundingClientRect().top, startY, targetY }), 80);
  }))()`);
  assert.match(modalLanding.surface, /modal/, `Mascot did not recognize the open dialog as a preferred landing surface: ${JSON.stringify(modalLanding)}`);
  assert.ok(modalLanding.zIndex > 800, 'Mascot should render above the dialog it is standing on');
  await evaluate("document.querySelector('.modal .m-close')?.click()");
  await wait(500);
  assert.equal(await evaluate("document.querySelector('.agent-fab')?.dataset.catWalkSurface || ''"), '', 'Mascot should return to the bottom rail when its dialog closes');

  await evaluate("document.querySelector('.cat-mascot-fab')?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'reset' } }))");
  await wait(80);
  const interactionStart = await layout();

  const startX = interactionStart.mascot.x + interactionStart.mascot.width / 2;
  const startY = interactionStart.mascot.y + interactionStart.mascot.height / 2;
  await mouse('mousePressed', startX, startY, 1);
  await mouse('mouseMoved', startX - 120, startY - 90, 1);
  await wait(180);
  const dragged = await layout();
  assert.equal(dragged.state, 'grabbed', 'Mascot did not enter the grabbed state');
  assert.ok(dragged.poseAngle < -0.8, `Grabbed mascot body did not hang from the head anchor: ${dragged.poseAngle}`);
  assert.ok(Math.abs(dragged.tailAngle) > 0.08, `Grabbed mascot tail did not react to movement: ${dragged.tailAngle}`);
  assert.equal(dragged.anchorLocal, desktop.anchorLocal, 'Head anchor moved when the mascot switched into the grabbed pose');
  assert.equal(dragged.poseClipped, 'false', 'Grabbed mascot pose exceeded the expanded animation canvas');
  await screenshot(screenshots.grabbed);
  await mouse('mouseReleased', startX - 120, startY - 90);
  await wait(100);
  const released = await layout();
  assert.equal(released.panelOpen, false, 'Dragging the mascot opened the assistant panel');
  assert.ok(['falling', 'fallen'].includes(released.state), 'Released mascot did not fall toward the page bottom');
  await wait(2400);

  const overlapTarget = await evaluate(`(() => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const outer = mascot.getBoundingClientRect();
    const visual = mascot.dataset.visualBounds.split(',').map(Number);
    const scaleX = outer.width / mascot.offsetWidth;
    const scaleY = outer.height / mascot.offsetHeight;
    const centerX = outer.left + ((visual[0] + visual[2]) / 2) * scaleX;
    const centerY = outer.top + ((visual[1] + visual[3]) / 2) * scaleY;
    const button = document.createElement('button');
    button.id = 'mascot-overlap-target';
    button.textContent = '重叠按钮测试';
    Object.assign(button.style, { position: 'fixed', left: (centerX - 58) + 'px', top: (centerY - 24) + 'px', width: '116px', height: '48px', zIndex: '499' });
    button.addEventListener('click', () => { button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1); });
    document.body.appendChild(button);
    const hitbox = mascot.querySelector('.cat-mascot-hitbox')?.getBoundingClientRect();
    return { x: centerX, y: centerY, hitbox: hitbox ? { width: hitbox.width, height: hitbox.height } : null };
  })()`);
  assert.ok(overlapTarget.hitbox?.width > 0 && overlapTarget.hitbox?.height > 0, 'Mascot visible hitbox was not created');
  assert.ok(overlapTarget.hitbox.width < interactionStart.mascot.width || overlapTarget.hitbox.height < interactionStart.mascot.height, 'Mascot hitbox still covers the full transparent root box');
  await mouse('mousePressed', overlapTarget.x, overlapTarget.y, 1);
  await mouse('mouseReleased', overlapTarget.x, overlapTarget.y);
  await wait(120);
  const overlapClick = await evaluate(`(() => {
    const button = document.querySelector('#mascot-overlap-target');
    const result = { clicks: Number(button?.dataset.clicks || 0), panelOpen: document.querySelector('.agent-panel')?.classList.contains('open') || false };
    button?.remove();
    return result;
  })()`);
  assert.equal(overlapClick.clicks, 1, 'Clicking a button beneath the mascot should activate the button once');
  assert.equal(overlapClick.panelOpen, false, 'Click-through to an underlying button should not activate the mascot');

  const gestureDrag = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    const rect = mascot.getBoundingClientRect();
    const common = { bubbles: true, cancelable: true, pointerId: 913, pointerType: 'mouse', isPrimary: true, button: 0 };
    mascot.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, buttons: 1 }));
    document.elementFromPoint(30, 160).dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: 30, clientY: 160, buttons: 1 }));
    requestAnimationFrame(() => {
      const state = mascot.dataset.state;
      const translated = mascot.style.translate;
      mascot.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: 30, clientY: 160, buttons: 0 }));
      resolve({ state, translated });
    });
  }))()`);
  assert.equal(gestureDrag.state, 'grabbed', 'Synthetic gesture pointer did not retain the grabbed state outside the mascot');
  assert.notEqual(gestureDrag.translated, '', 'Synthetic gesture pointer did not move the mascot');
  await wait(2400);

  const commanded = await evaluate(`(() => new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    mascot.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'reset' } }));
    const beforeX = mascot.getBoundingClientRect().x;
    mascot.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'walk', duration: 420 } }));
    requestAnimationFrame(() => {
      const walking = mascot.dataset.state;
      setTimeout(() => {
        const afterX = mascot.getBoundingClientRect().x;
        const direction = mascot.dataset.direction;
        const canvasTransform = mascot.querySelector('canvas').style.transform;
        setTimeout(() => resolve({ walking, settled: mascot.dataset.state, beforeX, afterX, direction, canvasTransform }), 360);
      }, 140);
    });
  }))()`);
  assert.equal(commanded.walking, 'walking', 'Mascot did not enter autonomous walking state');
  assert.equal(commanded.settled, 'idle', 'Mascot did not settle after a commanded walk');
  assert.ok(commanded.direction === 'right' ? commanded.afterX > commanded.beforeX : commanded.afterX < commanded.beforeX, 'Mascot body faces a direction that disagrees with its movement');
  assert.equal(commanded.canvasTransform, commanded.direction === 'left' ? 'scaleX(-1)' : '', 'Mascot sprite orientation disagrees with walking direction');
  await evaluate("document.querySelector('.cat-mascot-fab')?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'sleep', duration: 1500 } }))");
  await wait(180);
  assert.equal((await layout()).state, 'sleeping', 'Mascot did not remain in its resting pose');
  assert.equal(await evaluate("document.querySelector('.cat-mascot-fab')?.dataset.poseMode"), 'ragdoll-flat', 'Sleeping pose should use the reusable flat ragdoll pose');
  await screenshot(screenshots.sleeping);

  const lookAround = await evaluate(`new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    mascot?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'look_around', duration: 700 } }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(mascot?.dataset.transient)));
  })`);
  assert.equal(lookAround, 'look_around', 'Mascot did not perform its rapid look-around behavior');
  const happyTail = await evaluate(`new Promise((resolve) => {
    const mascot = document.querySelector('.cat-mascot-fab');
    mascot?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'tail_happy', duration: 700 } }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(mascot?.dataset.transient)));
  })`);
  assert.equal(happyTail, 'tail_happy', 'Mascot did not perform its happy tail behavior');
  await evaluate("document.querySelector('.cat-mascot-fab')?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'joy_jump', duration: 620 } }))");
  await wait(100);
  assert.equal((await layout()).state, 'jumping', 'Mascot did not enter its joyful jump state');
  await wait(650);
  await evaluate("document.querySelector('.cat-mascot-fab')?.dispatchEvent(new CustomEvent('mascot-command', { detail: { type: 'deep_sleep' } }))");
  await wait(650);
  assert.equal((await layout()).state, 'deep_sleeping', 'Deep sleep should persist until interaction');

  const tapPoint = await evaluate(`(() => {
    const rect = document.querySelector('.cat-mascot-fab .cat-mascot-hitbox')?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  assert.ok(tapPoint, 'Mascot visible hitbox is unavailable for tap interaction');
  const tapX = tapPoint.x;
  const tapY = tapPoint.y;
  await mouse('mouseMoved', 60, 80);
  await wait(150);
  const gaze = await evaluate("document.querySelector('.cat-mascot-fab')?.dataset.gaze");
  assert.notEqual(gaze, '0.00,0.00', 'Mascot eyes did not respond to pointer movement');
  await mouse('mousePressed', tapX, tapY, 1);
  await mouse('mouseReleased', tapX, tapY);
  await wait(400);
  assert.equal((await layout()).panelOpen, false, 'A short mascot interaction should not immediately open the full panel');
  const tapFeedback = await evaluate(`(() => ({
    transient: document.querySelector('.cat-mascot-fab')?.dataset.transient,
    bubble: document.querySelector('.mascot-bubble')?.classList.contains('is-visible') || false
  }))()`);
  assert.equal(tapFeedback.transient, 'tap', 'Clicking the mascot did not wiggle its ears');
  assert.equal(tapFeedback.bubble, true, 'Clicking the mascot did not show a short dialogue bubble');
  assert.notEqual((await layout()).state, 'deep_sleeping', 'Clicking the mascot should wake it from deep sleep');
  await screenshot(screenshots.bubble);
  const continueRect = await evaluate(`(() => {
    const rect = document.querySelector('.mascot-bubble button')?.getBoundingClientRect();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
  })()`);
  assert.ok(continueRect, 'Companion dialogue did not expose a continue action');
  await mouse('mousePressed', continueRect.x, continueRect.y, 1);
  await mouse('mouseReleased', continueRect.x, continueRect.y);
  await wait(300);
  const continuationImmediate = await evaluate(`(() => ({
    panelOpen: document.querySelector('.agent-panel')?.classList.contains('open') || false,
    bridge: Boolean(document.querySelector('.ap-companion-bridge')),
    welcomeRepeated: document.querySelector('.ap-log')?.textContent.includes('你好，我是小蕉') || false,
    noticeRemoved: !document.querySelector('.ap-notice'),
    voiceNoteRemoved: !document.querySelector('.ap-voice-note'),
    readingControlRemoved: ![...document.querySelectorAll('.ap-voice-button')].some((node) => node.textContent.includes('朗读')),
  }))()`);
  assert.equal(continuationImmediate.panelOpen, true, 'Continue action did not open the assistant panel');
  assert.equal(continuationImmediate.bridge, true, 'Assistant did not carry the companion message into the conversation');
  assert.equal(continuationImmediate.welcomeRepeated, false, 'First continuation was replaced by the generic welcome message');
  assert.equal(continuationImmediate.noticeRemoved, true, 'Model notice should be removed from the panel');
  assert.equal(continuationImmediate.voiceNoteRemoved, true, 'Long voice notice should be removed from the panel');
  assert.equal(continuationImmediate.readingControlRemoved, true, 'Reading control should be removed from the panel');
  const relationshipView = await evaluate(`(() => ({
    dots: document.querySelectorAll('.ap-relationship-dots i').length,
    awake: document.querySelectorAll('.ap-relationship-dots i.is-awake').length,
    text: document.querySelector('.ap-relationship-text')?.textContent || '',
  }))()`);
  assert.equal(relationshipView.dots, 5, 'Relationship state should render exactly five points');
  assert.ok(relationshipView.awake >= 1 && relationshipView.awake <= 5, 'Relationship state has an invalid number of active points');
  assert.ok(relationshipView.text.includes('小蕉') || relationshipView.text.includes('你和小蕉'), 'Relationship state should use a natural-language description');
  await wait(4500);
  const continuationResult = await evaluate(`(() => ({
    messages: document.querySelectorAll('.ap-msg.agent').length,
    links: document.querySelectorAll('.ap-explore-link').length,
    followups: document.querySelectorAll('.ap-followup').length,
  }))()`);
  assert.ok(continuationResult.messages >= 2, 'Assistant did not continue answering after the bridge message');
  assert.ok(continuationResult.links >= 1, 'Continuation did not include a relevant exploration entry');
  assert.ok(continuationResult.followups >= 2, 'Continuation did not include related knowledge prompts');
  await evaluate("document.querySelector('.mascot-bubble button')?.click()");
  await wait(400);
  const opened = await layout();
  assert.equal(opened.panelOpen, true, 'The dialogue action did not open the assistant panel');
  const chatAvatar = await evaluate(`(() => {
    const image = document.querySelector('.ap-msg.agent .ap-avatar-jiao img');
    return {
      source: image?.getAttribute('src') || '',
      loaded: Boolean(image?.complete && image.naturalWidth > 0),
    };
  })()`);
  assert.equal(chatAvatar.loaded, true, 'The Xiao Jiao chat avatar did not load');
  assert.match(chatAvatar.source, /\/brand\/logo\.png(?:\?.*)?$/, 'The Xiao Jiao chat avatar is not using the shared brand logo');
  await screenshot(screenshots.chat);
  assert.equal(opened.state, 'awake', 'Mascot should stay awake beside the open assistant panel');

  await setViewport(390, 844, true);
  await wait(500);
  const mobile = await layout();
  assert.equal(mobile.overlaps, false, 'Mascot overlaps the gesture toggle on mobile');
  assert.equal(mobile.overflow, false, 'Mascot causes horizontal overflow on mobile');

  console.log(JSON.stringify({ desktop, dragged, released, gestureDrag, commanded, gaze, tapFeedback, opened, chatAvatar, mobile, screenshots }, null, 2));
} finally {
  ws?.close();
  if (!browser.killed) browser.kill();
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    wait(2000),
  ]);
  if (profile.startsWith(os.tmpdir())) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch { /* OS releases the temporary Edge profile shortly after exit. */ }
  }
}
