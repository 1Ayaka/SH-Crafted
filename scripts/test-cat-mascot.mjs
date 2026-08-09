import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const assetRoot = path.join(projectRoot, 'assets', 'mascot', 'cat');
const rig = JSON.parse(await readFile(path.join(assetRoot, 'rig.json'), 'utf8'));

assert.equal(rig.schema, 'tanwuzhi.godot-cat-rig/v1');
assert.equal(rig.source, 'node_2d.tscn');
assert.equal(rig.bones.length, 20, 'Godot rig should contain 20 bones');
assert.equal(rig.sprites.length, 19, 'Godot rig should contain 19 sprite layers');
assert.ok(rig.viewport.width > 0 && rig.viewport.height > 0, 'Mascot viewport must be measurable');

const boneIds = new Set(rig.bones.map((bone) => bone.id));
assert.equal(boneIds.size, rig.bones.length, 'Bone ids must be unique');
assert.ok(boneIds.has(rig.grabBone), 'Grab bone must exist in the rig');

const images = new Set();
for (const sprite of rig.sprites) {
  assert.ok(boneIds.has(sprite.bone), `Sprite ${sprite.id} references a missing bone`);
  assert.ok(sprite.image.endsWith('.png'), `Sprite ${sprite.id} must use a PNG texture`);
  images.add(sprite.image);
}
assert.equal(images.size, 12, 'Godot scene should contribute 12 texture files');
await Promise.all([...images].map((image) => access(path.join(assetRoot, image))));

console.log(`Mascot rig OK: ${rig.bones.length} bones, ${rig.sprites.length} sprites, ${images.size} textures.`);
