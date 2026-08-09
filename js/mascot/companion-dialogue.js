const pick = (items) => items[Math.floor(Math.random() * items.length)];
const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const clip = (value, length = 62) => {
  const text = clean(value);
  if (text.length <= length) return text;
  const short = text.slice(0, length);
  const stop = Math.max(short.lastIndexOf('。'), short.lastIndexOf('；'), short.lastIndexOf('，'));
  return `${short.slice(0, stop > 28 ? stop + 1 : length)}…`;
};

function messageFor(type, payload = {}) {
  if (type === 'walk') return pick([
    '我沿着网页边缘巡一圈，看看有没有新线索。',
    '光影换了方向，我也去页面边上找找新的入口。',
    '我去看看地图和工序之间，有没有悄悄连起来的脉络。',
    '慢慢走，器物留下的线索常藏在不起眼的角落。',
    '巡游时间到。也许下一步就会遇见一门没见过的手艺。',
    '我去活动一下关节，坐得太久可看不到新故事。',
  ]);
  if (type === 'sleep') return pick([
    '走累了，先把尾巴收好…… Zzz',
    '纸影也要歇一歇。Zzz…',
    '先趴一会儿，等新的非遗线索把我叫醒。',
    '把爪子藏好，做一个有竹香和纸墨味的梦…… Zzz',
    '光影暂停一下，小蕉进入省电模式。Zzz…',
  ]);
  if (type === 'wake') return pick([
    '醒啦，接着找藏在器物里的故事。',
    '光又亮了。刚才我们探索到哪里了？',
    '伸个懒腰，继续沿着材料和工艺往外找。',
    '休息好了，我又能陪你沿着线索往外走了。',
  ]);
  if (type === 'grab') return pick([
    '轻一点，我的关节像皮影一样是活动的。',
    '被拎起来啦，脚和尾巴要晃起来了。',
    '抓稳头部，身体会像皮影偶一样顺着重力垂下来。',
    '悬空视角也不错，能把页面上的线索看得更远。',
    '我的剪纸轮廓很轻，尾巴可还会继续甩。',
  ]);
  if (type === 'drop') return pick([
    '要落地了，我先收一收爪子。',
    '松手啦，尾巴先帮我找平衡。',
    '正在下落，看看这次能不能稳稳站住。',
    '皮影武生落台，也得讲究一个身段。',
  ]);
  if (type === 'land') return pick([
    '啪嗒！还好剪纸小猫身段轻。',
    '落地姿势有点像皮影武生……让我缓一下。',
    '尾巴没来得及扶稳我，再躺半秒。',
    '这一跤提醒我：手艺里的重心真的很重要。',
    '安全落地，只是姿势还需要再练练。',
  ]);
  if (type === 'recover') return pick([
    '站好啦，继续探索。',
    '拍拍纸屑，我又可以出发了。',
    '关节归位，下一条线索在哪里？',
    '没事，皮影角色最擅长重新站上舞台。',
  ]);
  if (type === 'tap') return pick([
    '收到信号了。你可以点下面的按钮继续问我。',
    '我从皮影和剪纸中诞生，也喜欢追着器物的故事跑。',
    '我会留意你正在看的地方，再递上一条短线索。',
    '听见啦。材料、地域和工序，你想先沿着哪条线走？',
    '别看我只是一只小猫，我记得不少上海手艺的线索。',
    '附近可能有值得探索的内容，要不要一起看看？',
    '点一点是短提示，继续问我可以获得完整讲解。',
    '有些非遗看起来不同，却可能共享同一种材料或生活环境。',
  ]);
  if (type === 'district') {
    const name = clean(payload.name) || '这个地区';
    const overview = clip(payload.heritageOverview || payload.summary, 68);
    if (!overview) return pick([
      `${name}里藏着不少与日常生活相连的非遗，可以从一个项目慢慢向外探索。`,
      `先别急着离开${name}，看看这里的材料、节俗和生活环境怎样塑造手艺。`,
      `${name}不只是一块地图区域，也是一组不断延续的生活经验。`,
    ]);
    return pick([
      `${name}的线索来了：${overview}`,
      `来到${name}，可以先留意这条脉络：${overview}`,
      `${name}的地域生活与非遗彼此影响。${overview}`,
      `如果从地方文化开始探索，${name}有这样一条入口：${overview}`,
    ]);
  }
  if (type === 'craft') {
    const title = clean(payload.title) || '这个项目';
    const summary = clip(payload.summary, 58);
    if (!summary) return pick([
      `你走近了“${title}”，先看看它的材料与工序，会更容易发现它和其他非遗的联系。`,
      `“${title}”值得慢慢看。先找原料，再看手如何让它发生变化。`,
      `探索“${title}”时，不妨同时留意它为什么会在这个地方发展。`,
    ]);
    return pick([
      `你走近了“${title}”。${summary}`,
      `“${title}”的故事从这里展开：${summary}`,
      `先记住“${title}”这条线索。${summary}`,
      `观察“${title}”时，可以把材料、动作和地域放在一起看。${summary}`,
    ]);
  }
  if (type === 'step') {
    const name = clean(payload.name) || '下一道工序';
    return pick([
      `现在来到“${name}”。留意材料在这一步发生了什么变化。`,
      `“${name}”开始了。手上的力度、方向和顺序可能都很关键。`,
      `走到“${name}”这一步，可以对照前后状态看看工艺留下了什么痕迹。`,
      `别急着完成“${name}”，传统技艺常把经验藏在动作节奏里。`,
    ]);
  }
  if (type === 'action') {
    const text = clip(payload.text, 46);
    return pick([
      `我看见了：${text}。手艺的脉络常常就藏在这些小动作里。`,
      `刚才的动作是“${text}”。看看材料有没有出现新的状态。`,
      `动作记录下来啦：${text}。传统技艺依靠的正是这些可重复的经验。`,
      `完成“${text}”后，不妨比较一下操作前后的质感变化。`,
    ]);
  }
  if (type === 'graph') {
    const title = clean(payload.title) || '当前节点';
    return pick([
      `这条关系把“${title}”与更大的材料、地域或工艺脉络连了起来。`,
      `“${title}”不是孤立的，沿着连线还能找到它共享的材料与传统。`,
      `你刚进入“${title}”。试着比较它与上一个节点之间的相同和不同。`,
      `从“${title}”继续向外看，也许会遇到外形不同、原理却相通的手艺。`,
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
    const text = messageFor(type, payload);
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
