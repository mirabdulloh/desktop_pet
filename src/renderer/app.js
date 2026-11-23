import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const canvas = document.getElementById('scene');
const bubble = document.getElementById('speech-bubble');
const particles = document.getElementById('particles');
const empty = document.getElementById('empty');

const TOP_ROOM = 0.13;
const BOTTOM_ROOM = 0.015;
const DRAG_THRESHOLD = 4;

const MOODS = {
  neutral: {},
  happy: { happy: 1 },
  surprised: { surprised: 0.9 },
  sleep: { relaxed: 0.4, blink: 1 },
};
const EXPRESSIONS = ['happy', 'surprised', 'relaxed', 'blink'];

const POSES = {
  idle: { armL: -1.22, armR: 1.22, foreL: -0.12, foreR: 0.12, lean: 0 },
  wave: { armL: -1.22, armR: -0.95, foreL: -0.12, foreR: -0.55, lean: 0 },
  drag: { armL: -0.55, armR: 0.55, foreL: -0.25, foreR: 0.25, lean: 0.08 },
  fall: { armL: 0.45, armR: -0.45, foreL: 0.2, foreR: -0.2, lean: -0.05 },
  sleep: { armL: -1.32, armR: 1.32, foreL: -0.05, foreR: 0.05, lean: 0.12 },
};

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(16, 1, 0.1, 40);
const rig = new THREE.Group();
const lookTarget = new THREE.Object3D();
scene.add(rig, lookTarget);
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
keyLight.position.set(0.6, 1.4, 2);
scene.add(keyLight);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const clock = new THREE.Clock();
const headPosition = new THREE.Vector3();

let character = null;
let vrm = null;
let view = { height: 1.6, centerY: 0.8, distance: 6 };
let windowOrigin = null;
let cursor = { x: -1, y: -1 };
let lastCursor = null;
let lastActivity = performance.now();
let frame = 0;

let mood = 'neutral';
let pose = 'idle';
let moodUntil = 0;
let poseUntil = 0;
let motionState = 'rest';
let sleeping = false;
let nextBlink = 2;
let blinkPhase = -1;
let petAmount = 0;
let lastPetLine = 0;
let idleTimer = null;
let bubbleTimer = null;
let press = null;

const current = { ...POSES.idle, headX: 0, headY: 0, happy: 0, surprised: 0, relaxed: 0, blink: 0 };

const randomFrom = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const damp = (from, to, rate, dt) => THREE.MathUtils.damp(from, to, rate, dt);

function say(group, duration = 3200) {
  const text = randomFrom(character.lines && character.lines[group]);
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('visible');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), duration);
}

function setMood(name, ms = 0) {
  mood = name;
  moodUntil = ms ? performance.now() + ms : 0;
}

function setPose(name, ms = 0) {
  pose = name;
  poseUntil = ms ? performance.now() + ms : 0;
}

function headScreenPoint() {
  const head = vrm && vrm.humanoid.getNormalizedBoneNode('head');
  if (!head) return { x: innerWidth / 2, y: innerHeight * 0.25 };
  head.getWorldPosition(headPosition).project(camera);
  return {
    x: ((headPosition.x + 1) / 2) * innerWidth,
    y: ((1 - headPosition.y) / 2) * innerHeight,
  };
}

function burst(symbol, count, className = '') {
  const origin = headScreenPoint();
  for (let i = 0; i < count; i += 1) {
    const node = document.createElement('span');
    node.className = `particle ${className}`;
    node.textContent = symbol;
    node.style.left = `${origin.x + (Math.random() - 0.5) * 70}px`;
    node.style.top = `${origin.y - 20 - Math.random() * 25}px`;
    node.style.setProperty('--drift', `${(Math.random() - 0.5) * 50}px`);
    node.style.animationDelay = `${i * 70}ms`;
    node.addEventListener('animationend', () => node.remove());
    particles.appendChild(node);
  }
}

function wake() {
  lastActivity = performance.now();
  if (!sleeping) return;
  sleeping = false;
  setPose('idle');
  setMood('surprised', 900);
  say('wake');
}

