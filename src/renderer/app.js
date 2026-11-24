import * as PIXI from 'pixi.js';
import { install } from '@pixi/unsafe-eval';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';

install(PIXI);
window.PIXI = PIXI;
Live2DModel.registerTicker(PIXI.Ticker);

const canvas = document.getElementById('stage');
const bubble = document.getElementById('speech-bubble');
const particles = document.getElementById('particles');
const chatForm = document.getElementById('chat');
const chatInput = document.getElementById('chat-input');
const chatNote = document.getElementById('chat-note');
const chatSend = document.getElementById('chat-send');

const CHAT_ERRORS = {
  rate: "We've hit the usage limit for now. Let's talk again a bit later.",
  connection: "I can't reach the internet right now.",
  billing: 'Your API account needs credits before I can reply.',
  refused: "Sorry, I can't talk about that.",
  other: 'Something went wrong. Please try again.',
};

const DRAG_THRESHOLD = 4;
const TOP_ROOM = 0.1;
const ARM_SWAP_SECONDS = 0.07;

const app = new PIXI.Application({
  view: canvas,
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio, 2),
  resizeTo: window,
});

let character = null;
let model = null;
let core = null;
let baseScale = 1;
let cursor = { x: -1, y: -1 };
let previousCursor = null;
let win = null;
let velocity = { x: 0, y: 0 };
let sway = 0;
let swayVelocity = 0;
let squash = 1;
let squashVelocity = 0;
let squashTarget = 1;
let swing = 0;
let swingVelocity = 0;
let previousVelocityX = 0;
let grabPoint = null;
let hop = null;
let hopLift = 0;
let lean = 0;
let sleepAmount = 0;
let talkOpen = 0;
let talkTarget = 0;
let nextTalkShape = 0;
let blinkStart = -1;
let nextBlink = performance.now() + 2200;
let glance = { x: 0, y: 0 };
let nextGlance = 0;
let lastGesture = -1;

let motion = 'rest';
let press = null;
let sleeping = false;
let deepSleep = false;
let hardLanding = false;
let lastActivity = performance.now();
let nextAction = performance.now() + 7000;
let nextLine = 0;
let petting = 0;
let lastPetLine = 0;
let typeTimer = null;
let hideTimer = null;
let expressionTimer = null;
let talkingUntil = 0;
let lastInteractive = null;
let needsKey = false;
let chatBusy = false;

const randomFrom = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);
const between = ([min, max]) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

function setExpression(id, ms = 0) {
  clearTimeout(expressionTimer);
  if (!id) {
    model.internalModel.motionManager.expressionManager?.resetExpression();
    return;
  }
  model.expression(id);
  if (ms) expressionTimer = setTimeout(() => setExpression(null), ms);
}

const setMood = (mood, ms) => setExpression(character.moods[mood], ms);

function playGesture(index) {
  let chosen = index;
  while (chosen === undefined || (index === undefined && chosen === lastGesture)) {
    chosen = Math.floor(Math.random() * character.gestureCount);
  }
  lastGesture = chosen;
  model.motion('Gesture', chosen, MotionPriority.FORCE);
}

function headPoint() {
  const bounds = model.getBounds();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.16 };
}

function burst(symbol, count, className = '') {
  const origin = headPoint();
  for (let i = 0; i < count; i += 1) {
    const node = document.createElement('span');
    node.className = `particle ${className}`;
    node.textContent = symbol;
    node.style.left = `${origin.x + (Math.random() - 0.5) * 70}px`;
    node.style.top = `${origin.y - 30 - Math.random() * 18}px`;
    node.style.setProperty('--drift', `${(Math.random() - 0.5) * 44}px`);
    node.style.animationDelay = `${i * 80}ms`;
    node.addEventListener('animationend', () => node.remove());
    particles.appendChild(node);
  }
}

// A requested sleep ignores mouse movement and only ends on a click, drag or menu action.
function wake(force = false) {
  if (deepSleep && !force) return;
  lastActivity = performance.now();
  if (!sleeping) return;
  sleeping = false;
  deepSleep = false;
  squashVelocity = -1.2;
  setMood('surprised', 900);
  sayFrom('wake');
  nextAction = performance.now() + 5000;
}

function goToSleep(deep) {
  sleeping = true;
  deepSleep = deep;
  setMood('peaceful');
}

