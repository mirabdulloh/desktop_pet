# Desktop Pet 🧷

A little anime desktop buddy that lives on your screen — transparent, always-on-top,
draggable, and skinned per-character from a `characters/` folder. First character:
**Marin Kitagawa** (placeholder art for now — see
[characters/marin-kitagawa/README.md](characters/marin-kitagawa/README.md)).

See [RESEARCH.md](RESEARCH.md) for the survey of existing desktop-pet projects that this
design is based on.

## Run it

```bash
npm install
npm start
```

She'll appear in the bottom-right corner of your screen, bob gently, occasionally say
something, and can be picked up and dragged around. A tray icon lets you hide/show her,
switch characters (once there's more than one), or quit.

## How it works

- **`src/main.js`** — the Electron main process. Creates a transparent, frameless,
  always-on-top `BrowserWindow`, a system tray icon/menu, and persists her screen position
  between runs. Click-through is handled with the standard pattern for this kind of app:
  the window ignores mouse events by default (so it never steals clicks from whatever's
  behind it) and the renderer tells it to stop ignoring only while the cursor is actually
  over the character.
- **`src/preload.js`** — the small `contextBridge` API (`window.pet`) the renderer uses to
  talk to the main process.
- **`src/renderer/`** — loads the current character's sprite, does hit-testing for
  click-through, handles drag-to-move and click reactions, and shows her speech bubble.
- **`characters/<id>/`** — one folder per character: `character.json` (name, sizes, lines
  she says) + its own art. The engine doesn't know anything character-specific; it just
  toggles `state-idle` / `state-drag` / `state-click` / `state-sleep` classes on the
  sprite's root element and lets the character's own art/CSS react to them.

## Adding another character

1. Copy `characters/marin-kitagawa/` to `characters/<new-id>/`.
2. Edit its `character.json` (name, sizes, lines) and swap in its art.
3. Restart the app — she shows up in the tray's character picker automatically.

## Roadmap

- [ ] Real art for Marin (swap the placeholder SVG — see her folder's README)
- [ ] Settings window instead of tray-only controls
- [ ] Idle "walk" behavior / screen-edge awareness
- [ ] Optional Live2D rendering via `pixi-live2d-display` for characters that have a rig
- [ ] Packaging (`electron-builder`) for a double-clickable app
- [ ] More characters

## License

Code is MIT (see [LICENSE](LICENSE)). Placeholder character art in this repo is original
and MIT too. If you swap in real character art/models, make sure *you* have the rights to
it and to redistribute it — see the licensing note in
[RESEARCH.md](RESEARCH.md#licensing-note-important).
