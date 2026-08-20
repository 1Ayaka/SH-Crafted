import assert from 'node:assert/strict';
import { resolveVoicePreferences, wakeMatch } from '../js/voice/voice-controller.js';

assert.equal(resolveVoicePreferences({}).wakeEnabled, true, '新用户应默认开启唤醒');
assert.equal(resolveVoicePreferences({ wakeEnabled: false }).wakeEnabled, true, '旧版默认关闭应迁移为开启');
assert.equal(resolveVoicePreferences({ wakeEnabled: false, preferenceVersion: 2 }).wakeEnabled, false, '新版主动关闭应保留');

assert.deepEqual(wakeMatch('小蕉小蕉'), { matched: true, command: '' });
assert.deepEqual(wakeMatch('小焦，小娇，打开地图'), { matched: true, command: '打开地图' });
assert.deepEqual(wakeMatch('小胶小椒有什么好玩的'), { matched: true, command: '有什么好玩的' });
assert.deepEqual(wakeMatch('小脚'), { matched: true, command: '' }, '模型吞掉一次重复时仍应唤醒');
assert.deepEqual(wakeMatch('小蕉，介绍崇明土布'), { matched: true, command: '介绍崇明土布' });
assert.deepEqual(wakeMatch('今天想吃香蕉'), { matched: false, command: '' });
assert.deepEqual(wakeMatch('这里提到了小蕉这个角色'), { matched: false, command: '' }, '正文中提及不应误唤醒');

console.log('voice wake word tests passed');
