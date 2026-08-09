import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceScene = path.resolve(process.argv[2] || 'D:/godotWork/cat-anim/node_2d.tscn');
const sourceRoot = path.dirname(sourceScene);
const outputRoot = path.join(projectRoot, 'assets', 'mascot', 'cat');
const text = await readFile(sourceScene, 'utf8');

const vector = (value, fallback = [0, 0]) => {
  const match = String(value || '').match(/Vector2\(([-\d.eE]+),\s*([-\d.eE]+)\)/);
  return match ? [Number(match[1]), Number(match[2])] : fallback;
};

const resourcePaths = new Map();
for (const match of text.matchAll(/^\[ext_resource[^\]]*path="([^"]+)"[^\]]*id="([^"]+)"\]/gm)) {
  resourcePaths.set(match[2], match[1].replace(/^res:\/\//, ''));
}

const sections = [...text.matchAll(/^\[node name="([^"]+)" type="([^"]+)"(?: parent="([^"]+)")?[^\]]*\]\r?\n([\s\S]*?)(?=^\[node |(?![\s\S]))/gm)].map((match, index) => {
  const props = {};
  for (const line of match[4].split(/\r?\n/)) {
    const property = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (property) props[property[1]] = property[2];
  }
  return { index, name: match[1], type: match[2], parent: match[3] || '.', props };
});

const boneSections = sections.filter((node) => node.type === 'Bone2D');
const boneByScenePath = new Map();
for (const node of boneSections) {
  const parentBonePath = node.parent.replace(/^Skeleton2D\/?/, '');
  const rigPath = parentBonePath ? `${parentBonePath}/${node.name}` : node.name;
  boneByScenePath.set(`Skeleton2D/${rigPath}`, rigPath);
  node.rigPath = rigPath;
  node.parentRigPath = parentBonePath || null;
  node.position = vector(node.props.position);
}

const boneGlobal = new Map();
const globalBonePoint = (node) => {
  if (boneGlobal.has(node.rigPath)) return boneGlobal.get(node.rigPath);
  const parent = node.parentRigPath ? boneSections.find((candidate) => candidate.rigPath === node.parentRigPath) : null;
  const base = parent ? globalBonePoint(parent) : [0, 0];
  const point = [base[0] + node.position[0], base[1] + node.position[1]];
  boneGlobal.set(node.rigPath, point);
  return point;
};

const sceneNodeByPath = new Map();
for (const node of sections) {
  const nodePath = node.parent === '.' ? node.name : `${node.parent}/${node.name}`;
  sceneNodeByPath.set(nodePath, { ...node, nodePath });
}

const nodeGlobalTransform = (node) => {
  const parent = node.parent === '.' ? null : sceneNodeByPath.get(node.parent);
  const parentTransform = parent ? nodeGlobalTransform(parent) : { x: 0, y: 0, rotation: 0 };
  const [localX, localY] = vector(node.props.position);
  const cos = Math.cos(parentTransform.rotation);
  const sin = Math.sin(parentTransform.rotation);
  return {
    x: parentTransform.x + localX * cos - localY * sin,
    y: parentTransform.y + localX * sin + localY * cos,
    rotation: parentTransform.rotation + Number(node.props.rotation || 0),
  };
};

const dominantBone = (value = '') => {
  let best = { path: 'hip', total: -1 };
  for (const match of value.matchAll(/"([^"]+)",\s*PackedFloat32Array\(([^)]*)\)/g)) {
    const total = match[2].split(',').reduce((sum, number) => sum + (Number(number.trim()) || 0), 0);
    if (total > best.total) best = { path: match[1], total };
  }
  return best.path;
};

const sprites = [];
const usedResources = new Set();
const points = [];
for (const node of sections.filter((item) => item.type === 'Polygon2D')) {
  const resourceId = node.props.texture?.match(/ExtResource\("([^"]+)"\)/)?.[1];
  const sourceName = resourcePaths.get(resourceId);
  if (!sourceName) continue;
  usedResources.add(sourceName);
  const transform = nodeGlobalTransform(node);
  const offset = vector(node.props.offset);
  const polygon = [...String(node.props.polygon || '').matchAll(/([-\d.eE]+),\s*([-\d.eE]+)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  polygon.forEach(([x, y]) => points.push([x + transform.x + offset[0], y + transform.y + offset[1]]));
  sprites.push({
    id: `${node.name}-${node.index}`,
    image: path.basename(sourceName),
    bone: dominantBone(node.props.bones),
    x: transform.x + offset[0],
    y: transform.y + offset[1],
    rotation: transform.rotation,
  });
}

await mkdir(outputRoot, { recursive: true });
for (const resource of usedResources) {
  await copyFile(path.join(sourceRoot, resource), path.join(outputRoot, path.basename(resource)));
}

const minX = Math.min(...points.map(([x]) => x));
const minY = Math.min(...points.map(([, y]) => y));
const maxX = Math.max(...points.map(([x]) => x));
const maxY = Math.max(...points.map(([, y]) => y));
const manifest = {
  schema: 'tanwuzhi.godot-cat-rig/v1',
  source: path.basename(sourceScene),
  viewport: { x: Math.floor(minX - 24), y: Math.floor(minY - 24), width: Math.ceil(maxX - minX + 48), height: Math.ceil(maxY - minY + 48) },
  grabBone: 'hip/chest/head',
  bones: boneSections.map((node) => ({
    id: node.rigPath,
    parent: node.parentRigPath,
    x: node.position[0],
    y: node.position[1],
    restX: globalBonePoint(node)[0],
    restY: globalBonePoint(node)[1],
  })),
  sprites,
};
await writeFile(path.join(outputRoot, 'rig.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: outputRoot, bones: manifest.bones.length, sprites: sprites.length, images: usedResources.size, viewport: manifest.viewport }, null, 2));
