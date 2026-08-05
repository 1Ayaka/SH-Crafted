// 入口：加载真实数据 → 启动 hash 路由
import { loadAll, siteText } from './data.js';
import { route, startRouter } from './router.js';
import { el, catSVG } from './ui.js';
import { initializeAdmin, saveSiteTexts } from './admin.js';
import { mountEditableModule } from './editable.js';

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
  const icpLink = document.getElementById('icp-link');
  if (icpLink) icpLink.textContent = siteText('footer.icp', icpLink.textContent);
  await initializeAdmin();
  const legalFooter = document.querySelector('.site-legal');
  if (legalFooter && icpLink) {
    mountEditableModule(legalFooter, [{ key: 'footer.icp', element: icpLink }], (values) => (
      saveSiteTexts([{ key: 'footer.icp', content: values['footer.icp'] }])
    ));
  }
} catch (err) {
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'loading' }, [
    el('p', { text: `数据加载失败：${err.message}` }),
    el('p', { class: 'small muted', text: '请通过 npm run dev 启动本地服务器后访问，不要用 file:// 直接打开。' }),
  ]));
  throw err;
}

// Views are intentionally imported per route. In particular, the home page no
// longer waits for the map/Three.js and workbench modules before it can render.
route('/', async (root) => (await import('./views/home.js')).homeView(root));
route('/explore', async (root) => (await import('./views/explore.js')).exploreView(root), { keepAlive: true });
route('/contribute/:districtId', async (root, p) => (await import('./views/contribute.js')).contributeView(root, p));
route('/craft/:id', async (root, p) => (await import('./views/craft.js')).craftView(root, p));
route('/passport', async (root) => (await import('./views/passport.js')).passportView(root));
route('/admin/login', async (root) => (await import('./views/admin.js')).adminLoginView(root));
route('/admin', async (root) => (await import('./views/admin.js')).adminHomeView(root));
route('/admin/submissions', async (root) => (await import('./views/admin.js')).adminSubmissionsView(root));
route('/admin/craft/:id', async (root, p) => (await import('./views/admin.js')).adminCraftView(root, p));

app.innerHTML = '';
startRouter(app);
