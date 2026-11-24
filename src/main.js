const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  protocol,
  dialog,
  safeStorage,
  globalShortcut,
} = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Chat } = require('./chat');
const { ACTION_PROMPT, createActionFilter, parseAction, runAction } = require('./actions');
const { MEMORY_PROMPT, Memory } = require('./memory');

const CHARACTERS_DIR = path.join(__dirname, '..', 'characters');
const LIVE2D_DIR = path.join(__dirname, '..', 'vendor', 'live2d');
const GRAVITY = 0.9;
const BOUNCE = 0.32;
const AIR_DRAG = 0.992;
const FLOOR_FRICTION = 0.8;
const MAX_THROW_SPEED = 45;
const GAITS = {
  walk: { crouch: 7, air: 18, land: 9, distance: 30 },
  run: { crouch: 2, air: 10, land: 2, distance: 44 },
};
const MAX_WALK_DISTANCE = 900;
const RISE_PIXELS_PER_FRAME = 7;
const SCALES = { Small: 0.75, Medium: 1, Large: 1.3 };
const CONTENT_TYPES = { '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' };
const MAX_CHAT_LENGTH = 2000;
const RECALL_TIMEOUT_MS = 2500;
const KEYS = {
  goLeft: 'Control+Alt+Left',
  goRight: 'Control+Alt+Right',
  runLeft: 'Control+Alt+Shift+Left',
  runRight: 'Control+Alt+Shift+Right',
  top: 'Control+Alt+Up',
  down: 'Control+Alt+Down',
  sleep: 'Control+Alt+S',
  jump: 'Control+Alt+J',
  gesture: 'Control+Alt+G',
  chat: 'Control+Alt+C',
  hide: 'Control+Alt+H',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'pet-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let tray = null;
let character = null;
let settings = {};
let pos = { x: 0, y: 0 };
let drag = null;
let motion = null;
let walk = null;
let rise = null;
let interactive = false;
let unavailableKeys = [];
let memoryWindow = null;
let chatSession = crypto.randomUUID();
const memory = new Memory();

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const keyPath = () => path.join(app.getPath('userData'), 'api-key.bin');
const mongoPath = () => path.join(app.getPath('userData'), 'mongo-uri.bin');

function readMongoUri() {
  try {
    return safeStorage.decryptString(fs.readFileSync(mongoPath()));
  } catch {
    return null;
  }
}

function openMemoryWindow() {
  if (memoryWindow) {
    app.focus({ steal: true });
    memoryWindow.show();
    memoryWindow.focus();
    return;
  }
  memoryWindow = new BrowserWindow({
    width: 520,
    height: 560,
    minWidth: 400,
    minHeight: 380,
    title: "Haru's Memory",
    webPreferences: {
      preload: path.join(__dirname, 'memory-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  memoryWindow.setMenuBarVisibility(false);
  memoryWindow.loadFile(path.join(__dirname, 'memory-window', 'index.html'));
  memoryWindow.on('closed', () => {
    memoryWindow = null;
  });
  app.focus({ steal: true });
}

function clearChat() {
  chat.clear();
  chatSession = crypto.randomUUID();
}

function handleMemoryIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!memoryWindow || event.sender !== memoryWindow.webContents) throw new Error('Not allowed');
    return handler(...args);
  });
}

const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

function readApiKey() {
  try {
    return safeStorage.decryptString(fs.readFileSync(keyPath()));
  } catch {
    return null;
  }
}

const chat = new Chat(
  () => (fs.existsSync(keyPath()) ? readApiKey() : null),
  path.join(app.getPath('temp'), 'desktop-pet-chat'),
);

async function hasCredentials() {
  if (fs.existsSync(keyPath()) || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  return chat.planAvailable();
}

async function openChat() {
  if (!win) return;
  win.show();
  app.focus({ steal: true });
  win.focus();
  send('pet:chat-open', { hasKey: await hasCredentials() });
}

async function removeApiKey() {
  fs.rmSync(keyPath(), { force: true });
  chat.clear();
  refreshTray();
  send('pet:chat-open', { hasKey: await hasCredentials() });
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(partial) {
  settings = { ...settings, ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function listCharacterIds() {
  return fs
    .readdirSync(CHARACTERS_DIR)
    .filter((name) => fs.existsSync(path.join(CHARACTERS_DIR, name, 'character.json')));
}

function loadCharacter(id) {
  const file = path.join(CHARACTERS_DIR, id, 'character.json');
  return { ...JSON.parse(fs.readFileSync(file, 'utf-8')), id };
}

function windowSize() {
  const scale = settings.scale || 1;
  return {
    width: Math.round(character.stageWidth * scale),
    height: Math.round(character.stageHeight * scale),
  };
}

function workArea() {
  const { width, height } = windowSize();
  const center = { x: Math.round(pos.x + width / 2), y: Math.round(pos.y + height / 2) };
  return screen.getDisplayNearestPoint(center).workArea;
}

function floorY() {
  const area = workArea();
  return area.y + area.height - windowSize().height;
}

function applyPosition() {
  const { width, height } = windowSize();
  win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width, height });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function savePosition() {
  saveSettings({ x: Math.round(pos.x), y: Math.round(pos.y) });
}

function stepPhysics() {
  const area = workArea();
  const { width } = windowSize();
  const floor = floorY();

  motion.vy += GRAVITY;
  motion.vx *= AIR_DRAG;
  pos.x += motion.vx;
  pos.y += motion.vy;

  if (pos.y < area.y) {
    pos.y = area.y;
    motion.vy = Math.abs(motion.vy) * 0.3;
  }

  if (pos.x < area.x || pos.x > area.x + area.width - width) {
    pos.x = Math.min(Math.max(pos.x, area.x), area.x + area.width - width);
    motion.vx *= -0.5;
  }

  if (pos.y >= floor) {
    const impact = motion.vy;
    pos.y = floor;
    motion.vx *= FLOOR_FRICTION;
    motion.vy = impact > 5 ? -impact * BOUNCE : 0;
    if (impact > 5) send('pet:motion', { type: 'land', impact });
    if (motion.vy === 0 && Math.abs(motion.vx) < 0.4) {
      motion = null;
      send('pet:motion', { type: 'rest' });
      savePosition();
    }
  }
  applyPosition();
}

function stepWalk() {
  const area = workArea();
  const maxX = area.x + area.width - windowSize().width;
  const gait = GAITS[walk.gait];
  const hopFrames = gait.crouch + gait.air + gait.land;
  const inAir = walk.frame >= gait.crouch && walk.frame < gait.crouch + gait.air;
  if (inAir) {
    const step = gait.distance / gait.air;
    pos.x = Math.min(Math.max(pos.x + walk.dir * step, area.x), maxX);
    walk.remaining -= step;
  }
  walk.frame += 1;
  if (walk.frame >= hopFrames) {
    walk.frame = 0;
    if (walk.remaining <= 0 || pos.x <= area.x || pos.x >= maxX) {
      walk = null;
      send('pet:motion', { type: 'walk-end' });
      savePosition();
    }
  }
  applyPosition();
}

function hopState() {
  if (!walk) return null;
  const { frame, dir } = walk;
  const gait = GAITS[walk.gait];
  const run = walk.gait === 'run';
  if (frame < gait.crouch) return { stage: 'crouch', t: frame / gait.crouch, dir, run };
  if (frame < gait.crouch + gait.air) return { stage: 'air', t: (frame - gait.crouch) / gait.air, dir, run };
  return { stage: 'land', t: (frame - gait.crouch - gait.air) / gait.land, dir, run };
}

function stepRise() {
  rise.frame += 1;
  const t = Math.min(rise.frame / rise.frames, 1);
  const eased = t * t * (3 - 2 * t);
  pos.y = rise.from + (rise.to - rise.from) * eased;
  applyPosition();
  if (t >= 1) {
    rise = null;
    send('pet:motion', { type: 'rest' });
    savePosition();
  }
}

function goToTop() {
  if (drag || motion || rise) return;
  walk = null;
  const to = workArea().y;
  if (pos.y <= to) return;
  rise = { from: pos.y, to, frame: 0, frames: Math.max(30, Math.round((pos.y - to) / RISE_PIXELS_PER_FRAME)) };
  send('pet:motion', { type: 'rise' });
}

function comeDown() {
  if (drag || motion) return;
  walk = null;
  rise = null;
  motion = { vx: 0, vy: 0 };
  send('pet:motion', { type: 'fall' });
}

function tick() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const cursor = screen.getCursorScreenPoint();

  if (drag) {
    pos.x = cursor.x - drag.offsetX;
    pos.y = cursor.y - drag.offsetY;
    drag.samples.push({ x: pos.x, y: pos.y, t: Date.now() });
    if (drag.samples.length > 6) drag.samples.shift();
    applyPosition();
  } else if (motion) {
    stepPhysics();
  } else if (rise) {
    stepRise();
  } else if (walk) {
    stepWalk();
  }

  send('pet:tick', {
    cursor: { x: cursor.x - pos.x, y: cursor.y - pos.y },
    window: { x: pos.x, y: pos.y },
    hop: hopState(),
  });
}

function startFall(vx = 0, vy = 0) {
  if (settings.gravity === false) {
    savePosition();
    send('pet:motion', { type: 'rest' });
    return;
  }
  motion = { vx, vy };
  send('pet:motion', { type: 'fall' });
}

function createWindow() {
  const { width, height } = windowSize();
  const primary = screen.getPrimaryDisplay().workArea;
  pos = {
    x: settings.x ?? primary.x + primary.width - width - 40,
    y: settings.y ?? primary.y + primary.height - height,
  };
  const area = workArea();
  pos.x = Math.min(Math.max(pos.x, area.x), area.x + area.width - width);
  pos.y = Math.min(Math.max(pos.y, area.y), area.y + area.height - height);

  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width,
    height,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  interactive = false;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (settings.gravity !== false && pos.y < floorY()) startFall();
  });
  win.on('closed', () => {
    win = null;
  });
}

function switchCharacter(id) {
  clearChat();
  character = loadCharacter(id);
  saveSettings({ characterId: id });
  drag = null;
  motion = null;
  walk = null;
  rise = null;
  if (win) win.destroy();
  createWindow();
  refreshTray();
}

function setScale(scale) {
  saveSettings({ scale });
  const { height } = windowSize();
  pos.y = Math.min(pos.y, workArea().y + workArea().height - height);
  applyPosition();
  refreshTray();
}

function actionItems() {
  const gestures = Array.from({ length: character.gestureCount }, (_, index) => ({
    label: `Gesture ${index + 1}`,
    click: () => send('pet:action', { type: 'gesture', index }),
  }));
  const expressions = Object.entries(character.expressions).map(([id, label]) => ({
    label,
    click: () => send('pet:action', { type: 'expression', id }),
  }));
  return [
    { label: `Chat with ${character.name}`, accelerator: KEYS.chat, registerAccelerator: false, click: openChat },
    { label: 'Clear Chat', click: clearChat },
    { label: 'Memory...', click: openMemoryWindow },
    { label: 'Remove API Key', enabled: fs.existsSync(keyPath()), click: removeApiKey },
    { type: 'separator' },
    {
      label: 'Random Gesture',
      accelerator: KEYS.gesture,
      registerAccelerator: false,
      click: () => send('pet:action', { type: 'gesture' }),
    },
    { label: 'Gestures', submenu: gestures },
    { label: 'Expressions', submenu: expressions },
  ];
}

function movementItems() {
  const action = (label, payload, accelerator) => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send('pet:action', payload),
  });
  return [
    action('Go Left', { type: 'walk', dir: -1 }, KEYS.goLeft),
    action('Go Right', { type: 'walk', dir: 1 }, KEYS.goRight),
    action('Run Left', { type: 'walk', dir: -1, run: true }, KEYS.runLeft),
    action('Run Right', { type: 'walk', dir: 1, run: true }, KEYS.runRight),
    action('Go to Top', { type: 'top' }, KEYS.top),
    action('Come Down', { type: 'down' }, KEYS.down),
    action('Jump', { type: 'jump' }, KEYS.jump),
    { type: 'separator' },
    action('Sleep / Wake Up', { type: 'toggle-sleep' }, KEYS.sleep),
    { type: 'separator' },
  ];
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

