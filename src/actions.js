const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog, shell } = require('electron');

const MAX_VALUE_LENGTH = 200;
const APP_FOLDERS = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
const YOUTUBE_PREFIXES = ['https://www.youtube.com/', 'https://youtube.com/', 'https://m.youtube.com/'];
const GOOGLE_PREFIXES = ['https://www.google.com/search'];
const CHROMIUM_BROWSERS = {
  'com.google.chrome': 'Google Chrome',
  'com.brave.browser': 'Brave Browser',
  'com.microsoft.edgemac': 'Microsoft Edge',
};
const MATCHES_HANDLER = `
on matches(pageUrl, prefixes)
  repeat with prefix in prefixes
    if (pageUrl as text) starts with (prefix as text) then return true
  end repeat
  return false
end matches`;

const ACTION_PROMPT = `

You can do these things on the user's computer, only when their latest message asks for it. Add exactly one command at the very end of your reply:
<<action {"type":"youtube","value":"search words"}>> opens YouTube search results. Use an empty value for the YouTube home page.
<<action {"type":"google","value":"search words"}>> opens Google search results.
<<action {"type":"website","value":"example.com"}>> opens a website.
<<action {"type":"app","value":"Calculator"}>> opens an installed app by name.
Say briefly what you are opening. You can't click, type, play a specific video, read pages, or see the result. Never add a command unless the user asked.`;

const chromiumScript = (name) => `
on run argv
  set targetUrl to item 1 of argv
  set prefixes to items 2 thru -1 of argv
  if not (application "${name}" is running) then return "none"
  tell application "${name}"
    repeat with w in windows
      if my matches(URL of active tab of w, prefixes) then
        set URL of active tab of w to targetUrl
        set index of w to 1
        activate
        return "reused"
      end if
    end repeat
    repeat with w in windows
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        if my matches(URL of t, prefixes) then
          set URL of t to targetUrl
          set active tab index of w to tabIndex
          set index of w to 1
          activate
          return "reused"
        end if
      end repeat
    end repeat
  end tell
  return "none"
end run
${MATCHES_HANDLER}`;

const SAFARI_SCRIPT = `
on run argv
  set targetUrl to item 1 of argv
  set prefixes to items 2 thru -1 of argv
  if not (application "Safari" is running) then return "none"
  tell application "Safari"
    repeat with w in windows
      try
        if my matches(URL of current tab of w, prefixes) then
          set URL of current tab of w to targetUrl
          set index of w to 1
          activate
          return "reused"
        end if
      end try
    end repeat
    repeat with w in windows
      try
        repeat with t in tabs of w
          if my matches(URL of t, prefixes) then
            set URL of t to targetUrl
            set current tab of w to t
            set index of w to 1
            activate
            return "reused"
          end if
        end repeat
      end try
    end repeat
  end tell
  return "none"
end run
${MATCHES_HANDLER}`;

function defaultBrowserId() {
  const plist = path.join(os.homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], (error, stdout) => {
      if (error) return resolve('com.apple.safari');
      try {
        const handler = (JSON.parse(stdout).LSHandlers || []).find((item) => item.LSHandlerURLScheme === 'https');
        return resolve((handler?.LSHandlerRoleAll || 'com.apple.safari').toLowerCase());
      } catch {
        return resolve('com.apple.safari');
      }
    });
  });
}

// URLs are passed as script arguments, so page text can never become AppleScript code.
async function reuseBrowserTab(url, prefixes) {
  const id = await defaultBrowserId();
  const script = id === 'com.apple.safari' ? SAFARI_SCRIPT : CHROMIUM_BROWSERS[id] && chromiumScript(CHROMIUM_BROWSERS[id]);
  if (!script) return false;
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script, url, ...prefixes], { timeout: 6000 }, (error, stdout) => {
      resolve(!error && stdout.trim() === 'reused');
    });
  });
}

async function openInBrowser(url, prefixes) {
  if (!(await reuseBrowserTab(url, prefixes))) await shell.openExternal(url);
}

function createActionFilter(emit) {
  let raw = '';
  let sent = '';
  return {
    push(delta) {
      raw += delta;
      const start = raw.indexOf('<<');
      let visible = start >= 0 ? raw.slice(0, start) : raw;
      if (start < 0 && visible.endsWith('<')) visible = visible.slice(0, -1);
      visible = visible.trimEnd();
      if (visible.length > sent.length) {
        emit(visible.slice(sent.length));
        sent = visible;
      }
    },
    raw: () => raw,
  };
}

function parseAction(reply) {
  const match = reply.match(/<<action\s+(\{[^\n]*?\})\s*>>/);
  if (!match) return null;
  try {
    const { type, value = '' } = JSON.parse(match[1]);
    if (!['youtube', 'google', 'website', 'app'].includes(type)) return null;
    if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) return null;
    return { type, value: value.trim() };
  } catch {
    return null;
  }
}

function safeWebsite(value) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
}

function findApp(name) {
  const wanted = `${name.replace(/\.app$/i, '').toLowerCase()}.app`;
  for (const folder of APP_FOLDERS) {
    if (!fs.existsSync(folder)) continue;
    const entry = fs.readdirSync(folder).find((item) => item.toLowerCase() === wanted);
    if (entry) return path.join(folder, entry);
  }
  return null;
}

// Cancel is the default button so pressing Enter in the chat box can't approve an action.
async function confirm(message) {
  app.focus({ steal: true });
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Open', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
  });
  return response === 0;
}

const openApp = (appPath) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/open', [appPath], (error) => (error ? reject(error) : resolve()));
  });

async function runAction(action) {
  try {
    if (action.type === 'youtube') {
      const query = encodeURIComponent(action.value);
      const url = query ? `https://www.youtube.com/results?search_query=${query}` : 'https://www.youtube.com/';
      await openInBrowser(url, YOUTUBE_PREFIXES);
    } else if (action.type === 'google') {
      await openInBrowser(`https://www.google.com/search?q=${encodeURIComponent(action.value)}`, GOOGLE_PREFIXES);
    } else if (action.type === 'website') {
      const url = safeWebsite(action.value);
      if (!url) return { ok: false, message: "I can only open secure https websites." };
      if (!(await confirm(`Open this website?\n\n${url.href}`))) return { ok: false, message: "Okay, I won't open it." };
      await shell.openExternal(url.href);
    } else {
      const appPath = findApp(action.value);
      if (!appPath) return { ok: false, message: `I couldn't find an app called ${action.value}.` };
      if (!(await confirm(`Open ${path.basename(appPath, '.app')}?`))) return { ok: false, message: "Okay, I won't open it." };
      await openApp(appPath);
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Sorry, I couldn't open that." };
  }
}

module.exports = { ACTION_PROMPT, createActionFilter, parseAction, reuseBrowserTab, runAction, safeWebsite };