function layout() {
  if (!model) return;
  const { originalWidth, originalHeight } = model.internalModel;
  const usable = innerHeight * (1 - TOP_ROOM);
  baseScale = Math.min(usable / originalHeight, innerWidth / originalWidth);
  model.position.set(innerWidth / 2, innerHeight);
}

const drift = (t, a, b, c) => (Math.sin(t * a) + Math.sin(t * b + 1.7) * 0.6 + Math.sin(t * c + 4.1) * 0.3) / 1.9;

function applyParameters(dt) {
  const now = performance.now();
  const t = now / 1000;

  if (now < talkingUntil) {
    if (now > nextTalkShape) {
      talkTarget = 0.15 + Math.random() * 0.8;
      nextTalkShape = now + 70 + Math.random() * 90;
    }
  } else {
    talkTarget = 0;
  }
  talkOpen += (talkTarget - talkOpen) * Math.min(dt * 24, 1);
  if (talkOpen > 0.02) {
    core.setParameterValueById('ParamMouthOpenY', Math.max(core.getParameterValueById('ParamMouthOpenY'), talkOpen));
  }

  const focus = model.internalModel.focusController;
  core.addParameterValueById('ParamEyeBallX', (focus.targetX - focus.x) * 0.7 + focus.targetX * 0.35);
  core.addParameterValueById('ParamEyeBallY', (focus.targetY - focus.y) * 0.7 + focus.targetY * 0.35);

  const awake = 1 - sleepAmount;
  core.addParameterValueById('ParamBodyAngleX', clamp(sway * 9, -10, 10) + lean * 5 + drift(t, 0.31, 0.53, 0.97) * 1.6 * awake);
  core.addParameterValueById('ParamBodyAngleZ', lean * 5 + drift(t, 0.23, 0.47, 0.83) * 1.3 * awake);
  core.addParameterValueById('ParamAngleZ', clamp(sway * 13, -24, 24) + lean * 4 + drift(t, 0.37, 0.61, 1.13) * 2.2 * awake);
  core.addParameterValueById('ParamBodyAngleY', -hopLift * 3 - sleepAmount * 5);
  core.addParameterValueById('ParamAngleY', -sleepAmount * 22);

  let eyes = 1 - sleepAmount;
  if (blinkStart < 0 && now > nextBlink) blinkStart = now;
  if (blinkStart >= 0) {
    const progress = (now - blinkStart) / 150;
    if (progress >= 1) {
      blinkStart = -1;
      nextBlink = now + (Math.random() < 0.18 ? 220 : 1800 + Math.random() * 4600);
    } else {
      eyes *= 1 - Math.sin(progress * Math.PI);
    }
  }
  core.multiplyParameterValueById('ParamEyeLOpen', eyes);
  core.multiplyParameterValueById('ParamEyeROpen', eyes);
}

function updateGaze(now) {
  const focus = model.internalModel.focusController;
  if (sleeping) {
    focus.focus(0, -0.1);
    return;
  }
  if (now > nextGlance) {
    glance = Math.random() < 0.35 ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 0.7, y: (Math.random() - 0.5) * 0.3 };
    nextGlance = now + 1500 + Math.random() * 4000;
  }
  const soft = (value) => value / (Math.abs(value) + 260);
  const tracking = now - lastActivity < 2500;
  const x = tracking ? soft(cursor.x - innerWidth / 2) * 0.62 : glance.x;
  const y = tracking ? soft(innerHeight * 0.24 - cursor.y) * 0.45 : glance.y;
  focus.focus(clamp(x + (hop ? hop.dir * 0.3 : 0), -1, 1), y);
}

