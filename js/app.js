// 入口：加载真实数据 → 启动 hash 路由
import { loadAll, siteText } from './data.js';
import { route, startRouter } from './router.js';
import { el, catSVG } from './ui.js';
import { initializeAdmin, saveSiteTexts } from './admin.js';
import { mountEditableModule } from './editable.js';
import { agent } from './agent.js';
import { getGraphNode, heritageDetailTarget } from './agent/graph-adapter.js';

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
route('/graph', async (root) => (await import('./views/graph.js')).graphView(root));
route('/graph/:nodeId', async (root, p) => (await import('./views/graph.js')).graphView(root, p));
route('/contribute/:districtId', async (root, p) => (await import('./views/contribute.js')).contributeView(root, p));
route('/craft/:id', async (root, p) => (await import('./views/craft.js')).craftView(root, p));
route('/passport', async (root) => (await import('./views/passport.js')).passportView(root));
route('/admin/login', async (root) => (await import('./views/admin.js')).adminLoginView(root));
route('/admin', async (root) => (await import('./views/admin.js')).adminHomeView(root));
route('/admin/submissions', async (root) => (await import('./views/admin.js')).adminSubmissionsView(root));
route('/admin/craft/:id', async (root, p) => (await import('./views/admin.js')).adminCraftView(root, p));

app.innerHTML = '';
agent.enableGlobal({
  context: () => ({
    route: location.hash.replace(/^#/, '') || '/',
    page_type: 'site',
    available_actions: ['get_current_context', 'search_graph', 'open_node', 'open_heritage_detail', 'open_region', 'go_back', 'read_summary', 'stop_speaking', 'show_help'],
    context_revision: 'site-global-v1',
  }),
  async openNode({ node_id }) { location.hash = `#/graph/${encodeURIComponent(node_id)}`; return { ok: true, node_id }; },
  async openHeritageDetail({ heritage_id }) {
    const craftId = heritageDetailTarget(heritage_id);
    if (!craftId) return { ok: false, error: { code: 'node_not_found', message: '这个节点暂时没有对应的非遗详情页。' } };
    location.hash = `#/craft/${encodeURIComponent(craftId)}`;
    return { ok: true };
  },
  async openRegion({ region_id }) { location.hash = `#/graph/${encodeURIComponent(region_id)}`; return { ok: true }; },
  async goBack() { if (history.length > 1) history.back(); else location.hash = '#/'; return { ok: true }; },
  async readSummary({ target_id }) {
    const node = getGraphNode(target_id);
    if (!node) return { ok: true, message: '请先打开一个可朗读的星图节点。' };
    const started = agent.speak(`${node.title}。${node.summary || '目前资料中没有找到摘要。'}`);
    return { ok: true, message: started ? '正在为你朗读节点摘要。' : '摘要已显示在页面上。' };
  },
  async stopSpeaking() { agent.stopSpeaking(); return { ok: true }; },
  async setVoicePreferences(args) { return agent.setVoicePreferences(args); },
  async showHelp() { agent.say('你可以问非遗知识，也可以说：打开象牙相关非遗、进入知识星图、返回或朗读摘要。'); return { ok: true }; },
});
startRouter(app);

// 手势开关按钮始终可见（轻量 DOM，不影响首屏）。
// 点击后按需加载 MediaPipe WASM + 模型（约 17MB），用户主动触发。
// localStorage 中的 enabled 字段控制下次进页面是否自动开启。
import('./gesture/gesture-init.js')
  .then((m) => m.initGesture())
  .catch((error) => console.warn('手势系统初始化失败：', error));
