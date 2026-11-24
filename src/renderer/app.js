import { Puppet } from './puppet.js';
import { noise, clamp } from './motion.js';

const mount = document.getElementById('puppet-mount');
const bubble = document.getElementById('speech-bubble');
const particles = document.getElementById('particles');

const DRAG_THRESHOLD = 4;
const HEAD = { x: 0.5, y: 0.42 };

const REST = { armL: 4, armR: -4, foreL: -5, foreR: 5, legL: 0, legR: 0, torso: 0, head: 0, root: 0 };

const MOODS = {
  neutral: { smile: 0.42, happy: 0, open: 0, brow: 0, blush: 0.25, lid: 1 },
  happy: { smile: 1, happy: 1, open: 0.45, brow: -2, blush: 0.75, lid: 1 },
  surprised: { smile: 0, happy: 0, open: 0.75, brow: -6, blush: 0.3, lid: 1.12 },
  shy: { smile: 0.75, happy: 0, open: 0, brow: 1.5, blush: 0.85, lid: 0.72 },
  sleepy: { smile: 0.2, happy: 0, open: 0.05, brow: 2, blush: 0.2, lid: 0 },
};

// Each clip starts with a small opposite move, the classic animation anticipation beat.
const CLIPS = {
  wave: [
    [0, { armR: 10, foreR: 10, torso: 2, head: -2 }],
    [0.14, { armR: -100, foreR: -56, torso: -3, head: 5 }],
    [0.42, { armR: -102, foreR: -16, torso: -3, head: 6 }],
    [0.62, { armR: -100, foreR: -58, torso: -2, head: 4 }],
    [0.82, { armR: -102, foreR: -16, torso: -3, head: 6 }],
    [1.02, { armR: -100, foreR: -50, torso: -2, head: 3 }],
    [1.3, {}],
  ],
  stretch: [
    [0, { armL: -8, armR: 8, torso: 0, head: 4 }],
    [0.28, { armL: 98, armR: -98, foreL: 42, foreR: -42, head: -6 }],
    [1.25, { armL: 106, armR: -106, foreL: 34, foreR: -34, head: 6, torso: 4 }],
    [1.75, {}],
  ],
  tilt: [
    [0, { head: -13, torso: -2 }],
    [1.3, { head: 10, torso: 1.5 }],
    [2.1, {}],
  ],
  nod: [
    [0, { head: 7 }],
    [0.2, { head: -6 }],
    [0.42, { head: 6 }],
    [0.62, {}],
  ],
  fidget: [
    [0, { armL: -18, foreL: -62, armR: 18, foreR: 62, torso: 1 }],
    [1.2, { armL: -20, foreL: -70, armR: 20, foreR: 70, torso: -2, head: 5 }],
    [1.9, {}],
  ],
  hum: [
    [0, { torso: 4, head: 8, root: 1.5 }],
    [0.55, { torso: -4, head: -8, root: -1.5 }],
    [1.1, { torso: 4, head: 8, root: 1.5 }],
    [1.65, { torso: -4, head: -8, root: -1.5 }],
    [2.2, {}],
  ],
};

let character = null;
let puppet = null;
let svg = null;
let cursor = { x: -1, y: -1 };
let previousCursor = null;
let win = null;
let velocity = { x: 0, y: 0 };
const accel = { x: 0, y: 0 };

let motion = 'rest';
let mood = 'neutral';
let moodUntil = 0;
let clip = null;
let facing = 1;
let walkPhase = 0;
let press = null;
let sleeping = false;
let lastActivity = performance.now();
let lastFrame = performance.now();
let nextAction = performance.now() + 3000;
let nextLine = 0;
let nextBlink = 1.6;
let blinkEnd = 0;
let nextGlance = 1;
let glance = { x: 0, y: 0 };
let petting = 0;
let lastPetLine = 0;
let typeTimer = null;
let hideTimer = null;
let talkingUntil = 0;
let lastInteractive = null;

const randomFrom = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);
const between = ([min, max]) => min + Math.random() * (max - min);

function setMood(name, ms = 0) {
  mood = name;
  moodUntil = ms ? performance.now() + ms : 0;
}

function playClip(name) {
  clip = { frames: CLIPS[name], start: performance.now() };
}

function speak(text, holdMs = 2600) {
  if (!text) return;
  clearInterval(typeTimer);
  clearTimeout(hideTimer);
  let shown = 0;
  bubble.textContent = '';
  bubble.classList.add('visible');
  talkingUntil = performance.now() + text.length * 34;
  typeTimer = setInterval(() => {
    shown += 1;
    bubble.textContent = text.slice(0, shown);
    if (shown >= text.length) {
      clearInterval(typeTimer);
      hideTimer = setTimeout(() => bubble.classList.remove('visible'), holdMs);
    }
  }, 34);
}

