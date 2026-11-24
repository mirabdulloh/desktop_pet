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
- `src/chat.js` and `src/providers/`: swappable AI connection (Claude plan or API key)
- `src/memory.js` and `src/memory-window/`: MongoDB memory and its management window
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
- **Clear Chat** starts a new conversation. With memory connected, conversations are saved.
- In API mode, server-side refusal fallback can retry a declined request on another model.
- Her personality is the `persona` field in `characters/haru/character.json`.

### What she can open

Ask her in chat, for example "open YouTube and find lofi music".

- **YouTube and Google searches** open right away and reuse a matching tab in Chrome, Brave,
  Edge or Safari. macOS may ask once for permission to control the browser. A new tab opens
  only when no matching tab exists or permission is denied.
- **Play requests** ("play the best Russian song") find the top YouTube result and load it
  in the open YouTube tab. "Play that" starts the top result of the YouTube page already open.
- **Websites** (https only) and **installed apps** ask for your approval first.
- She can't pause, click page buttons, type into pages, read pages, or access your files. Each command is checked by the
  app in `src/actions.js` before anything runs.

## Memory

Haru stores long-term memory in your own MongoDB Atlas cluster, in the `Haru` database
(`memory` for notes and `messages` for past conversations). Put the connection string in a git-ignored `.env` file
in the project root (see `.env.example`). The app connects at startup and whenever the file
is saved. Right-click her and choose **Memory...** to view or delete notes.

- `MONGODB_URI` in `.env` takes priority over a connection saved in the Memory window.
- Connections saved in the window are encrypted with the macOS Keychain.
- She saves lasting facts, preferences and corrections, and recalls relevant ones per message.
- Passwords, keys, tokens and card-like numbers are refused or hidden before saving.
- Saved text lives in your Atlas cluster and relevant notes are sent to the active AI.
- Memory is separate from the AI. To add another model, create a provider in `src/providers/`
  and select it in `src/chat.js`.

## Telegram (demo)

Right-click Haru and choose **Telegram...**, then import `result.json` from Telegram Desktop
(**Settings > Advanced > Export Telegram data**, JSON format, personal chats, no media).

- Select the chats she may learn from. Only your own messages are sent to the AI.
- She counts your real words, phrases and habits on this Mac, then learns Uzbek shortcuts
  only when they appear in your messages and their meaning is clear.
- `Haru.telegram_styles` keeps the style, common words, shortcuts and fixes, not the chats.
- Ask in chat, for example "write to Ali that I'll be late". A draft opens for you to edit.
- When you fix a word in a draft, she remembers that word-level correction for that contact.
- Click a learned shortcut in the Telegram window to remove it if it is wrong.
- **Open in Telegram** fills in the text. You choose the chat and press Send yourself.

**Live connection (optional):** create an app at [my.telegram.org](https://my.telegram.org),
then log in from the Telegram window with your API ID, API hash, phone and login code.

- The session is encrypted on this Mac and never stored in Atlas or this repository.
- She sends only when you click **Send to [name]** on a draft.
- Ask "what did Ali write?" and she reads the latest 15 messages with that person and sends
  them to the active AI for a short summary. They are not saved. Bots and Telegram's
  login-code chat are excluded.
- **Log out** ends the session on Telegram and deletes it from this Mac.

## Roadmap

- [ ] Voice input and spoken replies with lip sync
- [ ] Reply suggestions for new Telegram messages
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
