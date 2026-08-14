import assert from 'node:assert/strict';
import { isExplorationRecommendationQuery, recommendExploration } from '../js/agent/exploration-recommender.js';

assert.equal(isExplorationRecommendationQuery('我现在探索哪一个比较好'), true);
assert.equal(isExplorationRecommendationQuery('第一次看非遗，从哪个开始？'), true);
assert.equal(isExplorationRecommendationQuery('月份牌年画是什么时候形成的？'), false);

const generic = recommendExploration('我现在探索哪一个比较好', {}, 2);
assert.equal(generic.length, 2);
assert.equal(generic.every((item) => item.type === 'heritage' && item.detail_available), true);
assert.equal(generic.every((item) => item.recommendation_reason.length > 12), true);

const performance = recommendExploration('我比较喜欢故事和表演，推荐一个', {}, 2);
assert.match(performance[0].title, /皮影|戏/);

const textile = recommendExploration('我想看看织造和生活有关的项目，哪个比较好', {}, 2);
assert.match(textile[0].title, /土布|纺织|药斑布/);

const excluded = recommendExploration('接下来探索哪一个', { current_root: { id: generic[0].id } }, 2);
assert.equal(excluded.some((item) => item.id === generic[0].id), false);

console.log('agent exploration recommendation tests passed');
