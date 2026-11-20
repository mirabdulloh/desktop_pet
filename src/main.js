const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const CHARACTERS_DIR = path.join(__dirname, '..', 'characters');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let win = null;
let tray = null;

function listCharacterIds() {
  return fs
    .readdirSync(CHARACTERS_DIR)
    .filter((name) => fs.existsSync(path.join(CHARACTERS_DIR, name, 'character.json')));
}

function loadCharacter(id) {
  const dir = path.join(CHARACTERS_DIR, id);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf-8'));
  return { ...config, id, dir };
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(partial) {
  const settings = { ...loadSettings(), ...partial };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

function createWindow(character) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const settings = loadSettings();

  const newWin = new BrowserWindow({
    width: character.stageWidth,
    height: character.stageHeight,
    x: settings.x ?? screenWidth - character.stageWidth - 60,
    y: settings.y ?? screenHeight - character.stageHeight - 60,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  newWin.setAlwaysOnTop(true, 'floating');
  newWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  newWin.setIgnoreMouseEvents(true, { forward: true });
  newWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  newWin.webContents.on('did-finish-load', () => {
    newWin.webContents.send('pet:load-character', character);
  });

  newWin.on('moved', () => {
    const [x, y] = newWin.getPosition();
    saveSettings({ x, y });
  });

  return newWin;
}

function buildTrayMenu(currentId) {
  const characterItems = listCharacterIds().map((id) => {
    const config = loadCharacter(id);
    return {
      label: config.name || id,
      type: 'radio',
      checked: id === currentId,
      click: () => switchCharacter(id),
    };
  });

  return Menu.buildFromTemplate([
    { label: 'Desktop Pet', enabled: false },
    { type: 'separator' },
    ...characterItems,
    { type: 'separator' },
    {
      label: 'Hide',
      click: () => win && win.hide(),
    },
    {
      label: 'Show',
      click: () => win && win.show(),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function switchCharacter(id) {
  const character = loadCharacter(id);
  saveSettings({ characterId: id, x: undefined, y: undefined });

  if (win) {
    win.destroy();
  }
  win = createWindow(character);
  tray.setContextMenu(buildTrayMenu(id));
}

app.whenReady().then(() => {
  const settings = loadSettings();
  const availableIds = listCharacterIds();
  const startingId = availableIds.includes(settings.characterId)
    ? settings.characterId
    : 'marin-kitagawa';

  const character = loadCharacter(startingId);
  win = createWindow(character);

  tray = new Tray(path.join(__dirname, '..', 'build', 'tray.png'));
  tray.setToolTip('Desktop Pet');
  tray.setContextMenu(buildTrayMenu(startingId));
  tray.on('click', () => {
    if (win) win.isVisible() ? win.hide() : win.show();
  });
});

ipcMain.on('pet:set-ignore-mouse', (_event, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('pet:move-window-by', (_event, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('pet:quit', () => app.quit());

app.on('window-all-closed', () => {
  // Tray-resident app: don't quit just because the pet window closed.
});
