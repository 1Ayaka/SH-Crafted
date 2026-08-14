import { el } from '../ui.js';
import { adminNotice } from '../editable.js';
import { adminState, applyGraphPatch, deleteCrafts, exportGraph, importCraft, isAdmin, loadBrandLogo, loadSubmissions, login, logout, previewGraphPatch, reviewSubmission, saveCraft, saveCraftSteps, setContentReviewed, uploadBrandLogo, uploadCraftImage, uploadCraftStepImage } from '../admin.js';
import { bindImageDropZone, COMMUNITY_IMAGE_ACCEPT, createUploadProgress } from '../image-upload.js';
import { applyBrandLogoVersion, brandLogoUrl } from '../brand.js';
import { allCrafts, applyCraftEditorialUpdate, craftAssetUrl, ensureCraftLoaded, refreshGraphContent, setContentReviewedLocal } from '../data.js';
import { loadCommunityStats } from '../community.js';
import { DISTRICT_PROFILES } from '../config.js';
import { topNav } from './home.js';
import { createLayerBG } from '../layerbg.js';
import { RESOURCE_SHAPES, resourceShape } from '../workbench-preview.js';
import { materialInventoryBeforeStep, uniqueMaterialNames } from '../material-flow.js';

const plusSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';
const minusSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12"/></svg>';

function iconButton(label, icon, onClick, extraClass = '') {
  return el('button', {
    class: `admin-icon-button ${extraClass}`.trim(), type: 'button', 'aria-label': label, title: label,
    html: icon, onclick: onClick,
  });
}

async function adminShell(root, active, content) {
  const bg = await createLayerBG('assets/bg2/manifest.json', { scrim: 'top', enter: false, parallax: false, fixed: true });
  const page = el('section', { class: 'view admin-page' }, [bg.el, topNav(active), content]);
  root.appendChild(page);
  return { cleanup() { bg.destroy(); } };
}

function requireAdmin() {
  if (isAdmin()) return true;
  location.hash = '#/admin/login';
  return false;
}

export async function adminLoginView(root) {
  if (isAdmin()) {
    location.hash = '#/admin';
    return { cleanup() {} };
  }
  const error = el('p', { class: 'admin-login-error', role: 'alert' });
  const username = el('input', { name: 'username', autocomplete: 'username', value: 'djt', required: 'required' });
  const password = el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: 'required' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: '登录' });
  const form = el('form', { class: 'admin-login-card' }, [
    el('p', { class: 'admin-kicker', text: '内容管理' }),
    el('h1', { text: '登录后直接编辑网站' }),
    el('p', { class: 'admin-login-lede', text: '管理界面沿用访客页面。登录后，每个可维护模块会显示编辑与保存按钮。' }),
    el('label', {}, [el('span', { text: '用户名' }), username]),
    el('label', {}, [el('span', { text: '密码' }), password]),
    error,
    submit,
    el('a', { class: 'admin-return-link', href: '#/', text: '返回网站' }),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = '登录中';
    try {
      await login(username.value.trim(), password.value);
      location.hash = '#/admin';
      location.reload();
    } catch (loginError) {
      if (loginError.status === 429) {
        const seconds = Number(loginError.payload?.retry_after_seconds) || 600;
        error.textContent = `尝试次数过多，请约 ${Math.max(1, Math.ceil(seconds / 60))} 分钟后再试。`;
      } else {
        const remaining = Number(loginError.payload?.attempts_remaining);
        error.textContent = Number.isFinite(remaining)
          ? `用户名或密码不正确，还可尝试 ${remaining} 次。`
          : '用户名或密码不正确。';
      }
    } finally {
      submit.disabled = false;
      submit.textContent = '登录';
    }
  });
  return adminShell(root, 'admin', el('main', { class: 'admin-login-wrap' }, [form]));
}

