// 极简 hash 路由：访客页面 + 站内管理员登录/工序管理
const routes = [];
let current = null;
let dispatchId = 0;

export function route(pattern, handler) {
  // pattern 形如 '/craft/:id'
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern });
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
      if (leaving?.cleanup) { try { leaving.cleanup(); } catch { /* 忽略清理异常 */ } }
      onLeave?.();
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
      current = { path, cleanup: view?.cleanup, mount };
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}
