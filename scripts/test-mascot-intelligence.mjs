import assert from 'node:assert/strict';
import { availableCompanionBehaviors, chooseCompanionBehavior, nextCompanionBehaviorDelay } from '../js/mascot/behavior-brain.js';
import { createRelationshipStore } from '../js/mascot/relationship-store.js';

let clock = 1_800_000_000_000;
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
const relationship = createRelationshipStore({ storage, now: () => clock });
assert.equal(relationship.snapshot().level, 1);
assert.equal(relationship.snapshot().label, '你和小蕉刚熟悉');
const firstTap = relationship.record('tap');
assert.equal(firstTap.changed, true);
assert.equal(relationship.record('tap').changed, false, 'Repeated taps inside the cooldown must not farm points');
clock += 13_000;
assert.equal(relationship.record('tap').changed, true);
for (let index = 0; index < 24; index += 1) {
  clock += 21_000;
  relationship.record('question');
}
assert.equal(relationship.snapshot().level, 5);
const peakScore = relationship.snapshot().score;
clock += 5 * 24 * 60 * 60 * 1000;
assert.ok(relationship.snapshot().score < peakScore, 'Relationship score should decay over time');

const lowLevel = availableCompanionBehaviors({ level: 1 });
assert.equal(lowLevel.some(({ id }) => id === 'joy_jump'), false);
assert.equal(lowLevel.some(({ id }) => id === 'deep_sleep'), true);
assert.equal(lowLevel.some(({ id }) => id === 'tail_happy'), true);
assert.equal(lowLevel.some(({ id }) => id === 'zoomies'), true);
const lowLevelWeight = lowLevel.reduce((sum, behavior) => sum + behavior.weight(1), 0);
const walkWeight = lowLevel.find(({ id }) => id === 'walk')?.weight(1) || 0;
assert.ok(walkWeight / lowLevelWeight > 0.45, 'Walking should remain the most frequent autonomous behavior');
const highLevel = availableCompanionBehaviors({
  level: 5,
  currentTop: 850,
  surfaces: [{ id: 'modal', top: 300 }],
});
assert.equal(highLevel.some(({ id }) => id === 'platform_jump'), true);
assert.equal(highLevel.some(({ id }) => id === 'tail_happy'), true);
assert.equal(availableCompanionBehaviors({ level: 5, reducedMotion: true }).some(({ id }) => id.includes('jump')), false);
const selected = chooseCompanionBehavior({ level: 5, currentTop: 850, surfaces: [{ id: 'modal', top: 300 }] }, () => 0.999);
assert.equal(selected.id, 'joy_jump');
assert.equal(nextCompanionBehaviorDelay(5, () => 0.5), nextCompanionBehaviorDelay(1, () => 0.5));
assert.equal(nextCompanionBehaviorDelay(1, () => 1), 7200, 'Autonomous behavior pauses should stay short');

console.log('小猫关系与行为决策测试：通过');
