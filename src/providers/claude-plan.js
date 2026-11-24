const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { promisify } = require('util');

const TIMEOUT_MS = 120000;
const HISTORY_TURNS = 20;
const run = promisify(execFile);

function resultCode(result) {
  if (result.stop_reason === 'refusal') return 'refused';
  if (result.api_error_status === 401 || result.api_error_status === 403) return 'login';
  if (result.api_error_status === 429) return 'rate';
  return 'other';
}

// Apps opened from Finder don't inherit the terminal's PATH, so common install folders are checked too.
async function findClaude() {
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { stdout } = await run(shell, ['-lc', 'command -v claude'], { timeout: 5000 });
    const found = stdout.trim().split('\n').pop();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // Falls through to the known install locations.
  }
  const home = os.homedir();
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
  const nvm = fs.existsSync(nvmRoot) ? fs.readdirSync(nvmRoot).map((v) => path.join(nvmRoot, v, 'bin', 'claude')) : [];
  const candidates = [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...nvm];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Removing API credentials makes Claude Code use the signed-in subscription.
function planEnv(binary) {
  const env = { ...process.env, PATH: `${path.dirname(binary)}:${process.env.PATH || ''}` };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}

class ClaudePlanProvider {
  constructor(workDir) {
    this.workDir = workDir;
    this.history = [];
    this.child = null;
    this.binary = null;
  }

  clear() {
    this.child?.kill();
    this.history = [];
  }

  async isAvailable() {
    this.binary = this.binary || (await findClaude());
    if (!this.binary) return false;
    try {
      const { stdout } = await run(this.binary, ['auth', 'status'], { env: planEnv(this.binary), timeout: 8000 });
      const status = JSON.parse(stdout);
      return status.loggedIn === true && status.authMethod === 'claude.ai';
    } catch {
      return false;
    }
  }

  buildPrompt(context, text) {
    const parts = context ? [context] : [];
    if (this.history.length) {
      const past = this.history.map((turn) => `User: ${turn.user}\nYou: ${turn.reply}`).join('\n\n');
      parts.push(`Our conversation so far:\n\n${past}`);
    }
    parts.push(parts.length ? `Reply to the user's new message:\n\n${text}` : text);
    return parts.join('\n\n');
  }

  async send({ system, context, text, onText }) {
    this.binary = this.binary || (await findClaude());
    if (!this.binary) return { ok: false, error: 'login' };
    fs.mkdirSync(this.workDir, { recursive: true });

    // No tools, MCP servers or settings: the chat can only produce text.
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--effort', 'low',
      '--system-prompt', system,
    ];

    return new Promise((resolve) => {
      const child = spawn(this.binary, args, { cwd: this.workDir, env: planEnv(this.binary) });
      this.child = child;
      let reply = '';
      let result = null;
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, TIMEOUT_MS);

      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = null;
        resolve(outcome);
      };

      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === 'result') result = event;
        const delta = event.type === 'stream_event' && !event.parent_tool_use_id ? event.event?.delta : null;
        if (delta?.type === 'text_delta') {
          reply += delta.text;
          onText(delta.text);
        }
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.stdin.end(this.buildPrompt(context, text));

      child.on('error', () => finish({ ok: false, error: 'login' }));
      child.on('close', (code, signal) => {
        if (timedOut) return finish({ ok: false, error: 'other' });
        if (signal) return finish({ ok: false, error: 'cancelled' });
        if (!result) return finish({ ok: false, error: code === 0 ? 'other' : 'connection' });
        if (result.is_error || result.stop_reason === 'refusal') return finish({ ok: false, error: resultCode(result) });
        // Commands are removed so old actions are never replayed as if they were requested again.
        const spoken = reply.replace(/<<[^\n]*?>>/g, '').trim();
        this.history = [...this.history, { user: text, reply: spoken }].slice(-HISTORY_TURNS);
        return finish({ ok: true });
      });
    });
  }
}

module.exports = { ClaudePlanProvider };