function updateSprings(dt) {
  const swayTarget = clamp(velocity.x * 0.05, -1, 1);
  swayVelocity += ((swayTarget - sway) * 90 - swayVelocity * 9) * dt;
  sway += swayVelocity * dt;

  let liftTarget = 0;
  squashTarget = 1;
  if (hop?.stage === 'crouch') squashTarget = 0.94;
  if (hop?.stage === 'air') {
    liftTarget = Math.sin(hop.t * Math.PI);
    squashTarget = 1.035;
  }
  if (hop?.stage === 'land') squashTarget = 1 - 0.06 * (1 - hop.t);
  if (motion === 'fall') squashTarget = clamp(1 + velocity.y * 0.0025, 0.98, 1.07);
  if (motion === 'drag' || motion === 'rise') squashTarget = 1.03;
  hopLift += (liftTarget - hopLift) * Math.min(dt * 30, 1);
  lean += ((hop ? hop.dir * (hop.run ? 1.7 : 1) : 0) - lean) * Math.min(dt * 7, 1);
  sleepAmount += ((sleeping ? 1 : 0) - sleepAmount) * Math.min(dt * 2.4, 1);

  squashVelocity += ((squashTarget - squash) * 260 - squashVelocity * 11) * dt;
  squash += squashVelocity * dt;
  squash = clamp(squash, 0.78, 1.2);

  // A pendulum driven by window acceleration makes her hang from where she is held.
  const held = motion === 'drag' || motion === 'fall';
  const acceleration = clamp(velocity.x - previousVelocityX, -40, 40);
  previousVelocityX = velocity.x;
  swingVelocity += held ? -acceleration * 0.32 : 0;
  swingVelocity += (-swing * (held ? 34 : 70) - swingVelocity * (held ? 3.6 : 11)) * dt;
  swing = clamp(swing + swingVelocity * dt, -0.3, 0.3);
  if (!held && !press && Math.abs(swing) < 0.004) {
    swing = 0;
    swingVelocity = 0;
    grabPoint = null;
  }

  const footX = innerWidth / 2;
  const footY = innerHeight - hopLift * (hop?.run ? 9 : 15) * (innerHeight / 440);
  const pivot = grabPoint || { x: footX, y: footY };
  const cos = Math.cos(swing);
  const sin = Math.sin(swing);
  const fx = footX - pivot.x;
  const fy = footY - pivot.y;
  model.rotation = swing;
  model.position.set(pivot.x + fx * cos - fy * sin, pivot.y + fx * sin + fy * cos);
  model.scale.set(baseScale * (2 - squash), baseScale * squash);
}

function chooseAction(now) {
  const typing = document.activeElement === chatInput && chatInput.value;
  if (motion !== 'rest' || sleeping || press || now < nextAction || chatBusy || typing) return;
  nextAction = now + between(character.idleActionMs);
  if (Math.random() < 0.25) {
    const gait = Math.random() < 0.2 ? 'run' : 'walk';
    window.pet.walk(Math.random() < 0.5 ? -1 : 1, 60 + Math.random() * 160, gait);
  } else {
    playGesture();
  }
  if (now > nextLine) {
    nextLine = now + between(character.idleLineIntervalMs);
    sayFrom('idle');
  }
}

function updateHit() {
  const inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x < innerWidth && cursor.y < innerHeight;
  let over = Boolean(press);
  const chatBox = chatForm.hidden ? null : chatForm.getBoundingClientRect();
  if (
    chatBox &&
    cursor.x >= chatBox.left &&
    cursor.x <= chatBox.right &&
    cursor.y >= chatBox.top &&
    cursor.y <= chatBox.bottom
  ) {
    over = true;
  } else if (!press && inside) {
    const gl = app.renderer.gl;
    const ratio = app.renderer.resolution;
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
    over = pixel[3] > 24;
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
    if (over && !press && !sleeping && motion === 'rest' && model.hitTest(cursor.x, cursor.y).includes('Head')) {
      petting += moved;
    }
  }
  previousCursor = { ...cursor };
  petting = Math.max(0, petting - 340 * dt);
  if (petting > 480) {
    petting = 0;
    setMood('happy', 2400);
    burst('♥', 4);
    const now = performance.now();
    if (now - lastPetLine > 7000) {
      lastPetLine = now;
      sayFrom('pet');
    }
  }
}

function update() {
  if (!model) return;
  const now = performance.now();
  const dt = Math.min(app.ticker.deltaMS / 1000, 0.05);
  if (!sleeping && motion === 'rest' && !chatBusy && now - lastActivity > character.sleepAfterMs) {
    goToSleep(false);
    bubble.classList.remove('visible');
  }
  if (sleeping && Math.random() < dt * 0.55) burst('z', 1, 'sleep');
  chooseAction(now);
  updateSprings(dt);
  updateGaze(now);
}

let hitFrame = 0;
function afterRender() {
  if (!model) return;
  hitFrame += 1;
  if (hitFrame % 2 === 0) updatePetting(updateHit(), app.ticker.deltaMS / 500);
}