const sayFrom = (group, holdMs) => speak(randomFrom(character.lines[group]), holdMs);

function headPoint() {
  const box = svg.getBoundingClientRect();
  return { x: box.left + box.width * HEAD.x, y: box.top + box.height * 0.34 };
}

function burst(symbol, count, className = '') {
  const origin = headPoint();
  for (let i = 0; i < count; i += 1) {
    const node = document.createElement('span');
    node.className = `particle ${className}`;
    node.textContent = symbol;
    node.style.left = `${origin.x + (Math.random() - 0.5) * 60}px`;
    node.style.top = `${origin.y - 44 - Math.random() * 18}px`;
    node.style.setProperty('--drift', `${(Math.random() - 0.5) * 44}px`);
    node.style.animationDelay = `${i * 80}ms`;
    node.addEventListener('animationend', () => node.remove());
    particles.appendChild(node);
  }
}

function wake() {
  lastActivity = performance.now();
  if (!sleeping) return;
  sleeping = false;
  setMood('surprised', 800);
  puppet.squash(0.08);
  sayFrom('wake');
  nextAction = performance.now() + 4000;
}

function basePose(time) {
  const pose = { ...REST };
  if (motion === 'drag') {
    const swing = noise(time * 2.3) * 28;
    Object.assign(pose, {
      armL: 54 + swing,
      armR: -54 + swing,
      foreL: 18,
      foreR: -18,
      legL: 14 + noise(time * 3 + 8) * 30,
      legR: -14 + noise(time * 3 + 21) * 30,
      root: clamp(velocity.x * 1.1, -22, 22),
      head: clamp(-velocity.x * 0.5, -12, 12),
    });
  } else if (motion === 'fall') {
    Object.assign(pose, { armL: 108, armR: -108, foreL: 36, foreR: -36, legL: 12, legR: -18, head: -5 });
  } else if (motion === 'walk') {
    const stride = Math.sin(walkPhase);
    Object.assign(pose, {
      legL: stride * 15,
      legR: -stride * 15,
      armL: 5 - stride * 13,
      armR: -5 - stride * 13,
      foreL: -14,
      foreR: 14,
      torso: 3 + Math.sin(walkPhase * 2) * 1.2,
      head: -Math.sin(walkPhase) * 2,
    });
  } else if (sleeping) {
    Object.assign(pose, { head: 17, torso: 5, armL: 1, armR: -1, foreL: -2, foreR: 2 });
  }
  return pose;
}

function clipPose(now, pose) {
  if (!clip || motion !== 'rest') {
    clip = null;
    return pose;
  }
  const elapsed = (now - clip.start) / 1000;
  const { frames } = clip;
  if (elapsed >= frames[frames.length - 1][0]) {
    clip = null;
    return pose;
  }
  let active = frames[0][1];
  for (const [at, values] of frames) if (elapsed >= at) active = values;
  return { ...pose, ...active };
}

function gaze(time) {
  const point = headPoint();
  const active = performance.now() - lastActivity < 3500;
  if (time > nextGlance) {
    glance = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 0.9 };
    nextGlance = time + 0.8 + Math.random() * 3.2;
    if (Math.random() < 0.35 && time > blinkEnd + 0.4) blinkEnd = time + 0.12;
  }
  if (sleeping) return { look: { x: 0, y: 5 }, eye: { x: 0, y: 0 } };

  const dx = active ? clamp((cursor.x - point.x) / 170, -1, 1) : glance.x * 0.45;
  const dy = active ? clamp((cursor.y - point.y) / 200, -1, 1) : glance.y * 0.45;
  const microX = active ? glance.x * 0.12 : 0;
  return {
    look: { x: dx * 6, y: dy * 4 },
    eye: { x: clamp(dx * 4.5 + microX, -5, 5) + (active ? 0 : glance.x * 1.6), y: dy * 3.5 },
  };
}

function faceFor(time, now) {
  const face = { ...(sleeping ? MOODS.sleepy : MOODS[mood]) };
  if (time > nextBlink) {
    blinkEnd = time + 0.11;
    nextBlink = time + 1.8 + Math.random() * 4.4;
    if (Math.random() < 0.2) nextBlink = time + 0.28;
  }
  if (time < blinkEnd) face.lid = 0;
  if (now < talkingUntil) face.open = Math.max(face.open, clamp(0.34 + noise(time * 11) * 1.5, 0.05, 0.75));
  return face;
}

function chooseAction(now) {
  if (motion !== 'rest' || sleeping || clip || press || now < nextAction) return;
  nextAction = now + between(character.idleActionMs);
  const roll = Math.random();
  if (roll < 0.3) {
    window.pet.walk(Math.random() < 0.5 ? -1 : 1, 50 + Math.random() * 180);
  } else {
    playClip(randomFrom(['tilt', 'hum', 'fidget', 'stretch', 'nod', 'tilt', 'hum']));
  }
  if (now > nextLine) {
    nextLine = now + between(character.idleLineIntervalMs);
    sayFrom('idle');
  }
}