function registerShortcuts() {
  const act = (payload) => () => {
    if (win && !win.isVisible()) win.showInactive();
    send('pet:action', payload);
  };
  const bindings = [
    [KEYS.goLeft, act({ type: 'walk', dir: -1 })],
    [KEYS.goRight, act({ type: 'walk', dir: 1 })],
    [KEYS.runLeft, act({ type: 'walk', dir: -1, run: true })],
    [KEYS.runRight, act({ type: 'walk', dir: 1, run: true })],
    [KEYS.top, act({ type: 'top' })],
    [KEYS.down, act({ type: 'down' })],
    [KEYS.sleep, act({ type: 'toggle-sleep' })],
    [KEYS.jump, act({ type: 'jump' })],
    [KEYS.gesture, act({ type: 'gesture' })],
    [KEYS.chat, openChat],
    [KEYS.hide, toggleVisible],
  ];
  unavailableKeys = bindings.filter(([key, handler]) => !globalShortcut.register(key, handler)).map(([key]) => key);
}

function refreshTray() {
  const characters = listCharacterIds().map((id) => ({
    label: loadCharacter(id).name || id,
    type: 'radio',
    checked: id === character.id,
    click: () => switchCharacter(id),
  }));
  const sizes = Object.entries(SCALES).map(([label, scale]) => ({
    label,
    type: 'radio',
    checked: (settings.scale || 1) === scale,
    click: () => setScale(scale),
  }));

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Desktop Pet', enabled: false },
      { type: 'separator' },
      ...characters,
      { type: 'separator' },
      { label: 'Actions', submenu: [...movementItems(), ...actionItems()] },
      { label: 'Size', submenu: sizes },
      {
        label: 'Gravity',
        type: 'checkbox',
        checked: settings.gravity !== false,
        click: (item) => {
          saveSettings({ gravity: item.checked });
          if (item.checked) startFall();
        },
      },
      { label: 'Show / Hide', accelerator: KEYS.hide, registerAccelerator: false, click: toggleVisible },
      ...(unavailableKeys.length
        ? [{ label: `Shortcuts in use by another app: ${unavailableKeys.length}`, enabled: false }]
        : []),
      { type: 'separator' },
      { label: 'This content uses sample data owned and copyrighted by Live2D Inc.', enabled: false },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function serveAsset(request) {
  const url = new URL(request.url);
  const target = path.resolve(LIVE2D_DIR, url.hostname, `.${decodeURIComponent(url.pathname)}`);
  if (!target.startsWith(LIVE2D_DIR + path.sep) || !fs.existsSync(target)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(fs.readFileSync(target), {
    headers: {
      'content-type': CONTENT_TYPES[path.extname(target)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    },
  });
}

ipcMain.handle('pet:get-character', () => character);

ipcMain.handle('pet:chat-status', () => hasCredentials());

ipcMain.on('pet:focus', () => {
  if (!win) return;
  app.focus({ steal: true });
  win.focus();
});

ipcMain.handle('pet:save-key', (_event, key) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { ok: false, error: 'empty' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'storage' };
  fs.mkdirSync(path.dirname(keyPath()), { recursive: true });
  fs.writeFileSync(keyPath(), safeStorage.encryptString(trimmed), { mode: 0o600 });
  refreshTray();
  return { ok: true };
});

ipcMain.handle('pet:chat-send', async (_event, text) => {
  const message = typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LENGTH) : '';
  if (!message) return { ok: false, error: 'empty' };
  const session = chatSession;
  const context = await withTimeout(memory.recall(message, session).catch(() => ''), RECALL_TIMEOUT_MS, '');
  const filter = createActionFilter((delta) => send('pet:chat-delta', delta));
  const system = character.persona + ACTION_PROMPT + MEMORY_PROMPT;
  const result = await chat.send(system, context, message, filter.push);
  if (!result.ok) return result;

  const raw = filter.raw();
  const spoken = raw.replace(/<<[^\n]*?>>/g, '').replace(/^\[\w+\]\s*/, '').trim();
  // Saving runs in the background so a slow database never delays her reply.
  memory
    .applyCommands(raw)
    .then(() => memory.saveExchange(session, message, spoken))
    .catch((error) => console.warn('Memory save failed:', error.name));

  const action = parseAction(raw);
  return action ? { ...result, action: await runAction(action) } : result;
});

handleMemoryIpc('memory:status', () => memory.status());
handleMemoryIpc('memory:list', () => memory.list());
handleMemoryIpc('memory:remove', (id) => (typeof id === 'string' ? memory.forget(id) : false));

handleMemoryIpc('memory:connect', async (uri) => {
  const value = typeof uri === 'string' ? uri.trim() : '';
  if (!/^mongodb(\+srv)?:\/\//.test(value)) return { ok: false, error: 'That connection string is not valid.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Secure storage is unavailable on this Mac.' };
  const result = await memory.connect(value);
  if (result.ok) fs.writeFileSync(mongoPath(), safeStorage.encryptString(value), { mode: 0o600 });
  return result;
});

handleMemoryIpc('memory:disconnect', async () => {
  await memory.disconnect();
  fs.rmSync(mongoPath(), { force: true });
});

handleMemoryIpc('memory:clear', async () => {
  const { response } = await dialog.showMessageBox(memoryWindow, {
    type: 'warning',
    buttons: ['Delete Everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: "Delete all of Haru's memories and saved conversations?",
    detail: 'This permanently removes them from your Atlas database and cannot be undone.',
  });
  if (response === 0) await memory.clearAll();
});

ipcMain.on('pet:set-interactive', (_event, value) => {
  if (!win || value === interactive) return;
  interactive = value;
  win.setIgnoreMouseEvents(!value);
});

ipcMain.on('pet:drag-start', () => {
  const cursor = screen.getCursorScreenPoint();
  motion = null;
  walk = null;
  rise = null;
  drag = { offsetX: cursor.x - pos.x, offsetY: cursor.y - pos.y, samples: [] };
  send('pet:motion', { type: 'drag' });
});

ipcMain.on('pet:drag-end', () => {
  if (!drag) return;
  const { samples } = drag;
  drag = null;
  let vx = 0;
  let vy = 0;
  if (samples.length > 1) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const frames = Math.max((last.t - first.t) / 16, 1);
    vx = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, (last.x - first.x) / frames));
    vy = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, (last.y - first.y) / frames));
  }
  startFall(vx, vy);
});

