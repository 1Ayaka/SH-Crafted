// 数据护照：来源、授权、审核状态、计数 —— 全部来自 manifest 真实字段
import { el } from '../ui.js';
import { allCrafts } from '../data.js';
import { topNav } from './home.js';
import { agent } from '../agent.js';

const RIGHTS = { pending: '授权待确认' };

export function passportView(root) {
  const crafts = allCrafts();
  const rows = crafts.map((c) => {
    const m = c.manifest;
    const v = m.video;
    return el('tr', {}, [
      el('td', {}, [
        el('b', { text: c.title }),
        el('p', { class: 'mono', text: `${m.package_id} / ${v.video_id}` }),
      ]),
      el('td', {}, [
        el('p', { text: '火山引擎视频理解（长视频多模态）' }),
        el('p', { class: 'mono', text: `来源文件：${v.source_filename}` }),
        el('p', { class: 'mono', text: `处理模式：${m.provider.mode} · ${m.provider.prompt_version}` }),
      ]),
      el('td', {}, [
        el('span', { class: 'tag tag-review', text: RIGHTS[v.rights_status] || v.rights_status }),
        el('p', { class: 'mono', text: `rights_status: ${v.rights_status}` }),
      ]),
      el('td', {}, [
        el('span', { class: 'tag tag-review', text: '待审核' }),
        el('p', { class: 'mono', text: `verified_claims: ${m.counts.verified_claims} / ${m.counts.claims}` }),
        el('p', { class: 'mono', text: `human_review: not_started` }),
      ]),
      el('td', {}, [
        el('p', { class: 'mono', text: `证据 ${m.counts.evidence} · 知识 ${m.counts.claims} · 工序 ${m.counts.process_steps} · 关键帧 ${m.counts.keyframes}` }),
        el('p', { class: 'mono', text: `时长 ${Math.round(v.duration_ms / 1000)}s · ${v.width}×${v.height} · 播放地址：未接入` }),
      ]),
      el('td', {}, [
        el('p', { class: 'mono', text: new Date(m.generated_at).toLocaleString('zh-CN') }),
      ]),
    ]);
  });

  root.appendChild(el('section', { class: 'view' }, [
    topNav('passport'),
    el('div', { class: 'passport' }, [
      el('h2', { text: '数据护照' }),
      el('p', {
        class: 'sub',
        text: '本页展示每个数据包的来源、授权范围、模型处理方式与人工审核状态。包内知识草稿、工艺步骤与证据均为 AI 自动抽取的衍生内容，已在页面中逐条标注“待审核”，不覆盖原始资料。',
      }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, ['项目', '来源与处理模型', '授权状态', '人工审核', '数据计数', '生成时间'].map((h) => el('th', { text: h })))),
        el('tbody', {}, rows),
      ]),
      el('p', { class: 'foot-note', text: `目录生成时间：${new Date(allCrafts()[0] ? crafts[0].manifest.generated_at : Date.now()).toLocaleString('zh-CN')} · 视频文件尚未接入播放（playback_url 为空），页面证据以关键帧 + 转写原文 + 时间码形式呈现。其余 12 个行政区与更多项目：资料待接入。` }),
    ]),
  ]));
  agent.unmount();
  return { cleanup() {} };
}
