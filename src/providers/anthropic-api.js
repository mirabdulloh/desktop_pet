const { default: Anthropic } = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 4000;

function errorCode(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'auth';
  if (error instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (error instanceof Anthropic.RateLimitError) return 'rate';
  if (error instanceof Anthropic.APIConnectionError) return 'connection';
  if (error instanceof Anthropic.APIError && error.status === 402) return 'billing';
  return 'other';
}

class AnthropicApiProvider {
  constructor(getApiKey) {
    this.getApiKey = getApiKey;
    this.history = [];
    this.stream = null;
  }

  isConfigured() {
    return Boolean(this.getApiKey() || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  clear() {
    this.stream?.abort();
    this.history = [];
  }

  async send({ system, context, text, onText }) {
    const apiKey = this.getApiKey();
    const client = new Anthropic(apiKey ? { apiKey } : {});
    const content = context ? `${context}\n\n${text}` : text;
    const messages = [...this.history, { role: 'user', content }];

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

module.exports = { AnthropicApiProvider };
