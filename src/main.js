const { app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Chat } = require('./chat');

const CHARACTERS_DIR = path.join(__dirname, '..', 'characters');
const LIVE2D_DIR = path.join(__dirname, '..', 'vendor', 'live2d');
const GRAVITY = 0.9;
const BOUNCE = 0.32;
const AIR_DRAG = 0.992;
const FLOOR_FRICTION = 0.8;
const MAX_THROW_SPEED = 45;
const WALK_SPEED = 1.15;
const SCALES = { Small: 0.75, Medium: 1, Large: 1.3 };
const CONTENT_TYPES = { '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' };
const MAX_CHAT_LENGTH = 2000;

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
let interactive = false;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const keyPath = () => path.join(app.getPath('userData'), 'api-key.bin');

function readApiKey() {
  try {
    return safeStorage.decryptString(fs.readFileSync(keyPath()));
  } catch {
    return null;
  }
}

const hasCredentials = () =>
  fs.existsSync(keyPath()) || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const chat = new Chat(() => (fs.existsSync(keyPath()) ? readApiKey() : null));

function openChat() {
  if (!win) return;
  win.show();
  app.focus({ steal: true });
  win.focus();
  send('pet:chat-open', { hasKey: hasCredentials() });
}

function removeApiKey() {
  fs.rmSync(keyPath(), { force: true });
  chat.clear();
  send('pet:chat-open', { hasKey: hasCredentials() });
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
  pos.x += walk.dir * WALK_SPEED;
  walk.remaining -= WALK_SPEED;
  if (walk.remaining <= 0 || pos.x <= area.x || pos.x >= maxX) {
    pos.x = Math.min(Math.max(pos.x, area.x), maxX);
    walk = null;
    send('pet:motion', { type: 'walk-end' });
    savePosition();
  }
  applyPosition();
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
  } else if (walk) {
    stepWalk();
  }

  send('pet:tick', {
    cursor: { x: cursor.x - pos.x, y: cursor.y - pos.y },
    window: { x: pos.x, y: pos.y },
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
  chat.clear();
  character = loadCharacter(id);
  saveSettings({ characterId: id });
  drag = null;
  motion = null;
  walk = null;
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
    { label: `Chat with ${character.name}`, click: openChat },
    { label: 'Clear Chat', click: () => chat.clear() },
    { label: 'Remove API Key', enabled: fs.existsSync(keyPath()), click: removeApiKey },
    { type: 'separator' },
    { label: 'Random Gesture', click: () => send('pet:action', { type: 'gesture' }) },
    { label: 'Gestures', submenu: gestures },
    { label: 'Expressions', submenu: expressions },
    { label: 'Walk Left', click: () => send('pet:action', { type: 'walk', dir: -1 }) },
    { label: 'Walk Right', click: () => send('pet:action', { type: 'walk', dir: 1 }) },
  ];
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
      { label: 'Actions', submenu: actionItems() },
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
      { label: 'Show / Hide', click: () => win && (win.isVisible() ? win.hide() : win.show()) },
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

ipcMain.handle('pet:save-key', (_event, key) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { ok: false, error: 'empty' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'storage' };
  fs.mkdirSync(path.dirname(keyPath()), { recursive: true });
  fs.writeFileSync(keyPath(), safeStorage.encryptString(trimmed), { mode: 0o600 });
  refreshTray();
  return { ok: true };
});

ipcMain.handle('pet:chat-send', (_event, text) => {
  const message = typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LENGTH) : '';
  if (!message) return { ok: false, error: 'empty' };
  return chat.send(character.persona, message, (delta) => send('pet:chat-delta', delta));
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
  if (drag || motion || settings.gravity === false) return;
  walk = null;
  startFall((Math.random() - 0.5) * 4, -13);
});

ipcMain.on('pet:walk', (_event, { dir, distance }) => {
  if (drag || motion || walk) return;
  walk = { dir: dir < 0 ? -1 : 1, remaining: Math.min(Math.max(distance, 0), 400) };
  send('pet:motion', { type: 'walk', dir: walk.dir });
});

ipcMain.on('pet:show-menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
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
    refreshTray();
    setInterval(tick, 16);
  });

  // The pet lives in the tray, so closing its window must not end the app.
  app.on('window-all-closed', () => {});
}
