# Marin Kitagawa — character pack

`sprite.svg` here is a **placeholder** — an original, simple chibi drawing (not traced or
copied from any official art, screenshot, or existing fan model), just so the engine has
something to render out of the box.

Marin Kitagawa and her design are © Shueisha / CloverWorks (*My Dress-Up Darling*). No
official or redistributable fan Live2D/sprite model of her was found during research
(see [RESEARCH.md](../../RESEARCH.md)) that would be safe to ship in this public repo.

## Swapping in real art

The engine only cares about `character.json` and whatever file it points `sprite` at — it
doesn't know or care what's inside. To use real art you have the rights to use (your own
commission, a licensed asset pack, frames you exported yourself, etc):

1. Replace `sprite.svg` with your art. It can be:
   - An **SVG** with the same structure (a `#float-group`, optional `#lid-left`/`#lid-right`
     for blinking, `#arm-right` for the wave-on-click reaction) — reuse the CSS state
     classes (`state-idle`, `state-drag`, `state-click`, `state-sleep`) the engine toggles
     on the root element, or add your own and style them however you like.
   - A **PNG sprite sheet** or plain **PNG/GIF** — update `character.json`'s `"sprite"`
     field and swap the loader in `src/renderer/renderer.js` (`loadSprite()`) accordingly;
     it's one small function.
   - A **Live2D model** (`.moc3` + textures) via `pixi-live2d-display` — bigger change, but
     the window/drag/click-through plumbing in `src/main.js` doesn't need to change at all.
2. Adjust `stageWidth`/`stageHeight`/`spriteWidth`/`spriteHeight` in `character.json` to
   match your art's canvas.
3. Edit the `lines` in `character.json` to whatever you want her to say.

## Adding a second character later

Copy this folder, give it a new id (the folder name), write its own `character.json` +
art. It shows up automatically in the tray's character picker — `src/main.js` lists every
subfolder of `characters/` that has a `character.json`.
