import { el } from '../ui.js';
import { DISTRICT_PROFILES } from '../config.js';
import { submitHeritage } from '../community.js';
import { bindImageDropZone, COMMUNITY_IMAGE_ACCEPT, createUploadProgress, uploadCommunityImage } from '../image-upload.js';
import { createLayerBG } from '../layerbg.js';
import { topNav } from './home.js';

const splitList = (value) => [...new Set(String(value || '').split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];

const IMPORT_TEMPLATE = Object.freeze({
  schema: 'sh-crafted.heritage-submission/v1',
  title: '', category: '', summary: '', history: '', features: '',
  source_url: '', cover_url: '', gallery_urls: [],
  overview_images: [{ title: '', image_url: '', description: '' }],
  steps: [{ name: '', description: '', result: '', materials: [], tools: [], actions: [] }],
  contributor_name: '', contributor_contact: '',
});

function parseImportText(text, filename = '') {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('文件内容为空');
  let parsed;
  if (/\.jsonl$/i.test(filename)) {
    const records = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`JSONL 第 ${index + 1} 行格式错误`); }
    });
    if (records.length !== 1) throw new Error('用户投稿界面一次只能导入一条非遗记录');
    [parsed] = records;
  } else {
    parsed = JSON.parse(source);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error('用户投稿界面一次只能导入一条非遗记录');
    [parsed] = parsed;
  }
  const record = parsed?.heritage || parsed?.submission || parsed?.craft || parsed;
  if (!record || typeof record !== 'object') throw new Error('没有找到非遗记录对象');
  const list = (value) => Array.isArray(value) ? value : splitList(value);
  return {
    title: record.title ?? record.name ?? '',
    category: record.category ?? record.type ?? '',
    summary: record.summary ?? record.description ?? record.introduction ?? '',
    history: record.history ?? record.origin ?? '',
    features: record.features ?? record.value ?? record.characteristics ?? '',
    source_url: record.source_url ?? record.source?.url ?? '',
    cover_url: record.cover_url ?? record.cover ?? record.image_url ?? '',
    gallery_urls: list(record.gallery_urls ?? record.gallery ?? record.images ?? []),
    overview_images: list(record.overview_images ?? record.star_data?.overview_images ?? []).map((image) => typeof image === 'string'
      ? { title: '', description: '', image_url: image }
      : { title: image?.title ?? '', description: image?.description ?? image?.caption ?? '', image_url: image?.image_url ?? image?.url ?? '' }),
    star_data: record.star_data || {},
    contributor_name: record.contributor_name ?? record.contributor?.name ?? '',
    contributor_contact: record.contributor_contact ?? record.contributor?.contact ?? '',
    steps: list(record.steps ?? record.process_steps ?? []).slice(0, 12).map((step) => ({
      name: step?.name ?? step?.title ?? '',
      description: step?.description ?? step?.action ?? '',
      result: step?.result ?? step?.output ?? '',
      materials: list(step?.materials ?? []),
      tools: list(step?.tools ?? []),
      actions: list(step?.actions ?? []).map((action) => typeof action === 'object' ? action.label : action).filter(Boolean),
      documentary_clips: Array.isArray(step?.documentary_clips) ? step.documentary_clips : [],
    })),
  };
}

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
  let overviewImages = Array.isArray(restored.overview_images) ? restored.overview_images.slice(0, 8) : [];
  const overviewHost = el('div', { class: 'community-overview-images' });
  const starSummary = el('textarea', { rows: '3', maxlength: '2000', placeholder: '星图摘要：它与哪些传统、地区或材料有关？' }, [restored.star_data?.summary || '']);
  const starRelations = el('input', { type: 'text', maxlength: '500', value: (restored.star_data?.relations || []).join('、'), placeholder: '关联传统、地区或材料，用顿号分隔' });
  const starKeywords = el('input', { type: 'text', maxlength: '500', value: (restored.star_data?.keywords || []).join('、'), placeholder: '关键词，用顿号分隔' });
  let starImages = Array.isArray(restored.star_data?.images) ? restored.star_data.images.slice(0, 8) : [];
  const starImagesHost = el('div', { class: 'community-overview-images' });
  const starImageInput = el('input', { class: 'community-image-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, multiple: true, tabindex: '-1' });
  const starImageProgress = createUploadProgress();
  const starImageStatus = el('p', { class: 'community-import-status', role: 'status', 'aria-live': 'polite' });
  const coverPreview = el('div', { class: 'community-main-image-preview' });
  const coverInput = el('input', { class: 'community-image-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, tabindex: '-1' });
  const coverProgress = createUploadProgress();
  const renderCoverPreview = () => {
    coverPreview.replaceChildren(...[
      coverUrl.value ? el('img', { src: coverUrl.value, alt: '项目主图预览' }) : el('div', { class: 'community-overview-image-empty', text: '尚未设置主图' }),
      el('p', { text: coverUrl.value ? '这张图将作为项目封面，并在节点缺图时自动兜底。' : '建议上传一张最能代表项目的图片。' }),
    ]);
  };
  const uploadCover = async (files) => {
    const file = [...files][0];
    if (!file) return;
    coverInput.disabled = true; coverProgress.start(file.name);
    try {
      const image = await uploadCommunityImage(file, { onProgress: coverProgress.update });
      coverUrl.value = image.image_url; coverProgress.success(`${file.name} 已设为主图`);
      renderCoverPreview(); renderStarImages(); saveDraft();
    } catch (error) { coverProgress.error(error.message || '主图上传失败'); }
    finally { coverInput.disabled = false; }
  };
  const coverDrop = el('div', { class: 'community-overview-drop', role: 'button', tabindex: '0', 'aria-label': '上传项目主图' }, [
    el('strong', { text: '拖入主图，或点击选择' }), el('span', { text: '项目封面 · 节点缺图时的默认图片' }), coverInput,
  ]);
  bindImageDropZone({ zone: coverDrop, input: coverInput, onFiles: uploadCover });
  const mainImageSection = el('section', { class: 'community-image-purpose-section is-primary' }, [
    el('div', { class: 'community-image-purpose-heading' }, [el('span', { text: '01' }), el('div', {}, [el('h3', { text: '主图（项目封面）' }), el('p', { text: '用于项目识别、列表封面，并作为节点图的默认兜底。' })])]),
    coverPreview, coverDrop, coverProgress.el, field('或填写公开图片链接', coverUrl, '上传图片后会自动填写此地址。'),
  ]);
  renderCoverPreview();
  const renderStarImages = () => {
    starImagesHost.replaceChildren();
    if (!starImages.length) starImagesHost.appendChild(el('div', { class: 'community-node-fallback' }, [
      coverUrl.value ? el('img', { src: coverUrl.value, alt: '节点主图兜底预览' }) : null,
      el('div', {}, [el('strong', { text: coverUrl.value ? '将使用主图兜底' : '节点图可留空' }), el('p', { text: coverUrl.value ? '无需重复上传；前台节点会显示上方主图。' : '设置主图后，这里会自动显示兜底预览。' })]),
    ]));
    starImages.forEach((image, index) => {
      const titleControl = el('input', { value: image.title || '', placeholder: `节点图片 ${index + 1} 标题` });
      const descriptionControl = el('textarea', { rows: '2', placeholder: '图片内容说明' }, [image.description || '']);
      const sourceControl = el('input', { type: 'url', value: image.source_url || '', placeholder: '图片来源链接（选填）' });
      const sync = () => { Object.assign(image, { title: titleControl.value, description: descriptionControl.value, source_url: sourceControl.value }); saveDraft(); };
      [titleControl, descriptionControl, sourceControl].forEach((control) => control.addEventListener('input', sync));
      starImagesHost.appendChild(el('article', { class: 'community-overview-image-card' }, [
        el('img', { src: image.image_url, alt: image.title || '星图节点图片' }),
        field('图片标题', titleControl), field('图片说明', descriptionControl), field('图片来源', sourceControl),
        el('button', { type: 'button', class: 'community-remove-step', text: '删除图片', onclick: () => { starImages.splice(index, 1); renderStarImages(); saveDraft(); } }),
      ]));
    });
  };
  const uploadStarImages = async (files) => {
    const selected = [...files].slice(0, Math.max(0, 8 - starImages.length));
    if (!selected.length) { starImageStatus.textContent = starImages.length >= 8 ? '节点图片最多上传 8 张。' : '没有检测到图片文件。'; return; }
    starImageInput.disabled = true;
    let uploadedCount = 0;
    for (const [index, file] of selected.entries()) {
      starImageProgress.start(`${index + 1}/${selected.length} · ${file.name}`);
      try {
        const image = await uploadCommunityImage(file, { onProgress: starImageProgress.update });
        starImages.push({ title: file.name.replace(/\.[^.]+$/, ''), description: '', source_url: '', image_url: image.image_url });
        uploadedCount += 1; renderStarImages(); saveDraft();
      } catch (error) {
        starImageProgress.error(`${file.name} 上传失败`); starImageStatus.textContent = error.message; break;
      }
    }
    starImageInput.disabled = false;
    if (uploadedCount === selected.length) { starImageProgress.success(`${uploadedCount} 张节点图片已上传`); starImageStatus.textContent = '节点图片已加入投稿资料。'; }
  };
  const starImageDrop = el('div', { class: 'community-overview-drop', role: 'button', tabindex: '0', 'aria-label': '上传星图节点图片' }, [
    el('strong', { text: '拖入星图节点图片，或点击选择' }), el('span', { text: '最多 8 张，单张不超过 6MB' }), starImageInput,
  ]);
  bindImageDropZone({ zone: starImageDrop, input: starImageInput, onFiles: uploadStarImages });
  const starImageSection = el('section', { class: 'community-star-image-section' }, [
    el('div', { class: 'community-image-purpose-heading' }, [el('span', { text: '03' }), el('div', {}, [el('h3', { text: '节点图（知识星图专用）' }), el('p', { text: '选填。仅用于星图信息面板；留空时自动使用主图，不会借用概览图。' })])]),
    starImageDrop, starImageProgress.el, starImageStatus, starImagesHost,
  ]);
  renderStarImages();
  const contributorName = el('input', { type: 'text', maxlength: '100', value: restored.contributor_name || '', placeholder: '选填' });
  const contributorContact = el('input', { type: 'text', maxlength: '200', value: restored.contributor_contact || '', placeholder: '选填，仅管理员审核时可见' });
  const honeypot = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  const status = el('p', { class: 'community-submit-status', role: 'status' });
  const stepsHost = el('div', { class: 'community-steps' });
  const processSection = el('section', { class: 'community-process-module' });
  const overviewSection = el('section', { class: 'community-image-purpose-section' }, [
    el('div', { class: 'community-image-purpose-heading' }, [el('span', { text: '02' }), el('div', {}, [el('h3', { text: '概览图（作品浏览）' }), el('p', { text: '用于项目详情展示更多角度，不会自动成为主图或节点图。' })])]),
    overviewHost,
  ]);
  const detailFields = el('div', { class: 'community-full-fields' }, [
    field('历史与来历', history),
    field('特色与价值', features),
    field('资料来源链接', sourceUrl, '建议填写政府、文化机构、博物馆或公开报道页面。'),
    el('section', { class: 'community-image-role-guide', 'aria-label': '图片用途说明' }, [
      el('strong', { text: '图片按用途分开维护' }), el('p', { text: '主图负责项目身份，概览图负责浏览，节点图只服务知识星图。' }),
    ]),
    mainImageSection,
    field('更多图片链接', galleryUrls),
    overviewSection,
    el('div', { class: 'community-star-fields' }, [field('星图摘要', starSummary), field('星图关联', starRelations), field('星图关键词', starKeywords)]),
    starImageSection,
  ]);
  coverUrl.addEventListener('input', () => { renderCoverPreview(); renderStarImages(); saveDraft(); });

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
      overview_images: overviewImages,
      star_data: { summary: starSummary.value, relations: splitList(starRelations.value), keywords: splitList(starKeywords.value), images: starImages },
      contributor_name: contributorName.value,
      contributor_contact: contributorContact.value,
      steps: state.steps,
    };
  }
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); } catch { /* 图片较大时保留当前页面状态，不阻断投稿 */ }
    }, 350);
  }

  function renderOverviewImages() {
    overviewHost.replaceChildren();
    overviewImages.forEach((image, index) => {
      const titleInput = el('input', { type: 'text', maxlength: '160', value: image.title || '', placeholder: `图片 ${index + 1} 标题` });
      const description = el('textarea', { rows: '2', maxlength: '1000', required: true, placeholder: '请说明图片中展示的内容、来源或用途' }, [image.description || '']);
      const sync = () => { image.title = titleInput.value; image.description = description.value; saveDraft(); };
      titleInput.addEventListener('input', sync); description.addEventListener('input', sync);
      overviewHost.appendChild(el('article', { class: 'community-overview-image-card' }, [
        image.image_url ? el('img', { src: image.image_url, alt: image.title || '概览图预览' }) : el('div', { class: 'community-overview-image-empty', text: '等待上传图片' }),
        field('图片标题', titleInput), field('图片说明（必填）', description),
        el('button', { type: 'button', class: 'community-remove-step', text: '删除图片', onclick: () => { overviewImages.splice(index, 1); renderOverviewImages(); saveDraft(); } }),
      ]));
    });
  }

  const overviewInput = el('input', { class: 'community-image-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, multiple: true, tabindex: '-1' });
  const overviewUploadStatus = el('p', { class: 'community-import-status', role: 'status', 'aria-live': 'polite' });
  const overviewProgress = createUploadProgress();
  const addOverviewFiles = async (files) => {
    const selected = [...files].slice(0, Math.max(0, 8 - overviewImages.length));
    if (!selected.length) {
      overviewUploadStatus.className = 'community-import-status error';
      overviewUploadStatus.textContent = overviewImages.length >= 8 ? '概览图最多上传 8 张。' : '没有检测到图片文件。';
      return;
    }
    overviewInput.disabled = true;
    overviewUploadStatus.className = 'community-import-status';
    let uploaded = 0;
    for (const [index, file] of selected.entries()) {
      overviewUploadStatus.textContent = `正在上传 ${index + 1}/${selected.length}：${file.name}`;
      overviewProgress.start(`${index + 1}/${selected.length} · ${file.name}`);
      try {
        const image = await uploadCommunityImage(file, { onProgress: overviewProgress.update });
        overviewImages.push({ title: file.name.replace(/\.[^.]+$/, ''), description: '', image_url: image.image_url });
        uploaded += 1;
        renderOverviewImages();
        saveDraft();
      } catch (error) {
        overviewProgress.error(`${file.name} 上传失败`);
        overviewUploadStatus.className = 'community-import-status error';
        overviewUploadStatus.textContent = `${file.name}：${error.message}`;
        break;
      }
    }
    overviewInput.disabled = false;
    if (uploaded === selected.length) {
      overviewProgress.success(`${uploaded} 张图片已上传`);
      overviewUploadStatus.className = 'community-import-status';
      overviewUploadStatus.textContent = `已上传 ${uploaded} 张图片，请为每张填写说明。`;
    }
  };
  const overviewDrop = el('div', {
    class: 'community-overview-drop', role: 'button', tabindex: '0',
    'aria-label': '上传概览图片',
  }, [
    el('strong', { text: '拖入概览图，或点击选择图片' }),
    el('span', { text: '支持 PNG、JPG、WebP、GIF；单张不超过 6MB，最多 8 张' }),
    overviewInput,
  ]);
  bindImageDropZone({ zone: overviewDrop, input: overviewInput, onFiles: addOverviewFiles });
  overviewHost.before(overviewDrop, overviewProgress.el, overviewUploadStatus);

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
    // 图片与星图资料是所有投稿的必填概览信息，简易模式也保持可见。
    detailFields.hidden = false;
    processSection.hidden = kind !== 'full';
    saveDraft();
  }
  noteMode.addEventListener('click', () => setKind('note'));
  fullMode.addEventListener('click', () => setKind('full'));

  const importStatus = el('p', { class: 'community-import-status', role: 'status' });
  const importInput = el('input', { type: 'file', accept: '.json,.jsonl,application/json,application/x-ndjson' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try {
      const imported = parseImportText(await file.text(), file.name);
      title.value = imported.title; category.value = imported.category; summary.value = imported.summary;
      history.value = imported.history; features.value = imported.features; sourceUrl.value = imported.source_url;
      coverUrl.value = imported.cover_url; galleryUrls.value = imported.gallery_urls.join('\n');
      overviewImages = imported.overview_images;
      starSummary.value = imported.star_data?.summary || '';
      starRelations.value = (imported.star_data?.relations || []).join('、');
      starKeywords.value = (imported.star_data?.keywords || []).join('、');
      starImages = Array.isArray(imported.star_data?.images) ? imported.star_data.images.slice(0, 8) : [];
      contributorName.value = imported.contributor_name; contributorContact.value = imported.contributor_contact;
      state.steps = imported.steps; state.includeSteps = imported.steps.length > 0;
      processToggle.checked = state.includeSteps; processSection.classList.toggle('is-enabled', state.includeSteps);
      setKind('full'); renderSteps(); renderOverviewImages(); renderCoverPreview(); renderStarImages(); saveDraft();
      importStatus.textContent = `已导入“${imported.title || file.name}”，请检查后提交审核。`;
      importStatus.className = 'community-import-status success';
    } catch (error) {
      importStatus.textContent = `导入失败：${error.message || '文件格式不正确'}`;
      importStatus.className = 'community-import-status error';
    } finally { importInput.value = ''; }
  });
  const downloadTemplate = el('button', { type: 'button', class: 'btn-ghost', text: '下载 JSON 模板', onclick: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(IMPORT_TEMPLATE, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '非遗导入模板.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  } });

  const form = el('form', { class: 'community-form' }, [
    el('section', { class: 'community-intro-card' }, [
      el('p', { class: 'community-eyebrow', text: `${profile.name} · 社区共建` }),
      el('h1', { text: '添加文化遗产' }),
      el('p', { text: '你提交的内容会先进入待审核列表，管理员确认后才会出现在地图和项目列表中。' }),
      el('div', { class: 'community-mode', role: 'group', 'aria-label': '条目类型' }, [noteMode, fullMode]),
    ]),
    el('section', { class: 'community-import-card' }, [
      el('div', {}, [el('h2', { text: '标准格式导入' }), el('p', { text: '支持 JSON 和 JSONL。导入只会填写本页表单，确认内容无误后仍需手动提交审核。' })]),
      el('div', { class: 'community-import-actions' }, [
        el('label', { class: 'btn btn-primary community-import-file' }, [el('span', { text: '选择导入文件' }), importInput]),
        downloadTemplate,
      ]),
      el('p', { class: 'community-import-schema', text: '格式标识：sh-crafted.heritage-submission/v1；也兼容 name、description、process_steps 等常用字段。' }),
      importStatus,
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
        overview_image_required: '至少需要上传一张概览图，并为每张图片填写说明。',
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
  renderOverviewImages();
  return { cleanup() { clearTimeout(saveTimer); bg.destroy(); } };
}
