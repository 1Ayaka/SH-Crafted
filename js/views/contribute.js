import { el } from '../ui.js';
import { DISTRICT_PROFILES } from '../config.js';
import { submitHeritage } from '../community.js';
import { createLayerBG } from '../layerbg.js';
import { topNav } from './home.js';

const splitList = (value) => [...new Set(String(value || '').split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];

function field(label, control, help = '') {
  return el('label', { class: 'community-field' }, [
    el('span', { text: label }),
    control,
    help ? el('small', { text: help }) : null,
  ]);
}

export async function contributeView(root, { districtId }) {
  const profile = DISTRICT_PROFILES[districtId];
  if (!profile) {
    root.appendChild(el('main', { class: 'community-missing' }, [
      el('h1', { text: '未找到该地区' }),
      el('a', { href: '#/explore', text: '返回地图' }),
    ]));
    return { cleanup() {} };
  }

  const bg = await createLayerBG('assets/bg2/manifest.json', { scrim: 'top', parallax: true, fixed: true });
  const storageKey = `sh_contribution_draft_${districtId}`;
  let restored = {};
  try { restored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { restored = {}; }
  const state = {
    kind: restored.kind === 'full' ? 'full' : 'note',
    includeSteps: Boolean(restored.include_steps),
    steps: Array.isArray(restored.steps) ? restored.steps.slice(0, 12) : [],
  };

  const title = el('input', { type: 'text', maxlength: '160', required: true, value: restored.title || '', placeholder: '填写文化遗产名称' });
  const category = el('input', { type: 'text', maxlength: '100', value: restored.category || '', placeholder: '例如：传统技艺、民俗、传统美术' });
  const summary = el('textarea', { rows: '7', maxlength: '6000', required: true, placeholder: '至少填写10个字，说明它是什么、在哪里流传，以及你希望记录的内容。' }, [restored.summary || '']);
  const history = el('textarea', { rows: '4', maxlength: '5000', placeholder: '选填：历史、来历或传承线索' }, [restored.history || '']);
  const features = el('textarea', { rows: '4', maxlength: '5000', placeholder: '选填：形态、用途、地域特色或代表性内容' }, [restored.features || '']);
  const sourceUrl = el('input', { type: 'url', maxlength: '1200', value: restored.source_url || '', placeholder: 'https://…' });
  const coverUrl = el('input', { type: 'url', maxlength: '1200', value: restored.cover_url || '', placeholder: 'https://…' });
  const galleryUrls = el('textarea', { rows: '3', placeholder: '每行一个公开图片链接，最多8张' }, [(restored.gallery_urls || []).join('\n')]);
  const contributorName = el('input', { type: 'text', maxlength: '100', value: restored.contributor_name || '', placeholder: '选填' });
  const contributorContact = el('input', { type: 'text', maxlength: '200', value: restored.contributor_contact || '', placeholder: '选填，仅管理员审核时可见' });
  const honeypot = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  const status = el('p', { class: 'community-submit-status', role: 'status' });
  const stepsHost = el('div', { class: 'community-steps' });
  const processSection = el('section', { class: 'community-process-module' });
  const detailFields = el('div', { class: 'community-full-fields' }, [
    field('历史与来历', history),
    field('特色与价值', features),
    field('资料来源链接', sourceUrl, '建议填写政府、文化机构、博物馆或公开报道页面。'),
    field('封面图片链接', coverUrl, '暂时使用公开图片链接；管理员会在上线前检查来源与展示效果。'),
    field('更多图片链接', galleryUrls),
  ]);

  let saveTimer = 0;
  function snapshot() {
    return {
      kind: state.kind,
      include_steps: state.includeSteps,
      district_id: districtId,
      title: title.value,
      category: category.value,
      summary: summary.value,
      history: history.value,
      features: features.value,
      source_url: sourceUrl.value,
      cover_url: coverUrl.value,
      gallery_urls: splitList(galleryUrls.value),
      contributor_name: contributorName.value,
      contributor_contact: contributorContact.value,
      steps: state.steps,
    };
  }
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(storageKey, JSON.stringify(snapshot())), 350);
  }

  function renderSteps() {
    stepsHost.replaceChildren();
    if (!state.includeSteps) return;
    state.steps.forEach((step, index) => {
      const name = el('input', { type: 'text', maxlength: '160', value: step.name || '', placeholder: `工序 ${index + 1} 名称` });
      const description = el('textarea', { rows: '3', maxlength: '3000', placeholder: '说明这一工序如何进行' }, [step.description || '']);
      const result = el('input', { type: 'text', maxlength: '1000', value: step.result || '', placeholder: '完成后得到什么' });
      const materials = el('textarea', { rows: '2', placeholder: '材料之间用逗号或换行分隔' }, [(step.materials || []).join('、')]);
      const tools = el('textarea', { rows: '2', placeholder: '工具之间用逗号或换行分隔' }, [(step.tools || []).join('、')]);
      const actions = el('textarea', { rows: '2', placeholder: '可执行动作；第一项作为正确动作' }, [(step.actions || []).join('、')]);
      const sync = () => {
        Object.assign(step, {
          name: name.value,
          description: description.value,
          result: result.value,
          materials: splitList(materials.value),
          tools: splitList(tools.value),
          actions: splitList(actions.value),
        });
        saveDraft();
      };
      [name, description, result, materials, tools, actions].forEach((control) => control.addEventListener('input', sync));
      stepsHost.appendChild(el('article', { class: 'community-step-card' }, [
        el('div', { class: 'community-step-heading' }, [
          el('div', {}, [el('span', { text: `工序 ${String(index + 1).padStart(2, '0')}` }), el('h3', { text: step.name || '未命名工序' })]),
          el('button', { type: 'button', class: 'community-remove-step', text: '删除工序', onclick: () => { state.steps.splice(index, 1); renderSteps(); saveDraft(); } }),
        ]),
        field('工序名称', name),
        field('工序说明', description),
        field('完成结果', result),
        el('div', { class: 'community-step-grid' }, [field('所需材料', materials), field('所需工具', tools)]),
        field('可选操作', actions, '第一项会作为正确操作；管理员上线后仍可继续调整。'),
      ]));
    });
  }

  const processToggle = el('input', { type: 'checkbox' });
  processToggle.checked = state.includeSteps;
  processToggle.addEventListener('change', () => {
    state.includeSteps = processToggle.checked;
    if (state.includeSteps && !state.steps.length) state.steps.push({ name: '', description: '', result: '', materials: [], tools: [], actions: [] });
    processSection.classList.toggle('is-enabled', state.includeSteps);
    renderSteps();
    saveDraft();
  });
  processSection.append(
    el('div', { class: 'community-process-heading' }, [
      el('div', {}, [el('h2', { text: '制作工序' }), el('p', { text: '如果只是记录一条线索，可以不添加工序。' })]),
      el('label', { class: 'community-switch' }, [processToggle, el('span', { text: '添加工序模块' })]),
    ]),
    stepsHost,
    el('button', {
      type: 'button', class: 'btn-ghost community-add-step', text: '新增工序',
      onclick: () => { state.steps.push({ name: '', description: '', result: '', materials: [], tools: [], actions: [] }); renderSteps(); saveDraft(); },
    }),
  );

  const noteMode = el('button', { type: 'button', text: '简单便签' });
  const fullMode = el('button', { type: 'button', text: '完整条目' });
  function setKind(kind) {
    state.kind = kind;
    noteMode.classList.toggle('active', kind === 'note');
    fullMode.classList.toggle('active', kind === 'full');
    detailFields.hidden = kind !== 'full';
    processSection.hidden = kind !== 'full';
    saveDraft();
  }
  noteMode.addEventListener('click', () => setKind('note'));
  fullMode.addEventListener('click', () => setKind('full'));

  const form = el('form', { class: 'community-form' }, [
    el('section', { class: 'community-intro-card' }, [
      el('p', { class: 'community-eyebrow', text: `${profile.name} · 社区共建` }),
      el('h1', { text: '添加文化遗产' }),
      el('p', { text: '你提交的内容会先进入待审核列表，管理员确认后才会出现在地图和项目列表中。' }),
      el('div', { class: 'community-mode', role: 'group', 'aria-label': '条目类型' }, [noteMode, fullMode]),
    ]),
    el('section', { class: 'community-form-section' }, [
      el('h2', { text: '基本信息' }),
      el('div', { class: 'community-field-grid' }, [field('名称', title), field('类别', category)]),
      field('内容说明', summary),
    ]),
    detailFields,
    processSection,
    el('section', { class: 'community-form-section' }, [
      el('h2', { text: '投稿人信息' }),
      el('p', { class: 'community-section-note', text: '均为选填；联系方式仅供管理员核实，不会公开展示。' }),
      el('div', { class: 'community-field-grid' }, [field('称呼', contributorName), field('联系方式', contributorContact)]),
      el('label', { class: 'community-consent' }, [
        el('input', { type: 'checkbox', required: true }),
        el('span', { text: '我确认提交内容可供本项目审核、整理与公开展示，并会尽量注明资料来源。' }),
      ]),
      el('div', { class: 'community-honeypot', 'aria-hidden': 'true' }, [honeypot]),
      status,
      el('div', { class: 'community-submit-actions' }, [
        el('a', { class: 'btn-ghost', href: '#/explore', text: '返回地图' }),
        el('button', { class: 'btn btn-primary', type: 'submit', text: '提交审核' }),
      ]),
    ]),
  ]);

  form.addEventListener('input', saveDraft);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '正在提交…';
    status.textContent = '';
    status.className = 'community-submit-status';
    try {
      const result = await submitHeritage({ ...snapshot(), website: honeypot.value });
      localStorage.removeItem(storageKey);
      form.replaceChildren(el('section', { class: 'community-success' }, [
        el('p', { class: 'community-eyebrow', text: '提交成功' }),
        el('h1', { text: '内容已进入待审核列表' }),
        el('p', { text: `投稿编号：${result.submission_id}` }),
        el('p', { text: '管理员审核通过后，它会作为正式条目出现在对应地区。' }),
        el('a', { class: 'btn btn-primary', href: '#/explore', text: '返回地图' }),
      ]));
    } catch (error) {
      const messages = {
        submission_rate_limited: '提交过于频繁，请一小时后再试。',
        title_required: '请填写文化遗产名称。',
        summary_required: '内容说明至少需要10个字。',
        steps_required: '已开启工序模块，请至少添加一道工序。',
      };
      status.textContent = messages[error.message] || '提交失败，请稍后重试。';
      status.classList.add('error');
      button.disabled = false;
      button.textContent = '提交审核';
    }
  });

  const page = el('section', { class: 'view community-page' }, [bg.el, topNav('explore'), el('main', { class: 'community-shell' }, [form])]);
  root.appendChild(page);
  setKind(state.kind);
  processSection.classList.toggle('is-enabled', state.includeSteps);
  renderSteps();
  return { cleanup() { clearTimeout(saveTimer); bg.destroy(); } };
}
