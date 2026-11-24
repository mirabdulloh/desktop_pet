const fs = require('fs');
const path = require('path');

const REF = 'b1de66b0b1f1cb881d95fb6158622aeb6a2827bd';
const MODEL_BASE = `https://raw.githubusercontent.com/Live2D/CubismWebSamples/${REF}/Samples/Resources/Haru/`;
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const ROOT = path.join(__dirname, '..', 'vendor', 'live2d');
const MODEL_DIR = path.join(ROOT, 'haru');
const GESTURE_COUNT = 26;

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function save(base, relative, data) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error(`Unsafe path: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function referencedFiles(model) {
  const refs = model.FileReferences;
  const files = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData];
  (refs.Expressions || []).forEach((item) => files.push(item.File));
  files.push('motions/haru_g_idle.motion3.json');
  for (let i = 1; i <= GESTURE_COUNT; i += 1) {
    files.push(`motions/haru_g_m${String(i).padStart(2, '0')}.motion3.json`);
  }
  return [...new Set(files.filter(Boolean))];
}

(async () => {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'live2dcubismcore.min.js'), await download(CORE_URL));

  const manifest = await download(`${MODEL_BASE}Haru.model3.json`);
  save(MODEL_DIR, 'Haru.model3.json', manifest);
  const files = referencedFiles(JSON.parse(manifest.toString('utf8')));
  for (const file of files) {
    save(MODEL_DIR, file, await download(MODEL_BASE + file.split('/').map(encodeURIComponent).join('/')));
  }
  console.log(`Live2D runtime and Haru ready (${files.length + 1} model files).`);
})().catch((error) => {
  console.error(`Live2D setup failed: ${error.message}`);
  process.exit(1);
});
