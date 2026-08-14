import { el } from '../ui.js';
import { topNav } from './home.js';
import { agent } from '../agent.js';
import { transitionTo } from '../transitions.js';
import { createHeritageGraphOverviewState, createHeritageGraphState, openGraphBranch, selectGraphNode } from '../heritage-graph.js';
import { mountHeritageGraph } from '../heritage-graph-3d.js';
import { isContentReviewed } from '../data.js';
import { openGraphContribution } from '../graph-contribution.js';
import {
  getGraphNode,
  graphId,
  graphNodes,
  heritageForGraphTarget,
  heritageDetailTarget,
} from '../agent/graph-adapter.js';

const TYPE_LABELS = { heritage: '非遗项目', region: '地区', tradition: '传统', material: '材料' };
const TARGET_RELATIONS = { region: 'LOCATED_IN', tradition: 'BELONGS_TO_TRADITION', material: 'USES_MATERIAL' };

function resolveInitialState(requestedId) {
  if (!requestedId) return { state: createHeritageGraphOverviewState(), requested: null };
  const requested = getGraphNode(requestedId);
  const defaultRoot = getGraphNode(graphId('heritage', 'SHIH_0004'))
    || graphNodes().find((node) => node.type === 'heritage');
  if (!requested) return { state: createHeritageGraphState(defaultRoot?.id), requested: null };
  if (requested.type === 'heritage') return { state: createHeritageGraphState(requested.id), requested };

  const related = heritageForGraphTarget(requested.id);
  const root = related.nodes[0] || defaultRoot;
  const state = createHeritageGraphState(root?.id);
  if (state.root && related.relation) {
    openGraphBranch(state, related.relation);
    selectGraphNode(state, requested);
  }
  return { state, requested };
}