export async function adminHomeView(root) {
  if (!requireAdmin()) return { cleanup() {} };
  const crafts = allCrafts();
  const [submissionData, engagement, brandState] = await Promise.all([
    loadSubmissions('pending').catch(() => ({ submissions: [] })),
    loadCommunityStats({ refresh: true }).catch(() => ({})),
    loadBrandLogo().catch(() => ({ logo_url: '/brand/logo.png', version: '', uploaded: false })),
  ]);
  const pendingCount = submissionData.submissions?.length || 0;
  const adminImportTemplate = { schema: 'sh-crafted.heritage-submission/v1', id: '', update_existing: true, title: '', district_id: '', category: '', summary: '', history: '', features: '', source_url: '', cover_url: '', images: [{ title: '', image_url: '', description: '', source_url: '' }], model_path: 'assets/models/crafts/example.glb', graph_data: { summary: '', keywords: [], relations: [{ type: 'tradition', title: '', summary: '' }] }, steps: [{ name: '', description: '', result: '', materials: [], tools: [], actions: [], documentary_clips: [{ title: '', video_url: 'https://', start_seconds: 0, end_seconds: 30, description: '', source_url: '' }] }] };
  const importInput = el('input', { type: 'file', accept: '.json,.jsonl,application/json,application/x-ndjson', multiple: true });
  const graphPatchInput = el('input', { type: 'file', accept: '.json,application/json' });
  const graphPatchStatus = el('span', { class: 'admin-save-status', text: '星图可增量同步' });
  const reviewCheckbox = el('input', { type: 'checkbox', checked: adminState().contentReviewed });
  const reviewStatus = el('span', { class: 'admin-save-status', text: adminState().contentReviewed ? '全库已确认' : '仍显示待审核提示' });
  reviewCheckbox.addEventListener('change', async () => {
    reviewCheckbox.disabled = true;
    try {
      await setContentReviewed(reviewCheckbox.checked);
      setContentReviewedLocal(reviewCheckbox.checked);
      reviewStatus.textContent = reviewCheckbox.checked ? '全库已确认' : '仍显示待审核提示';
      window.dispatchEvent(new CustomEvent('sh-crafted:content-review-changed'));
    } catch (error) {
      reviewCheckbox.checked = !reviewCheckbox.checked;
      reviewStatus.textContent = error.message;
    } finally { reviewCheckbox.disabled = false; }
  });
  importInput.addEventListener('change', async () => {
    const files = [...(importInput.files || [])]; if (!files.length) return;
    try {
      const rows = [];
      for (const file of files) {
        const text = (await file.text()).replace(/^\uFEFF/, '').trim();
        const parsed = /\.jsonl$/i.test(file.name) ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : JSON.parse(text);
        rows.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
      const records = rows.map((row) => row?.heritage || row?.craft || row).filter(Boolean);
      const identity = (value) => String(value || '').normalize('NFKC').replace(/[\s·•・—_()（）]+/g, '').toLowerCase();
      const matches = records.map((record) => crafts.find((craft) => (record.id && craft.craftId === record.id)
        || (craft.config?.districtId === record.district_id && identity(craft.title) === identity(record.title)))).filter(Boolean);
      if (matches.length && !confirm(`检测到 ${matches.length} 条同地区同名或同 ID 项目，将按现有项目覆盖。\n\n受保护项目和已手工维护项目仍会由服务端拒绝覆盖。是否继续？`)) return;
      let created = 0; let updated = 0;
      for (const record of records) {
        const result = await importCraft({
          ...record,
          update_existing: record.update_existing === true || matches.some((craft) => (record.id && craft.craftId === record.id)
            || (craft.config?.districtId === record.district_id && identity(craft.title) === identity(record.title))),
          graph_data: record.graph_data || record.star_data || {},
          model_path: record.model_path || record.model_url || record.model || '',
          images: record.images || record.overview_images || [],
        });
        if (result.updated) updated += 1; else created += 1;
      }
      alert(`批量导入完成：新增 ${created} 条，覆盖 ${updated} 条。正在刷新管理列表。`);
      location.reload();
    } catch (error) { alert(`导入失败：${error.message || 'JSON 格式错误'}`); }
    finally { importInput.value = ''; }
  });
  graphPatchInput.addEventListener('change', async () => {
    const file = graphPatchInput.files?.[0]; if (!file) return;
    try {
      const patch = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      const preview = await previewGraphPatch(patch);
      graphPatchStatus.textContent = `预览：新增节点 ${preview.counts.nodes_create}、更新 ${preview.counts.nodes_update}；关系冲突 ${preview.conflicts.length}`;
      if (preview.revision_conflict || preview.conflicts.length) throw new Error('补丁与服务器版本或已有保护内容冲突，请先导出最新版后合并。');
      if (!window.confirm(`确认应用星图补丁？将新增 ${preview.counts.nodes_create} 个节点。`)) return;
      await applyGraphPatch(patch);
      graphPatchStatus.textContent = '星图补丁已应用';
      location.reload();
    } catch (error) { graphPatchStatus.textContent = `补丁未应用：${error.message || '格式错误'}`; }
    finally { graphPatchInput.value = ''; }
  });
  const downloadGraph = async () => {
    const payload = await exportGraph();
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '探物志-知识星图补丁.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const primaryIds = new Set(Array.from({ length: 8 }, (_, index) => `SHIH_${String(index + 1).padStart(4, '0')}`));
  const deletableCrafts = crafts.filter((craft) => !primaryIds.has(craft.craftId) && !craft.config.protected);
  const selectedCraftIds = new Set();
  const selectionSummary = el('span', { class: 'admin-bulk-summary', text: '已选择 0 项', 'aria-live': 'polite' });
  const selectAll = el('input', { type: 'checkbox', 'aria-label': '选择全部可删除项目', disabled: deletableCrafts.length === 0 });
  const deleteButton = el('button', { class: 'admin-danger-button', type: 'button', text: '删除所选项目', disabled: true });
  const cardCheckboxes = new Map();
  const updateBulkState = () => {
    const selectedCount = selectedCraftIds.size;
    selectionSummary.textContent = `已选择 ${selectedCount} 项${deletableCrafts.length ? `，共 ${deletableCrafts.length} 项可删除` : '，当前没有可删除项目'}`;
    deleteButton.disabled = selectedCount === 0;
    selectAll.checked = deletableCrafts.length > 0 && selectedCount === deletableCrafts.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < deletableCrafts.length;
    for (const [craftId, checkbox] of cardCheckboxes) checkbox.closest('.admin-craft-card')?.classList.toggle('is-selected', selectedCraftIds.has(craftId));
  };
  selectAll.addEventListener('change', () => {
    selectedCraftIds.clear();
    if (selectAll.checked) deletableCrafts.forEach((craft) => selectedCraftIds.add(craft.craftId));
    for (const [craftId, checkbox] of cardCheckboxes) checkbox.checked = selectedCraftIds.has(craftId);
    updateBulkState();
  });
  deleteButton.addEventListener('click', async () => {
    const selected = crafts.filter((craft) => selectedCraftIds.has(craft.craftId));
    if (!selected.length) return;
    const names = selected.map((craft) => `• ${craft.title}（${craft.craftId}）`).join('\n');
    if (!window.confirm(`确定删除以下 ${selected.length} 个项目吗？\n\n${names}\n\n项目将从地图和知识星图下线，并同步删除工序与图库。原始 8 项不受此操作影响。`)) return;
    deleteButton.disabled = true;
    deleteButton.textContent = '正在删除…';
    try {
      const result = await deleteCrafts(selected.map((craft) => craft.craftId));
      window.alert(`已删除 ${result.deleted_count} 个项目。数据库历史中保留了删除前修订。`);
      location.reload();
    } catch (error) {
      deleteButton.textContent = '删除所选项目';
      updateBulkState();
      adminNotice(error.message || '批量删除失败。', true);
    }
  });
  const craftCards = crafts.map((craft) => {
    const isProtected = primaryIds.has(craft.craftId) || Boolean(craft.config.protected);
    const checkbox = el('input', {
      type: 'checkbox', disabled: isProtected,
      'aria-label': isProtected ? `${craft.title}是原始项目，不可删除` : `选择删除${craft.title}`,
    });
    if (!isProtected) {
      cardCheckboxes.set(craft.craftId, checkbox);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedCraftIds.add(craft.craftId);
        else selectedCraftIds.delete(craft.craftId);
        updateBulkState();
      });
    }
    return el('article', {
      class: `admin-craft-card${isProtected ? ' is-protected' : ''}`, 'data-craft-id': craft.craftId,
      'data-search': `${craft.title} ${craft.config.districtLabel || ''} ${craft.config.category || ''}`.toLowerCase(),
    }, [
      el('label', { class: 'admin-craft-select' }, [checkbox, el('span', { text: isProtected ? '原始项目' : '选择' })]),
      craft.config.heroFrame
        ? el('img', { src: craftAssetUrl(craft, craft.config.heroFrame), alt: craft.title, loading: 'lazy' })
        : el('div', { class: 'admin-card-placeholder', text: '社区条目' }),
      el('div', {}, [
        el('p', { class: 'admin-card-meta', text: `${craft.config.districtLabel || '地区待核对'} · ${craft.stepCount ?? craft.steps.length} 道工序 · ${engagement[craft.craftId]?.view_count || 0} 次查看 · ${engagement[craft.craftId]?.inheritor_count || 0} 位传承人` }),
        el('h2', { text: craft.title }),
        el('div', { class: 'admin-card-actions' }, [
          el('a', { class: 'btn btn-primary', href: `#/admin/craft/${craft.craftId}`, text: '维护项目' }),
          el('a', { class: 'btn-ghost', href: `#/craft/${craft.craftId}`, text: '查看用户页面' }),
        ]),
      ]),
    ]);
  });
  const projectSearch = el('input', { type: 'search', placeholder: '搜索项目、地区或分类', 'aria-label': '搜索已有项目' });
  const projectSearchStatus = el('span', { class: 'admin-project-search-status', text: `共 ${craftCards.length} 个项目`, 'aria-live': 'polite' });
  projectSearch.addEventListener('input', () => {
    const query = projectSearch.value.trim().toLowerCase();
    let visible = 0;
    craftCards.forEach((card) => {
      const matches = !query || String(card.dataset.search || '').includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    projectSearchStatus.textContent = query ? `找到 ${visible} 个项目` : `共 ${craftCards.length} 个项目`;
  });
  const projectSearchBar = el('section', { class: 'admin-project-search' }, [projectSearch, projectSearchStatus]);
  const bulkToolbar = el('section', { class: 'admin-bulk-toolbar', 'aria-label': '批量删除项目' }, [
    el('label', { class: 'admin-bulk-select-all' }, [selectAll, el('span', { text: '选择全部可删除项目' })]),
    selectionSummary,
    deleteButton,
  ]);
  updateBulkState();
  let pendingLogoFile = null;
  let pendingLogoUrl = '';
  const brandFileInput = el('input', { class: 'admin-brand-file-input', type: 'file', accept: 'image/png', tabindex: '-1' });
  const brandProgress = createUploadProgress();
  const currentBrandImage = el('img', {
    src: brandLogoUrl(brandState.version), alt: '当前全站 Logo', 'data-brand-logo': 'true',
  });
  const pendingBrandImage = el('img', { class: 'is-empty', alt: '待保存 Logo 预览' });
  const brandStatus = el('p', {
    class: 'admin-brand-status', role: 'status', 'aria-live': 'polite',
    text: brandState.uploaded ? '当前使用管理员上传版本' : '当前使用随版本发布的默认 Logo',
  });
  const brandSaveButton = el('button', { class: 'btn btn-primary', type: 'button', text: '保存并全站应用', disabled: true });
  const clearPendingLogo = () => {
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    pendingLogoUrl = '';
    pendingLogoFile = null;
    brandFileInput.value = '';
    pendingBrandImage.removeAttribute('src');
    pendingBrandImage.classList.add('is-empty');
    brandSaveButton.disabled = true;
  };
  const selectBrandFile = (files) => {
    const file = [...files][0];
    if (!file) return;
    brandProgress.reset();
    if (file.type !== 'image/png' || file.size > 2 * 1024 * 1024) {
      clearPendingLogo();
      brandStatus.className = 'admin-brand-status is-error';
      brandStatus.textContent = file.type !== 'image/png' ? '请选择 PNG 图片，以保留透明背景。' : 'Logo 图片不能超过 2MB。';
      return;
    }
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    pendingLogoFile = file;
    pendingLogoUrl = URL.createObjectURL(file);
    pendingBrandImage.src = pendingLogoUrl;
    pendingBrandImage.classList.remove('is-empty');
    brandSaveButton.disabled = false;
    brandStatus.className = 'admin-brand-status';
    brandStatus.textContent = `已选择 ${file.name}，保存前不会影响前台。`;
  };
  const brandDrop = el('div', { class: 'admin-image-drop', role: 'button', tabindex: '0', 'aria-label': '选择或拖入新 Logo' }, [
    el('strong', { text: '拖入透明 PNG' }), el('span', { text: '或点击选择，最大 2MB' }), brandFileInput,
  ]);
  bindImageDropZone({ zone: brandDrop, input: brandFileInput, onFiles: selectBrandFile });
  brandSaveButton.addEventListener('click', async () => {
    if (!pendingLogoFile) return;
    brandSaveButton.disabled = true;
    brandStatus.className = 'admin-brand-status is-saving';
    brandStatus.textContent = '正在保存并刷新全站 Logo…';
    brandProgress.start(pendingLogoFile.name);
    try {
      const result = await uploadBrandLogo(pendingLogoFile, { onProgress: brandProgress.update });
      const url = applyBrandLogoVersion(result.version);
      currentBrandImage.src = url;
      clearPendingLogo();
      brandStatus.className = 'admin-brand-status is-success';
      brandStatus.textContent = '保存成功：首页、导航、浏览器图标和小蕉头像已统一更新。';
      brandProgress.success('Logo 已保存并全站应用');
    } catch (error) {
      brandSaveButton.disabled = false;
      brandStatus.className = 'admin-brand-status is-error';
      brandStatus.textContent = error.message;
      brandProgress.error('Logo 上传失败');
    }
  });
  const brandPanel = el('section', { class: 'admin-brand-panel', 'aria-labelledby': 'admin-brand-heading' }, [
    el('div', { class: 'admin-brand-copy' }, [
      el('p', { class: 'admin-kicker', text: '全站品牌资源' }),
      el('h2', { id: 'admin-brand-heading', text: 'Logo 管理' }),
      el('p', { text: '上传透明背景 PNG。点击保存后，首页、全站导航、浏览器图标和小蕉聊天头像会统一读取新版本。' }),
      brandDrop,
      brandProgress.el,
      brandStatus,
    ]),
    el('div', { class: 'admin-brand-previews' }, [
      el('figure', {}, [el('div', { class: 'admin-brand-preview' }, [currentBrandImage]), el('figcaption', { text: '当前 Logo' })]),
      el('figure', {}, [el('div', { class: 'admin-brand-preview' }, [pendingBrandImage, el('span', { class: 'admin-brand-empty', text: '选择图片后预览' })]), el('figcaption', { text: '待保存预览' })]),
    ]),
    brandSaveButton,
  ]);
  const maintenanceTools = el('details', { class: 'admin-maintenance-tools' }, [
    el('summary', {}, [el('strong', { text: '导入、导出与批量维护' }), el('span', { text: 'JSON 导入、星图补丁和内容模板' })]),
    el('div', { class: 'admin-maintenance-tools-body' }, [
      el('label', { class: 'btn-ghost admin-import-button' }, [el('span', { text: '导入主非遗 JSON' }), importInput]),
      el('button', { class: 'btn-ghost', type: 'button', text: '下载管理员模板', onclick: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(adminImportTemplate, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = '主非遗导入模板.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } }),
      el('button', { class: 'btn-ghost', type: 'button', text: '导出星图补丁', onclick: downloadGraph }),
      el('label', { class: 'btn-ghost admin-import-button' }, [el('span', { text: '导入星图补丁' }), graphPatchInput]),
      graphPatchStatus,
    ]),
  ]);
  const content = el('main', { class: 'admin-dashboard' }, [
    el('div', { class: 'admin-page-heading' }, [
      el('div', {}, [
        el('p', { class: 'admin-kicker', text: `管理员 ${adminState().username}` }),
        el('h1', { text: '内容与工序管理' }),
        el('p', { text: '返回首页、地图或详情页可以直接编辑文字；这里用于导入、筛选、删除项目并调整制作工序。' }),
      ]),
      el('div', { class: 'admin-heading-actions' }, [
        el('label', { class: 'admin-review-toggle' }, [reviewCheckbox, el('span', { text: '专家已审核全部当前内容' }), reviewStatus]),
        el('a', { class: 'btn btn-primary', href: '#/admin/submissions', text: `审核社区投稿（${pendingCount}）` }),
        el('button', { class: 'btn-ghost', text: '退出登录', onclick: () => logout() }),
      ]),
    ]),
    brandPanel,
    maintenanceTools,
    projectSearchBar,
    bulkToolbar,
    el('div', { class: 'admin-craft-grid' }, craftCards),
  ]);
  return adminShell(root, 'admin', content);
}

export async function adminSubmissionsView(root) {
  if (!requireAdmin()) return { cleanup() {} };
  let selectedStatus = 'pending';
  const list = el('div', { class: 'admin-submission-list' });
  const summary = el('p', { class: 'admin-submission-summary', text: '正在读取投稿…' });
  const statusSelect = el('select', { 'aria-label': '筛选投稿状态' }, [
    el('option', { value: 'pending', text: '待审核' }),
    el('option', { value: 'approved', text: '已通过' }),
    el('option', { value: 'rejected', text: '已驳回' }),
    el('option', { value: 'all', text: '全部投稿' }),
  ]);

  async function renderList() {
    list.replaceChildren(el('p', { class: 'empty-state', text: '正在读取投稿…' }));
    try {
      const payload = await loadSubmissions(selectedStatus);
      const submissions = payload.submissions || [];
      summary.textContent = `${submissions.length} 份${statusSelect.options[statusSelect.selectedIndex].text}投稿`;
      list.replaceChildren();
      if (!submissions.length) {
        list.appendChild(el('p', { class: 'empty-state', text: '当前没有符合条件的投稿。' }));
        return;
      }
      submissions.forEach((submission) => {
        const isGraph = submission.kind === 'graph';
        const note = el('textarea', { rows: '3', maxlength: '2000', placeholder: '审核说明（选填）' }, [submission.reviewer_note || '']);
        const actions = submission.status === 'pending'
          ? el('div', { class: 'admin-review-actions' }, [
              el('button', {
                class: 'btn-ghost', type: 'button', text: '驳回', onclick: async (event) => {
                  if (!confirm(`确定驳回“${submission.title}”吗？`)) return;
                  event.currentTarget.disabled = true;
                  try { await reviewSubmission(submission.id, 'reject', note.value); location.reload(); }
                  catch (error) { event.currentTarget.disabled = false; adminNotice(error.message, true); }
                },
              }),
              el('button', {
                class: 'btn btn-primary', type: 'button', text: isGraph ? '审核通过并更新星图' : '审核通过并上线', onclick: async (event) => {
                  if (!confirm(`确认“${submission.title}”内容可以公开展示并正式上线吗？`)) return;
                  event.currentTarget.disabled = true;
                  try { await reviewSubmission(submission.id, 'approve', note.value); location.reload(); }
                  catch (error) { event.currentTarget.disabled = false; adminNotice(error.message, true); }
                },
              }),
            ])
          : el('p', {
              class: `admin-review-result is-${submission.status}`,
              text: submission.status === 'approved'
                ? (isGraph ? `已更新节点：${submission.published_graph_node_id || submission.target_node_id}` : (submission.publication_removed_at ? `已下线：${submission.published_craft_id}` : `已上线：${submission.published_craft_id}`))
                : '已驳回',
            });
        list.appendChild(el('article', { class: 'admin-submission-card' }, [
          el('header', { class: 'admin-submission-heading' }, [
            el('div', {}, [
              el('p', { class: 'admin-kicker', text: `${isGraph ? '知识星图共建' : submission.kind === 'full' ? '完整条目' : '简单便签'} · ${submission.id}` }),
              el('h2', { text: submission.title }),
            ]),
            el('span', { class: `admin-submission-status is-${submission.status}`, text: submission.status === 'pending' ? '待审核' : submission.status === 'approved' ? '已通过' : '已驳回' }),
          ]),
          el('dl', { class: 'admin-submission-meta' }, [
            el('div', {}, [el('dt', { text: isGraph ? '目标节点' : '地区' }), el('dd', { text: isGraph ? submission.target_node_title : (DISTRICT_PROFILES[submission.district_id]?.name || submission.district_id) })]),
            el('div', {}, [el('dt', { text: isGraph ? '补充类型' : '类别' }), el('dd', { text: isGraph ? ({ supplement: '补充资料', correction: '纠正摘要', relation: '补充关系', image: '补充图片' }[submission.contribution_type] || submission.contribution_type) : submission.category })]),
            el('div', {}, [el('dt', { text: '提交时间' }), el('dd', { text: new Date(submission.submitted_at).toLocaleString('zh-CN') })]),
            el('div', {}, [el('dt', { text: '投稿人' }), el('dd', { text: submission.contributor_name || '未填写' })]),
            el('div', {}, [el('dt', { text: '联系方式' }), el('dd', { text: submission.contributor_contact || '未填写' })]),
          ]),
          el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '内容说明' }), el('p', { text: submission.summary })]),
          isGraph && submission.relation ? el('section', { class: 'admin-submission-copy' }, [
            el('h3', { text: '拟新增关系' }),
            el('p', { text: `${submission.target_node_title} — ${submission.relation.relation} → ${submission.relation.related_node_title}` }),
            el('p', { text: submission.relation.explanation }),
          ]) : null,
          submission.history ? el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '历史与来历' }), el('p', { text: submission.history })]) : null,
          submission.features ? el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '特色与价值' }), el('p', { text: submission.features })]) : null,
          submission.source_url ? el('a', { class: 'admin-submission-source', href: submission.source_url, target: '_blank', rel: 'noopener noreferrer', text: submission.source_title ? `打开来源：${submission.source_title}` : '打开投稿资料来源' }) : null,
          isGraph && submission.images?.length ? el('section', { class: 'admin-submission-gallery' }, [
            el('h3', { text: `节点图片（${submission.images.length}）` }),
            el('div', {}, submission.images.map((image) => el('a', { href: image.image_url, target: '_blank', rel: 'noopener noreferrer' }, [el('img', { src: image.image_url, alt: image.title || submission.target_node_title, loading: 'lazy' })]))),
          ]) : null,
          submission.cover_url ? el('img', { class: 'admin-submission-cover', src: submission.cover_url, alt: `${submission.title}投稿封面`, loading: 'lazy' }) : null,
          submission.gallery_urls?.length ? el('section', { class: 'admin-submission-gallery' }, [
            el('h3', { text: `资料图片（${submission.gallery_urls.length}）` }),
            el('div', {}, submission.gallery_urls.map((url, index) => el('a', {
              href: url, target: '_blank', rel: 'noopener noreferrer', title: '打开原图',
            }, [el('img', { src: url, alt: `${submission.title}资料图 ${index + 1}`, loading: 'lazy' })]))),
          ]) : null,
          submission.steps?.length ? el('section', { class: 'admin-submission-steps' }, [
            el('h3', { text: `制作工序（${submission.steps.length}）` }),
            ...submission.steps.map((step, index) => el('article', {}, [
              el('h4', { text: `${index + 1}. ${step.name}` }),
              el('p', { text: step.action || '未填写工序说明' }),
              el('p', { class: 'small muted', text: `材料：${step.materials.join('、') || '无'} · 工具：${step.tools.join('、') || '无'} · 操作：${step.actions.map((action) => action.label).join('、')}` }),
            ])),
          ]) : null,
          fieldForReview(note),
          actions,
        ]));
      });
    } catch (error) {
      summary.textContent = '投稿读取失败';
      list.replaceChildren(el('p', { class: 'empty-state', text: error.message || '请稍后重试。' }));
    }
  }

  function fieldForReview(control) {
    return el('label', { class: 'admin-review-note' }, [el('span', { text: '审核说明' }), control]);
  }
  statusSelect.addEventListener('change', () => { selectedStatus = statusSelect.value; renderList(); });
  const content = el('main', { class: 'admin-dashboard admin-submissions-page' }, [
    el('div', { class: 'admin-page-heading' }, [
      el('div', {}, [
        el('a', { class: 'admin-return-link', href: '#/admin', text: '返回内容管理' }),
        el('h1', { text: '社区投稿审核' }),
        el('p', { text: '投稿只有在这里审核通过后，才会进入正式内容库并显示在地图中。' }),
      ]),
      el('div', { class: 'admin-submission-filter' }, [summary, statusSelect]),
    ]),
    list,
  ]);
  await renderList();
  return adminShell(root, 'admin', content);
}

