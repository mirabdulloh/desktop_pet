export class Spring {
  constructor(value = 0, frequency = 5, damping = 0.72) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.frequency = frequency;
    this.damping = damping;
  }

  step(dt) {
    // Substeps keep stiff springs stable when a frame runs long.
    const steps = Math.ceil(dt / 0.008);
    const h = dt / steps;
    const omega = 2 * Math.PI * this.frequency;
    for (let i = 0; i < steps; i += 1) {
      const accel = omega * omega * (this.target - this.value) - 2 * this.damping * omega * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

function hash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function valueNoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

export function noise(x) {
  return (valueNoise(x) + 0.5 * valueNoise(x * 2.03 + 17) + 0.25 * valueNoise(x * 4.01 + 41)) / 0.875 - 0.857;
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