function scheduleIdleLine() {
  clearTimeout(idleTimer);
  const [min, max] = character.idleLineIntervalMs || [18000, 42000];
  idleTimer = setTimeout(() => {
    if (vrm && !sleeping && motionState === 'rest') say('idle');
    scheduleIdleLine();
  }, min + Math.random() * (max - min));
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function frameModel() {
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const modelHeight = box.max.y - box.min.y;
  const height = modelHeight / (1 - TOP_ROOM - BOTTOM_ROOM);
  view = {
    height,
    centerY: box.min.y - BOTTOM_ROOM * height + height / 2,
    distance: height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
  };
}

function showEmpty(title, text) {
  empty.hidden = false;
  document.getElementById('empty-title').textContent = title;
  document.getElementById('empty-text').textContent = text;
}

async function loadModel() {
  if (vrm) {
    rig.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    vrm = null;
  }

  const bytes = await window.pet.readModel();
  if (!bytes) {
    showEmpty(`${character.name} needs a model`, 'Import a .vrm file you have permission to use. It stays on this computer.');
    return;
  }

  try {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await loader.parseAsync(data, '');
    const loaded = gltf.userData.vrm;
    if (!loaded) throw new Error('This file does not contain VRM data.');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(loaded);
    loaded.scene.traverse((node) => {
      node.frustumCulled = false;
    });

    vrm = loaded;
    if (vrm.lookAt) vrm.lookAt.target = lookTarget;
    rig.add(vrm.scene);
    vrm.update(0);
    frameModel();
    applyPose(0, 1);
    vrm.update(0);
    if (vrm.springBoneManager) vrm.springBoneManager.reset();

    empty.hidden = true;
    say('greet');
    setMood('happy', 1800);
    scheduleIdleLine();
  } catch (error) {
    console.warn('Model load failed:', error);
    showEmpty('Could not load that model', 'The file is damaged or is not a valid VRM. Try importing another one.');
  }
}

function bone(name) {
  return vrm.humanoid.getNormalizedBoneNode(name);
}

function setRotation(name, x, y, z) {
  const node = bone(name);
  if (node) node.rotation.set(x, y, z);
}

function applyPose(time, dt) {
  const target = POSES[pose];
  const rate = motionState === 'rest' ? 7 : 12;
  for (const key of Object.keys(target)) current[key] = damp(current[key], target[key], rate, dt);

  const breathe = Math.sin(time * (sleeping ? 1.25 : 1.9));
  const sway = Math.sin(time * 0.55);
  const wave = pose === 'wave' ? Math.sin(time * 13) * 0.28 : 0;
  const dangle = pose === 'drag' ? Math.sin(time * 6) * 0.14 : 0;

  setRotation('spine', current.lean + breathe * 0.012, sway * 0.018, sway * 0.012);
  setRotation('chest', breathe * 0.018, sway * 0.012, 0);
  setRotation('neck', current.headX * 0.35, current.headY * 0.35, 0);
  setRotation('head', current.headX * 0.65, current.headY * 0.65, -current.headY * 0.08 + sway * 0.015);
  setRotation('leftUpperArm', 0, 0, current.armL + breathe * 0.012 + dangle);
  setRotation('rightUpperArm', 0, 0, current.armR - breathe * 0.012 - dangle + wave * 0.35);
  setRotation('leftLowerArm', 0, current.foreL, 0);
  setRotation('rightLowerArm', 0, 0, current.foreR + wave);
  setRotation('leftUpperLeg', dangle, 0, 0.02);
  setRotation('rightUpperLeg', -dangle, 0, -0.02);
}

function updateLook(dt) {
  const scale = view.height / innerHeight;
  const dx = (cursor.x - innerWidth / 2) * scale;
  const head = headScreenPoint();
  const dy = (head.y - cursor.y) * scale;

  lookTarget.position.set(rig.position.x + dx, rig.position.y + view.centerY + (innerHeight / 2 - cursor.y) * scale, 1.2);

  const yaw = sleeping ? 0 : clamp(Math.atan2(dx, 1.6), -0.55, 0.55);
  const pitch = sleeping ? 0.38 : clamp(-Math.atan2(dy, 1.6), -0.3, 0.3);
  current.headY = damp(current.headY, yaw, 6, dt);
  current.headX = damp(current.headX, pitch, 6, dt);
}

function updateExpressions(time, dt) {
  const target = MOODS[mood] || MOODS.neutral;
  for (const name of EXPRESSIONS) {
    if (name !== 'blink') current[name] = damp(current[name], target[name] || 0, 11, dt);
  }

  let blink = target.blink || 0;
  if (!blink && !target.happy) {
    if (blinkPhase < 0 && time > nextBlink) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += dt / 0.15;
      blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
      if (blinkPhase >= 1) {
        blinkPhase = -1;
        nextBlink = time + 1.8 + Math.random() * 4;
      }
    }
  }
  current.blink = target.blink ? damp(current.blink, 1, 5, dt) : blink;

  if (vrm.expressionManager) {
    for (const name of EXPRESSIONS) vrm.expressionManager.setValue(name, current[name]);
  }
}

