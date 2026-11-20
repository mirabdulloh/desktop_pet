# Research — desktop anime buddy / desktop pet

Notes from a survey of existing open-source "desktop pet" / anime mascot projects,
done before writing any code, to decide the stack and avoid known pitfalls.

## What already exists

| Project | Stack | License | Notes |
|---|---|---|---|
| [Shimeji-ee](https://github.com/gil/shimeji-ee) | Java | New BSD (engine), zlib/libpng (art) | The original/classic desktop mascot. Character = a folder of numbered `shime*.png` sprites + `actions.xml`/`behaviors.xml` describing state machine (walk, fall, sit on windows, drag, etc). Huge fan-pack ecosystem. |
| [Shijima-Qt](https://pixelomer.itch.io/shijima) / [libshijima](https://github.com/pixelomer/libshijima) | C++/Qt | GPL-3.0 | Modern native reimplementation of the Shimeji sprite/behavior format. |
| [claude-pet](https://github.com/xtrimsystems/claude-pet) | — | — | Reuses the Shimeji/Shijima sprite format directly. |
| [Hime Display](https://github.com/TSKI433/hime-display) | Electron + Vite | GPL-3.0 | "Universal" desktop model viewer — loads Live2D, Spine, MMD, VRoid models into a transparent always-on-top window. Closest reference for Electron + Live2D, but it's a full viewer app, not a small embeddable widget. |
| [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) | PixiJS plugin | MIT | The standard way to render a Live2D Cubism model (`.moc3` + textures) on the web/in Electron. Several community forks add Cubism 5 / lipsync support. No ready-made "Electron transparent window + this lib" starter exists — the window plumbing has to be hand-built. |
| [Clawd](https://github.com/KebeliSamet0/clawd) | Electron, vanilla JS | MIT | Transparent, frameless, always-on-top pixel-art mascot that lives in the tray. Closest match to what we're building (engine-wise, not art style). |
| [Flabba](https://gh.r-mj.com/Oh-Wow-wow-pair/Flabba) | Electron | — | 128×128 transparent window, click-through by default, hover to interact, drag to move — exactly the interaction model we want. |
| [3D Desktop Pet](https://besthub.dev/articles/building-a-cross-platform-3d-desktop-pet-with-electron-vue-and-dexie-js-9c7bc1c1ae54) | Electron + Three.js + Vue | — | Write-up of a 3D version; useful for the transparent-window setup, overkill for a 2D sprite character. |

## Decisions this led to

1. **Electron**, not Tauri/Qt/Godot. The project needs zero native build tooling, cross-platform transparent/always-on-top windows are well documented, and it matches the ecosystem every reference project above uses.
2. **Click-through window, not a draggable OS region.** The standard pattern (used by Clawd/Flabba) is:
   - Create the `BrowserWindow` with `transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true`.
   - Call `win.setIgnoreMouseEvents(true, { forward: true })` so clicks pass through to whatever is behind the window *except* when the renderer tells the main process the cursor is over an actual (opaque) part of the character.
   - The renderer does its own hit-testing (`mousemove` → `document.elementFromPoint`) and flips `setIgnoreMouseEvents` over IPC. This avoids the window ever "stealing" clicks from apps underneath it.
   - Dragging is implemented manually (track `mousedown`/`mousemove` deltas in the renderer, move the window via `win.setPosition` from the main process) rather than relying on `-webkit-app-region: drag`, which gives more control for later physics (falling off the edge of the screen, snapping to the taskbar, etc).
3. **Character = data, not code.** Every reference engine (Shimeji's XML+sprites, Hime Display's model loader) treats the character as an asset bundle the engine reads, not something hardcoded. We copy that: `characters/<id>/character.json` + its own art folder. Adding character #2 later means adding a folder, not touching the engine.
4. **Sprite/CSS animation first, Live2D later.** A real Live2D rig needs a modeler's `.moc3` + rigged textures — that's a content problem, not a code problem, and no such asset exists for Marin Kitagawa that's safe to redistribute (see below). The engine is built so a character's `character.json` can later point at a Live2D model file instead of a flat sprite without changing the drag/click-through/tray plumbing.

## Licensing note (important)

Searched for an existing fan-made Live2D/VTuber rig of Marin Kitagawa (*My Dress-Up Darling*) to use as the first character's actual face. **Found none that's freely redistributable** — only paid Fiverr commission listings for *custom* Live2D rigging, and one unrelated CGTrader 3D fan-art model. The character and her design are © Shuei-sha / CloverWorks; a traced or lifted image of her would make this repo takedown-able the moment it's public on GitHub.

So for v1, the Marin Kitagawa "skin" ships with a small **original placeholder illustration** (a simple SVG chibi with the right vibe — blonde twin-tails, cosplay-y outfit — but not copied from any official art or screenshot), plus a documented slot (`characters/marin-kitagawa/README.md`) for swapping in real art *you* have the rights to use (your own commission, a licensed asset pack, or your own exported frames). The engine itself doesn't care what's in that folder.

## Sources
- [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [TSKI433/hime-display](https://github.com/TSKI433/hime-display)
- [KebeliSamet0/clawd](https://github.com/KebeliSamet0/clawd)
- [gil/shimeji-ee](https://github.com/gil/shimeji-ee)
- [pixelomer/libshijima](https://github.com/pixelomer/libshijima) / [Shijima-Qt](https://pixelomer.itch.io/shijima)
- [xtrimsystems/claude-pet](https://github.com/xtrimsystems/claude-pet)
- [electron/electron#1335 — click-through transparent windows](https://github.com/electron/electron/issues/1335)
- [Building a cross-platform 3D desktop pet (Electron + Vue + Three.js)](https://besthub.dev/articles/building-a-cross-platform-3d-desktop-pet-with-electron-vue-and-dexie-js-9c7bc1c1ae54)
