const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog, net, shell } = require('electron');

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
<<action {"type":"play","value":"search words"}>> finds the top YouTube result and starts playing it. Use this whenever the user asks to play, press, start or put on a song or video. Choose specific search words, such as a well-known song and artist, when they ask for "the best" one. If they say "that", "this", "it" or "the first one" without naming anything, use an empty value: <<action {"type":"play","value":""}>> plays the top result of the YouTube page open right now. Never ask which song in that case.
<<action {"type":"google","value":"search words"}>> opens Google search results.
<<action {"type":"website","value":"example.com"}>> opens a website.
<<action {"type":"app","value":"Calculator"}>> opens an installed app by name.
For YouTube requests always use youtube or play, never website. These reuse the YouTube tab that is already open. Say briefly what you are doing. You can't pause, skip, click other buttons, type into pages, read pages, or see the result. Never add a command unless the user asked.`;

const chromiumScript = (name) => `
on run argv
  set targetUrl to item 1 of argv
  set prefixes to items 2 thru -1 of argv
  if not (application "${name}" is running) then return "none"
  tell application "${name}"
    repeat with w in windows
      try
        if my matches(URL of active tab of w, prefixes) then
          set URL of active tab of w to targetUrl
          set index of w to 1
          activate
          return "reused"
        end if
      end try
    end repeat
    repeat with w in windows
      try
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
      end try
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

const readChromiumTabScript = (name) => `
on run argv
  if not (application "${name}" is running) then return ""
  tell application "${name}"
    repeat with w in windows
      try
        if my matches(URL of active tab of w, argv) then return URL of active tab of w
      end try
    end repeat
    repeat with w in windows
      try
        repeat with t in tabs of w
          if my matches(URL of t, argv) then return URL of t
        end repeat
      end try
    end repeat
  end tell
  return ""
end run
${MATCHES_HANDLER}`;

const READ_SAFARI_TAB_SCRIPT = `
on run argv
  if not (application "Safari" is running) then return ""
  tell application "Safari"
    repeat with w in windows
      try
        if my matches(URL of current tab of w, argv) then return URL of current tab of w
      end try
    end repeat
    repeat with w in windows
      try
        repeat with t in tabs of w
          if my matches(URL of t, argv) then return URL of t
        end repeat
      end try
    end repeat
  end tell
  return ""
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
    // The long timeout leaves time to answer the macOS permission prompt.
    execFile('/usr/bin/osascript', ['-e', script, url, ...prefixes], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) console.warn('Tab reuse failed:', stderr.trim().slice(0, 160));
      resolve(!error && stdout.trim() === 'reused');
    });
  });
}

async function openInBrowser(url, prefixes) {
  if (!(await reuseBrowserTab(url, prefixes))) await shell.openExternal(url);
}

async function findTopVideo(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await net.fetch(url, {
    headers: { 'accept-language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const match = (await response.text()).match(/"videoRenderer":\{"videoId":"([\w-]{11})"/);
  return match ? match[1] : null;
}

async function readYouTubeTab() {
  const id = await defaultBrowserId();
  const script = id === 'com.apple.safari' ? READ_SAFARI_TAB_SCRIPT : CHROMIUM_BROWSERS[id] && readChromiumTabScript(CHROMIUM_BROWSERS[id]);
  if (!script) return null;
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script, ...YOUTUBE_PREFIXES], { timeout: 30000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

// With no song name, the open YouTube page decides what "play that" means.
async function resolveVideo(value) {
  if (value) return findTopVideo(value);
  const current = await readYouTubeTab();
  if (!current) return null;
  const url = new URL(current);
  const watched = url.searchParams.get('v');
  if (url.pathname === '/watch' && /^[\w-]{11}$/.test(watched || '')) return watched;
  const query = url.searchParams.get('search_query');
  return url.pathname === '/results' && query ? findTopVideo(query) : null;
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
    if (!['youtube', 'play', 'google', 'website', 'app'].includes(type)) return null;
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
    } else if (action.type === 'play') {
      let videoId = null;
      try {
        videoId = await resolveVideo(action.value);
      } catch {
        videoId = null;
      }
      if (!videoId && !action.value) {
        return { ok: false, message: 'Open a YouTube search or tell me the song name, and I will play it.' };
      }
      if (!videoId) {
        const results = `https://www.youtube.com/results?search_query=${encodeURIComponent(action.value)}`;
        await openInBrowser(results, YOUTUBE_PREFIXES);
        return { ok: false, message: "I couldn't start it, so I opened the search results." };
      }
      await openInBrowser(`https://www.youtube.com/watch?v=${videoId}&autoplay=1`, YOUTUBE_PREFIXES);
    } else if (action.type === 'google') {
      await openInBrowser(`https://www.google.com/search?q=${encodeURIComponent(action.value)}`, GOOGLE_PREFIXES);
    } else if (action.type === 'website') {
      const url = safeWebsite(action.value);
      if (!url) return { ok: false, message: "I can only open secure https websites." };
      if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
        await openInBrowser(url.href, YOUTUBE_PREFIXES);
        return { ok: true };
      }
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

module.exports = {
  ACTION_PROMPT,
  createActionFilter,
  findTopVideo,
  parseAction,
  resolveVideo,
  reuseBrowserTab,
  runAction,
  safeWebsite,
};
