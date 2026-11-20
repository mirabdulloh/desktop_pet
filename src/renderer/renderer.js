const spriteMount = document.getElementById('sprite-mount');
const bubble = document.getElementById('speech-bubble');

let character = null;
let svgRoot = null;
let dragging = false;
let hasShownDragLine = false;
let bubbleHideTimer = null;
let idleTimer = null;

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function setState(state) {
  if (!svgRoot) return;
  svgRoot.classList.remove('state-idle', 'state-drag', 'state-click', 'state-sleep');
  svgRoot.classList.add(`state-${state}`);
}

function say(text, durationMs) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('visible');
  clearTimeout(bubbleHideTimer);
  bubbleHideTimer = setTimeout(() => bubble.classList.remove('visible'), durationMs);
}

function scheduleIdleLine() {
  const [min, max] = character.idleLineIntervalMs || [6000, 14000];
  const delay = min + Math.random() * (max - min);
  idleTimer = setTimeout(() => {
    const lines = character.lines && character.lines.idle;
    if (lines && lines.length && !dragging) {
      say(randomFrom(lines), 3200);
    }
    scheduleIdleLine();
  }, delay);
}

async function mountSprite(char) {
  spriteMount.style.setProperty('--sprite-width', `${char.spriteWidth}px`);
  spriteMount.style.setProperty('--sprite-height', `${char.spriteHeight}px`);

  const response = await fetch(`../../characters/${char.id}/${char.sprite}`);
  spriteMount.innerHTML = await response.text();
  svgRoot = spriteMount.querySelector('svg');
  setState('idle');
}

function setupInteractions() {
  spriteMount.addEventListener('mouseenter', () => window.pet.setIgnoreMouse(false));
  spriteMount.addEventListener('mouseleave', () => {
    if (!dragging) window.pet.setIgnoreMouse(true);
  });

  spriteMount.addEventListener('pointerdown', (event) => {
    dragging = false;
    hasShownDragLine = false;
    spriteMount.setPointerCapture(event.pointerId);
  });

  spriteMount.addEventListener('pointermove', (event) => {
    if (event.buttons !== 1) return;
    if (!dragging && (Math.abs(event.movementX) > 2 || Math.abs(event.movementY) > 2)) {
      dragging = true;
      spriteMount.classList.add('dragging');
      setState('drag');
      if (!hasShownDragLine) {
        hasShownDragLine = true;
        const lines = character.lines && character.lines.dragStart;
        if (lines && lines.length) say(randomFrom(lines), 2000);
      }
    }
    if (dragging) {
      window.pet.moveWindowBy(event.movementX, event.movementY);
    }
  });

  spriteMount.addEventListener('pointerup', (event) => {
    spriteMount.releasePointerCapture(event.pointerId);
    if (dragging) {
      dragging = false;
      spriteMount.classList.remove('dragging');
      setState('idle');
      window.pet.setIgnoreMouse(true);
    } else {
      setState('click');
      const lines = character.lines && character.lines.click;
      if (lines && lines.length) say(randomFrom(lines), 1800);
      setTimeout(() => setState('idle'), 1100);
    }
  });
}

window.pet.onLoadCharacter(async (char) => {
  character = char;
  clearTimeout(idleTimer);
  await mountSprite(char);
  setupInteractions();
  scheduleIdleLine();
});
