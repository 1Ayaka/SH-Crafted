// 入口：加载真实数据 → 启动 hash 路由
import { loadAll } from './data.js';
import { route, startRouter } from './router.js';
import { el, catSVG } from './ui.js';

const app = document.getElementById('app');

app.appendChild(el('div', { class: 'loading' }, [
  catSVG(),
  el('p', { text: '正在加载非遗数据包…', id: 'load-msg' }),
]));

try {
  await loadAll((title) => {
    const msg = document.getElementById('load-msg');
    if (msg) msg.textContent = `已加载：${title}`;
  });
} catch (err) {
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'loading' }, [
    el('p', { text: `数据加载失败：${err.message}` }),
    el('p', { class: 'small muted', text: '请通过 npm run dev 启动本地服务器后访问，不要用 file:// 直接打开。' }),
  ]));
  throw err;
}

const { homeView } = await import('./views/home.js');
const { exploreView } = await import('./views/explore.js');
const { craftView } = await import('./views/craft.js');
const { passportView } = await import('./views/passport.js');

route('/', (root) => homeView(root));
route('/explore', (root) => exploreView(root));
route('/craft/:id', (root, p) => craftView(root, p));
route('/passport', (root) => passportView(root));

app.innerHTML = '';
startRouter(app);
