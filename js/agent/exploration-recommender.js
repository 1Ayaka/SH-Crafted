import { graphNodes } from './graph-adapter.js';

const RECOMMENDATION_RE = /(?:推荐|建议|适合).*(?:非遗|项目|探索|看看|了解)|(?:现在|接下来|第一次|先).*(?:探索|看|了解).*(?:哪|什么|比较好)|探索哪(?:一|个)|从哪(?:一|个|里)开始/;

const PREFERENCES = Object.freeze([
  { pattern: /表演|故事|戏|亲子|儿童/, terms: ['皮影', '戏'] },
  { pattern: /纸|画|视觉|图案|海派/, terms: ['月份牌', '撕纸', '年画'] },
  { pattern: /织|布|纺|服饰|生活/, terms: ['土布', '药斑布', '纺织'] },
  { pattern: /雕|刻|精细|文人|器物/, terms: ['竹刻'] },
  { pattern: /编织|结构|立体/, terms: ['编织', '篾丝'] },
]);

const DEFAULT_ORDER = ['嘉定竹刻', '七宝皮影戏', '上海月份牌年画', '崇明土布纺织技艺', '南桥撕纸'];

export function isExplorationRecommendationQuery(input) {
  return RECOMMENDATION_RE.test(String(input || '').replace(/\s+/g, ''));
}

function reasonFor(node) {
  const title = String(node?.title || '');
  if (/竹刻|雕|刻/.test(title)) return '材料、工具和制作动作都比较直观，适合从“它是怎样做出来的”开始。';
  if (/皮影|戏|表演/.test(title)) return '既能看造型制作，也能看表演和故事如何让传统进入今天的生活。';
  if (/月份牌|年画/.test(title)) return '视觉风格鲜明，可以从图像、印刷与上海城市文化之间的关系切入。';
  if (/土布|纺织|药斑布/.test(title)) return '与衣食住行联系紧密，材料到成品的变化容易理解，也适合体验工序。';
  if (/撕纸|剪纸/.test(title)) return '从一张纸到完整形象的变化很清楚，入门轻巧，视觉反馈也直接。';
  if (/编织|篾丝/.test(title)) return '能清楚观察材料如何通过重复动作形成结构，适合偏爱细节的人。';
  return node?.summary ? `${String(node.summary).slice(0, 56)}${String(node.summary).length > 56 ? '……' : ''}` : '它有可继续展开的项目详情和知识关系，适合作为探索入口。';
}

export function recommendExploration(input, context = {}, limit = 2) {
  const query = String(input || '');
  const excluded = new Set([
    context.current_root?.id,
    context.selected_node?.id,
    ...(context.history || []).map((item) => typeof item === 'string' ? item : item?.id),
  ].filter(Boolean));
  const available = graphNodes().filter((node) => (
    node.type === 'heritage' && node.detail_available && node.public !== false && !excluded.has(node.id)
  ));
  const preference = PREFERENCES.find((item) => item.pattern.test(query));
  const rank = (node) => {
    const title = String(node.title || '');
    const preferenceScore = preference ? Math.max(0, ...preference.terms.map((term) => title.includes(term) ? 100 : 0)) : 0;
    const defaultIndex = DEFAULT_ORDER.findIndex((term) => title.includes(term));
    return preferenceScore + (defaultIndex >= 0 ? 20 - defaultIndex : 0) + (node.summary ? 2 : 0);
  };
  return available
    .map((node) => ({ ...node, recommendation_reason: reasonFor(node), recommendation_score: rank(node) }))
    .sort((a, b) => b.recommendation_score - a.recommendation_score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, Math.max(1, Math.min(3, Number(limit) || 2)));
}

