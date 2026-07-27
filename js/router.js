// 极简 hash 路由：#/  #/explore  #/craft/<id>  #/passport
const routes = [];
let current = null;

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
    const path = currentHash();
    for (const r of routes) {
      const m = path.match(r.rx);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      if (current?.cleanup) { try { current.cleanup(); } catch { /* 忽略清理异常 */ } }
      onLeave?.();
      appEl.innerHTML = '';
      const view = await r.handler(appEl, params);
      current = { path, cleanup: view?.cleanup };
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}