window.pet.onTick(({ cursor: nextCursor, window: position, hop: nextHop }) => {
  cursor = nextCursor;
  hop = nextHop;
  if (win) velocity = { x: position.x - win.x, y: position.y - win.y };
  win = position;
});

window.pet.onMotion(({ type, impact }) => {
  if (!model) return;
  if (type !== 'walk' && type !== 'walk-end') wake(true);
  if (type === 'rise') {
    motion = 'rise';
    setMood('happy');
    sayFrom('top', 1600);
  } else if (type === 'drag') {
    motion = 'drag';
    document.body.classList.add('dragging');
    squashVelocity = 1.4;
    setMood('surprised');
    sayFrom('drag', 1400);
  } else if (type === 'fall') {
    motion = 'fall';
    document.body.classList.remove('dragging');
    setMood('surprised');
  } else if (type === 'land') {
    squashVelocity = -clamp(impact * 0.16, 1, 4);
    hardLanding = hardLanding || impact > 22;
    if (impact > 22) sayFrom('land', 1500);
  } else if (type === 'rest') {
    motion = 'rest';
    document.body.classList.remove('dragging');
    if (hardLanding) setMood('sad', 1500);
    else setExpression(null);
    hardLanding = false;
    nextAction = performance.now() + 3000;
  } else if (type === 'walk') {
    motion = 'walk';
  } else if (type === 'walk-end') {
    motion = 'rest';
  }
});

window.pet.onAction((action) => {
  if (!model || motion === 'drag' || motion === 'fall') return;
  if (action.type === 'down') {
    window.pet.comeDown();
    return;
  }
  if (motion === 'rise') return;
  if (action.type === 'sleep') {
    if (motion === 'walk') {
      window.pet.stopWalk();
      motion = 'rest';
    }
    goToSleep(true);
    sayFrom('sleep', 1200);
    return;
  }
  wake(true);
  nextAction = performance.now() + between(character.idleActionMs);
  if (action.type === 'gesture') playGesture(action.index);
  else if (action.type === 'expression') setExpression(action.id, 5000);
  else if (action.type === 'top') window.pet.goTop();
  else if (action.type === 'walk') {
    if (action.run) sayFrom('run', 1200);
    window.pet.walk(action.dir, action.run ? 420 : 220, action.run ? 'run' : 'walk', true);
  }
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  press = { x: event.screenX, y: event.screenY, dragging: false };
  grabPoint = { x: event.clientX, y: event.clientY };
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
  } else if (event.type === 'pointerup' && model) {
    wake(true);
    const onHead = model.hitTest(event.clientX, event.clientY).includes('Head');
    model.motion('TapBody', undefined, MotionPriority.FORCE);
    setMood(onHead ? 'shy' : 'happy', 2000);
    burst('♥', 3);
    sayFrom('click', 1600);
    if (chatForm.hidden) window.pet.chatStatus().then((hasKey) => showChat(hasKey));
  }
}

canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', endPress);
canvas.addEventListener('dblclick', () => {
  squashVelocity = -3;
  setTimeout(() => window.pet.jump(), 110);
});
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.pet.showMenu();
});
window.addEventListener('resize', layout);

function showChat(hasKey, focus = true) {
  needsKey = !hasKey;
  chatForm.hidden = false;
  chatNote.hidden = !needsKey;
  chatNote.textContent = needsKey
    ? 'Run "claude auth login" in Terminal to use your Claude plan, or paste an API key here.'
    : '';
  chatInput.type = needsKey ? 'password' : 'text';
  chatInput.placeholder = needsKey ? 'API key' : `Message ${character.name}...`;
  chatInput.value = '';
  chatSend.textContent = needsKey ? 'Save' : 'Send';
  if (focus) {
    window.pet.focusWindow();
    chatInput.focus();
    wake(true);
  }
}

function hideChat() {
  chatForm.hidden = true;
  chatInput.value = '';
}

function showReply(text) {
  clearInterval(typeTimer);
  clearTimeout(hideTimer);
  bubble.textContent = text;
  bubble.classList.add('visible');
  bubble.scrollTop = bubble.scrollHeight;
}

async function saveKey(key) {
  const result = await window.pet.saveApiKey(key);
  if (result.ok) {
    showChat(true);
    speak('Thanks! What do you want to talk about?');
  } else {
    chatNote.textContent = result.error === 'storage' ? 'Secure storage is unavailable on this computer.' : 'Paste a valid key.';
  }
}

