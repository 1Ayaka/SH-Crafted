import { graphId, searchGraph } from './graph-adapter.js';

const STOP_RE = /^(停|别说了|停止朗读|停下|取消|闭嘴)$/;
const RELATION_RE = [
  [/位于|在哪里|在哪个地区|什么地方/, 'LOCATED_IN'],
  [/属于传统|什么传统|同类项目|同一传统|传统/, 'BELONGS_TO_TRADITION'],
  [/材料|材质|使用什么|用什么做/, 'USES_MATERIAL'],
];

function stripCommand(text) {
  return String(text || '').trim()
    .replace(/^(请|帮我|带我|我想|想要|可以|能不能|请你|打开|查看|看看|进入|带我看|讲讲|介绍一下)/, '')
    .replace(/(打开|查看|看看|进入|带我看|讲讲|介绍一下|的详情|详情页)$/g, '')
    .trim();
}

function visibleTarget(text, context) {
  const visible = context.visible_nodes || [];
  const number = text.match(/第\s*([一二三四五六七八九十\d]+)个|^([一二三四五六七八九十\d]+)$/);
  if (number) {
    const raw = number[1] || number[2];
    const index = /^[\d]+$/.test(raw) ? Number(raw) : '一二三四五六七八九十'.indexOf(raw) + 1;
    return visible[index - 1] ? { kind: 'node', node: visible[index - 1] } : { kind: 'error', message: '当前页面没有这个序号的可见节点。' };
  }
  const clean = stripCommand(text).replace(/^(这个|它|刚才那个|当前项目)$/, '');
  if (!clean && (context.selected_node || context.current_root)) return { kind: 'node', node: context.selected_node || context.current_root };
  const matches = visible.filter((node) => [node.title, ...(node.aliases || [])].some((value) => clean && String(value).includes(clean)));
  if (matches.length === 1) return { kind: 'node', node: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches.slice(0, 3) };
  const global = searchGraph(clean, { limit: 4 });
  if (global.length === 1) return { kind: 'node', node: global[0] };
  if (global.length > 1) return { kind: 'ambiguous', candidates: global.slice(0, 3) };
  return { kind: 'none' };
}

export function resolveIntent(input, context) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (STOP_RE.test(text)) return { name: 'stop_speaking', args: {} };
  if (/关闭语音模式|关闭唤醒|停止唤醒/.test(text)) return { name: 'set_voice_preferences', args: { wake_enabled: false } };
  if (/打开语音模式|开启语音|开启唤醒/.test(text)) return { name: 'set_voice_preferences', args: { wake_enabled: true } };
  if (/回到(刚才|上一层|上一个)|返回/.test(text)) return { name: 'go_back', args: {} };
  if (/回到(完成品|作品|根节点)/.test(text)) return { name: /完成品|作品/.test(text) ? 'focus_model' : 'return_to_root', args: {} };
  if (/读给我听|朗读|念一下|读一下/.test(text)) {
    return { name: 'read_summary', args: { target_id: context.selected_node?.id || context.current_root?.id, content: 'summary', max_seconds: 35 } };
  }
  if (/帮助|怎么用|可以做什么/.test(text)) return { name: 'show_help', args: {} };
  for (const [pattern, relation] of RELATION_RE) if (pattern.test(text)) return { name: 'expand_branch', args: { relation } };

  const target = visibleTarget(text, context);
  if (/打开|查看|看看|进入|带我|详情|同类项目/.test(text) || target.kind !== 'none') {
    if (target.kind === 'ambiguous') return { clarification: `你想打开${target.candidates.map((item) => item.title).join('，还是')}？`, candidates: target.candidates };
    if (target.kind === 'error') return { clarification: target.message };
    if (target.kind === 'node') {
      if (target.node.type === 'region') return { name: 'open_region', args: { region_id: target.node.id } };
      return { name: 'open_node', args: { node_id: target.node.id, focus_camera: true, open_summary: true } };
    }
  }
  const region = searchGraph(stripCommand(text), { types: ['region'], limit: 2 });
  if (region.length === 1 && /还有哪些|地区|区/.test(text)) return { name: 'open_region', args: { region_id: region[0].id } };
  return null;
}
