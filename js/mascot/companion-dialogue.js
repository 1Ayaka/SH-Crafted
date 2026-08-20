const pick = (items) => items[Math.floor(Math.random() * items.length)];
const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const clip = (value, length = 62) => {
  const text = clean(value);
  if (text.length <= length) return text;
  const short = text.slice(0, length);
  const stop = Math.max(short.lastIndexOf('。'), short.lastIndexOf('；'), short.lastIndexOf('，'));
  return `${short.slice(0, stop > 28 ? stop + 1 : length)}…`;
};

const EMOTION_EMOJI = Object.freeze({
  walk: '🐾', sleep: '💤', deep_sleep: '💤', wake: '👋', tap: '🐾',
  grab: '😳', drop: '💨', land: '😵', recover: '✨', joy_jump: '✨', platform_jump: '🐾',
});

const express = (type, text) => {
  const emoji = EMOTION_EMOJI[type];
  return emoji && text ? `${text} ${emoji}` : text;
};

function messageFor(type, payload = {}) {
  if (type === 'walk') return pick([
    '我去旁边转转，你慢慢看。',
    '这里我还没看过，过去瞧瞧。',
    '坐久了腿麻，我走两步。',
    '别急，我去前面探个路。',
    '这边好像有东西，我过去看看。',
    '我溜达一圈，很快回来。',
  ]);
  if (type === 'sleep') return pick([
    '有点困，我先趴会儿。Zzz…',
    '你慢慢看，我眯一小会儿。',
    '尾巴收好，睡一下……',
    '我就在这儿，等你叫我。Zzz…',
    '先打个盹，别走太远。',
  ]);
  if (type === 'wake') return pick([
    '醒了。刚才看到哪儿了？',
    '我回来啦，接着看吧。',
    '睡得正好。你发现什么了吗？',
    '伸个懒腰，继续。',
  ]);
  if (type === 'grab') return pick([
    '哎，我被拎起来了！',
    '轻一点，腿还在下面晃呢。',
    '等一下，我的尾巴还没跟上。',
    '这么高？让我看看。',
    '抓稳啦，我可要晃了。',
  ]);
  if (type === 'drop') return pick([
    '松手啦？我要落地了。',
    '等会儿，我还没站稳！',
    '尾巴尾巴，快帮我一下。',
    '好，准备落地。',
  ]);
  if (type === 'land') return pick([
    '啪嗒……让我躺两秒。',
    '落地了，就是姿势不太体面。',
    '没事没事，我缓一下。',
    '差一点就站住了。真的。',
    '还好是纸做的，不疼。',
  ]);
  if (type === 'recover') return pick([
    '好啦，我站稳了。',
    '拍拍灰，没事。',
    '我又回来啦。',
    '刚才什么也没发生。',
  ]);
  if (type === 'tap') return pick([
    '在呢。你想问什么？',
    '怎么啦？我听着呢。',
    '这儿有不少故事，挑一个聊聊？',
    '你现在看的这个，我也有点好奇。',
    '要不要看看它是怎么做出来的？',
    '我记得一些上海手艺的事，可以问我。',
    '点到什么有趣的了吗？',
    '我从皮影和剪纸里来，对手上的功夫最感兴趣。',
  ]);
  if (type === 'deep_sleep') return pick([
    '这次想多睡一会儿，点点我再起床。',
    '我先睡熟一点。想继续时把我叫醒吧。',
  ]);
  if (type === 'platform_jump') return pick([
    '上面看起来不错，我跳上去看看。',
    '借过一下，我想到高处待一会儿。',
  ]);
  if (type === 'joy_jump') return pick([
    '刚才那一下，我很喜欢。',
    '忍不住跳了一下。',
  ]);
  if (type === 'district') {
    const name = clean(payload.name) || '这个地区';
    const overview = clip(payload.heritageOverview || payload.summary, 68);
    if (!overview) return pick([
      `${name}到了。先看看这里有什么手艺。`,
      `${name}有不少老手艺，很多就藏在日常生活里。`,
      `别急着走，${name}还有不少东西可以看。`,
    ]);
    return pick([
      `到${name}了。${overview}`,
      `${name}这边挺有意思：${overview}`,
      `说到${name}，有件事值得留意：${overview}`,
      `先看看${name}。${overview}`,
    ]);
  }
  if (type === 'craft') {
    const title = clean(payload.title) || '这个项目';
    const summary = clip(payload.summary, 58);
    if (!summary) return pick([
      `“${title}”到了。先看看它用了什么材料。`,
      `这个是“${title}”。别急，慢慢看。`,
      `“${title}”的门道，多半藏在手上的动作里。`,
    ]);
    return pick([
      `这是“${title}”。${summary}`,
      `“${title}”挺有意思。${summary}`,
      `刚好说到“${title}”：${summary}`,
      `先看看“${title}”。${summary}`,
    ]);
  }
  if (type === 'step') {
    const name = clean(payload.name) || '下一道工序';
    return pick([
      `到“${name}”了，看看材料会怎么变。`,
      `这一步是“${name}”，手上要稳一点。`,
      `“${name}”看着简单，做起来可不一定。`,
      `先别赶，“${name}”这一步得慢慢来。`,
    ]);
  }
  if (type === 'action') {
    const text = clip(payload.text, 46);
    return pick([
      `看见了：${text}。材料好像有点变化。`,
      `刚才做的是“${text}”，手感应该不一样了。`,
      `“${text}”完成。看看和刚才有什么不同。`,
      `这一下很关键：${text}。`,
    ]);
  }
  if (type === 'graph') {
    const title = clean(payload.title) || '当前节点';
    return pick([
      `到“${title}”了。旁边几条线都可以点开看看。`,
      `原来“${title}”还和这些东西有关。`,
      `“${title}”和刚才那个不太一样，你看出来了吗？`,
      `先停在“${title}”看看，附近可能还有熟悉的材料。`,
    ]);
  }
  return '';
}

