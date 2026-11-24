const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { redactSecrets } = require('./memory');

const TELEGRAM_SERVICE_ID = '777000';
const MAX_DIALOGS = 300;
const MAX_MATCHES = 5;
const READ_LIMIT = 15;

const LOGIN_ERRORS = {
  PHONE_CODE_INVALID: 'That code is wrong. Try again.',
  PHONE_CODE_EXPIRED: 'That code expired. Log in again.',
  PASSWORD_HASH_INVALID: 'That password is wrong. Try again.',
  PHONE_NUMBER_INVALID: 'That phone number is not valid. Include the country code.',
  API_ID_INVALID: 'That API ID or API hash is wrong.',
};
const RETRY_ERRORS = new Set(['PHONE_CODE_INVALID', 'PASSWORD_HASH_INVALID']);

// Matches whole name parts, so "Ali" finds "Ali Karim" but not "Vali".
function nameMatches(title, wanted) {
  return Boolean(wanted) && (title.startsWith(wanted) || title.split(/\s+/).some((part) => part.startsWith(wanted)));
}

function errorName(error) {
  return error?.errorMessage || String(error?.message || '').match(/[A-Z_]{6,}/)?.[0] || '';
}

function describeError(error) {
  const name = errorName(error);
  if (name.startsWith('FLOOD')) return 'Telegram asked to slow down. Try again later.';
  return LOGIN_ERRORS[name] || 'Could not connect to Telegram.';
}

class TelegramLive {
  constructor(storage, onChange) {
    this.storage = storage;
    this.onChange = onChange;
    this.client = null;
    this.state = 'off';
    this.error = null;
    this.name = null;
    this.answer = null;
    this.entities = new Map();
  }

  get connected() {
    return this.state === 'connected';
  }

  status() {
    return { state: this.state, error: this.error, name: this.name };
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onChange();
  }

  createClient(session, apiId, apiHash) {
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
    client.setLogLevel('none');
    return client;
  }

  async finishLogin(apiId, apiHash) {
    const me = await this.client.getMe();
    this.name = me.firstName || me.username || 'your account';
    this.storage.save({ apiId, apiHash, session: this.client.session.save() });
    this.setState('connected');
  }

  async restore() {
    const saved = this.storage.load();
    if (!saved) return;
    this.setState('connecting');
    try {
      this.client = this.createClient(saved.session, saved.apiId, saved.apiHash);
      await this.client.connect();
      if (!(await this.client.checkAuthorization())) {
        this.storage.clear();
        await this.closeClient();
        this.setState('off', 'Telegram logged this app out. Log in again.');
        return;
      }
      await this.finishLogin(saved.apiId, saved.apiHash);
    } catch (error) {
      await this.closeClient();
      this.setState('off', describeError(error));
    }
  }

  ask(step) {
    return new Promise((resolve) => {
      this.answer = resolve;
      this.setState(step, this.error);
    });
  }

  submit(value) {
    const answer = this.answer;
    if (!answer || typeof value !== 'string' || !value.trim()) return;
    this.answer = null;
    this.setState('connecting');
    answer(value.trim());
  }

  login({ apiId, apiHash, phone }) {
    const id = Number(apiId);
    if (!Number.isInteger(id) || id <= 0 || typeof apiHash !== 'string' || !/^[a-f0-9]{32}$/i.test(apiHash.trim())) {
      return { ok: false, error: 'Check your API ID and API hash.' };
    }
    if (typeof phone !== 'string' || !/^\+?\d{7,15}$/.test(phone.replace(/[\s()-]/g, ''))) {
      return { ok: false, error: 'Enter your phone number with the country code.' };
    }
    if (this.state !== 'off') return { ok: false, error: 'Already connecting.' };
    const hash = apiHash.trim();
    this.client = this.createClient('', id, hash);
    this.setState('connecting');
    this.client
      .start({
        phoneNumber: phone.replace(/[\s()-]/g, ''),
        phoneCode: () => this.ask('code'),
        password: () => this.ask('password'),
        onError: (error) => {
          this.error = describeError(error);
          return !RETRY_ERRORS.has(errorName(error));
        },
      })
      .then(() => this.finishLogin(id, hash))
      .catch(async (error) => {
        const message = this.error || describeError(error);
        await this.closeClient();
        this.setState('off', message);
      });
    return { ok: true };
  }

  async closeClient() {
    const { client } = this;
    this.client = null;
    this.answer = null;
    this.entities.clear();
    await client?.disconnect().catch(() => {});
  }

  async disconnect() {
    await this.closeClient();
  }

  async logout() {
    if (this.connected) await this.client.invoke(new Api.auth.LogOut()).catch(() => {});
    await this.closeClient();
    this.storage.clear();
    this.name = null;
    this.setState('off');
  }

  async findContacts(name) {
    if (!this.connected) return [];
    const dialogs = await this.client.getDialogs({ limit: MAX_DIALOGS });
    const people = dialogs.filter(
      (dialog) => dialog.isUser && !dialog.entity?.bot && !dialog.entity?.self && String(dialog.id) !== TELEGRAM_SERVICE_ID,
    );
    const wanted = name.toLocaleLowerCase().trim();
    const title = (dialog) => (dialog.title || '').toLocaleLowerCase();
    const exact = people.filter((dialog) => title(dialog) === wanted);
    const matches = exact.length ? exact : people.filter((dialog) => nameMatches(title(dialog), wanted));
    return matches.slice(0, MAX_MATCHES).map((dialog) => {
      const key = String(dialog.id);
      this.entities.set(key, dialog.entity);
      return { key, name: dialog.title, username: dialog.entity?.username || null };
    });
  }

  async readRecent(key) {
    const entity = this.entities.get(key);
    if (!this.connected || !entity) return [];
    const messages = await this.client.getMessages(entity, { limit: READ_LIMIT });
    return [...messages]
      .reverse()
      .filter((message) => message.message)
      .map((message) => ({ fromMe: Boolean(message.out), text: redactSecrets(message.message) }));
  }

  async send(key, text) {
    const entity = this.entities.get(key);
    if (!this.connected || !entity) throw new Error('Not connected');
    await this.client.sendMessage(entity, { message: text });
  }
}

module.exports = { TelegramLive, describeError, nameMatches };