export async function graphView(root, params = {}) {
  const requestedId = decodeURIComponent(params.nodeId || '');
  const { state, requested } = resolveInitialState(requestedId);
  if (!state.root && state.mode !== 'overview') {
    root.appendChild(el('section', { class: 'view passport' }, [
      topNav('graph'),
      el('p', { text: '知识星图尚无可公开展示的根节点。' }),
    ]));
    return {};
  }

  let explorer = null;
  let disposed = false;
  let gestureRetry = 0;
  const heading = el('h1', { id: 'graph-page-heading', text: state.mode === 'overview' ? '上海非遗星图' : state.root.title });
  const subtitle = el('p', { class: 'heritage-graph-subtitle', text: state.mode === 'overview' ? '选择一个非遗项目，进入它的关系网络' : requested ? `正在探索：${requested.title}` : '选择一条关系继续探索' });
  const trail = el('nav', { class: 'heritage-graph-trail', 'aria-label': '知识图谱路径' });
  const info = el('aside', { class: 'heritage-graph-info', 'aria-live': 'polite' });
  const canvasHost = el('div', { class: 'heritage-graph-stage', 'aria-label': '知识图谱三维舞台' });
  const zoomControls = el('div', { class: 'heritage-graph-zoom', role: 'group', 'aria-label': '星图缩放' }, [
    el('button', { type: 'button', text: '缩小', onclick: () => explorer?.gestureAdapter?.().zoomBy(1.18) }),
    el('button', { type: 'button', text: '还原', onclick: () => explorer?.gestureAdapter?.().resetView() }),
    el('button', { type: 'button', text: '放大', onclick: () => explorer?.gestureAdapter?.().zoomBy(0.84) }),
  ]);
  const atmosphere = document.createElement('div');
  atmosphere.className = 'heritage-graph-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  atmosphere.innerHTML = `<svg viewBox="0 0 1600 900" preserveAspectRatio="none">
    <g class="heritage-graph-orbit-lines">
      <ellipse cx="790" cy="470" rx="610" ry="245" transform="rotate(-8 790 470)" />
      <ellipse cx="820" cy="455" rx="455" ry="365" transform="rotate(17 820 455)" />
      <path d="M-90 700 C290 500 510 590 760 410 S1240 180 1690 300" />
      <path d="M120 110 C420 245 535 120 810 230 S1275 510 1600 430" />
    </g>
    <g class="heritage-graph-coordinate-marks">
      <path d="M160 236h76M198 198v76M1360 646h76M1398 608v76" />
      <circle cx="198" cy="236" r="52"/><circle cx="1398" cy="646" r="52"/>
    </g>
  </svg>
  <i class="heritage-graph-mist mist-far"></i>
  <i class="heritage-graph-mist mist-mid"></i>
  <i class="heritage-graph-mist mist-near"></i>`;
  const shell = el('div', { class: `heritage-graph-overlay heritage-graph-page-shell${state.mode === 'overview' ? ' is-overview' : ''}`, 'aria-labelledby': 'graph-page-heading' }, [
    el('div', { class: 'heritage-graph-wash', 'aria-hidden': 'true' }),
    atmosphere,
    el('header', { class: 'heritage-graph-header' }, [
      el('div', { class: 'heritage-graph-heading' }, [
        el('span', { class: 'heritage-graph-kicker', text: '上海非遗 · 中国星图' }),
        heading,
        subtitle,
      ]),
      el('a', { class: 'heritage-graph-close', href: '#/explore', text: '返回地图' }),
    ]),
    trail,
    canvasHost,
    info,
    zoomControls,
    el('p', { class: 'heritage-graph-hint', text: state.mode === 'overview' ? '拖拽浏览 · 点击非遗节点进入具体探索' : '拖拽旋转 · 滚轮或按钮缩放 · 点击星点查看资料' }),
  ]);
  const navigation = topNav('graph');
  navigation.id = 'graph-page-navigation';
  const navigationToggle = el('button', {
    class: 'graph-nav-fold-toggle', type: 'button', text: '菜单',
    'aria-controls': navigation.id, 'aria-expanded': 'false',
  });
  const setNavigationExpanded = (expanded) => {
    const next = Boolean(expanded);
    navigation.classList.toggle('is-expanded', next);
    const page = navigation.closest('.graph-page');
    page?.classList.toggle('is-nav-expanded', next);
    if (next) page?.style.setProperty('--graph-nav-height', `${navigation.getBoundingClientRect().height}px`);
    navigationToggle.setAttribute('aria-expanded', String(next));
    navigationToggle.textContent = next ? '收起' : '菜单';
    [...navigation.children].forEach((child) => {
      if (child === navigationToggle) return;
      child.inert = !next;
      child.setAttribute('aria-hidden', String(!next));
    });
  };
  navigationToggle.addEventListener('click', () => setNavigationExpanded(!navigation.classList.contains('is-expanded')));
  navigation.appendChild(navigationToggle);
  setNavigationExpanded(false);
  shell.addEventListener('pointerdown', () => setNavigationExpanded(false));
  const wrap = el('section', { class: 'view graph-page' }, [navigation, shell]);
  root.appendChild(wrap);

  function renderTrail(context) {
    trail.replaceChildren();
    (context.breadcrumb_nodes || []).forEach((node, index, nodes) => {
      trail.appendChild(el('span', { class: index === nodes.length - 1 ? 'is-current' : '', text: node.title }));
      if (index < nodes.length - 1) trail.appendChild(el('span', { class: 'heritage-graph-trail-sep', text: '·', 'aria-hidden': 'true' }));
    });
  }

  function renderInfo(context) {
    const selected = context.selected_node || context.current_root;
    info.replaceChildren();
    if (!selected) return;
    const nodeImages = Array.isArray(selected.images) ? selected.images : [];
    const galleryLabel = selected.content_role === 'map_project' ? '项目其他图片' : '节点补充图片';
    info.append(...[
      el('div', { class: 'heritage-graph-info-head' }, [
        el('span', { class: `heritage-graph-type type-${selected.type}`, text: selected.content_role === 'graph_supplement' ? '星图补充' : (TYPE_LABELS[selected.type] || '节点') }),
        el('h3', { tabindex: '-1', text: selected.title }),
      ]),
      selected.overview_image ? el('figure', { class: 'heritage-graph-main-image' }, [
          el('img', { class: 'heritage-graph-overview-image', src: selected.overview_image, alt: `${selected.title}项目主图`, loading: 'lazy' }),
          el('figcaption', { text: '项目主图' }),
        ]) : null,
      nodeImages.length ? el('section', { class: 'heritage-graph-node-images' }, [
        el('h4', { text: galleryLabel }),
        el('div', { class: 'heritage-graph-image-gallery', 'aria-label': `${selected.title}${galleryLabel}` }, nodeImages.slice(0, 8).map((image) => el('figure', { class: 'heritage-graph-image-card' }, [el('img', { src: image.image_url || image.url, alt: image.title || selected.title, loading: 'lazy' }), image.title || image.description ? el('figcaption', { text: image.title || image.description }) : null]))),
      ]) : null,
      el('p', { class: selected.summary ? '' : 'is-muted', text: selected.summary || '该节点的详细摘要与来源正在整理中。' }),
    ].filter(Boolean));
    if (selected.community_knowledge?.length) info.appendChild(el('section', { class: 'heritage-graph-community-knowledge' }, [
      el('h4', { text: '社区审核补充' }),
      ...selected.community_knowledge.slice(-4).reverse().map((item) => el('article', {}, [
        el('p', { text: item.statement }),
        item.source_url ? el('a', { href: item.source_url, target: '_blank', rel: 'noopener noreferrer', text: `来源：${item.source_title || '打开资料'}` }) : null,
        el('small', { text: '社区提交 · 管理员审核通过' }),
      ])),
    ]));
    if (context.previous_node && context.previous_node.id !== selected.id) {
      info.appendChild(el('div', { class: 'heritage-graph-relationship-note' }, [
        el('strong', { text: `与上一节点“${context.previous_node.title}”的联系` }),
        el('p', { text: context.comparison_summary || context.relationship_summary || (isContentReviewed() ? '当前关系说明正在整理。' : '当前关系的内容正在整理，待审核。') }),
        !context.relationship_summary && !isContentReviewed() ? el('small', { class: 'is-muted', text: '待审核' }) : null,
      ]));
    }
    if (context.mode === 'branch' && selected.type === 'heritage' && selected.id !== context.current_root?.id) {
      info.appendChild(el('button', { class: 'btn btn-primary heritage-graph-root-button', type: 'button', text: '以此项目继续探索', onclick: () => { explorer.setRoot(selected); renderUI(); } }));
    }
    const detailCraftId = heritageDetailTarget(selected.id);
    if (detailCraftId) info.appendChild(el('a', {
      class: 'btn-ghost heritage-graph-back-button',
      href: `#/craft/${encodeURIComponent(detailCraftId)}`,
      text: '打开项目详情',
    }));
    info.appendChild(el('button', {
      class: 'btn-ghost heritage-graph-contribute-button', type: 'button', text: '补充这个节点',
      onclick: () => openGraphContribution(selected),
    }));
    const visible = context.mode === 'branch' ? context.visible_nodes : context.current_root ? [context.current_root] : [];
    if (visible.length) {
      info.appendChild(el('div', { class: 'heritage-graph-keyboard-list', 'aria-label': '当前可见星点' }, [
        el('span', { text: '当前星点' }),
        ...visible.map((node, index) => el('button', { type: 'button', text: `${index + 1}. ${node.title}`, onclick: () => { selectGraphNode(state, node); renderUI(); } })),
      ]));
    }
    info.appendChild(el('small', { class: 'heritage-graph-source', text: selected.source_ids?.length ? `来源记录：${selected.source_ids.join('、')}` : '当前节点暂无可公开来源链接。' }));
  }

  function syncUrl(context) {
    const id = context.selected_node?.id || context.current_root?.id;
    if (!id) return;
    const hash = `#/graph/${encodeURIComponent(id)}`;
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
  }

  function renderUI() {
    if (!explorer || disposed) return;
    const context = explorer.context();
    heading.textContent = state.mode === 'overview' ? '上海非遗星图' : (context.current_root?.title || state.root.title);
    subtitle.textContent = context.mode === 'branch'
      ? `${context.relation_label} · 当前关系下共 ${context.branch_total} 个节点`
      : state.mode === 'overview' ? '选择一个非遗项目，进入它的关系网络' : '选择一条关系继续探索';
    renderTrail(context);
    renderInfo(context);
    syncUrl(context);
    agent.setHost(agentHost);
  }

  function registerGesture() {
    const system = window.__gestureSystem;
    const adapter = explorer?.gestureAdapter?.();
    if (!system || !adapter) {
      if (!disposed && gestureRetry < 20) gestureRetry = window.setTimeout(registerGesture, 250);
      return;
    }
    system.registerViewContext('graph-page', {
      threeContexts: [{
        name: 'heritage-graph-page-3d', raycaster: adapter.raycaster, camera: adapter.camera,
        getTargets: () => adapter.getRaycastTargets(), getInteractiveGroups: () => adapter.getInteractiveGroups(),
        rendererDomElement: adapter.rendererDomElement,
        onHover: (group) => adapter.onHover(group), onHoverClear: () => adapter.onHoverClear(),
        onClick: (group) => adapter.onClick(group), isInteractive: (group) => adapter.isInteractive(group),
        onDragStart: () => {}, onDragMove: (dx, dy) => adapter.onDragMove(dx, dy), onDragEnd: () => {},
        onZoom: (factor) => adapter.zoomBy(factor),
      }],
    });
  }

  const agentHost = {
    context: () => {
      const graph = explorer?.context?.() || {};
      return { route: location.hash.replace(/^#/, ''), page_type: 'heritage_graph', ...graph, context_revision: `graph:${graph.mode || 'overview'}:${graph.selected_node?.id || ''}:${graph.branch || ''}:${graph.breadcrumbs?.join('|') || ''}` };
    },
    async openNode({ node_id }) { location.hash = `#/graph/${encodeURIComponent(node_id)}`; return { ok: true, node_id }; },
    async setRootNode({ node_id }) { const node = getGraphNode(node_id); const result = explorer.setRoot(node); renderUI(); return { ok: result.ok, node_id }; },
    async expandBranch({ relation }) { const result = explorer.branch(relation); renderUI(); return result.ok ? { ok: true } : { ok: true, message: '当前资料中没有找到这条关系。' }; },
    async openHeritageDetail({ heritage_id }) {
      const craftId = heritageDetailTarget(heritage_id);
      if (!craftId) return { ok: false, error: { code: 'node_not_found', message: '这个节点暂时没有对应的非遗详情页。' } };
      transitionTo(`#/craft/${encodeURIComponent(craftId)}`);
      return { ok: true };
    },
    async openRegion({ region_id }) { return this.openNode({ node_id: region_id }); },
    async goBack() { const result = explorer.goBack(); if (!result.ok) transitionTo('#/explore'); else renderUI(); return { ok: true }; },
    async returnToRoot() { explorer.returnRoot(); renderUI(); return { ok: true }; },
    async focusModel() { explorer.returnRoot(); renderUI(); return { ok: true }; },
    async readSummary({ target_id }) { const node = getGraphNode(target_id); const started = node && agent.speak(`${node.title}。${node.summary || '目前资料中没有找到摘要。'}`); return { ok: true, message: started ? '正在为你朗读节点摘要。' : '摘要已显示在页面上。' }; },
    async stopSpeaking() { agent.stopSpeaking(); return { ok: true }; },
    async setVoicePreferences(args) { return agent.setVoicePreferences(args); },
    async showHelp() { agent.say('你可以说：打开象牙相关非遗、展开位于、属于传统、使用材料、打开第二个、返回或朗读摘要。'); return { ok: true }; },
  };

  explorer = mountHeritageGraph(canvasHost, state, { onSelect: (node) => {
    if (node) agent.react('graph', { id: node.id, title: node.title, summary: node.summary });
    if (state.mode === 'overview' && node?.type === 'heritage') {
      location.hash = `#/graph/${encodeURIComponent(node.id)}`;
      return;
    }
    renderUI();
  }, onChange: renderUI });
  agent.mount();
  agent.setCraft(null);
  agent.setHost(agentHost);
  renderUI();
  registerGesture();

  const onGestureReady = () => registerGesture();
  document.addEventListener('sh-crafted:gesture-ready', onGestureReady);

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    if (navigation.classList.contains('is-expanded')) {
      setNavigationExpanded(false);
      navigationToggle.focus();
      return;
    }
    void agentHost.goBack();
  };
  document.addEventListener('keydown', onKey);
  return {
    cleanup() {
      disposed = true;
      clearTimeout(gestureRetry);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('sh-crafted:gesture-ready', onGestureReady);
      window.__gestureSystem?.unregisterViewContext?.('graph-page');
      explorer?.dispose?.();
      explorer = null;
      agent.unmount();
    },
  };
}