function stepDraft(step) {
  const materials = [...(step.materials || [])];
  const storedTransforms = Array.isArray(step.material_transforms) ? step.material_transforms : [];
  return {
    id: step.step_id,
    name: step.name || step.displayName || '',
    action: step.action || '',
    guide_text: step.guide_text || step.action || '',
    guide_bold_ranges: (step.guide_bold_ranges || []).map((range) => ({ start: range.start, end: range.end })),
    result: step.result || '',
    materials,
    material_transforms: storedTransforms.length
      ? storedTransforms.map((item) => ({ input_name: item.input_name || '', output_name: item.output_name ?? '' }))
      : materials.map((name) => ({ input_name: name, output_name: name })),
    tools: [...(step.tools || [])],
    resource_visuals: (step.resource_visuals || []).map((visual) => ({ ...visual })),
    documentary_clips: (step.documentary_clips || []).map((clip) => ({ ...clip })),
    step_image: step.step_image ? { ...step.step_image } : null,
    resource_groups: step.interactionRule.resource_groups.map((group) => ({
      ...group,
      options: [...group.options],
    })),
    quick_fill: step.interactionRule.quick_fill ? {
      ...step.interactionRule.quick_fill,
      resources: [...(step.interactionRule.quick_fill.resources || [])],
    } : null,
    actions: step.interactionRule.actions.map((action) => ({ ...action })),
    correct_action_id: step.interactionRule.action.id,
  };
}

