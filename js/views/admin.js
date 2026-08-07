import { el } from '../ui.js';
import { adminNotice } from '../editable.js';
import { adminState, importCraft, isAdmin, loadSubmissions, login, logout, reviewSubmission, saveCraft, saveCraftSteps } from '../admin.js';
import { allCrafts, craftAssetUrl, ensureCraftLoaded } from '../data.js';
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
  const [submissionData, engagement] = await Promise.all([
    loadSubmissions('pending').catch(() => ({ submissions: [] })),
    loadCommunityStats({ refresh: true }).catch(() => ({})),
  ]);
  const pendingCount = submissionData.submissions?.length || 0;
  const adminImportTemplate = { schema: 'sh-crafted.heritage-submission/v1', title: '', district_id: '', category: '', summary: '', cover_url: '', model_path: 'assets/models/crafts/example.glb', overview_images: [{ title: '', image_url: '', description: '' }], graph_data: { summary: '', keywords: [], images: [{ title: '', image_url: '', description: '', source_url: '' }], relations: [{ type: 'tradition', title: '', summary: '', images: [{ title: '', image_url: '', description: '' }] }] }, steps: [{ name: '', description: '', materials: [], tools: [], actions: [], documentary_clips: [{ title: '', video_url: 'https://', start_seconds: 0, end_seconds: 30, description: '', source_url: '' }] }] };
  const importInput = el('input', { type: 'file', accept: '.json,.jsonl,application/json,application/x-ndjson' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '').trim();
      const rows = /\.jsonl$/i.test(file.name) ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [JSON.parse(text)];
      if (rows.length !== 1) throw new Error('管理员导入一次只支持一个主非遗条目');
      const record = rows[0]?.heritage || rows[0]?.craft || rows[0];
      await importCraft({
        ...record,
        graph_data: record.graph_data || record.star_data || {},
        model_path: record.model_path || record.model_url || record.model || '',
        overview_images: record.overview_images || [],
      });
      alert('主非遗导入成功，正在刷新管理列表。');
      location.reload();
    } catch (error) { alert(`导入失败：${error.message || 'JSON 格式错误'}`); }
    finally { importInput.value = ''; }
  });
  const content = el('main', { class: 'admin-dashboard' }, [
    el('div', { class: 'admin-page-heading' }, [
      el('div', {}, [
        el('p', { class: 'admin-kicker', text: `管理员 ${adminState().username}` }),
        el('h1', { text: '内容与工序管理' }),
        el('p', { text: '返回首页、地图或详情页可以直接编辑文字；这里用于调整每个项目的制作工序。' }),
      ]),
      el('div', { class: 'admin-heading-actions' }, [
        el('label', { class: 'btn-ghost admin-import-button' }, [el('span', { text: '导入主非遗 JSON' }), importInput]),
        el('button', { class: 'btn-ghost', type: 'button', text: '下载管理员模板', onclick: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(adminImportTemplate, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = '主非遗导入模板.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } }),
        el('a', { class: 'btn btn-primary', href: '#/admin/submissions', text: `审核社区投稿（${pendingCount}）` }),
        el('button', { class: 'btn-ghost', text: '退出登录', onclick: () => logout() }),
      ]),
    ]),
    el('div', { class: 'admin-craft-grid' }, crafts.map((craft) => el('article', { class: 'admin-craft-card' }, [
      craft.config.heroFrame
        ? el('img', { src: craftAssetUrl(craft, craft.config.heroFrame), alt: craft.title, loading: 'lazy' })
        : el('div', { class: 'admin-card-placeholder', text: '社区条目' }),
      el('div', {}, [
        el('p', { class: 'admin-card-meta', text: `${craft.config.districtLabel || '地区待核对'} · ${craft.stepCount ?? craft.steps.length} 道工序 · ${engagement[craft.craftId]?.view_count || 0} 次查看 · ${engagement[craft.craftId]?.inheritor_count || 0} 位传承人` }),
        el('h2', { text: craft.title }),
        el('div', { class: 'admin-card-actions' }, [
          el('a', { class: 'btn btn-primary', href: `#/admin/craft/${craft.craftId}`, text: '编辑工序' }),
          el('a', { class: 'btn-ghost', href: `#/craft/${craft.craftId}`, text: '查看用户页面' }),
        ]),
      ]),
    ]))),
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
                class: 'btn btn-primary', type: 'button', text: '审核通过并上线', onclick: async (event) => {
                  if (!confirm(`确认“${submission.title}”内容可以公开展示并正式上线吗？`)) return;
                  event.currentTarget.disabled = true;
                  try { await reviewSubmission(submission.id, 'approve', note.value); location.reload(); }
                  catch (error) { event.currentTarget.disabled = false; adminNotice(error.message, true); }
                },
              }),
            ])
          : el('p', { class: `admin-review-result is-${submission.status}`, text: submission.status === 'approved' ? `已上线：${submission.published_craft_id}` : '已驳回' });
        list.appendChild(el('article', { class: 'admin-submission-card' }, [
          el('header', { class: 'admin-submission-heading' }, [
            el('div', {}, [
              el('p', { class: 'admin-kicker', text: `${submission.kind === 'full' ? '完整条目' : '简单便签'} · ${submission.id}` }),
              el('h2', { text: submission.title }),
            ]),
            el('span', { class: `admin-submission-status is-${submission.status}`, text: submission.status === 'pending' ? '待审核' : submission.status === 'approved' ? '已通过' : '已驳回' }),
          ]),
          el('dl', { class: 'admin-submission-meta' }, [
            el('div', {}, [el('dt', { text: '地区' }), el('dd', { text: DISTRICT_PROFILES[submission.district_id]?.name || submission.district_id })]),
            el('div', {}, [el('dt', { text: '类别' }), el('dd', { text: submission.category })]),
            el('div', {}, [el('dt', { text: '提交时间' }), el('dd', { text: new Date(submission.submitted_at).toLocaleString('zh-CN') })]),
            el('div', {}, [el('dt', { text: '投稿人' }), el('dd', { text: submission.contributor_name || '未填写' })]),
            el('div', {}, [el('dt', { text: '联系方式' }), el('dd', { text: submission.contributor_contact || '未填写' })]),
          ]),
          el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '内容说明' }), el('p', { text: submission.summary })]),
          submission.history ? el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '历史与来历' }), el('p', { text: submission.history })]) : null,
          submission.features ? el('section', { class: 'admin-submission-copy' }, [el('h3', { text: '特色与价值' }), el('p', { text: submission.features })]) : null,
          submission.source_url ? el('a', { class: 'admin-submission-source', href: submission.source_url, target: '_blank', rel: 'noopener noreferrer', text: '打开投稿资料来源' }) : null,
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
  graphData.images = Array.isArray(graphData.images) ? graphData.images : [];
  let activeIndex = 0;
  let dirty = false;
  let changeVersion = 0;
  let savedVersion = 0;
  let autoSaveTimer = null;
  let activeSave = null;
  let disposed = false;

  const tabs = el('div', { class: 'admin-step-tabs', role: 'tablist', 'aria-label': '选择工序' });
  const editor = el('section', { class: 'admin-step-editor' });
  const graphEditor = el('section', { class: 'admin-graph-editor' });
  const graphSummary = el('textarea', { rows: '3', maxlength: '2000', placeholder: '星图摘要' }, [graphData.summary || '']);
  const graphKeywords = el('input', { value: graphData.keywords.join('、'), placeholder: '关键词，用顿号分隔' });
  const graphImages = el('textarea', { rows: '6', placeholder: '节点图片 JSON 数组' }, [JSON.stringify(graphData.images, null, 2)]);
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
      const images = el('textarea', { rows: '3', placeholder: '该节点图片 JSON 数组' }, [JSON.stringify(relation.images || [], null, 2)]);
      [type, title, summary].forEach((control) => control.addEventListener('input', () => { relation.type = type.value; relation.title = title.value; relation.summary = summary.value; markGraphDirty(); }));
      images.addEventListener('input', () => { try { relation.images = JSON.parse(images.value || '[]'); images.setCustomValidity(''); markGraphDirty(); } catch { images.setCustomValidity('请输入有效的 JSON 数组'); } });
      graphRelations.appendChild(el('div', { class: 'admin-graph-relation-row' }, [type, title, summary, images, el('button', { type: 'button', class: 'admin-icon-button', text: '删除', onclick: () => { graphData.relations.splice(index, 1); markGraphDirty(); renderGraphRelations(); } })]));
    });
    graphRelations.appendChild(el('button', { class: 'admin-add-row', type: 'button', text: '添加关联节点', onclick: () => { graphData.relations.push({ type: 'tradition', title: '', summary: '' }); markGraphDirty(); renderGraphRelations(); } }));
  };
  [graphSummary, graphKeywords].forEach((control) => control.addEventListener('input', markGraphDirty));
  graphImages.addEventListener('input', () => { try { graphData.images = JSON.parse(graphImages.value || '[]'); graphImages.setCustomValidity(''); markGraphDirty(); } catch { graphImages.setCustomValidity('请输入有效的 JSON 数组'); } });
  const graphSaveButton = el('button', { class: 'btn-ghost', type: 'button', text: '保存星图资料', onclick: async () => {
    graphSaveButton.disabled = true;
    try {
      graphData.summary = graphSummary.value;
      graphData.keywords = String(graphKeywords.value || '').split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
      await saveCraft(craft.craftId, { graph_data: graphData });
      graphDirty = false; graphState.className = 'admin-save-status is-saved'; graphState.textContent = '星图已保存';
      adminNotice('星图资料已保存');
    } catch (error) { adminNotice(error.message, true); }
    graphSaveButton.disabled = false;
  } });
  graphEditor.append(el('div', { class: 'admin-section-heading' }, [el('div', {}, [el('h2', { text: '知识星图' }), el('p', { text: '维护该非遗及关联节点的文字和图片；不会覆盖已审核内容、证据或工序。' })]), el('div', {}, [graphState, graphSaveButton])]), el('label', { class: 'admin-field' }, [el('span', { text: '星图摘要' }), graphSummary]), el('label', { class: 'admin-field' }, [el('span', { text: '星图关键词' }), graphKeywords]), el('label', { class: 'admin-field' }, [el('span', { text: '主节点图片（JSON 数组）' }), graphImages, el('small', { text: '每项可填写 title、image_url、description、source_url。' })]), graphRelations);
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
      el('div', { class: 'admin-field' }, [el('label', { text: '纪录片片段（JSON 数组，可选）' }), (() => { const clips = el('textarea', { rows: '5', placeholder: '[{"title":"","video_url":"https://...","start_seconds":0,"end_seconds":30,"description":"","source_url":""}]' }, [JSON.stringify(step.documentary_clips || [], null, 2)]); clips.addEventListener('input', () => { try { step.documentary_clips = JSON.parse(clips.value || '[]'); clips.setCustomValidity(''); markDirty(); } catch { clips.setCustomValidity('请输入有效的 JSON 数组'); } }); return clips; })()]),
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
    const saved = await persistSteps({ announce: dirty });
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

  const content = el('main', { class: 'admin-process-page' }, [
    el('div', { class: 'admin-page-heading' }, [
      el('div', {}, [
        returnLink,
        el('h1', { text: `${craft.title} · 工序管理` }),
        el('p', { text: '在上方选择工序；下方可以修改名称、材料、工具和操作。' }),
      ]),
      el('div', { class: 'admin-heading-actions' }, [
        userPageLink,
        saveStatus,
        saveButton,
      ]),
    ]),
    tabs,
    editor,
    graphEditor,
  ]);
  render();
  const shell = await adminShell(root, 'admin', content);
  const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return { cleanup() {
    disposed = true;
    clearTimeout(autoSaveTimer);
    // 顶部导航等非本页按钮离开时仍尽力提交最后一次修改；本页的返回按钮会等待保存完成。
    if (dirty && !activeSave) void saveCraftSteps(craft.craftId, structuredClone(steps)).catch(() => {});
    if (graphDirty) void saveCraft(craft.craftId, { graph_data: graphData }).catch(() => {});
    shell.cleanup();
    window.removeEventListener('beforeunload', beforeUnload);
  } };
}
