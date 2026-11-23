const { app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const CHARACTERS_DIR = path.join(__dirname, '..', 'characters');
const GRAVITY = 0.9;
const BOUNCE = 0.32;
const AIR_DRAG = 0.992;
const FLOOR_FRICTION = 0.8;
const MAX_THROW_SPEED = 45;
const SCALES = { Small: 0.75, Medium: 1, Large: 1.3 };

let win = null;
let tray = null;
let character = null;
let settings = {};
let pos = { x: 0, y: 0 };
let drag = null;
let motion = null;
let interactive = false;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const modelPath = (id) => path.join(app.getPath('userData'), 'models', `${id}.vrm`);

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
      saveSettings({ x: Math.round(pos.x), y: Math.round(pos.y) });
    }
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
  }

  send('pet:tick', {
    cursor: { x: cursor.x - pos.x, y: cursor.y - pos.y },
    window: { x: pos.x, y: pos.y },
  });
}

function startFall(vx = 0, vy = 0) {
  if (settings.gravity === false) {
    saveSettings({ x: Math.round(pos.x), y: Math.round(pos.y) });
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
  win.on('closed', () => {
    win = null;
  });
}

async function importModel() {
  app.focus({ steal: true });
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Choose a VRM model for ${character.name}`,
    filters: [{ name: 'VRM model', extensions: ['vrm'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;

  const target = modelPath(character.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(filePaths[0], target);
  send('pet:model-changed');
}

function switchCharacter(id) {
  character = loadCharacter(id);
  saveSettings({ characterId: id });
  drag = null;
  motion = null;
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
      { label: 'Import VRM Model…', click: importModel },
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
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

ipcMain.handle('pet:get-character', () => character);

ipcMain.handle('pet:read-model', () => {
  const file = modelPath(character.id);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
});

ipcMain.handle('pet:import-model', importModel);

ipcMain.on('pet:set-interactive', (_event, value) => {
  if (!win || value === interactive) return;
  interactive = value;
  win.setIgnoreMouseEvents(!value);
});

ipcMain.on('pet:drag-start', () => {
  const cursor = screen.getCursorScreenPoint();
  motion = null;
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
  startFall((Math.random() - 0.5) * 4, -13);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (app.dock) app.dock.hide();
    settings = loadSettings();
    const ids = listCharacterIds();
    character = loadCharacter(ids.includes(settings.characterId) ? settings.characterId : 'marin-kitagawa');
    createWindow();

    tray = new Tray(path.join(__dirname, '..', 'build', 'tray.png'));
    tray.setToolTip('Desktop Pet');
    refreshTray();
    setInterval(tick, 16);
  });

  // The pet lives in the tray, so closing its window must not end the app.
  app.on('window-all-closed', () => {});
}
