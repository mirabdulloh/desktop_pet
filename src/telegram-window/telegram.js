const api = window.telegramApi;
const el = (id) => document.getElementById(id);
const MAX_SELECTED = 10;
let selected = new Set();
let currentDraft = null;
let renderedDraftText;

function showMessage(text) {
  el('message').textContent = text || '';
}

function renderChats(chats) {
  el('learn').hidden = chats.length === 0;
  el('learn-all').hidden = chats.length === 0;
  el('chats').replaceChildren(
    ...chats.map((chat) => {
      const row = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      const text = document.createElement('span');
      box.type = 'checkbox';
      box.checked = selected.has(chat.key);
      box.addEventListener('change', () => {
        if (box.checked && selected.size >= MAX_SELECTED) {
          box.checked = false;
          showMessage(`The demo learns up to ${MAX_SELECTED} chats at a time.`);
        } else if (box.checked) {
          selected.add(chat.key);
        } else {
          selected.delete(chat.key);
        }
      });
      text.textContent = `${chat.name} (${chat.count} of your messages)`;
      label.append(box, text);
      row.append(label);
      return row;
    }),
  );
}

function renderStyles(allStyles) {
  const styles = allStyles.filter((style) => style.profile);
  const wordsOnly = allStyles.length - styles.length;
  el('no-styles').hidden = allStyles.length > 0;
  el('styles-more').hidden = wordsOnly === 0;
  el('styles-more').textContent = `Real replies and words are also saved for ${wordsOnly} more ${wordsOnly === 1 ? 'person' : 'people'}.`;
  el('styles').replaceChildren(
    ...styles.map((style) => {
      const row = document.createElement('li');
      const body = document.createElement('div');
      const name = document.createElement('div');
      const detail = document.createElement('div');
      const remove = document.createElement('button');
      body.className = 'grow';
      name.className = 'name';
      name.textContent = style.name;
      detail.className = 'detail';
      detail.textContent = style.profile;
      const stats = document.createElement('div');
      stats.className = 'detail';
      stats.textContent = `${style.wordCount} words, ${style.shortcuts.length} shortcuts, ${style.fixCount} of your fixes`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const shortcut of style.shortcuts) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = `${shortcut.short} = ${shortcut.full} ×`;
        chip.title = shortcut.meaning;
        chip.setAttribute('aria-label', `Remove wrong shortcut ${shortcut.short} meaning ${shortcut.full}`);
        chip.addEventListener('click', async () => {
          await api.removeShortcut(style.key, shortcut.short);
          render();
        });
        chips.append(chip);
      }
      remove.type = 'button';
      remove.textContent = 'Forget';
      remove.setAttribute('aria-label', `Forget style for ${style.name}`);
      remove.addEventListener('click', async () => {
        await api.remove(style.key);
        render();
      });
      const replies = document.createElement('div');
      replies.className = 'detail';
      replies.textContent = style.replyHabits ? `How you reply: ${style.replyHabits}` : '';
      stats.textContent += `, ${style.exampleCount} real replies saved`;
      body.append(name, detail, replies, stats, chips);
      const actions = document.createElement('div');
      actions.className = 'stack';
      if (liveConnected && !autoKeys.has(style.key)) {
        const auto = document.createElement('button');
        auto.type = 'button';
        auto.textContent = 'Auto-reply';
        auto.setAttribute('aria-label', `Answer ${style.name} automatically`);
        auto.addEventListener('click', async () => {
          await api.startAutoReply(style.key, style.name);
          render();
        });
        actions.append(auto);
      }
      actions.append(remove);
      row.append(body, actions);
      return row;
    }),
  );
}

function renderDraft(draft) {
  el('draft').hidden = !draft;
  if (!draft) return;
  el('draft-title').textContent = `Draft to ${draft.contact}`;
  el('draft-text').value = draft.text;
  const recipients = draft.recipients || [];
  el('recipient-row').hidden = recipients.length === 0;
  el('draft-send').hidden = recipients.length === 0;
  el('recipient').replaceChildren(
    ...recipients.map((person) => {
      const option = document.createElement('option');
      option.value = person.key;
      option.textContent = person.username ? `${person.name} (@${person.username})` : person.name;
      return option;
    }),
  );
  updateSendLabel(recipients);
  const styleNote = draft.styled ? 'Written in your style. Fix any wrong word and she learns it.' : 'No learned style for this contact yet.';
  el('draft-note').textContent = recipients.length
    ? `${styleNote} Nothing is sent until you press Send.`
    : `${styleNote} Telegram opens with this text. Choose ${draft.contact} and press Send yourself.`;
}

function updateSendLabel(recipients) {
  const person = recipients.find((item) => item.key === el('recipient').value);
  el('draft-send').textContent = person ? `Send to ${person.name}` : 'Send';
}

function renderLive(live) {
  const connected = live.state === 'connected';
  const asking = live.state === 'code' || live.state === 'password';
  el('live-connected').hidden = !connected && live.state !== 'connecting';
  el('live-connected').textContent = connected ? `Connected as ${live.name}.` : 'Connecting...';
  el('live-login').hidden = live.state !== 'off';
  el('live-step').hidden = !asking;
  el('live-logout').hidden = !connected;
  el('live-error').hidden = !live.error;
  el('live-error').textContent = live.error || '';
  if (asking) {
    const isCode = live.state === 'code';
    el('step-label').textContent = isCode ? 'Login code from Telegram' : 'Your Telegram two-step password';
    el('step-value').type = isCode ? 'text' : 'password';
    if (el('step-value').dataset.step !== live.state) {
      el('step-value').value = '';
      el('step-value').dataset.step = live.state;
      el('step-value').focus();
    }
  } else {
    delete el('step-value').dataset.step;
    el('step-value').value = '';
  }
  if (connected) {
    el('api-id').value = '';
    el('api-hash').value = '';
    el('phone').value = '';
  }
}

