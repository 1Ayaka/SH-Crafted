import { el, openModal } from './ui.js';
import { submitHeritage } from './community.js';
import { bindImageDropZone, COMMUNITY_IMAGE_ACCEPT, createUploadProgress, uploadCommunityImage } from './image-upload.js';

const CONTRIBUTION_LABELS = {
  supplement: '补充资料', correction: '纠正摘要', relation: '补充节点关系', image: '补充图片',
};
const RELATION_BY_TYPE = { region: 'LOCATED_IN', tradition: 'BELONGS_TO_TRADITION', material: 'USES_MATERIAL' };

const field = (label, control, note = '') => el('label', { class: 'community-field' }, [
  el('span', { text: label }), control, note ? el('small', { text: note }) : null,
]);

export function openGraphContribution(node) {
  const type = el('select', { name: 'contribution_type' }, Object.entries(CONTRIBUTION_LABELS).map(([value, text]) => el('option', { value, text })));
  const statement = el('textarea', { name: 'statement', rows: '6', minlength: '20', maxlength: '6000', required: true, placeholder: '请写出一条可独立理解、可由来源核对的陈述。避免只写关键词或“资料有误”。' });
  const sourceTitle = el('input', { name: 'source_title', maxlength: '300', required: true, placeholder: '例如：上海市文化和旅游局项目介绍' });
  const sourceUrl = el('input', { name: 'source_url', type: 'url', required: true, placeholder: 'https://…' });
  const relatedType = el('select', { name: 'related_node_type' }, [
    el('option', { value: 'region', text: '地区' }), el('option', { value: 'tradition', text: '传统' }), el('option', { value: 'material', text: '材料' }),
  ]);
  const relatedTitle = el('input', { name: 'related_node_title', maxlength: '160', placeholder: '关系另一端的规范名称' });
  const relationExplanation = el('textarea', { name: 'relation_explanation', rows: '3', maxlength: '3000', placeholder: '说明两个节点为什么存在这条关系，并指出来源中的依据。' });
  const relationFields = el('section', { class: 'graph-contribution-dependent', hidden: true }, [
    el('p', { class: 'graph-contribution-section-title', text: '关系端点' }),
    el('div', { class: 'graph-contribution-grid' }, [field('节点类型', relatedType), field('节点名称', relatedTitle)]),
    field('关系依据', relationExplanation),
  ]);
  const imageUrl = el('input', { name: 'image_url', type: 'url', placeholder: 'https://…' });
  const imageTitle = el('input', { name: 'image_title', maxlength: '160', placeholder: '图片内容或作品名称' });
  const imageDescription = el('textarea', { name: 'image_description', rows: '3', maxlength: '1000', placeholder: '说明画面内容、拍摄对象与大致时间；不要填写无法确认的人名。' });
  const imageInput = el('input', { class: 'community-image-file-input', type: 'file', accept: COMMUNITY_IMAGE_ACCEPT, tabindex: '-1' });
  const imageUploadStatus = el('p', { class: 'community-import-status', role: 'status', 'aria-live': 'polite' });
  const imageProgress = createUploadProgress();
  const imagePreview = el('img', { class: 'graph-contribution-image-preview', alt: '待投稿图片预览', hidden: true });
  let uploadedImageUrl = '';
  const imageDrop = el('div', {
    class: 'community-overview-drop graph-contribution-image-drop', role: 'button', tabindex: '0',
    'aria-label': '上传知识星图节点图片',
  }, [
    el('strong', { text: '拖入节点图片，或点击选择图片' }),
    el('span', { text: '支持 PNG、JPG、WebP、GIF；单张不超过 6MB' }),
    imageInput,
  ]);
  const uploadGraphImage = async (files) => {
    const file = [...files][0];
    if (!file) return;
    imageInput.disabled = true;
    imageUploadStatus.className = 'community-import-status';
    imageUploadStatus.textContent = `正在上传：${file.name}`;
    imageProgress.start(file.name);
    try {
      const image = await uploadCommunityImage(file, { onProgress: imageProgress.update });
      uploadedImageUrl = image.image_url;
      imagePreview.src = image.image_url;
      imagePreview.hidden = false;
      if (!imageTitle.value) imageTitle.value = file.name.replace(/\.[^.]+$/, '');
      imageUploadStatus.textContent = '图片已上传，可以继续填写说明并提交审核。';
      imageProgress.success(`${file.name} 已上传`);
      imageUrl.required = false;
    } catch (error) {
      imageProgress.error(`${file.name} 上传失败`);
      imageUploadStatus.className = 'community-import-status error';
      imageUploadStatus.textContent = error.message;
    } finally {
      imageInput.disabled = false;
    }
  };
  bindImageDropZone({ zone: imageDrop, input: imageInput, onFiles: uploadGraphImage });
  const imageFields = el('section', { class: 'graph-contribution-dependent', hidden: true }, [
    el('p', { class: 'graph-contribution-section-title', text: '图片资料' }),
    imageDrop, imageProgress.el, imageUploadStatus, imagePreview,
    field('或填写图片公开链接', imageUrl, '上传本地图片和填写公开链接二选一；请确认有权公开展示，并在上方填写图片出处。'),
    el('div', { class: 'graph-contribution-grid' }, [field('图片标题', imageTitle), field('图片说明', imageDescription)]),
  ]);
  const contributorName = el('input', { name: 'contributor_name', maxlength: '100', placeholder: '选填' });
  const contributorContact = el('input', { name: 'contributor_contact', maxlength: '200', placeholder: '选填，仅供审核联系，不公开展示' });
  const consent = el('input', { type: 'checkbox', required: true });
  const status = el('p', { class: 'community-submit-status', role: 'status', 'aria-live': 'polite' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: '提交管理员审核' });
  const updateDependent = () => {
    const relationMode = type.value === 'relation';
    const imageMode = type.value === 'image';
    relationFields.hidden = !relationMode;
    imageFields.hidden = !imageMode;
    relatedTitle.required = relationMode;
    relationExplanation.required = relationMode;
    imageUrl.required = imageMode && !uploadedImageUrl;
  };
  type.addEventListener('change', updateDependent);
  const form = el('form', { class: 'graph-contribution-form' }, [
    el('section', { class: 'graph-contribution-standard' }, [
      el('p', { text: `正在补充：${node.title}` }),
      el('small', { text: '提交规范：一条陈述只表达一个事实；写清对象与时间范围；必须附可访问来源；图片需有公开展示权；不提交手机号、住址等个人隐私。' }),
    ]),
    field('补充类型', type),
    field('事实陈述', statement, '管理员会按这条陈述逐项核对；纠错通过后将替换当前摘要，其余类型保留为“社区审核补充”。'),
    el('div', { class: 'graph-contribution-grid' }, [field('来源名称', sourceTitle), field('来源链接', sourceUrl)]),
    relationFields, imageFields,
    el('div', { class: 'graph-contribution-grid' }, [field('您的称呼', contributorName), field('联系方式', contributorContact)]),
    el('label', { class: 'community-consent' }, [consent, el('span', { text: '我确认内容可提交审核，并同意审核通过后在知识星图中公开事实陈述与来源；联系方式不会公开。' })]),
    el('input', { class: 'community-honeypot', name: 'website', tabindex: '-1', autocomplete: 'off' }),
    status,
    el('div', { class: 'community-submit-actions' }, [submit]),
  ]);
  updateDependent();
  let close = () => {};
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    status.classList.remove('error');
    status.textContent = '正在提交…';
    try {
      const payload = {
        kind: 'graph', target_node_id: node.id, contribution_type: type.value, statement: statement.value,
        source_title: sourceTitle.value, source_url: sourceUrl.value,
        contributor_name: contributorName.value, contributor_contact: contributorContact.value,
        website: form.elements.website.value,
      };
      if (type.value === 'relation') Object.assign(payload, {
        related_node_type: relatedType.value, related_node_title: relatedTitle.value,
        relation: RELATION_BY_TYPE[relatedType.value], relation_explanation: relationExplanation.value,
      });
      if (type.value === 'image') payload.images = [{ title: imageTitle.value, description: imageDescription.value, image_url: uploadedImageUrl || imageUrl.value, source_url: sourceUrl.value }];
      const result = await submitHeritage(payload);
      form.replaceChildren(el('div', { class: 'graph-contribution-success' }, [
        el('h3', { text: '已进入审核队列' }),
        el('p', { text: `编号 ${result.submission_id}。管理员通过后，补充内容和来源会自动进入这个节点。` }),
        el('button', { class: 'btn-ghost', type: 'button', text: '完成', onclick: () => close() }),
      ]));
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message || '提交失败，请稍后重试。';
      submit.disabled = false;
    }
  });
  close = openModal({ title: '共建知识星图', body: form });
  requestAnimationFrame(() => statement.focus());
}
