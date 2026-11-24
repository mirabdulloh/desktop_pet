const statusEl = document.getElementById('status');
const connectForm = document.getElementById('connect');
const uriInput = document.getElementById('uri');
const connectError = document.getElementById('connect-error');
const connectButton = document.getElementById('connect-button');
const section = document.getElementById('memories');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');

function showError(message) {
  connectError.textContent = message || '';
  connectError.hidden = !message;
}

async function renderList() {
  const items = await window.memoryApi.list();
  countEl.textContent = `${items.length} ${items.length === 1 ? 'note' : 'notes'}`;
  emptyEl.hidden = items.length > 0;
  listEl.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement('li');
      const kind = document.createElement('span');
      const content = document.createElement('span');
      const remove = document.createElement('button');
      kind.className = 'kind';
      kind.textContent = item.kind;
      content.className = 'content';
      content.textContent = item.content;
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete note: ${item.content}`);
      remove.addEventListener('click', async () => {
        await window.memoryApi.remove(item.id);
        renderList();
      });
      row.append(kind, content, remove);
      return row;
    }),
  );
}

async function render() {
  const status = await window.memoryApi.status();
  const connected = status.state === 'connected';
  statusEl.className = `status ${connected ? 'connected' : status.state === 'error' ? 'error' : ''}`;
  statusEl.textContent = connected ? 'Connected to Atlas' : status.state === 'connecting' ? 'Connecting...' : status.state === 'error' ? 'Not connected' : 'Not set up';
  connectForm.hidden = connected;
  section.hidden = !connected;
  showError(connected ? '' : status.error);
  if (connected) await renderList();
  else if (status.state === 'connecting') setTimeout(render, 700);
}

connectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const uri = uriInput.value.trim();
  if (!uri) return;
  connectButton.disabled = true;
  connectButton.textContent = 'Connecting...';
  showError('');
  const result = await window.memoryApi.connect(uri);
  connectButton.disabled = false;
  connectButton.textContent = 'Connect';
  if (result.ok) uriInput.value = '';
  await render();
  if (!result.ok) showError(result.error);
});

const importButton = document.getElementById('import-button');
importButton.addEventListener('click', async () => {
  importButton.disabled = true;
  connectButton.disabled = true;
  showError('');
  const result = await window.memoryApi.importEnv();
  importButton.disabled = false;
  connectButton.disabled = false;
  await render();
  if (!result.ok && !result.cancelled) showError(result.error);
});

document.getElementById('clear').addEventListener('click', async () => {
  await window.memoryApi.clearAll();
  renderList();
});

document.getElementById('disconnect').addEventListener('click', async () => {
  await window.memoryApi.disconnect();
  render();
});

render();
