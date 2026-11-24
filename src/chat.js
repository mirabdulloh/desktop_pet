const { AnthropicApiProvider } = require('./providers/anthropic-api');
const { ClaudePlanProvider } = require('./providers/claude-plan');

// To add another AI, create a provider with send() and clear(), then choose it in activeProvider().
class Chat {
  constructor(getApiKey, workDir) {
    this.api = new AnthropicApiProvider(getApiKey);
    this.plan = new ClaudePlanProvider(workDir);
    this.busy = false;
  }

  activeProvider() {
    return this.api.isConfigured() ? this.api : this.plan;
  }

  planAvailable() {
    return this.plan.isAvailable();
  }

  clear() {
    this.api.clear();
    this.plan.clear();
  }

  // A one-off request on a fresh provider, so background work never enters the conversation.
  async complete(system, text) {
    const provider = this.api.isConfigured()
      ? new AnthropicApiProvider(this.api.getApiKey)
      : new ClaudePlanProvider(this.plan.workDir);
    let output = '';
    const result = await provider.send({ system, context: '', text, onText: (delta) => { output += delta; } });
    return result.ok ? { ok: true, text: output.trim() } : result;
  }

  async send(system, context, text, onText) {
    if (this.busy) return { ok: false, error: 'busy' };
    this.busy = true;
    try {
      return await this.activeProvider().send({ system, context, text, onText });
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Chat };
