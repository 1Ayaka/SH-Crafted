import assert from 'node:assert/strict';
import { isExplorationRecommendationQuery, recommendExploration } from '../js/agent/exploration-recommender.js';

assert.equal(isExplorationRecommendationQuery('我现在探索哪一个比较好'), true);
assert.equal(isExplorationRecommendationQuery('第一次看非遗，从哪个开始？'), true);
assert.equal(isExplorationRecommendationQuery('有啥好玩的'), true);
assert.equal(isExplorationRecommendationQuery('带我逛逛'), true);
assert.equal(isExplorationRecommendationQuery('随便推荐一个'), true);
assert.equal(isExplorationRecommendationQuery('月份牌年画是什么时候形成的？'), false);

const candidates = [
  { id: 'heritage:test_bamboo', type: 'heritage', title: '嘉定竹刻', summary: '竹材雕刻项目。', detail_available: true, public: true },
  { id: 'heritage:test_shadow', type: 'heritage', title: '七宝皮影戏', summary: '结合造型与表演。', detail_available: true, public: true },
  { id: 'heritage:test_textile', type: 'heritage', title: '崇明土布纺织技艺', summary: '与乡土生活相关的织造技艺。', detail_available: true, public: true },
];
const generic = recommendExploration('我现在探索哪一个比较好', {}, 2, candidates);
assert.equal(generic.length, 2);
assert.equal(generic.every((item) => item.type === 'heritage' && item.detail_available), true);
assert.equal(generic.every((item) => item.recommendation_reason.length > 12), true);

const performance = recommendExploration('我比较喜欢故事和表演，推荐一个', {}, 2, candidates);
assert.match(performance[0].title, /皮影|戏/);

const casual = recommendExploration('有什么好玩的', {}, 2, candidates);
assert.equal(casual[0].title, '崇明土布纺织技艺', '轻松体验型推荐应优先展示完成度更高的崇明土布项目');

const textile = recommendExploration('我想看看织造和生活有关的项目，哪个比较好', {}, 2, candidates);
assert.match(textile[0].title, /土布|纺织|药斑布/);

const excluded = recommendExploration('接下来探索哪一个', { current_root: { id: generic[0].id } }, 2, candidates);
assert.equal(excluded.some((item) => item.id === generic[0].id), false);

const currentCraftExcluded = recommendExploration('有啥好玩的', { current_craft_id: 'test_bamboo' }, 2, candidates);
assert.equal(currentCraftExcluded.some((item) => item.id === 'heritage:test_bamboo'), false, '推荐不应把用户正在看的项目再次推荐给用户');

console.log('agent exploration recommendation tests passed');