export function createCompanionDialogue({ anchor, onOpenAgent } = {}) {
  const viewportPadding = 12;
  const bubbleGap = 18;
  const upperFlipLine = 0.42;
  const lowerFlipLine = 0.58;
  const bubble = document.createElement('aside');
  bubble.className = 'mascot-bubble';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  const copy = document.createElement('p');
  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = '继续问小蕉';
  let pendingContinuation = null;
  let lastSemanticContinuation = null;
  let lastSemanticContinuationAt = 0;
  action.addEventListener('click', () => {
    const pendingIsSemantic = ['district', 'craft', 'step', 'action', 'graph'].includes(pendingContinuation?.type);
    const recentSemantic = performance.now() - lastSemanticContinuationAt < 45000 ? lastSemanticContinuation : null;
    const continuation = pendingIsSemantic ? pendingContinuation : (recentSemantic || pendingContinuation);
    pendingContinuation = null;
    hide();
    onOpenAgent?.(continuation);
  });
  bubble.append(copy, action);
  document.body.appendChild(bubble);
  let anchorElement = anchor || null;
  let hideTimer = 0;
  let frame = 0;
  let lastSemanticAt = 0;
  let lastSemanticKey = '';
  let placement = '';

  const visualAnchorRect = () => {
    const rect = anchorElement.getBoundingClientRect();
    const bounds = String(anchorElement.dataset.visualBounds || '').split(',').map(Number);
    if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) return rect;
    const scaleX = rect.width / Math.max(1, anchorElement.offsetWidth || rect.width);
    const scaleY = rect.height / Math.max(1, anchorElement.offsetHeight || rect.height);
    const left = rect.left + bounds[0] * scaleX;
    const top = rect.top + bounds[1] * scaleY;
    const right = rect.left + bounds[2] * scaleX;
    const bottom = rect.top + bounds[3] * scaleY;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  const position = () => {
    frame = 0;
    if (!bubble.classList.contains('is-visible') || !anchorElement?.isConnected) return;
    const rect = visualAnchorRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const roomAbove = rect.top - viewportPadding;
    const roomBelow = innerHeight - viewportPadding - rect.bottom;
    const requiredRoom = bubbleRect.height + bubbleGap;
    if (!placement) placement = centerY <= innerHeight / 2 ? 'below' : 'above';
    if (placement === 'above' && centerY < innerHeight * upperFlipLine) placement = 'below';
    if (placement === 'below' && centerY > innerHeight * lowerFlipLine) placement = 'above';
    if (placement === 'above' && roomAbove < requiredRoom && roomBelow > roomAbove) placement = 'below';
    if (placement === 'below' && roomBelow < requiredRoom && roomAbove > roomBelow) placement = 'above';

    const rawLeft = rect.left + rect.width / 2 - bubbleRect.width / 2;
    const rawTop = placement === 'below'
      ? rect.bottom + bubbleGap
      : rect.top - bubbleRect.height - bubbleGap;
    const left = Math.round(Math.max(viewportPadding, Math.min(innerWidth - bubbleRect.width - viewportPadding, rawLeft)));
    const top = Math.round(Math.max(viewportPadding, Math.min(innerHeight - bubbleRect.height - viewportPadding, rawTop)));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.dataset.placement = placement;
    const anchorZ = Number.parseInt(getComputedStyle(anchorElement.closest('.agent-fab') || anchorElement).zIndex, 10);
    bubble.style.zIndex = String(Math.max(1510, (Number.isFinite(anchorZ) ? anchorZ : 500) + 1));
    frame = requestAnimationFrame(position);
  };
  function hide() {
    clearTimeout(hideTimer);
    bubble.classList.remove('is-visible');
    pendingContinuation = null;
    cancelAnimationFrame(frame);
    frame = 0;
    placement = '';
    delete bubble.dataset.placement;
  }
  const show = (text, { duration = 5200, withAction = true, continuation = null } = {}) => {
    if (!text) return;
    clearTimeout(hideTimer);
    copy.textContent = text;
    pendingContinuation = withAction ? continuation : null;
    action.hidden = !withAction;
    placement = '';
    bubble.classList.add('is-visible');
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
    hideTimer = setTimeout(hide, duration);
  };
  const respond = (type, payload = {}, options = {}) => {
    const semantic = ['district', 'craft', 'step', 'action', 'graph'].includes(type);
    const pendingSemantic = ['district', 'craft', 'step', 'action', 'graph'].includes(pendingContinuation?.type);
    if (!semantic && pendingSemantic && bubble.classList.contains('is-visible')) return;
    const key = `${type}:${payload.id || payload.name || payload.title || payload.text || ''}`;
    const now = performance.now();
    if (semantic && key === lastSemanticKey && now - lastSemanticAt < 4500) return;
    if (semantic && now - lastSemanticAt < 1300) return;
    if (semantic) { lastSemanticKey = key; lastSemanticAt = now; }
    const text = express(type, messageFor(type, payload));
    const continuation = { type, payload: { ...payload }, text };
    if (semantic) {
      lastSemanticContinuation = continuation;
      lastSemanticContinuationAt = now;
    }
    show(text, {
      withAction: type !== 'sleep',
      duration: semantic ? 10000 : undefined,
      continuation,
      ...options,
    });
  };

  return {
    element: bubble,
    respond,
    show,
    hide,
    setAnchor(next) { anchorElement = next; },
    destroy() { hide(); bubble.remove(); },
  };
}
