# Desktop Pet

An anime desktop buddy that stands on your taskbar or Dock, powered by real
[Live2D](https://www.live2d.com/en/) models. The first character is **Haru**, Live2D's
official sample character, with professional art, animation, expressions and physics.

## Run it

```bash
npm install
```

Download the Live2D runtime and Haru from Live2D's official sources. Running this means
you accept the [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html),
the [Sample Data Terms](https://www.live2d.com/en/learn/sample/model-terms/) and the
[Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).

```bash
npm run setup
```

```bash
npm start
```

## What she does

- 27 professional animations and 8 facial expressions
- Built-in blinking, breathing and hair and clothing physics
- Follows your cursor with her head, eyes and body
- Click to react, rub her head to pet, double-click to jump
- Drag and throw her, then she falls and lands on the taskbar
- Plays gestures on her own and falls asleep when you're idle
- Clicks pass through everything except her visible pixels
- Right-click her, or use the tray, for gestures, expressions, size and gravity

## Structure

- `src/main.js`: window, tray, drag, gravity, walking and local asset serving
- `src/preload.js`: the small `window.pet` bridge
- `src/renderer/app.js`: Live2D rendering, reactions and speech
- `characters/<id>/character.json`: name, size, expressions, moods and lines
- `tools/setup-live2d.js`: downloads the runtime and model into the git-ignored `vendor/`

`speak(text)` and `setMood(name)` in `app.js` are the entry points for future AI chat. The
speech bubble types the reply and her mouth moves with it.

## Roadmap

- [ ] AI chat and voice with lip sync
- [ ] Name each gesture and group them by mood
- [ ] Load any Live2D model from the tray
- [ ] Settings window
- [ ] Packaged app with `electron-builder`

## License and credits

Project code is MIT (see [LICENSE](LICENSE)). The MIT license does not cover Live2D files.

This content uses sample data owned and copyrighted by Live2D Inc. The sample data are
utilized in accordance with terms and conditions set by Live2D Inc. This content itself is
created at the author's sole discretion.

Live2D Cubism Core is under the Live2D Proprietary Software License. Businesses with annual
revenue of 10 million JPY or more need a separate license from Live2D. Rendering uses
[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) (MIT).