function guideFragment(text, ranges = []) {
  const fragment = document.createDocumentFragment();
  const boundaries = new Set([0, text.length]);
  ranges.forEach(({ start, end }) => { boundaries.add(start); boundaries.add(end); });
  const points = [...boundaries].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    const copy = text.slice(start, end);
    if (!copy) continue;
    const bold = ranges.some((range) => start >= range.start && end <= range.end);
    fragment.appendChild(bold ? el('strong', { text: copy }) : document.createTextNode(copy));
  }
  return fragment;
}

function readGuideEditor(editor) {
  let text = '';
  const ranges = [];
  const walk = (node, bold = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.nodeValue || '';
      if (bold && text.length > start) ranges.push({ start, end: text.length });
      return;
    }
    if (node.nodeName === 'BR') { text += '\n'; return; }
    const nextBold = bold || node.nodeName === 'STRONG' || node.nodeName === 'B';
    [...node.childNodes].forEach((child) => walk(child, nextBold));
  };
  walk(editor);
  return { text: text.slice(0, 5000), ranges };
}

function editableList(title, values, onChange) {
  const list = el('div', { class: 'admin-resource-list' });
  const render = () => {
    list.innerHTML = '';
    values.forEach((value, index) => {
      const input = el('input', { value, 'aria-label': `${title} ${index + 1}` });
      input.addEventListener('input', () => { values[index] = input.value; onChange(); });
      list.appendChild(el('div', { class: 'admin-resource-row' }, [
        input,
        iconButton(`删除${title}`, minusSvg, () => { values.splice(index, 1); onChange(); render(); }),
      ]));
    });
    list.appendChild(el('button', {
      class: 'admin-add-row', type: 'button', html: `${plusSvg}<span>添加${title}</span>`,
      onclick: () => { values.push(''); onChange(); render(); list.querySelector('.admin-resource-row:last-of-type input')?.focus(); },
    }));
  };
  render();
  return list;
}

