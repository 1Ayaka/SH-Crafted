// 统一动作注册表 —— 鼠标、触屏、键盘、语音、手势通过相同的语义动作接口执行
// 参考 agent/tool-registry.js 的 createToolRegistry 模式
const ACTIONS = Object.freeze({
  // 三维场景
  'three-hover': { description: '悬停 Three.js 目标', layer: 'three' },
  'three-click': { description: '点击 Three.js 目标', layer: 'three' },
  'three-drag-start': { description: '开始 Three.js 拖拽', layer: 'three' },
  'three-drag-move': { description: 'Three.js 拖拽中', layer: 'three' },
  'three-drag-end': { description: '结束 Three.js 拖拽', layer: 'three' },

  // DOM 交互
  'dom-click': { description: '点击 DOM 手势目标', layer: 'dom' },
  'dom-scroll': { description: '滚动 DOM 区域', layer: 'dom' },

  // 导航
  'navigate-back': { description: '返回上一层', layer: 'app' },
  'navigate-to-root': { description: '返回根节点', layer: 'app' },

  // 知识图谱
  'graph-open-node': { description: '打开图谱节点', layer: 'app' },
  'graph-expand-branch': { description: '展开图谱分支', layer: 'app' },
  'graph-set-root': { description: '设置图谱根节点', layer: 'app' },

  // 模型
  'model-rotate': { description: '旋转模型', layer: 'three' },
  'model-rotate-end': { description: '结束旋转模型', layer: 'three' },
  'model-scatter': { description: '模型散墨', layer: 'three' },
  'model-reset-view': { description: '重置模型视角', layer: 'three' },

  // 手势系统
  'gesture-click': { description: '执行一次隔空点击', layer: 'gesture' },
  'gesture-long-press': { description: '执行隔空长按', layer: 'gesture' },
  'gesture-zoom-in': { description: '通过兼容入口放大当前场景', layer: 'gesture' },
  'gesture-zoom-out': { description: '握拳缩小当前场景', layer: 'gesture' },
  'gesture-calibrate': { description: '校准手势', layer: 'gesture' },
  'gesture-cancel': { description: '取消当前手势操作', layer: 'gesture' },

  // 通用
  'noop': { description: '无操作', layer: 'any' },
});

export function createActionRegistry() {
  const handlers = new Map();
  const sources = new Map(); // targetId → Set<input sources>

  function registerAction(actionType, handler) {
    if (!ACTIONS[actionType]) {
      throw new Error(`unknown_action:${actionType}`);
    }
    handlers.set(actionType, handler);
  }

  function unregisterAction(actionType) {
    handlers.delete(actionType);
  }

  async function execute(actionType, params = {}) {
    const handler = handlers.get(actionType);
    if (!handler) {
      return {
        success: false,
        action: actionType,
        error: 'no_handler_registered',
        errorCode: 'NO_HANDLER',
      };
    }

    try {
      const result = await handler(params);
      return {
        success: true,
        action: actionType,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        action: actionType,
        error: error.message || 'action_execution_failed',
        errorCode: 'EXECUTION_ERROR',
        recoverable: true,
      };
    }
  }

  // 记录输入源对某个目标的操作
  function trackSource(targetId, source) {
    if (!sources.has(targetId)) {
      sources.set(targetId, new Set());
    }
    sources.get(targetId).add(source);
  }

  function getSources(targetId) {
    return sources.get(targetId) || new Set();
  }

  function reset() {
    handlers.clear();
    sources.clear();
  }

  return {
    registerAction,
    unregisterAction,
    execute,
    trackSource,
    getSources,
    reset,
    actions: () => ({ ...ACTIONS }),
  };
}

export { ACTIONS };
