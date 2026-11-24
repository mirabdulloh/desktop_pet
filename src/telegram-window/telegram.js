const api = window.telegramApi;
const el = (id) => document.getElementById(id);
const MAX_SELECTED = 10;
let selected = new Set();

function showMessage(text) {
  el('message').textContent = text || '';
}

function renderChats(chats) {
  el('learn').hidden = chats.length === 0;
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

function renderStyles(styles) {
  el('no-styles').hidden = styles.length > 0;
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
      body.append(name, detail, stats, chips);
      row.append(body, remove);
      return row;
    }),
  );
}

function renderDraft(draft) {
  el('draft').hidden = !draft;
  if (!draft) return;
  el('draft-title').textContent = `Draft to ${draft.contact}`;
  el('draft-text').value = draft.text;
  el('draft-note').textContent = `${draft.styled ? 'Written in your style. Fix any wrong word and she learns it.' : 'No learned style for this contact yet.'} Telegram opens with this text. Choose ${draft.contact} and press Send yourself.`;
}

const learnedNote = (count) => (count ? ` Learned ${count} ${count === 1 ? 'fix' : 'fixes'} from your edit.` : '');

async function render() {
  const state = await api.state();
  el('status').textContent = state.connected ? 'Memory connected' : 'Memory not connected';
  el('status').className = `status ${state.connected ? 'connected' : 'error'}`;
  renderDraft(state.draft);
  renderChats(state.chats);
  renderStyles(state.styles);
}

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

api.onUpdated(render);
api.onProgress(showMessage);
render();