function renderAuto(state) {
  const connected = state.live.state === 'connected';
  el('live-controls').hidden = !connected;
  el('direct-send').checked = state.directSend;
  el('no-auto').hidden = state.autoReply.length > 0;
  el('auto-people').replaceChildren(
    ...state.autoReply.map((person) => {
      const row = document.createElement('li');
      const name = document.createElement('div');
      const stop = document.createElement('button');
      name.className = 'grow';
      name.textContent = `Answering ${person.name} by herself`;
      stop.type = 'button';
      stop.textContent = 'Stop';
      stop.setAttribute('aria-label', `Stop auto-reply for ${person.name}`);
      stop.addEventListener('click', async () => {
        await api.stopAutoReply(person.key);
        render();
      });
      row.append(name, stop);
      return row;
    }),
  );
  el('auto-history').replaceChildren(
    ...state.autoHistory.map((item) => {
      const row = document.createElement('li');
      const text = document.createElement('div');
      text.className = 'detail';
      const time = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      text.textContent = item.sent
        ? `${time} Replied to ${item.name}: ${item.text}`
        : `${time} Left ${item.name}'s message for you to answer.`;
      row.append(text);
      return row;
    }),
  );
}

const learnedNote = (count) => (count ? ` Learned ${count} ${count === 1 ? 'fix' : 'fixes'} from your edit.` : '');

async function render() {
  const state = await api.state();
  el('status').textContent = state.connected ? 'Memory connected' : 'Memory not connected';
  el('status').className = `status ${state.connected ? 'connected' : 'error'}`;
  currentDraft = state.draft;
  if (state.draft?.text !== renderedDraftText || !state.draft) {
    renderedDraftText = state.draft?.text;
    el('send-error').hidden = true;
    renderDraft(state.draft);
  }
  renderLive(state.live);
  renderAuto(state);
  renderChats(state.chats);
  liveConnected = state.live.state === 'connected';
  autoKeys = new Set(state.autoReply.map((person) => `tg:${person.key}`));
  renderStyles(state.styles);
}

let liveConnected = false;
let autoKeys = new Set();

el('direct-send').addEventListener('change', (event) => api.setDirectSend(event.target.checked));

el('import').addEventListener('click', async () => {
  showMessage('Reading export...');
  const result = await api.importExport();
  selected = new Set();
  if (result.cancelled) showMessage('');
  else if (!result.ok) showMessage(result.error);
  else showMessage(`Found ${result.count} personal chats you can learn from. Select the ones you want.`);
  render();
});

el('learn').addEventListener('click', async () => {
  if (!selected.size) {
    showMessage('Select at least one chat.');
    return;
  }
  el('learn').disabled = true;
  el('import').disabled = true;
  const result = await api.learn([...selected]);
  el('learn').disabled = false;
  el('import').disabled = false;
  selected = new Set();
  const learnedText = `Learned ${result.learned} ${result.learned === 1 ? 'chat' : 'chats'}.`;
  showMessage(result.failed ? `${learnedText} ${result.failed} failed, try again later.` : learnedText);
  render();
});

el('learn-all').addEventListener('click', async () => {
  const buttons = ['learn-all', 'learn', 'import'].map(el);
  buttons.forEach((button) => { button.disabled = true; });
  const result = await api.learnAll();
  buttons.forEach((button) => { button.disabled = false; });
  showMessage(
    result.error
      || `Saved your real replies from ${result.saved} chats and wrote ${result.summarized} summaries. Skipped ${result.skipped} unnamed or very small chats.`,
  );
  render();
});

el('draft-copy').addEventListener('click', async () => {
  const result = await api.copy(el('draft-text').value);
  el('draft-note').textContent = `Copied. Paste it in Telegram and press Send yourself.${learnedNote(result.learned)}`;
  if (result.learned) renderStyles((await api.state()).styles);
});

el('draft-open').addEventListener('click', async () => {
  const result = await api.openInTelegram(el('draft-text').value);
  el('draft-note').textContent = `Choose the person in Telegram and press Send yourself.${learnedNote(result.learned)}`;
  if (result.learned) renderStyles((await api.state()).styles);
});

el('draft-discard').addEventListener('click', async () => {
  await api.discard();
  render();
});

el('recipient').addEventListener('change', () => updateSendLabel(currentDraft?.recipients || []));

el('draft-send').addEventListener('click', async () => {
  const button = el('draft-send');
  button.disabled = true;
  el('send-error').hidden = true;
  const result = await api.send(el('recipient').value, el('draft-text').value);
  button.disabled = false;
  if (result.ok) {
    showMessage(`Sent to ${result.name}.`);
    render();
  } else {
    el('send-error').textContent = result.error;
    el('send-error').hidden = false;
  }
});

el('live-login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await api.login({ apiId: el('api-id').value, apiHash: el('api-hash').value, phone: el('phone').value });
  if (!result.ok) {
    el('live-error').textContent = result.error;
    el('live-error').hidden = false;
  }
});

el('live-step').addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = el('step-value').value;
  el('step-value').value = '';
  delete el('step-value').dataset.step;
  await api.submitLogin(value);
});

el('live-logout').addEventListener('click', async () => {
  await api.logout();
  render();
});

api.onUpdated(render);
api.onProgress(showMessage);
render();
