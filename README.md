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
- Right-click her, or use the tray, for Go Left/Right, Run Left/Right, Go to Top, Come Down,
  Sleep, Wake Up, gestures, expressions, size and gravity

## Keyboard shortcuts

These work from any app. On macOS, `Alt` is the `Option` key.

| Shortcut | Action |
|---|---|
| `Control + Option + ←` / `→` | Go left / right |
| `Control + Option + Shift + ←` / `→` | Run left / right |
| `Control + Option + ↑` / `↓` | Go to top / come down |
| `Control + Option + J` | Jump |
| `Control + Option + S` | Sleep / wake up |
| `Control + Option + G` | Random gesture |
| `Control + Option + C` | Open chat |
| `Control + Option + H` | Hide / show |

## Structure

- `src/main.js`: window, tray, drag, gravity, walking and local asset serving
- `src/chat.js`: streaming Claude conversation through your plan or an API key
- `src/preload.js`: the small `window.pet` bridge
- `src/renderer/app.js`: Live2D rendering, reactions and speech
- `characters/<id>/character.json`: name, size, expressions, moods and lines
- `tools/setup-live2d.js`: downloads the runtime and model into the git-ignored `vendor/`

## AI chat

Type in the box under Haru. If you close it, click her to bring it back.

**With your own Claude plan (personal use):** install
[Claude Code](https://code.claude.com/docs) and sign in. Haru then uses your plan's usage
limits, with all tools turned off so chat can only produce text.

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
claude auth login
```

**With an API key (required if you distribute the app):** paste an
[Anthropic API key](https://platform.claude.com/settings/keys) into the box. It is encrypted
with the macOS Keychain, kept in the app's data folder, and takes priority over a plan
login. **Remove API Key** in the menu deletes it. Anthropic does not allow apps to route
other people's requests through a Claude plan, so public releases must use API keys.

- Replies stream into her speech bubble while her mouth moves.
- Each reply starts with a mood tag that sets her expression.
- The conversation lasts until you quit or choose **Clear Chat**. It is not saved to disk.
- In API mode, server-side refusal fallback can retry a declined request on another model.
- Her personality is the `persona` field in `characters/haru/character.json`.

### What she can open

Ask her in chat, for example "open YouTube and find lofi music".

- **YouTube and Google searches** open right away in your browser.
- **Websites** (https only) and **installed apps** ask for your approval first.
- She can't click, type, read pages, or access your files. Each command is checked by the
  app in `src/actions.js` before anything runs.

## Roadmap

- [ ] Voice input and spoken replies with lip sync
- [ ] Long-term memory between sessions
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