async function sendMessage(text) {
  wake(true);
  chatBusy = true;
  chatSend.disabled = true;
  chatInput.value = '';
  showReply('...');

  let raw = '';
  let started = false;
  let stopDelta = false;
  activeDelta = (delta) => {
    if (stopDelta) return;
    raw += delta;
    if (raw.startsWith('[') && !raw.includes(']')) return;
    const tag = raw.match(/^\[(\w+)\]\s*/);
    if (!started) {
      started = true;
      if (tag && tag[1] !== 'neutral') setMood(tag[1], 5000);
      else setExpression(null);
      model.motion('Gesture', Math.floor(Math.random() * character.gestureCount), MotionPriority.NORMAL);
    }
    const shown = tag ? raw.slice(tag[0].length) : raw;
    if (shown) showReply(shown);
    talkingUntil = performance.now() + 420;
  };

  const result = await window.pet.sendChat(text);
  stopDelta = true;
  chatBusy = false;
  chatSend.disabled = false;
  lastActivity = performance.now();
  if (!chatForm.hidden) chatInput.focus();

  if (result.ok) {
    hideTimer = setTimeout(() => bubble.classList.remove('visible'), 4000 + raw.length * 45);
  } else if (result.error === 'auth') {
    showChat(false);
    chatNote.textContent = 'That API key did not work. Paste a valid key.';
    bubble.classList.remove('visible');
  } else if (result.error === 'login') {
    showChat(false);
    bubble.classList.remove('visible');
  } else if (result.error !== 'cancelled') {
    setMood('sad', 2500);
    speak(CHAT_ERRORS[result.error] || CHAT_ERRORS.other, 3500);
  }
}

let activeDelta = null;
window.pet.onChatDelta((delta) => activeDelta?.(delta));
window.pet.onChatOpen(({ hasKey }) => showChat(hasKey));

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = chatInput.value.trim();
  if (!value || chatBusy || !model) return;
  if (needsKey) saveKey(value);
  else sendMessage(value);
});
chatInput.addEventListener('pointerdown', () => window.pet.focusWindow());
chatInput.addEventListener('input', () => {
  lastActivity = performance.now();
});
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideChat();
});
document.getElementById('chat-close').addEventListener('click', hideChat);

(async () => {
  character = await window.pet.getCharacter();
  const base = `pet-asset://${character.assetDir}/`;
  const settings = await (await fetch(base + character.model)).json();
  const gesture = (index) => ({
    File: `motions/haru_g_m${String(index + 1).padStart(2, '0')}.motion3.json`,
    FadeInTime: 0.4,
    FadeOutTime: 0.5,
  });
  const gestures = Array.from({ length: character.gestureCount }, (_, index) => gesture(index));
  settings.url = base + character.model;
  // Voice clips are left out so the pet never plays sound unexpectedly.
  settings.FileReferences.Motions = {
    Idle: [{ File: 'motions/haru_g_idle.motion3.json', FadeInTime: 0.5, FadeOutTime: 0.5 }],
    TapBody: [5, 8, 19, 25].map(gesture),
    Gesture: gestures,
  };

  model = await Live2DModel.from(settings, { autoInteract: false });
  core = model.internalModel.coreModel;
  model.anchor.set(0.5, 1);
  app.stage.addChild(model);
  layout();
  // This hook runs after parameters are saved and before physics, so offsets can't accumulate and hair still reacts.
  const internal = model.internalModel;
  // Haru's pose file sets no fade time, and the slow default shows both arm sets as see-through.
  if (internal.pose) internal.pose._fadeTimeSeconds = ARM_SWAP_SECONDS;
  const updateNaturalMovements = internal.updateNaturalMovements.bind(internal);
  internal.updateNaturalMovements = (dt, now) => {
    updateNaturalMovements(dt, now);
    applyParameters(dt / 1000);
  };
  app.ticker.add(update, null, PIXI.UPDATE_PRIORITY.HIGH);
  app.ticker.add(afterRender, null, PIXI.UPDATE_PRIORITY.UTILITY);

  sayFrom('greet');
  showChat(await window.pet.chatStatus(), false);
  nextLine = performance.now() + between(character.idleLineIntervalMs);
})();
