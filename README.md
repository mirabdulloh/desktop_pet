# Desktop Pet

A small anime desktop buddy that lives on your taskbar or Dock. The first character is
**Suzu**, an original character made for this project: indigo bob, amber eyes, cat-ear
headphones and a mint hoodie.

## Run it

```bash
npm install
```

```bash
npm start
```

## What she does

- Follows your cursor with her head and eyes, and glances around when you're away
- Blinks, breathes and sways without a visible loop
- Hair, headphones-side locks and limbs move on springs and react to being moved
- Walks along the bottom of the screen and plays idle actions
- Click to wave, rub her head to pet, double-click to jump
- Drag and throw her, then she falls, squashes and recovers
- Falls asleep when you're idle
- Clicks pass through everything except her visible shape
- Tray menu for character, size, gravity, show/hide and quit

## Structure

- `src/main.js`: window, tray, drag, gravity and walking
- `src/preload.js`: the small `window.pet` bridge
- `src/renderer/motion.js`: springs and noise
- `src/renderer/puppet.js`: drives the layered character rig
- `src/renderer/app.js`: behavior, moods, clips and speech
- `characters/<id>/`: `character.json` and a layered `puppet.svg`

`speak(text)` and `setMood(name)` in `app.js` are the natural entry points for a future AI
chat: the bubble types the reply and her mouth moves with it.

## Actions

Right-click Suzu, or open **Actions** in the tray, to trigger any action. She also picks
idle actions herself. Actions live in `characters/suzu/actions.json`:

```json
"dance": { "clip": "Dance_Loop", "label": "Dance", "loop": true, "hold": 6, "mood": "happy", "idle": true }
```

To add one, add a line using any clip from the
[Universal Animation Library](https://opengameart.org/content/universal-animation-library),
then convert it with the pack's Godot `.glb` file:

```bash
npm run bake -- /path/to/AnimationLibrary_Godot_Standard.glb
```

## Add a character

Copy `characters/suzu/` to `characters/<new-id>/`, keep the `data-joint` layers, redraw the
art, and edit `character.json`. It appears in the tray automatically.

## Roadmap

- [ ] AI chat and voice with lip sync
- [ ] Sitting on window edges
- [ ] More idle actions and outfits
- [ ] Settings window
- [ ] Packaged app with `electron-builder`

## License

Code and the Suzu character art are MIT (see [LICENSE](LICENSE)). Motion data is converted
from the [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
by Quaternius, released under CC0.