ipcMain.on('pet:jump', () => {
  if (drag || motion || rise || settings.gravity === false) return;
  walk = null;
  startFall((Math.random() - 0.5) * 4, -13);
});

ipcMain.on('pet:walk', (_event, { dir, distance, gait, replace }) => {
  if (drag || motion || rise || (walk && !replace)) return;
  walk = {
    dir: dir < 0 ? -1 : 1,
    remaining: Math.min(Math.max(distance, 0), MAX_WALK_DISTANCE),
    frame: 0,
    gait: gait === 'run' ? 'run' : 'walk',
  };
  send('pet:motion', { type: 'walk', dir: walk.dir });
});

ipcMain.on('pet:walk-stop', () => {
  if (!walk) return;
  walk = null;
  savePosition();
});

ipcMain.on('pet:go-top', goToTop);
ipcMain.on('pet:come-down', comeDown);

ipcMain.on('pet:show-menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
    ...movementItems(),
    ...actionItems(),
    { type: 'separator' },
    { label: 'Hide', click: () => win && win.hide() },
    { label: 'Quit', click: () => app.quit() },
  ]).popup({ window: win });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(LIVE2D_DIR, 'live2dcubismcore.min.js'))) {
      dialog.showErrorBox('Live2D files missing', 'Run "npm run setup" once, then start the app again.');
      app.quit();
      return;
    }
    if (app.dock) app.dock.hide();
    protocol.handle('pet-asset', serveAsset);
    settings = loadSettings();
    const ids = listCharacterIds();
    character = loadCharacter(ids.includes(settings.characterId) ? settings.characterId : 'haru');
    createWindow();

    tray = new Tray(path.join(__dirname, '..', 'build', 'tray.png'));
    tray.setToolTip('Desktop Pet');
    registerShortcuts();
    refreshTray();
    setInterval(tick, 16);

    const mongoUri = readMongoUri();
    if (mongoUri) {
      memory.connect(mongoUri);
    } else if (!settings.memorySetupShown) {
      saveSettings({ memorySetupShown: true });
      openMemoryWindow();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    memory.disconnect();
  });

  // The pet lives in the tray, so closing its window must not end the app.
  app.on('window-all-closed', () => {});
}
