// 极简 hash 路由：访客页面 + 站内管理员登录/工序管理
const routes = [];
let current = null;
let dispatchId = 0;
const keptViews = new Map();

export function route(pattern, handler, options = {}) {
  // pattern 形如 '/craft/:id'
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern, keepAlive: Boolean(options.keepAlive) });
}

export function navigate(hash) {
  location.hash = hash;
}

export function currentHash() {
  return location.hash.replace(/^#/, '') || '/';
}

export function startRouter(appEl, { onLeave } = {}) {
  async function dispatch() {
    const id = ++dispatchId;
    const path = currentHash();
    for (const r of routes) {
      const m = path.match(r.rx);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const leaving = current;
      current = null;
      if (leaving?.keepAlive) {
        try { leaving.deactivate?.(); } catch { /* 忽略停用异常 */ }
        keptViews.set(leaving.cacheKey, leaving);
      } else if (leaving?.cleanup) {
        try { leaving.cleanup(); } catch { /* 忽略清理异常 */ }
      }
      onLeave?.();
      const cacheKey = r.keepAlive && !r.keys.length ? r.pattern : '';
      const cached = cacheKey ? keptViews.get(cacheKey) : null;
      if (cached) {
        appEl.replaceChildren(cached.mount);
        try { cached.activate?.(); } catch { /* 忽略恢复异常 */ }
        current = cached;
        window.scrollTo(0, 0);
        return;
      }
      const mount = document.createElement('div');
      mount.className = 'route-mount';
      mount.dataset.route = path;
      appEl.replaceChildren(mount);
      const view = await r.handler(mount, params);
      if (id !== dispatchId || path !== currentHash()) {
        try { view?.cleanup?.(); } catch { /* 忽略过期视图清理异常 */ }
        mount.remove();
        return;
      }
      current = {
        path,
        cleanup: view?.cleanup,
        activate: view?.activate,
        deactivate: view?.deactivate,
        mount,
        keepAlive: r.keepAlive,
        cacheKey,
      };
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}