function updateBehavior(now, dt) {
  if (moodUntil && now > moodUntil) setMood(sleeping ? 'sleep' : 'neutral');
  if (poseUntil && now > poseUntil) setPose(sleeping ? 'sleep' : 'idle');

  if (!sleeping && motionState === 'rest' && now - lastActivity > (character.sleepAfterMs || 90000)) {
    sleeping = true;
    setPose('sleep');
    setMood('sleep');
    bubble.classList.remove('visible');
  }
  if (sleeping && frame % 130 === 0) burst('z', 1, 'sleep');
  petAmount = Math.max(0, petAmount - 420 * dt);
}

function updateHitTest() {
  const inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x < innerWidth && cursor.y < innerHeight;
  if (!inside) {
    if (!press) window.pet.setInteractive(false);
    return false;
  }
  if (press) return true;

  if (!empty.hidden) {
    const box = empty.getBoundingClientRect();
    const over = cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom;
    window.pet.setInteractive(over);
    return false;
  }

  const gl = renderer.getContext();
  const ratio = renderer.getPixelRatio();
  const pixel = new Uint8Array(4);
  gl.readPixels(
    Math.floor(cursor.x * ratio),
    gl.drawingBufferHeight - Math.floor(cursor.y * ratio) - 1,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  const over = pixel[3] > 24;
  window.pet.setInteractive(over);
  return over;
}

function updatePetting(over) {
  if (lastCursor) {
    const moved = Math.hypot(cursor.x - lastCursor.x, cursor.y - lastCursor.y);
    if (moved > 0) wake();
    const head = headScreenPoint();
    const nearHead = Math.hypot(cursor.x - head.x, cursor.y - head.y) < innerHeight * 0.12;
    if (over && nearHead && !press && motionState === 'rest') petAmount += moved;
  }
  lastCursor = { ...cursor };

  if (petAmount > 650) {
    petAmount = 0;
    setMood('happy', 2200);
    burst('♥', 4);
    const now = performance.now();
    if (now - lastPetLine > 7000) {
      lastPetLine = now;
      say('pet');
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  frame += 1;

  if (vrm) {
    camera.position.set(rig.position.x, rig.position.y + view.centerY, view.distance);
    camera.lookAt(rig.position.x, rig.position.y + view.centerY, 0);
    camera.updateMatrixWorld();
    updateBehavior(performance.now(), dt);
    updateLook(dt);
    applyPose(time, dt);
    updateExpressions(time, dt);
    vrm.update(dt);
  }

  renderer.render(scene, camera);
  if (frame % 2 === 0) updatePetting(updateHitTest());
}

window.pet.onTick(({ cursor: nextCursor, window: position }) => {
  cursor = nextCursor;
  if (!windowOrigin) windowOrigin = { ...position };
  // Moving the model through world space with the window lets spring-bone hair react to drags and falls.
  const scale = view.height / innerHeight;
  rig.position.x = (position.x - windowOrigin.x) * scale;
  rig.position.y = -(position.y - windowOrigin.y) * scale;
});

window.pet.onMotion(({ type, impact }) => {
  motionState = type === 'land' ? motionState : type;
  wake();
  if (type === 'drag') {
    document.body.classList.add('dragging');
    setPose('drag');
    setMood('surprised');
    say('drag', 1800);
  } else if (type === 'fall') {
    document.body.classList.remove('dragging');
    setPose('fall');
    setMood('surprised');
  } else if (type === 'land') {
    setPose('idle');
    setMood('surprised', 500);
    if (impact > 24) say('land', 2200);
  } else if (type === 'rest') {
    document.body.classList.remove('dragging');
    setPose('idle');
    setMood('neutral');
  }
});

window.pet.onModelChanged(loadModel);

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  press = { x: event.screenX, y: event.screenY, dragging: false };
});

canvas.addEventListener('pointermove', (event) => {
  if (!press || press.dragging) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) > DRAG_THRESHOLD) {
    press.dragging = true;
    window.pet.dragStart();
  }
});

function endPress(event) {
  if (!press) return;
  const wasDragging = press.dragging;
  press = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (wasDragging) {
    window.pet.dragEnd();
  } else if (event.type === 'pointerup' && vrm) {
    wake();
    setPose('wave', 1300);
    setMood('happy', 1500);
    burst('♥', 3);
    say('click', 2000);
  }
}

canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', endPress);
canvas.addEventListener('dblclick', () => window.pet.jump());
document.getElementById('import-button').addEventListener('click', () => window.pet.importModel());
window.addEventListener('resize', resize);

(async () => {
  character = await window.pet.getCharacter();
  resize();
  await loadModel();
  animate();
})();
