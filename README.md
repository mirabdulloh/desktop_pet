# Desktop Pet

A 3D anime desktop buddy that stands on your taskbar or Dock. It loads real
[VRM](https://vrm.dev/) models, with one character pack per folder in `characters/`.
The first pack is **Marin**.

Model files are not included. Import a `.vrm` you have permission to use. It is copied to
the app's private data folder and is never added to this repository.

## Run it

```bash
npm install
```

```bash
npm start
```

Click **Import VRM model** on the card, or use **Import VRM Model…** in the tray menu.

## What it does

- Head and eyes follow your cursor
- Blinking, breathing, idle sway and facial expressions
- Hair and clothes physics from the model's spring bones, reacting to drags and falls
- Click to wave, rub her head to pet, double-click to jump
- Drag and throw her, then she falls and bounces onto the taskbar
- Falls asleep when you're idle
- Clicks pass through everything except the model's visible pixels
- Tray menu for character, size, gravity, show/hide and quit

## Structure

- `src/main.js`: window, tray, model import, drag and gravity physics
- `src/preload.js`: the small `window.pet` bridge
- `src/renderer/app.js`: three.js scene, VRM loading, animation and interactions
- `characters/<id>/character.json`: name, window size, spoken lines and timing

## Add a character

1. Copy `characters/marin-kitagawa/` to `characters/<new-id>/`.
2. Edit its `character.json`.
3. Restart, pick it in the tray, and import its VRM model.

## Roadmap

- [ ] VRMA animation clips (walk, sit, dance)
- [ ] Walking along the taskbar and sitting on window edges
- [ ] Voice and lip sync
- [ ] Settings window
- [ ] Packaged app with `electron-builder`

## License

Code is MIT (see [LICENSE](LICENSE)). Characters and models belong to their owners, so
check each model's license before using or sharing it.
