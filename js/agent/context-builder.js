import { adminState } from '../admin.js';
import { isContentReviewed } from '../data.js';

const ACTIONS = Object.freeze([
  'get_current_context', 'search_graph', 'open_node', 'expand_branch',
  'set_root_node', 'open_heritage_detail', 'open_region', 'go_back',
  'return_to_root', 'focus_model', 'read_summary', 'stop_speaking',
  'set_voice_preferences', 'show_help',
]);

function cloneList(value, limit = 12) {
  return Array.isArray(value) ? value.slice(-limit).map((item) => (
    typeof item === 'string' ? item : { ...item }
  )) : [];
}

// 惰性获取手势上下文（手势系统可能未初始化）
function resolveGestureContext() {
  try {
    // 动态导入避免循环依赖和首屏阻塞
    const system = window.__gestureSystem;
    if (system && typeof system.getGestureContext === 'function') {
      const ctx = system.getGestureContext();
      if (ctx) {
        return {
          enabled: ctx.enabled,
          state: ctx.state,
          hovered_target: ctx.hoveredTarget ? {
            type: ctx.hoveredTarget.type || 'unknown',
            id: ctx.hoveredTarget.id || ctx.hoveredTarget.targetId || null,
            title: ctx.hoveredTarget.title || null,
          } : null,
        };
      }
    }
  } catch { /* 手势系统未初始化，返回默认值 */ }
  return { enabled: false, state: 'DISABLED' };
}

export function buildAgentContext(hostContext = {}, voiceState = 'DISABLED') {
  const route = String(hostContext.route || location.hash.replace(/^#/, '') || '/');
  return {
    route,
    page_type: hostContext.page_type || (route.startsWith('/craft/') ? 'heritage_detail' : 'explore'),
    current_root: hostContext.current_root || null,
    active_branch: hostContext.active_branch || null,
    selected_node: hostContext.selected_node || null,
    visible_nodes: cloneList(hostContext.visible_nodes, 12),
    breadcrumbs: cloneList(hostContext.breadcrumbs, 8),
    history: cloneList(hostContext.history, 8),
    available_actions: cloneList(hostContext.available_actions || ACTIONS, 20),
    voice_state: voiceState,
    gesture: resolveGestureContext(),
    user_role: adminState().authenticated ? 'admin' : 'visitor',
    content_reviewed: isContentReviewed(),
    locale: document.documentElement.lang || 'zh-CN',
    context_revision: String(hostContext.context_revision || hostContext.revision || 'local'),
  };
}

export { ACTIONS };
