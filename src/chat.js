const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { promisify } = require('util');
const { default: Anthropic } = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 4000;
const PLAN_TIMEOUT_MS = 120000;
const PLAN_HISTORY_TURNS = 20;
const run = promisify(execFile);

function errorCode(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'auth';
  if (error instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (error instanceof Anthropic.RateLimitError) return 'rate';
  if (error instanceof Anthropic.APIConnectionError) return 'connection';
  if (error instanceof Anthropic.APIError && error.status === 402) return 'billing';
  return 'other';
}

function planResultCode(result) {
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

class Chat {
  constructor(getApiKey, workDir) {
    this.getApiKey = getApiKey;
    this.workDir = workDir;
    this.history = [];
    this.planHistory = [];
    this.stream = null;
    this.child = null;
    this.binary = null;
  }

  clear() {
    this.stream?.abort();
    this.child?.kill();
    this.history = [];
    this.planHistory = [];
  }

  async planAvailable() {
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

  send(system, text, onText) {
    if (this.stream || this.child) return { ok: false, error: 'busy' };
    const apiKey = this.getApiKey();
    if (apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return this.sendWithApi(apiKey, system, text, onText);
    }
    return this.sendWithPlan(system, text, onText);
  }

  planPrompt(text) {
    if (!this.planHistory.length) return text;
    const past = this.planHistory.map((turn) => `User: ${turn.user}\nYou: ${turn.reply}`).join('\n\n');
    return `Our conversation so far:\n\n${past}\n\nReply to the user's new message:\n\n${text}`;
  }

  async sendWithPlan(system, text, onText) {
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
      let cancelled = false;
      let settled = false;
      const timer = setTimeout(() => {
        cancelled = true;
        child.kill();
      }, PLAN_TIMEOUT_MS);

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
      child.stdin.end(this.planPrompt(text));

      child.on('error', () => finish({ ok: false, error: 'login' }));
      child.on('close', (code, signal) => {
        if (signal && !cancelled) return finish({ ok: false, error: 'cancelled' });
        if (cancelled) return finish({ ok: false, error: 'other' });
        if (!result) return finish({ ok: false, error: code === 0 ? 'other' : 'connection' });
        if (result.is_error || result.stop_reason === 'refusal') {
          return finish({ ok: false, error: planResultCode(result) });
        }
        this.planHistory = [...this.planHistory, { user: text, reply }].slice(-PLAN_HISTORY_TURNS);
        return finish({ ok: true });
      });
    });
  }

  async sendWithApi(apiKey, system, text, onText) {
    const client = new Anthropic(apiKey ? { apiKey } : {});
    const messages = [...this.history, { role: 'user', content: text }];

    try {
      this.stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system,
        messages,
      });
      this.stream.on('text', onText);
      const message = await this.stream.finalMessage();
      if (message.stop_reason === 'refusal') return { ok: false, error: 'refused' };
      // The full content is kept because thinking blocks must be replayed unchanged.
      this.history = [...messages, { role: 'assistant', content: message.content }];
      return { ok: true };
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) return { ok: false, error: 'cancelled' };
      console.warn('Chat request failed:', error.status ?? error.name);
      return { ok: false, error: errorCode(error) };
    } finally {
      this.stream = null;
    }
  }
}

module.exports = { Chat };
