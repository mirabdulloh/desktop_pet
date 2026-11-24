// Usage: node tools/bake-animations.js <AnimationLibrary_Godot_Standard.glb> [characterId]
const fs = require('fs');
const path = require('path');

const FPS = 24;
const HEAD_SCALE = 0.6;
const TORSO_SCALE = 0.75;
const LEG_PX = 50;
const MIN_PROJECTED = 0.22;
const FIELDS = ['torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'legR', 'lenArmL', 'lenForeL', 'lenArmR', 'lenForeR', 'lenLegL', 'lenLegR', 'dx', 'dy'];

// Puppet rest directions in SVG space. Viewer-left limbs are the rig's .L or .R side, resolved from the T-pose.
const REST = { armL: [-13, 28], foreL: [-4, 22], armR: [13, 28], foreR: [4, 22], legL: [0, 1], legR: [0, 1] };

const [, , glbPath, characterId = 'suzu'] = process.argv;
if (!glbPath) throw new Error('Pass the path to the animation GLB.');

const file = fs.readFileSync(glbPath);
if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file.');
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.slice(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;

const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const accessorCache = new Map();

function readAccessor(index) {
  if (accessorCache.has(index)) return accessorCache.get(index);
  const accessor = gltf.accessors[index];
  if (accessor.componentType !== 5126) throw new Error('Only float animation data is supported.');
  const view = gltf.bufferViews[accessor.bufferView];
  const size = COMPONENTS[accessor.type];
  const offset = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || size * 4;
  const out = new Float32Array(accessor.count * size);
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < size; c += 1) out[i * size + c] = file.readFloatLE(offset + i * stride + c * 4);
  }
  accessorCache.set(index, out);
  return out;
}

function sampleTrack(track, t) {
  const { times, values, size } = track;
  const last = times.length - 1;
  if (t <= times[0]) return Array.from(values.slice(0, size));
  if (t >= times[last]) return Array.from(values.slice(last * size, (last + 1) * size));
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - times[lo]) / (times[hi] - times[lo]);
  const out = [];
  let sign = 1;
  if (size === 4) {
    let dot = 0;
    for (let c = 0; c < 4; c += 1) dot += values[lo * 4 + c] * values[hi * 4 + c];
    if (dot < 0) sign = -1;
  }
  for (let c = 0; c < size; c += 1) out.push(values[lo * size + c] * (1 - f) + sign * values[hi * size + c] * f);
  if (size === 4) {
    const length = Math.hypot(...out);
    return out.map((v) => v / length);
  }
  return out;
}

function compose([tx, ty, tz], [x, y, z, w], [sx, sy, sz]) {
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

const parents = new Map();
gltf.nodes.forEach((node, index) => (node.children || []).forEach((child) => parents.set(child, index)));
const nodeIndex = new Map(gltf.nodes.map((node, index) => [node.name, index]));

function bone(name) {
  if (!nodeIndex.has(name)) throw new Error(`Missing bone ${name}`);
  return nodeIndex.get(name);
}

function tracksFor(animation) {
  const tracks = new Map();
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    const size = channel.target.path === 'rotation' ? 4 : 3;
    if (!tracks.has(channel.target.node)) tracks.set(channel.target.node, {});
    tracks.get(channel.target.node)[channel.target.path] = {
      times: readAccessor(sampler.input),
      values: readAccessor(sampler.output),
      size,
    };
  }
  return tracks;
}

