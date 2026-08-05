import assert from 'node:assert/strict';
import { materialInventoryBeforeStep, materialTransformMap, uniqueMaterialNames } from '../js/material-flow.js';

const steps = [
  {
    id: 'step-1',
    materials: ['原料'],
    material_transforms: [{ input_name: '原料', output_name: '半成品' }],
  },
  { id: 'step-2', materials: [], material_transforms: [] },
  { id: 'step-3', materials: [], material_transforms: [] },
  {
    id: 'step-4',
    materials: [],
    material_transforms: [{ input_name: '半成品', output_name: '完成品' }],
  },
];

assert.deepEqual(
  uniqueMaterialNames(materialInventoryBeforeStep(steps, 1)),
  ['半成品'],
  '第一步产物应进入库存',
);
assert.deepEqual(
  uniqueMaterialNames(materialInventoryBeforeStep(steps, 3)),
  ['半成品'],
  '第二、三步未使用时应暂存，第四步仍可重新使用',
);
assert.deepEqual(
  uniqueMaterialNames(materialInventoryBeforeStep(steps, 4)),
  ['完成品'],
  '重新使用后应只在实际参与的第四步转换',
);

const consumed = [
  ...steps.slice(0, 1),
  { id: 'consume', materials: [], material_transforms: [{ input_name: '半成品', output_name: '' }] },
];
assert.deepEqual(
  materialInventoryBeforeStep(consumed, 2),
  [],
  '显式留空产物应表示永久消耗，而不是暂存',
);

assert.equal(
  materialTransformMap({ materials: ['旧数据材料'], material_transforms: [] }).get('旧数据材料')?.output_name,
  '旧数据材料',
  '没有转换配置的旧数据应保持同名延续',
);

console.log('material flow tests passed');
