const DEFAULTS = { lenArmL: 1, lenForeL: 1, lenArmR: 1, lenForeR: 1, lenLegL: 1, lenLegR: 1, dx: 0, dy: 0 };
const smooth = (x) => x * x * (3 - 2 * x);

export class ActionPlayer {
  constructor(actions, baked, onFinish) {
    this.actions = actions;
    this.clips = baked.clips;
    this.fields = baked.fields;
    this.onFinish = onFinish;
    this.name = null;
    this.step = null;
    this.queue = [];
    this.from = null;
    this.fade = 0;
    this.fadeTime = 0;
    this.last = null;
  }

  get active() {
    return Boolean(this.step);
  }

  play(name, fade = 0.28) {
    const action = this.actions[name];
    if (!action) return false;
    this.name = name;
    this.queue = action.sequence ? [...action.sequence] : [name];
    this.beginNext(fade);
    return true;
  }

  stop(fade = 0.18) {
    this.name = null;
    this.step = null;
    this.queue = [];
    this.startFade(fade);
  }

  startFade(fade) {
    this.from = this.last;
    this.fade = fade;
    this.fadeTime = 0;
  }

  beginNext(fade) {
    const id = this.queue.shift();
    const action = this.actions[id];
    this.step = { id, action, clip: this.clips[id], time: 0, held: 0 };
    this.startFade(fade);
  }

  advance(dt) {
    const { step } = this;
    if (!step) return;
    step.time += dt;
    step.held += dt;
    const { duration } = step.clip;
    let done = false;
    if (step.action.loop) {
      if (step.time >= duration) step.time %= duration;
      done = step.action.hold !== undefined && step.held >= step.action.hold;
    } else if (step.time >= duration) {
      step.time = duration;
      done = true;
    }
    if (!done) return;
    if (this.queue.length) {
      this.beginNext(0.16);
    } else {
      const finished = this.name;
      this.stop(0.3);
      this.onFinish(finished);
    }
  }

  sample() {
    const { clip, time } = this.step;
    const position = (time / clip.duration) * (clip.frames.length - 1);
    const index = Math.min(Math.floor(position), clip.frames.length - 2);
    const f = position - index;
    const a = clip.frames[index];
    const b = clip.frames[index + 1];
    const out = {};
    this.fields.forEach((field, i) => {
      out[field] = a[i] + (b[i] - a[i]) * f;
    });
    return out;
  }

  apply(base, dt) {
    this.advance(dt);
    const target = { ...DEFAULTS, ...base, ...(this.step ? this.sample() : {}) };
    let pose = target;
    if (this.from && this.fadeTime < this.fade) {
      this.fadeTime += dt;
      const weight = smooth(Math.min(this.fadeTime / this.fade, 1));
      pose = { ...target };
      for (const key of Object.keys(target)) {
        const start = this.from[key] ?? target[key];
        pose[key] = start + (target[key] - start) * weight;
      }
    }
    this.last = pose;
    return pose;
  }
}