function worldMatrix(index, tracks, t, cache) {
  if (cache.has(index)) return cache.get(index);
  const node = gltf.nodes[index];
  const track = tracks.get(index) || {};
  const local = compose(
    track.translation ? sampleTrack(track.translation, t) : node.translation || [0, 0, 0],
    track.rotation ? sampleTrack(track.rotation, t) : node.rotation || [0, 0, 0, 1],
    track.scale ? sampleTrack(track.scale, t) : node.scale || [1, 1, 1],
  );
  const parent = parents.get(index);
  const world = parent === undefined ? local : multiply(worldMatrix(parent, tracks, t, cache), local);
  cache.set(index, world);
  return world;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
const wrap = (a) => ((a + 540) % 360) - 180;
const deg = ([x, y]) => (Math.atan2(y, x) * 180) / Math.PI;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function pointsAt(tracks, t) {
  const cache = new Map();
  const at = (name) => {
    const m = worldMatrix(bone(name), tracks, t, cache);
    return [m[12], m[13], m[14]];
  };
  const head = worldMatrix(bone('DEF-head'), tracks, t, cache);
  const points = {
    hips: at('DEF-hips'),
    neck: at('DEF-neck'),
    headAxis: [head[4], head[5], head[6]],
  };
  for (const side of ['L', 'R']) {
    points[`upper${side}`] = at(`DEF-upper_arm.${side}`);
    points[`fore${side}`] = at(`DEF-forearm.${side}`);
    points[`hand${side}`] = at(`DEF-hand.${side}`);
    points[`thigh${side}`] = at(`DEF-thigh.${side}`);
    points[`foot${side}`] = at(`DEF-foot.${side}`);
  }
  return points;
}

const tposeAnim = gltf.animations.find((a) => a.name === 'A_TPose');
if (!tposeAnim) throw new Error('A_TPose clip not found.');
const tpose = pointsAt(tracksFor(tposeAnim), 0);
// The side whose arm sits at +X appears on the viewer's right when the rig faces the camera.
const viewerRight = tpose.upperL[0] > 0 ? 'L' : 'R';
const viewerLeft = viewerRight === 'L' ? 'R' : 'L';
const hipHeight = tpose.hips[1];
const restLength = {
  upper: len3(sub(tpose.foreL, tpose.upperL)),
  fore: len3(sub(tpose.handL, tpose.foreL)),
  leg: len3(sub(tpose.footL, tpose.thighL)),
};

function projector(yawDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (v) => [v[0] * c + v[2] * s, -v[1]];
}

function bakeClip(animation, yawDegrees) {
  const tracks = tracksFor(animation);
  const duration = Math.max(...animation.samplers.map((s) => gltf.accessors[s.input].max[0]));
  const count = Math.max(2, Math.round(duration * FPS) + 1);
  const project = projector(yawDegrees);
  const previous = {};
  const frames = [];

  const limb = (key, from, to, full, parentAngle) => {
    const dir = project(sub(to, from));
    const length = Math.hypot(dir[0], dir[1]) / full;
    let world = previous[key];
    if (length > MIN_PROJECTED || world === undefined) {
      const raw = deg(dir) - deg(REST[key]);
      world = world === undefined ? wrap(raw) : world + wrap(raw - world);
      previous[key] = world;
    }
    return { angle: world - parentAngle, world, length: clamp(length, 0.5, 1.1) };
  };

  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * duration;
    const p = pointsAt(tracks, t);
    const spine = project(sub(p.neck, p.hips));
    const torso = wrap(deg(spine) + 90) * TORSO_SCALE;
    const axis = project(p.headAxis);
    const head = wrap(wrap(deg(axis) + 90) * HEAD_SCALE - torso);

    const armL = limb('armL', p[`upper${viewerLeft}`], p[`fore${viewerLeft}`], restLength.upper, torso);
    const foreL = limb('foreL', p[`fore${viewerLeft}`], p[`hand${viewerLeft}`], restLength.fore, torso + armL.angle);
    const armR = limb('armR', p[`upper${viewerRight}`], p[`fore${viewerRight}`], restLength.upper, torso);
    const foreR = limb('foreR', p[`fore${viewerRight}`], p[`hand${viewerRight}`], restLength.fore, torso + armR.angle);
    const legL = limb('legL', p[`thigh${viewerLeft}`], p[`foot${viewerLeft}`], restLength.leg, 0);
    const legR = limb('legR', p[`thigh${viewerRight}`], p[`foot${viewerRight}`], restLength.leg, 0);

    const hipX = project(p.hips)[0];
    const values = {
      torso, head,
      armL: armL.angle, foreL: foreL.angle, armR: armR.angle, foreR: foreR.angle,
      legL: legL.angle, legR: legR.angle,
      lenArmL: armL.length, lenForeL: foreL.length, lenArmR: armR.length, lenForeR: foreR.length,
      lenLegL: legL.length, lenLegR: legR.length,
      dx: clamp((hipX / hipHeight) * LEG_PX, -14, 14),
      dy: clamp(((hipHeight - p.hips[1]) / hipHeight) * LEG_PX, -30, 42),
    };
    frames.push(FIELDS.map((field) => Number(values[field].toFixed(field.startsWith('len') ? 2 : 1))));
  }
  return { duration: Number(duration.toFixed(3)), frames };
}

const characterDir = path.join(__dirname, '..', 'characters', characterId);
const actions = JSON.parse(fs.readFileSync(path.join(characterDir, 'actions.json'), 'utf8'));
const clips = {};
for (const [id, action] of Object.entries(actions)) {
  if (!action.clip) continue;
  const animation = gltf.animations.find((a) => a.name === action.clip);
  if (!animation) throw new Error(`Clip ${action.clip} not found for action ${id}.`);
  clips[id] = bakeClip(animation, action.yaw || 0);
}

const output = path.join(characterDir, 'animations.json');
fs.writeFileSync(output, JSON.stringify({ fps: FPS, fields: FIELDS, clips }));
console.log(`Baked ${Object.keys(clips).length} clips, ${(fs.statSync(output).size / 1024).toFixed(0)} KB, viewer-right side ${viewerRight}`);