export async function adminCraftView(root, { id }) {
  if (!requireAdmin()) return { cleanup() {} };
  const craft = await ensureCraftLoaded(id);
  if (!craft) {
    location.hash = '#/admin';
    return { cleanup() {} };
  }
  const steps = craft.steps.map(stepDraft);
  const graphData = structuredClone(craft.config?.graphData || craft.communityDetails?.star_data || { summary: '', relations: [], keywords: [] });
  graphData.relations = Array.isArray(graphData.relations) ? graphData.relations.map((item) => typeof item === 'string' ? ({ type: 'tradition', title: item, summary: '' }) : item) : [];
  graphData.keywords = Array.isArray(graphData.keywords) ? graphData.keywords : [];
  graphData.images = [];
  let activeIndex = 0;
  let dirty = false;
  let changeVersion = 0;
  let savedVersion = 0;
  let autoSaveTimer = null;
  let activeSave = null;
  let disposed = false;

  const contentDraft = {
    title: craft.title || '',
    category: craft.config?.category || '',
    summary: craft.summary || '',
    claims: (craft.claims || []).map((claim, index) => ({
      id: claim.claim_id || claim.id || `claim_${index + 1}`,
      statement: claim.statement || '',
      evidence_ids: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    })),
  };
  let coverPath = craft.config?.heroFrame || '';
  let coverChanged = false;
  let overviewImages = (craft.config?.works || []).slice(0, 48).map((work) => ({
    title: work.name || '', image_url: work.frame || '', description: work.description || '', source_url: work.sourceUrl || '',
  }));
  let overviewChanged = false;
  let contentDirty = false;
  const contentState = el('span', { class: 'admin-save-status is-saved', text: '正文已保存' });
  const contentSaveButton = el('button', { class: 'btn-ghost', type: 'button', text: '保存正文' });
  const contentEditor = el('section', { class: 'admin-content-editor', id: 'admin-content-section' });
  const titleInput = el('input', { value: contentDraft.title, maxlength: '200', placeholder: '项目名称' });
  const categoryInput = el('input', { value: contentDraft.category, maxlength: '100', placeholder: '分类；留空则显示“未分类”' });
  const summaryInput = el('textarea', { rows: '5', maxlength: '10000', placeholder: '项目简介；可以清空后保存' }, [contentDraft.summary]);
  const coverInput = el('input', { class: 'admin-upload-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, tabindex: '-1' });
  const coverProgress = createUploadProgress();
  const coverPreview = el('div', { class: 'admin-cover-preview' });
  const overviewEditor = el('div', { class: 'admin-overview-editor' });
  const claimList = el('div', { class: 'admin-claim-list' });
  const markContentDirty = () => {
    contentDirty = true;
    contentState.className = 'admin-save-status is-dirty';
    contentState.textContent = '正文有未保存修改';
  };
  const renderCoverPreview = () => {
    coverPreview.replaceChildren(
      coverPath
        ? el('img', { src: craftAssetUrl(craft, coverPath), alt: `${titleInput.value || craft.title}封面预览` })
        : el('div', { class: 'admin-cover-placeholder', text: '尚未设置项目封面' }),
      coverPath ? el('button', {
        class: 'admin-step-image-remove', type: 'button', text: '移除封面',
        onclick: () => { coverPath = ''; coverChanged = true; markContentDirty(); coverProgress.reset(); renderCoverPreview(); },
      }) : null,
    );
  };
  const uploadCover = async (files) => {
    const file = [...files][0];
    if (!file) return;
    coverInput.disabled = true;
    coverProgress.start(file.name);
    try {
      const image = await uploadCraftImage(craft.craftId, file, { onProgress: coverProgress.update });
      coverPath = image.image_url;
      coverChanged = true;
      markContentDirty();
      coverProgress.success(`${file.name} 已上传，保存正文后正式应用`);
      renderCoverPreview();
    } catch (error) {
      coverProgress.error(error.message || '封面上传失败');
    } finally { coverInput.disabled = false; }
  };
  const coverDrop = el('div', { class: 'admin-image-drop', role: 'button', tabindex: '0', 'aria-label': '上传项目封面' }, [
    el('strong', { text: '拖入项目封面' }), el('span', { text: '或点击选择 PNG、JPG、WebP、GIF，最大 6MB' }), coverInput,
  ]);
  bindImageDropZone({ zone: coverDrop, input: coverInput, onFiles: uploadCover });
  renderCoverPreview();
  const renderOverviewEditor = () => {
    overviewEditor.replaceChildren();
    const list = el('div', { class: 'admin-image-list' });
    overviewImages.forEach((image, index) => {
      const title = el('input', { value: image.title || '', placeholder: `图片 ${index + 1} 标题` });
      const description = el('textarea', { rows: '2', placeholder: '图片说明' }, [image.description || '']);
      const source = el('input', { value: image.source_url || '', placeholder: '来源链接（可选）' });
      [title, description, source].forEach((control) => control.addEventListener('input', () => {
        Object.assign(image, { title: title.value, description: description.value, source_url: source.value });
        overviewChanged = true; markContentDirty();
      }));
      list.appendChild(el('article', { class: 'admin-documentary-item' }, [
        el('img', { src: craftAssetUrl(craft, image.image_url), alt: image.title || '项目图片', loading: 'lazy' }),
        el('div', { class: 'admin-documentary-fields' }, [title, description, source]),
        iconButton('删除图片', minusSvg, () => { overviewImages.splice(index, 1); overviewChanged = true; markContentDirty(); renderOverviewEditor(); }),
      ]));
    });
    const input = el('input', { class: 'admin-upload-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, multiple: true, tabindex: '-1' });
    const progress = createUploadProgress();
    const drop = el('div', { class: 'admin-image-drop is-compact', role: 'button', tabindex: '0', 'aria-label': '上传项目图片' }, [
      el('strong', { text: '添加其他图片' }), el('span', { text: '可填写标题、介绍和来源，最多 48 张；单张失败不影响其他图片' }), input,
    ]);
    bindImageDropZone({ zone: drop, input, onFiles: async (files) => {
      const selected = [...files].slice(0, Math.max(0, 48 - overviewImages.length));
      let uploadedCount = 0;
      let failedCount = 0;
      for (const [index, file] of selected.entries()) {
        progress.start(`${index + 1}/${selected.length} · ${file.name}`);
        try {
          const uploaded = await uploadCraftImage(craft.craftId, file, { onProgress: progress.update });
          overviewImages.push({ title: file.name.replace(/\.[^.]+$/, ''), image_url: uploaded.image_url, description: '', source_url: '' });
          uploadedCount += 1;
          overviewChanged = true; markContentDirty();
        } catch (error) {
          failedCount += 1;
          progress.error(`${file.name}：${error.message || '图片上传失败'}`);
        }
      }
      if (!failedCount) progress.success(`${uploadedCount} 张图片已上传，保存正文后正式应用`);
      else progress.error(`已上传 ${uploadedCount} 张，${failedCount} 张失败；可稍后重试，不影响正文保存`);
      setTimeout(renderOverviewEditor, 350);
    } });
    overviewEditor.append(drop, progress.el, list);
  };
  renderOverviewEditor();
  [titleInput, categoryInput, summaryInput].forEach((control) => control.addEventListener('input', markContentDirty));
  const renderClaims = () => {
    claimList.replaceChildren();
    contentDraft.claims.forEach((claim, index) => {
      const statement = el('textarea', { rows: '3', maxlength: '3000', 'aria-label': `事实陈述 ${index + 1}` }, [claim.statement]);
      statement.addEventListener('input', () => { claim.statement = statement.value; markContentDirty(); });
      claimList.appendChild(el('div', { class: 'admin-claim-row' }, [
        statement,
        iconButton('删除事实陈述', minusSvg, () => { contentDraft.claims.splice(index, 1); markContentDirty(); renderClaims(); }),
      ]));
    });
    claimList.appendChild(el('button', {
      class: 'admin-add-row', type: 'button', html: `${plusSvg}<span>添加事实陈述</span>`,
      onclick: () => { contentDraft.claims.push({ id: `claim_${Date.now()}`, statement: '', evidence_ids: [] }); markContentDirty(); renderClaims(); claimList.querySelector('.admin-claim-row:last-of-type textarea')?.focus(); },
    }));
  };
  async function persistContent({ announce = false } = {}) {
    if (!contentDirty) return true;
    contentSaveButton.disabled = true;
    contentSaveButton.textContent = '保存中…';
    contentState.className = 'admin-save-status is-saving';
    contentState.textContent = '正在保存正文…';
    try {
      const fields = {
        title: titleInput.value,
        category: categoryInput.value,
        summary: summaryInput.value,
        claims: contentDraft.claims,
        ...(coverChanged ? { cover_path: coverPath } : {}),
        ...(overviewChanged ? { images: overviewImages } : {}),
      };
      const saved = await saveCraft(craft.craftId, fields);
      applyCraftEditorialUpdate(craft.craftId, fields, saved.revision);
      await refreshGraphContent().catch(() => null);
      coverChanged = false;
      overviewChanged = false;
      contentDirty = false;
      contentState.className = 'admin-save-status is-saved';
      contentState.textContent = '正文已保存';
      if (announce) adminNotice('项目正文与事实陈述已保存');
      return true;
    } catch (error) {
      contentState.className = 'admin-save-status is-error';
      contentState.textContent = '正文保存失败';
      adminNotice(error.message, true);
      return false;
    } finally {
      contentSaveButton.disabled = false;
      contentSaveButton.textContent = '保存正文';
    }
  }
  contentSaveButton.addEventListener('click', () => void persistContent({ announce: true }));
  contentEditor.append(
    el('div', { class: 'admin-section-heading' }, [
      el('div', {}, [el('h2', { text: '项目正文' }), el('p', { text: '这里是用户页面的正式内容。简介可以清空，事实陈述可逐条编辑或删除。' })]),
      el('div', {}, [contentState, contentSaveButton]),
    ]),
    el('div', { class: 'admin-content-fields' }, [
      el('label', { class: 'admin-field' }, [el('span', { text: '项目名称' }), titleInput]),
      el('label', { class: 'admin-field' }, [el('span', { text: '分类' }), categoryInput]),
    ]),
    el('label', { class: 'admin-field' }, [el('span', { text: '项目简介' }), summaryInput]),
    el('section', { class: 'admin-image-role-guide', 'aria-label': '图片用途说明' }, [
      el('article', { class: 'is-primary' }, [el('span', { text: '01 · 主图' }), el('strong', { text: '项目身份图' }), el('p', { text: '项目封面、列表与节点缺图时的默认图片。' })]),
      el('article', {}, [el('span', { text: '02 · 其他图片' }), el('strong', { text: '全站共用图集' }), el('p', { text: '详情页与星图共用，不需要重复上传。' })]),
    ]),
    el('section', { class: 'admin-cover-editor' }, [
      el('div', {}, [el('h3', { text: '主图' }), el('p', { class: 'admin-field-help', text: '项目唯一的默认图片，用于地图列表、详情封面和星图节点。' })]),
      el('div', { class: 'admin-cover-editor-grid' }, [coverPreview, el('div', {}, [coverDrop, coverProgress.el])]),
    ]),
    el('section', { class: 'admin-cover-editor' }, [
      el('div', {}, [el('h3', { text: '其他图片' }), el('p', { class: 'admin-field-help', text: '选填。可补充不同角度、工艺细节或活动现场；同一套图片会在详情和星图中复用。' })]),
      overviewEditor,
    ]),
    el('section', {}, [el('h3', { text: '事实陈述' }), el('p', { class: 'admin-field-help', text: '删除后保存即不再出现在用户页面或智能体项目资料中。' }), claimList]),
  );
  renderClaims();

  const tabs = el('div', { class: 'admin-step-tabs', role: 'tablist', 'aria-label': '选择工序' });
  const editor = el('section', { class: 'admin-step-editor', id: 'admin-active-step-editor' });
  const graphEditor = el('section', { class: 'admin-graph-editor', id: 'admin-graph-section' });
  const graphKeywords = el('input', { value: graphData.keywords.join('、'), placeholder: '关键词，用顿号分隔' });
  const graphRelations = el('div', { class: 'admin-graph-relations' });
  let graphDirty = false;
  const graphState = el('span', { class: 'admin-save-status is-saved', text: '星图已保存' });
  const markGraphDirty = () => { graphDirty = true; graphState.className = 'admin-save-status is-dirty'; graphState.textContent = '星图有未保存修改'; };
  const renderGraphRelations = () => {
    graphRelations.replaceChildren();
    graphData.relations.forEach((relation, index) => {
      const type = el('select', {}, ['tradition', 'material', 'region'].map((value) => { const option = el('option', { value, text: value === 'material' ? '材料' : value === 'region' ? '地区' : '传统' }); option.selected = relation.type === value; return option; }));
      const title = el('input', { value: relation.title || '', placeholder: '关联节点名称' });
      const summary = el('input', { value: relation.summary || '', placeholder: '节点说明（可选）' });
      [type, title, summary].forEach((control) => control.addEventListener('input', () => { relation.type = type.value; relation.title = title.value; relation.summary = summary.value; markGraphDirty(); }));
      graphRelations.appendChild(el('div', { class: 'admin-graph-relation-row' }, [type, title, summary, el('button', { type: 'button', class: 'admin-icon-button', text: '删除', onclick: () => { graphData.relations.splice(index, 1); markGraphDirty(); renderGraphRelations(); } })]));
    });
    graphRelations.appendChild(el('button', { class: 'admin-add-row', type: 'button', text: '添加关联节点', onclick: () => { graphData.relations.push({ type: 'tradition', title: '', summary: '' }); markGraphDirty(); renderGraphRelations(); } }));
  };
  graphKeywords.addEventListener('input', markGraphDirty);
  const graphSaveButton = el('button', { class: 'btn-ghost', type: 'button', text: '保存星图资料' });
  async function persistGraph({ announce = false } = {}) {
    if (!graphDirty) return true;
    graphSaveButton.disabled = true;
    try {
      graphData.summary = summaryInput.value;
      graphData.keywords = String(graphKeywords.value || '').split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
      const saved = await saveCraft(craft.craftId, { graph_data: graphData });
      applyCraftEditorialUpdate(craft.craftId, { graph_data: graphData }, saved.revision);
      await refreshGraphContent().catch(() => null);
      graphDirty = false; graphState.className = 'admin-save-status is-saved'; graphState.textContent = '星图已保存';
      if (announce) adminNotice('星图资料已保存');
      return true;
    } catch (error) {
      adminNotice(error.message, true);
      return false;
    } finally {
      graphSaveButton.disabled = false;
    }
  }
  graphSaveButton.addEventListener('click', () => void persistGraph({ announce: true }));
  graphEditor.append(el('div', { class: 'admin-section-heading' }, [el('div', {}, [el('h2', { text: '知识星图关系' }), el('p', { text: '星图节点名称、简介和图片自动使用上方项目正文；地区关系由所在地区自动生成。这里仅维护检索关键词和有事实依据的传统或材料关系。' })]), el('div', {}, [graphState, graphSaveButton])]), el('label', { class: 'admin-field' }, [el('span', { text: '星图检索关键词' }), graphKeywords]), graphRelations);
  renderGraphRelations();
  const saveButton = el('button', { class: 'btn btn-primary', text: '保存全部工序' });
  const saveStatus = el('span', { class: 'admin-save-status is-saved', text: '已保存' });

  const setSaveState = (state, text) => {
    saveStatus.className = `admin-save-status is-${state}`;
    saveStatus.textContent = text;
  };
  const scheduleAutoSave = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { void persistSteps({ announce: false }); }, 900);
  };
  const markDirty = () => {
    dirty = true;
    changeVersion += 1;
    saveButton.disabled = false;
    setSaveState('dirty', '有未保存修改');
    scheduleAutoSave();
  };

  async function persistSteps({ announce = false } = {}) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (activeSave) {
      const ok = await activeSave;
      if (!ok) return false;
      if (savedVersion < changeVersion) return persistSteps({ announce });
      return true;
    }
    if (!dirty && savedVersion >= changeVersion) {
      if (announce) adminNotice('工序已经是最新版本');
      return true;
    }
    const targetVersion = changeVersion;
    saveButton.disabled = true;
    saveButton.textContent = '保存中';
    setSaveState('saving', '正在保存到服务器…');
    activeSave = (async () => {
      try {
        await saveCraftSteps(craft.craftId, structuredClone(steps));
        savedVersion = Math.max(savedVersion, targetVersion);
        dirty = savedVersion < changeVersion;
        if (!disposed) {
          saveButton.disabled = !dirty;
          saveButton.textContent = '保存全部工序';
          setSaveState(dirty ? 'dirty' : 'saved', dirty ? '仍有新修改待保存' : '已保存到服务器');
          if (announce) adminNotice('工序已保存');
        }
        if (dirty) scheduleAutoSave();
        return true;
      } catch (error) {
        dirty = true;
        if (!disposed) {
          saveButton.disabled = false;
          saveButton.textContent = '重新保存';
          setSaveState('error', '保存失败，内容尚未离开本页');
          adminNotice(error.message, true);
        }
        return false;
      } finally {
        activeSave = null;
      }
    })();
    return activeSave;
  }
  const createStep = () => {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const stepId = `step_${craft.craftId}_${stamp}`;
    const actionId = `${stepId}_action_1`;
    steps.push({
      id: stepId,
      name: `工序 ${steps.length + 1}`,
      action: '',
      guide_text: '',
      guide_bold_ranges: [],
      result: '',
      materials: [],
      material_transforms: [],
      tools: [],
      resource_visuals: [],
      documentary_clips: [],
      step_image: null,
      resource_groups: null,
      quick_fill: null,
      actions: [{ id: actionId, label: '执行当前工序' }],
      correct_action_id: actionId,
    });
    activeIndex = steps.length - 1;
    markDirty();
    render();
  };

  function renderTabs() {
    tabs.innerHTML = '';
    steps.forEach((step, index) => tabs.appendChild(el('button', {
      class: `admin-step-tab${index === activeIndex ? ' active' : ''}`,
      type: 'button', role: 'tab', 'aria-selected': String(index === activeIndex),
      text: `${index + 1}. ${step.name || '未命名工序'}`,
      onclick: () => { activeIndex = index; render(); },
    })));
    tabs.appendChild(el('button', {
      class: 'admin-step-add', type: 'button', html: `${plusSvg}<span>新增工序</span>`, onclick: createStep,
    }));
  }

  function renderEditor() {
    editor.innerHTML = '';
    const step = steps[activeIndex];
    if (!step) {
      editor.appendChild(el('div', { class: 'empty-state', text: '当前没有工序，请点击“新增工序”。' }));
      return;
    }
    const nameInput = el('input', { value: step.name, 'aria-label': '工序名称' });
    const description = el('textarea', { rows: '5', 'aria-label': '工序说明' }, [step.action]);
    const result = el('textarea', { rows: '3', 'aria-label': '完成结果' }, [step.result]);
    const guideEditor = el('div', {
      class: 'admin-guide-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': '用户工作台上显示的工序提示', 'data-placeholder': '填写用户进行本步工序时看到的提示',
    });
    guideEditor.appendChild(guideFragment(step.guide_text || '', step.guide_bold_ranges || []));
    const syncGuide = () => {
      const value = readGuideEditor(guideEditor);
      step.guide_text = value.text;
      step.guide_bold_ranges = value.ranges;
      markDirty();
    };
    guideEditor.addEventListener('input', syncGuide);
    guideEditor.addEventListener('paste', (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
    });
    const boldGuide = () => {
      guideEditor.focus();
      document.execCommand('bold', false);
      syncGuide();
    };
    const clearGuideFormatting = () => {
      const plain = guideEditor.textContent || '';
      guideEditor.replaceChildren(document.createTextNode(plain));
      syncGuide();
    };
    nameInput.addEventListener('input', () => { step.name = nameInput.value; markDirty(); renderTabs(); });
    description.addEventListener('input', () => { step.action = description.value; markDirty(); });
    result.addEventListener('input', () => { step.result = result.value; markDirty(); });
    const markResourcesDirty = () => {
      // The compact editor exposes required material/tool lists rather than
      // group semantics. Once a list changes, rebuild it as required (`all`)
      // groups on the server and discard presets that may reference old names.
      step.resource_groups = null;
      step.quick_fill = null;
      markDirty();
    };

    const materialsEditor = el('div', { class: 'admin-material-transform-list' });
    const renderMaterialTransforms = () => {
      materialsEditor.innerHTML = '';
      const inheritedNames = uniqueMaterialNames(materialInventoryBeforeStep(steps, activeIndex));
      const transformFor = (name, defaultOutput = '') => {
        let transform = step.material_transforms.find((item) => item.input_name === name);
        if (!transform) {
          transform = { input_name: name, output_name: defaultOutput };
          step.material_transforms.push(transform);
        }
        return transform;
      };
      materialsEditor.appendChild(el('div', { class: 'admin-material-transform-head', 'aria-hidden': 'true' }, [
        el('span', { text: '进入本工序时' }),
        el('span', { text: '完成后变为' }),
        el('span'),
      ]));
      if (inheritedNames.length) materialsEditor.appendChild(el('p', {
        class: 'admin-material-flow-help',
        text: '既有材料可在本步使用或暂存。暂存不会删除材料，后续工序仍可重新启用；只有“完成后变为”留空才表示永久消耗。',
      }));
      inheritedNames.forEach((name) => {
        const transform = step.material_transforms.find((item) => item.input_name === name);
        const isActive = Boolean(transform);
        const output = isActive ? el('input', {
          value: transform.output_name,
          'aria-label': `继承材料 ${name} 完成后变为`,
          placeholder: '留空表示本步消耗',
        }) : el('span', { class: 'admin-held-material-label', text: '本步暂存，不参与加工' });
        if (isActive) output.addEventListener('input', () => { transform.output_name = output.value; markDirty(); });
        const toggle = el('button', {
          class: `admin-material-toggle${isActive ? ' is-hold' : ' is-use'}`,
          type: 'button',
          text: isActive ? '移出本步' : '本步使用',
          'aria-label': isActive ? `将继承材料 ${name} 移出本步并暂存` : `本步使用继承材料 ${name}`,
          onclick: () => {
            if (isActive) {
              step.material_transforms.splice(step.material_transforms.indexOf(transform), 1);
              const materialIndex = step.materials.indexOf(name);
              if (materialIndex >= 0) {
                step.materials.splice(materialIndex, 1);
                markResourcesDirty();
              } else markDirty();
            } else {
              step.material_transforms.push({ input_name: name, output_name: name });
              markDirty();
            }
            renderMaterialTransforms();
          },
        });
        materialsEditor.appendChild(el('div', { class: `admin-material-transform-row is-inherited${isActive ? '' : ' is-held'}` }, [
          el('div', { class: 'admin-inherited-material' }, [
            el('span', { text: name }),
            el('small', { text: isActive ? '既有材料 · 本步使用' : '既有材料 · 已暂存' }),
          ]),
          el('span', { class: 'admin-transform-arrow', text: '→', 'aria-hidden': 'true' }),
          output,
          toggle,
        ]));
      });
      step.materials.forEach((value, index) => {
        if (inheritedNames.includes(value)) return;
        const transform = transformFor(value, value);
        const input = el('input', { value, 'aria-label': `材料 ${index + 1}` });
        const output = el('input', {
          value: transform.output_name,
          'aria-label': `材料 ${index + 1} 完成后变为`,
          placeholder: '填写升级后的名称',
        });
        input.addEventListener('input', () => {
          step.materials[index] = input.value;
          transform.input_name = input.value;
          markResourcesDirty();
        });
        output.addEventListener('input', () => { transform.output_name = output.value; markDirty(); });
        materialsEditor.appendChild(el('div', { class: 'admin-material-transform-row' }, [
          input,
          el('span', { class: 'admin-transform-arrow', text: '→', 'aria-hidden': 'true' }),
          output,
          iconButton('删除材料', minusSvg, () => {
            const transformIndex = step.material_transforms.indexOf(transform);
            step.materials.splice(index, 1);
            if (transformIndex >= 0) step.material_transforms.splice(transformIndex, 1);
            markResourcesDirty();
            renderMaterialTransforms();
          }),
        ]));
      });
      materialsEditor.appendChild(el('button', {
        class: 'admin-add-row', type: 'button', html: `${plusSvg}<span>添加材料</span>`,
        onclick: () => {
          step.materials.push('');
          markResourcesDirty();
          renderMaterialTransforms();
          materialsEditor.querySelector('.admin-material-transform-row:last-of-type input')?.focus();
        },
      }));
    };
    renderMaterialTransforms();

    const operations = el('div', { class: 'admin-operation-list' });
    const renderOperations = () => {
      operations.innerHTML = '';
      step.actions.forEach((action, index) => {
        const radio = el('input', { type: 'radio', name: `correct-${step.id}`, value: action.id, 'aria-label': '设为正确操作' });
        radio.checked = step.correct_action_id === action.id;
        radio.addEventListener('change', () => { step.correct_action_id = action.id; markDirty(); });
        const input = el('input', { value: action.label, 'aria-label': `操作 ${index + 1}` });
        input.addEventListener('input', () => { action.label = input.value; markDirty(); });
        operations.appendChild(el('div', { class: 'admin-operation-row' }, [
          el('label', { class: 'admin-correct-action' }, [radio, el('span', { text: '正确操作' })]),
          input,
          iconButton('删除操作', minusSvg, () => {
            step.actions.splice(index, 1);
            if (!step.actions.some((item) => item.id === step.correct_action_id)) step.correct_action_id = step.actions[0]?.id || '';
            markDirty(); renderOperations();
          }),
        ]));
      });
      operations.appendChild(el('button', {
        class: 'admin-add-row', type: 'button', html: `${plusSvg}<span>添加操作</span>`,
        onclick: () => {
          const action = { id: `${step.id}_action_${Date.now()}`, label: '' };
          step.actions.push(action);
          if (!step.correct_action_id) step.correct_action_id = action.id;
          markDirty(); renderOperations();
        },
      }));
    };
    renderOperations();

    const stepImageEditor = el('section', { class: 'admin-step-image-editor' });
    const renderStepImageEditor = () => {
      const fileInput = el('input', {
        class: 'admin-step-image-input', type: 'file', accept: 'image/png,image/jpeg,image/webp', tabindex: '-1',
        'aria-label': `上传“${step.name || `工序 ${activeIndex + 1}`}”的步骤图片`,
      });
      const status = el('p', { class: 'admin-step-image-status', role: 'status', 'aria-live': 'polite' });
      const progress = createUploadProgress();
      const uploadFiles = async (files) => {
        const file = [...files][0];
        if (!file) return;
        fileInput.disabled = true;
        status.className = 'admin-step-image-status is-uploading';
        status.textContent = '正在上传图片…';
        progress.start(file.name);
        try {
          const image = await uploadCraftStepImage(craft.craftId, step.id, file, { onProgress: progress.update });
          step.step_image = {
            ...image,
            alt: `工序“${step.name || `工序 ${activeIndex + 1}`}”参考图`,
          };
          markDirty();
          progress.success(`${file.name} 已上传`);
          setTimeout(renderStepImageEditor, 350);
        } catch (error) {
          fileInput.disabled = false;
          fileInput.value = '';
          status.className = 'admin-step-image-status is-error';
          status.textContent = error.message || '图片上传失败，请重试。';
          progress.error(status.textContent);
        }
      };
      const imageDrop = el('div', { class: 'admin-image-drop', role: 'button', tabindex: '0', 'aria-label': `上传“${step.name || `工序 ${activeIndex + 1}`}”的步骤图片` }, [
        el('strong', { text: step.step_image?.image_url ? '拖入新图片替换' : '拖入步骤图片' }),
        el('span', { text: '或点击选择 PNG、JPG、WebP，最大 6MB' }), fileInput,
      ]);
      bindImageDropZone({ zone: imageDrop, input: fileInput, onFiles: uploadFiles });
      const heading = el('div', { class: 'admin-section-heading' }, [
        el('div', {}, [
          el('h3', { text: '工作台步骤图片' }),
          el('p', { text: '每道工序可上传一张截图；支持 PNG、JPG、WebP，单张不超过 6MB。图片会显示在用户工作台右下角。' }),
        ]),
        el('div', { class: 'admin-step-image-actions' }, [imageDrop]),
      ]);
      if (!step.step_image?.image_url) {
        stepImageEditor.replaceChildren(
          heading,
          el('div', { class: 'admin-step-image-empty' }, [
            el('strong', { text: '当前工序尚未添加图片' }),
            el('span', { text: '使用上方区域选择或拖入截图。' }),
          ]),
          progress.el,
          status,
        );
        return;
      }
      const preview = el('img', {
        src: craftAssetUrl(craft, step.step_image.image_url),
        alt: step.step_image.alt || `工序“${step.name || activeIndex + 1}”参考图`,
        loading: 'lazy',
      });
      preview.addEventListener('error', () => {
        status.className = 'admin-step-image-status is-error';
        status.textContent = '图片暂时无法读取，请重新上传。';
      }, { once: true });
      stepImageEditor.replaceChildren(
        heading,
        el('div', { class: 'admin-step-image-preview' }, [
          preview,
          el('div', { class: 'admin-step-image-meta' }, [
            el('strong', { text: step.step_image.original_name || '已上传的步骤图片' }),
            step.step_image.size ? el('span', { text: `${(step.step_image.size / 1024 / 1024).toFixed(2)} MB` }) : null,
          ]),
          el('button', {
            class: 'admin-step-image-remove', type: 'button', text: '移除图片',
            onclick: () => { step.step_image = null; markDirty(); renderStepImageEditor(); },
          }),
        ]),
        progress.el,
        status,
      );
    };
    renderStepImageEditor();

    const documentaryEditor = el('section', { class: 'admin-documentary-editor' });
    const defaultWorks = (craft.config?.works || []).slice(0, 8);
    const ensureClipImage = (work) => ({
      title: work.name || '纪录片关键帧', image_url: work.frame || '', evidence_id: work.evidenceId || '', description: '', source_url: '',
    });
    const renderDocumentaryEditor = () => {
      documentaryEditor.replaceChildren(
        el('div', { class: 'admin-section-heading' }, [
          el('div', {}, [el('h3', { text: '纪录片片段与关键帧' }), el('p', { text: '默认关键帧来自项目已有纪录片资料。拖入不合适的图片可删除或重新选择；视频地址为可选项。' })]),
        ]),
      );
      const picker = el('div', { class: 'admin-documentary-picker', 'aria-label': '已有纪录片关键帧' });
      defaultWorks.forEach((work) => {
        const card = el('button', { class: 'admin-documentary-source', type: 'button', draggable: 'true', title: '拖入下方片段列表', onclick: () => { step.documentary_clips.push(ensureClipImage(work)); markDirty(); renderDocumentaryEditor(); } }, [
          el('img', { src: craftAssetUrl(craft, work.frame), alt: work.name || '纪录片关键帧', loading: 'lazy' }),
          el('span', { text: work.name || '纪录片关键帧' }),
        ]);
        card.addEventListener('dragstart', (event) => { event.dataTransfer?.setData('application/x-sh-crafted-frame', JSON.stringify(ensureClipImage(work))); });
        picker.appendChild(card);
      });
      const list = el('div', { class: 'admin-documentary-list' });
      const drop = el('div', { class: 'admin-documentary-drop', text: '将上方关键帧拖到这里，或点击图片添加' });
      drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault(); drop.classList.remove('is-over');
        try { const clip = JSON.parse(event.dataTransfer?.getData('application/x-sh-crafted-frame') || '{}'); if (clip.image_url) { step.documentary_clips.push(clip); markDirty(); renderDocumentaryEditor(); } } catch (_) { /* ignore invalid drag payload */ }
      });
      const localInput = el('input', { class: 'admin-upload-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, tabindex: '-1' });
      const localProgress = createUploadProgress();
      const localDrop = el('div', { class: 'admin-image-drop is-compact', role: 'button', tabindex: '0', 'aria-label': '上传本地纪录片关键帧' }, [
        el('strong', { text: '上传新的关键帧' }), el('span', { text: '拖入本地图片或点击选择，最大 6MB' }), localInput,
      ]);
      bindImageDropZone({
        zone: localDrop, input: localInput,
        onFiles: async (files) => {
          const file = [...files][0];
          if (!file) return;
          localInput.disabled = true;
          localProgress.start(file.name);
          try {
            const uploaded = await uploadCraftImage(craft.craftId, file, { onProgress: localProgress.update });
            step.documentary_clips.push({
              title: file.name.replace(/\.[^.]+$/, ''), image_url: uploaded.image_url,
              evidence_id: '', description: '', source_url: '', video_url: '', start_seconds: 0, end_seconds: 0,
            });
            markDirty();
            localProgress.success(`${file.name} 已上传`);
            setTimeout(renderDocumentaryEditor, 350);
          } catch (error) {
            localProgress.error(error.message || '关键帧上传失败');
            localInput.disabled = false;
          }
        },
      });
      (step.documentary_clips || []).forEach((clip, index) => {
        const title = el('input', { value: clip.title || '', placeholder: '片段标题' });
        const description = el('textarea', { rows: '2', placeholder: '图片或片段说明' }, [clip.description || '']);
        const video = el('input', { value: clip.video_url || '', placeholder: '视频地址（可选）' });
        const start = el('input', { type: 'number', min: '0', step: '1', value: String(clip.start_seconds || 0), placeholder: '起始秒' });
        const end = el('input', { type: 'number', min: '0', step: '1', value: String(clip.end_seconds || 0), placeholder: '结束秒' });
        const sync = () => { Object.assign(clip, { title: title.value, description: description.value, video_url: video.value, start_seconds: Number(start.value) || 0, end_seconds: Number(end.value) || 0 }); markDirty(); };
        [title, description, video, start, end].forEach((control) => control.addEventListener('input', sync));
        list.appendChild(el('article', { class: 'admin-documentary-item' }, [
          clip.image_url ? el('img', { src: craftAssetUrl(craft, clip.image_url), alt: clip.title || '已选关键帧', loading: 'lazy' }) : el('div', { class: 'admin-documentary-placeholder', text: '视频' }),
          el('div', { class: 'admin-documentary-fields' }, [title, description, video, el('div', { class: 'admin-documentary-time' }, [start, end])]),
          iconButton('删除片段', minusSvg, () => { step.documentary_clips.splice(index, 1); markDirty(); renderDocumentaryEditor(); }),
        ]));
      });
      documentaryEditor.append(picker, drop, localDrop, localProgress.el, list);
    };
    renderDocumentaryEditor();

    const visualResources = [...new Set([
      ...step.materials,
      ...step.tools,
      ...step.material_transforms.map((item) => item.output_name),
    ].map((name) => String(name || '').trim()).filter(Boolean))];
    const visualList = el('div', { class: 'admin-visual-list' });
    visualResources.forEach((name) => {
      let visual = step.resource_visuals.find((item) => item.name === name);
      if (!visual) {
        visual = { name, shape: resourceShape(name), scale: 1 };
        step.resource_visuals.push(visual);
      }
      const shapeSelect = el('select', { 'aria-label': `${name}的三维形状` }, RESOURCE_SHAPES.map((shape) => {
        const option = el('option', { value: shape.id, text: shape.label });
        option.selected = visual.shape === shape.id;
        return option;
      }));
      const scale = el('input', {
        type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(visual.scale || 1),
        'aria-label': `${name}的三维尺寸`,
      });
      const scaleValue = el('output', { text: `${Number(visual.scale || 1).toFixed(2)}×` });
      shapeSelect.addEventListener('change', () => { visual.shape = shapeSelect.value; markDirty(); });
      scale.addEventListener('input', () => {
        visual.scale = Number(scale.value);
        scaleValue.textContent = `${visual.scale.toFixed(2)}×`;
        markDirty();
      });
      visualList.appendChild(el('div', { class: 'admin-visual-row' }, [
        el('strong', { text: name }), shapeSelect, scale, scaleValue,
      ]));
    });

    editor.append(
      el('div', { class: 'admin-editor-heading' }, [
        el('div', {}, [el('p', { class: 'admin-kicker', text: `工序 ${activeIndex + 1} / ${steps.length}` }), el('h2', { text: step.name || '未命名工序' })]),
        el('div', { class: 'admin-order-tools' }, [
          el('button', { class: 'btn-ghost', text: '前移', disabled: activeIndex === 0 ? 'disabled' : null, onclick: () => {
            if (activeIndex < 1) return; [steps[activeIndex - 1], steps[activeIndex]] = [steps[activeIndex], steps[activeIndex - 1]]; activeIndex--; markDirty(); render();
          } }),
          el('button', { class: 'btn-ghost', text: '后移', disabled: activeIndex === steps.length - 1 ? 'disabled' : null, onclick: () => {
            if (activeIndex >= steps.length - 1) return; [steps[activeIndex + 1], steps[activeIndex]] = [steps[activeIndex], steps[activeIndex + 1]]; activeIndex++; markDirty(); render();
          } }),
        ]),
      ]),
      el('div', { class: 'admin-field' }, [el('label', { text: '工序名称' }), nameInput]),
      el('div', { class: 'admin-field' }, [el('label', { text: '工序说明' }), description]),
      el('section', { class: 'admin-guide-section' }, [
        el('div', { class: 'admin-section-heading' }, [
          el('div', {}, [el('h3', { text: '工作台步骤提示' }), el('p', { text: '这段文字会悬浮在用户的工作台上；选中文字后可切换加粗。' })]),
          el('div', { class: 'admin-guide-tools' }, [
            el('button', { class: 'btn-ghost', type: 'button', text: '加粗 / 取消加粗', onmousedown: (event) => event.preventDefault(), onclick: boldGuide }),
            el('button', { class: 'btn-ghost', type: 'button', text: '清除加粗', onclick: clearGuideFormatting }),
          ]),
        ]),
        guideEditor,
      ]),
      el('div', { class: 'admin-field' }, [el('label', { text: '完成结果' }), result]),
      stepImageEditor,
      documentaryEditor,
      el('div', { class: 'admin-resource-columns' }, [
        el('section', { class: 'admin-material-transform-section' }, [
          el('h3', { text: '所需材料及升级结果' }),
          el('p', { class: 'admin-field-help', text: '每件材料完成动作后独立升一级，并在原位置替换为右侧填写的新材料。' }),
          materialsEditor,
        ]),
        el('section', {}, [el('h3', { text: '所需工具' }), editableList('工具', step.tools, markResourcesDirty)]),
      ]),
      el('section', { class: 'admin-visual-section' }, [
        el('div', { class: 'admin-section-heading' }, [
          el('h3', { text: '材料与工具的 3D 呈现' }),
          el('p', { text: '共 10 种形状；杯、盏等未手动设置时会自动使用圆柱体。尺寸只影响工作台中的视觉比例。' }),
        ]),
        visualResources.length ? visualList : el('p', { class: 'empty-state', text: '添加材料或工具后即可配置三维呈现。' }),
      ]),
      el('section', { class: 'admin-operations' }, [
        el('div', { class: 'admin-section-heading' }, [el('h3', { text: '可选操作' }), el('p', { text: '用户体验时会看到这些操作；请指定其中一个为当前工序的正确操作。' })]),
        operations,
      ]),
      el('button', { class: 'admin-delete-step', type: 'button', text: '删除当前工序', onclick: () => {
        if (!confirm(`确定删除“${step.name || `工序 ${activeIndex + 1}`}”吗？保存后生效。`)) return;
        steps.splice(activeIndex, 1);
        activeIndex = Math.max(0, Math.min(activeIndex, steps.length - 1));
        markDirty(); render();
      } }),
    );
  }

  function render() { renderTabs(); renderEditor(); }
  saveButton.disabled = true;
  saveButton.addEventListener('click', async () => {
    const saved = await persistSteps({ announce: true });
    if (saved) location.reload();
  });

  const returnLink = el('a', { class: 'admin-return-link', href: '#/admin', text: '返回项目列表' });
  const userPageLink = el('a', { class: 'btn-ghost', href: `#/craft/${craft.craftId}`, text: '查看用户页面' });
  const saveThenNavigate = (link) => link.addEventListener('click', async (event) => {
    event.preventDefault();
    const target = link.getAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    const contentSaved = await persistContent({ announce: contentDirty });
    const stepsSaved = contentSaved && await persistSteps({ announce: dirty });
    const saved = stepsSaved && await persistGraph({ announce: graphDirty });
    link.removeAttribute('aria-disabled');
    if (saved && target) {
      // 数据已经写入服务器，但 data.js 在当前 SPA 会话中仍持有进入页面时的缓存。
      // 切换 hash 后刷新一次，确保返回列表或用户页立即读取刚保存的版本。
      location.hash = target;
      location.reload();
    }
  });
  saveThenNavigate(returnLink);
  saveThenNavigate(userPageLink);

  const processSection = el('section', { class: 'admin-process-workspace', id: 'admin-process-section' }, [
    el('div', { class: 'admin-workspace-heading' }, [
      el('div', {}, [el('h2', { text: '制作工序' }), el('p', { text: `${steps.length} 道工序；选择签条后维护步骤图片、关键帧、材料、工具和操作。` })]),
    ]),
    tabs,
    editor,
  ]);
  const jumpTo = (target) => target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const maintenanceNav = el('aside', { class: 'admin-maintenance-nav', 'aria-label': '项目维护导航' }, [
    el('p', { class: 'admin-kicker', text: '维护导航' }),
    el('button', { type: 'button', text: '项目正文与封面', onclick: () => jumpTo(contentEditor) }),
    el('button', { type: 'button', text: `制作工序（${steps.length}）`, onclick: () => jumpTo(processSection) }),
    el('button', { type: 'button', text: `知识星图（${graphData.relations.length} 个关联）`, onclick: () => jumpTo(graphEditor) }),
    el('div', { class: 'admin-maintenance-facts' }, [
      el('span', { text: coverPath ? '已设置封面' : '尚未设置封面' }),
      el('span', { text: `${steps.filter((step) => step.step_image?.image_url).length}/${steps.length} 道工序有步骤图` }),
      el('span', { text: `${overviewImages.length} 张其他图片` }),
    ]),
  ]);
  const content = el('main', { class: 'admin-process-page' }, [
    el('div', { class: 'admin-page-heading' }, [
      el('div', {}, [
        returnLink,
        el('h1', { text: `${craft.title} · 内容与工序管理` }),
        el('p', { text: '先维护项目正文与事实陈述，再编辑工序和知识星图。' }),
      ]),
      el('div', { class: 'admin-heading-actions' }, [
        userPageLink,
        saveStatus,
        saveButton,
      ]),
    ]),
    el('div', { class: 'admin-maintenance-layout' }, [
      maintenanceNav,
      el('div', { class: 'admin-maintenance-workspace' }, [contentEditor, processSection, graphEditor]),
    ]),
  ]);
  render();
  const shell = await adminShell(root, 'admin', content);
  const beforeUnload = (event) => { if (dirty || contentDirty || graphDirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return { cleanup() {
    disposed = true;
    clearTimeout(autoSaveTimer);
    // 顶部导航等非本页按钮离开时仍尽力提交最后一次修改；本页的返回按钮会等待保存完成。
    if (dirty && !activeSave) void saveCraftSteps(craft.craftId, structuredClone(steps)).catch(() => {});
    if (contentDirty) void persistContent().catch(() => {});
    if (graphDirty) void persistGraph().catch(() => {});
    shell.cleanup();
    window.removeEventListener('beforeunload', beforeUnload);
  } };
}
