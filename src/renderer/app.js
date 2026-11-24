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
  rate: 'Too many messages right now. Try again in a moment.',
  connection: "I can't reach the internet right now.",
  billing: 'Your API account needs credits before I can reply.',
  refused: "Sorry, I can't talk about that.",
  other: 'Something went wrong. Please try again.',
};

const DRAG_THRESHOLD = 4;
const TOP_ROOM = 0.1;

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
let walkPhase = 0;

let motion = 'rest';
let press = null;
let sleeping = false;
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
  const chosen = index ?? Math.floor(Math.random() * character.gestureCount);
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

function wake() {
  lastActivity = performance.now();
  if (!sleeping) return;
  sleeping = false;
  squashVelocity = -1.2;
  setMood('surprised', 900);
  sayFrom('wake');
  nextAction = performance.now() + 5000;
}

function layout() {
  if (!model) return;
  const { originalWidth, originalHeight } = model.internalModel;
  const usable = innerHeight * (1 - TOP_ROOM);
  baseScale = Math.min(usable / originalHeight, innerWidth / originalWidth);
  model.position.set(innerWidth / 2, innerHeight);
}

function applyParameters() {
  const now = performance.now();
  if (now < talkingUntil) {
    core.setParameterValueById('ParamMouthOpenY', 0.25 + Math.abs(Math.sin(now / 62)) * 0.65);
  }
  core.addParameterValueById('ParamBodyAngleX', clamp(sway * 9, -10, 10));
  core.addParameterValueById('ParamAngleZ', clamp(sway * 13, -24, 24));
  if (motion === 'walk') {
    core.addParameterValueById('ParamBodyAngleZ', Math.sin(walkPhase) * 4);
    core.addParameterValueById('ParamBodyAngleY', Math.abs(Math.sin(walkPhase)) * 4);
  }
  if (sleeping) {
    core.setParameterValueById('ParamEyeLOpen', 0);
    core.setParameterValueById('ParamEyeROpen', 0);
    core.addParameterValueById('ParamAngleY', -22);
    core.addParameterValueById('ParamBodyAngleY', -5);
  }
}

function updateSprings(dt) {
  const target = clamp(velocity.x * 0.05, -1, 1);
  swayVelocity += ((target - sway) * 90 - swayVelocity * 9) * dt;
  sway += swayVelocity * dt;
  squashVelocity += ((1 - squash) * 260 - squashVelocity * 11) * dt;
  squash += squashVelocity * dt;
  const bob = motion === 'walk' ? Math.abs(Math.sin(walkPhase)) * 5 : 0;
  model.scale.set(baseScale * (2 - squash), baseScale * squash);
  model.position.y = innerHeight - bob;
}

function chooseAction(now) {
  if (motion !== 'rest' || sleeping || press || now < nextAction || !chatForm.hidden) return;
  nextAction = now + between(character.idleActionMs);
  if (Math.random() < 0.25) {
    window.pet.walk(Math.random() < 0.5 ? -1 : 1, 60 + Math.random() * 160);
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
    if (over && !press && motion === 'rest' && model.hitTest(cursor.x, cursor.y).includes('Head')) {
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
  if (motion === 'walk') walkPhase += dt * 9;
  if (!sleeping && motion === 'rest' && now - lastActivity > character.sleepAfterMs) {
    sleeping = true;
    bubble.classList.remove('visible');
    setExpression(null);
  }
  if (sleeping && Math.random() < dt * 0.55) burst('z', 1, 'sleep');
  chooseAction(now);
  updateSprings(dt);
  if (sleeping) model.focus(model.x, model.y);
  else model.focus(cursor.x, cursor.y);
}

let hitFrame = 0;
function afterRender() {
  if (!model) return;
  hitFrame += 1;
  if (hitFrame % 2 === 0) updatePetting(updateHit(), app.ticker.deltaMS / 500);
}

window.pet.onTick(({ cursor: nextCursor, window: position }) => {
  cursor = nextCursor;
  if (win) velocity = { x: position.x - win.x, y: position.y - win.y };
  win = position;
});

window.pet.onMotion(({ type, impact }) => {
  if (!model) return;
  if (type !== 'walk' && type !== 'walk-end') wake();
  if (type === 'drag') {
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
  wake();
  if (action.type === 'gesture') playGesture(action.index);
  else if (action.type === 'expression') setExpression(action.id, 5000);
  else if (action.type === 'walk') window.pet.walk(action.dir, 180);
});

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
  } else if (event.type === 'pointerup' && model) {
    wake();
    const onHead = model.hitTest(event.clientX, event.clientY).includes('Head');
    model.motion('TapBody', undefined, MotionPriority.FORCE);
    setMood(onHead ? 'shy' : 'happy', 2000);
    burst('♥', 3);
    sayFrom('click', 1600);
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

function showChat(hasKey) {
  needsKey = !hasKey;
  chatForm.hidden = false;
  chatNote.hidden = !needsKey;
  chatNote.textContent = needsKey ? 'Paste your Anthropic API key. It is stored encrypted on this Mac.' : '';
  chatInput.type = needsKey ? 'password' : 'text';
  chatInput.placeholder = needsKey ? 'API key' : `Message ${character.name}...`;
  chatInput.value = '';
  chatSend.textContent = needsKey ? 'Save' : 'Send';
  chatInput.focus();
  wake();
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
  model.internalModel.on('afterMotionUpdate', applyParameters);
  app.ticker.add(update, null, PIXI.UPDATE_PRIORITY.HIGH);
  app.ticker.add(afterRender, null, PIXI.UPDATE_PRIORITY.UTILITY);

  sayFrom('greet');
  nextLine = performance.now() + between(character.idleLineIntervalMs);
})();