function updateHit() {
  const inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x < innerWidth && cursor.y < innerHeight;
  let over = false;
  if (press) over = true;
  else if (inside) {
    const el = document.elementFromPoint(cursor.x, cursor.y);
    over = Boolean(el && el !== svg && svg.contains(el));
  }
  if (over !== lastInteractive) {
    lastInteractive = over;
    window.pet.setInteractive(over);
  }
  return over;
}

function updatePetting(over, dt) {
  if (previousCursor) {
    const moved = Math.hypot(cursor.x - previousCursor.x, cursor.y - previousCursor.y);
    if (moved > 0.5) wake();
    const head = headPoint();
    const nearHead = Math.hypot(cursor.x - head.x, cursor.y - head.y) < 58;
    if (over && nearHead && !press && motion === 'rest') petting += moved;
  }
  previousCursor = { ...cursor };
  petting = Math.max(0, petting - 340 * dt);
  if (petting > 480) {
    petting = 0;
    setMood('happy', 2200);
    burst('♥', 4);
    const now = performance.now();
    if (now - lastPetLine > 7000) {
      lastPetLine = now;
      sayFrom('pet');
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const time = now / 1000;

  if (moodUntil && now > moodUntil) setMood('neutral');
  if (!sleeping && motion === 'rest' && now - lastActivity > character.sleepAfterMs) {
    sleeping = true;
    clip = null;
    bubble.classList.remove('visible');
  }
  if (sleeping && Math.random() < dt * 0.55) burst('z', 1, 'sleep');
  if (motion === 'walk') walkPhase += dt * 11;

  chooseAction(now);
  const over = updateHit();
  updatePetting(over, dt);

  const { look, eye } = gaze(time);
  puppet.step(dt, time, {
    pose: clipPose(now, basePose(time)),
    look,
    eye,
    face: faceFor(time, now),
    accel,
    facing,
    breathRate: sleeping ? 1.25 : 2.1,
  });
  accel.x *= 0.72;
  accel.y *= 0.72;
}

window.pet.onTick(({ cursor: nextCursor, window: position }) => {
  cursor = nextCursor;
  if (win) {
    const vx = position.x - win.x;
    const vy = position.y - win.y;
    accel.x += clamp(vx - velocity.x, -24, 24) * 0.08;
    accel.y += clamp(vy - velocity.y, -24, 24) * 0.08;
    velocity = { x: vx, y: vy };
  }
  win = position;
});

window.pet.onMotion(({ type, impact, dir }) => {
  if (!puppet) return;
  if (type !== 'walk' && type !== 'walk-end') wake();
  if (type === 'drag') {
    motion = 'drag';
    document.body.classList.add('dragging');
    setMood('surprised');
    puppet.squash(-0.1);
    sayFrom('drag', 1400);
  } else if (type === 'fall') {
    motion = 'fall';
    document.body.classList.remove('dragging');
    setMood('surprised');
  } else if (type === 'land') {
    puppet.squash(clamp(impact * 0.012, 0.08, 0.26));
    if (impact > 22) sayFrom('land', 1500);
  } else if (type === 'rest') {
    motion = 'rest';
    document.body.classList.remove('dragging');
    setMood('neutral');
    nextAction = performance.now() + 2500;
  } else if (type === 'walk') {
    motion = 'walk';
    facing = dir;
  } else if (type === 'walk-end') {
    motion = 'rest';
    facing = 1;
  }
});

mount.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  mount.setPointerCapture(event.pointerId);
  press = { x: event.screenX, y: event.screenY, dragging: false };
});

mount.addEventListener('pointermove', (event) => {
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
  if (mount.hasPointerCapture(event.pointerId)) mount.releasePointerCapture(event.pointerId);
  if (wasDragging) {
    window.pet.dragEnd();
  } else if (event.type === 'pointerup') {
    wake();
    if (motion === 'rest') playClip('wave');
    setMood('happy', 1500);
    puppet.squash(0.07);
    burst('♥', 3);
    sayFrom('click', 1600);
  }
}

mount.addEventListener('pointerup', endPress);
mount.addEventListener('pointercancel', endPress);
mount.addEventListener('dblclick', () => {
  puppet.squash(0.2);
  setTimeout(() => window.pet.jump(), 110);
});

(async () => {
  character = await window.pet.getCharacter();
  mount.innerHTML = character.svg;
  svg = mount.querySelector('svg');
  puppet = new Puppet(svg);
  setMood('happy', 1600);
  sayFrom('greet');
  nextLine = performance.now() + between(character.idleLineIntervalMs);
  requestAnimationFrame(frame);
})();
