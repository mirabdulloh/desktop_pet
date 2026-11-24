import { Spring, noise } from './motion.js';

const num = (value) => value.toFixed(3);

export class Puppet {
  constructor(svg) {
    this.joints = new Map();
    svg.querySelectorAll('[data-joint]').forEach((el) => {
      const [px, py] = el.dataset.pivot.split(' ').map(Number);
      this.joints.set(el.dataset.joint, {
        el,
        px,
        py,
        sway: Number(el.dataset.sway) || 0,
        follow: Number(el.dataset.follow) || 0,
        parallax: Number(el.dataset.parallax) || 0,
        spring: new Spring(0, Number(el.dataset.freq) || 5, Number(el.dataset.damp) || 0.72),
      });
    });

    this.layers = [...svg.querySelectorAll('[data-parallax]:not([data-joint])')].map((el) => ({
      el,
      depth: Number(el.dataset.parallax),
    }));
    this.eyes = [...svg.querySelectorAll('[data-eye]')].map((el) => {
      const [x, y] = el.dataset.eye.split(' ').map(Number);
      return { el, x, y };
    });
    this.irises = [...svg.querySelectorAll('[data-iris]')];
    this.blush = [...svg.querySelectorAll('[data-blush]')];
    this.happyEyes = svg.querySelector('[data-happy]');
    this.brows = svg.querySelector('[data-brows]');
    this.mouth = svg.querySelector('[data-mouth]');
    this.shadow = svg.querySelector('[data-shadow]');

    this.s = {
      lookX: new Spring(0, 2.6, 0.82),
      lookY: new Spring(0, 2.6, 0.82),
      eyeX: new Spring(0, 14, 0.9),
      eyeY: new Spring(0, 14, 0.9),
      lid: new Spring(1, 16, 0.85),
      happy: new Spring(0, 7, 0.9),
      smile: new Spring(0.4, 5, 0.85),
      open: new Spring(0, 11, 0.75),
      brow: new Spring(0, 7, 0.75),
      blush: new Spring(0.25, 2.5, 1),
      squashY: new Spring(1, 5.5, 0.38),
      facing: new Spring(1, 5, 0.9),
    };
  }

  squash(amount) {
    this.s.squashY.value = 1 - amount;
  }

  step(dt, time, input) {
    const { pose, look, eye, face, accel, facing, breathRate } = input;
    const s = this.s;

    s.lookX.target = look.x * facing;
    s.lookY.target = look.y;
    s.eyeX.target = eye.x * facing;
    s.eyeY.target = eye.y;
    s.lid.target = face.lid;
    s.happy.target = face.happy;
    s.smile.target = face.smile;
    s.open.target = face.open;
    s.brow.target = face.brow;
    s.blush.target = face.blush;
    s.facing.target = facing;
    Object.values(s).forEach((spring) => spring.step(dt));

    const breath = Math.sin(time * breathRate + noise(time * 0.17) * 1.6);
    const additive = {
      root: noise(time * 0.19 + 3) * 1.4,
      torso: noise(time * 0.31 + 11) * 2.2 + breath * 0.35,
      head: noise(time * 0.27 + 29) * 5 + s.lookX.value * 0.45,
      armL: noise(time * 0.41 + 47) * 3.5 + breath * 0.9,
      armR: noise(time * 0.37 + 61) * 3.5 - breath * 0.9,
      foreL: noise(time * 0.53 + 71) * 4,
      foreR: noise(time * 0.49 + 83) * 4,
      lockL: noise(time * 0.7 + 97) * 2.5,
      lockR: noise(time * 0.66 + 101) * 2.5,
      ahoge: noise(time * 0.9 + 113) * 6,
    };

    const head = this.joints.get('head');
    for (const [name, joint] of this.joints) {
      joint.spring.target = (pose[name] || 0) + (additive[name] || 0);
      if (joint.follow) joint.spring.target += head.spring.value * joint.follow;
      if (joint.sway) {
        joint.spring.velocity += (-accel.x * 42 + Math.abs(accel.y) * Math.sin(time * 9) * 12) * joint.sway * dt * 60;
        joint.spring.velocity += (head.spring.target - head.spring.value) * joint.sway * 0.25;
      }
      joint.spring.step(dt);
    }

    this.render(breath);
  }

  render(breath) {
    const s = this.s;
    const sy = s.squashY.value + breath * 0.009;
    const sx = 1 / Math.sqrt(Math.max(sy, 0.6));
    let flip = s.facing.value;
    if (Math.abs(flip) < 0.12) flip = flip < 0 ? -0.12 : 0.12;

    for (const [name, joint] of this.joints) {
      const angle = num(joint.spring.value);
      if (name === 'root') {
        joint.el.setAttribute(
          'transform',
          `translate(${joint.px} ${joint.py}) rotate(${angle}) scale(${num(sx * flip)} ${num(sy)}) translate(${-joint.px} ${-joint.py})`,
        );
      } else {
        joint.el.setAttribute('transform', `rotate(${angle} ${joint.px} ${joint.py})`);
      }
    }

    const x = s.lookX.value;
    const y = s.lookY.value;
    for (const { el, depth } of this.layers) {
      el.setAttribute('transform', `translate(${num(x * depth)} ${num(y * depth)})`);
    }

    const happy = Math.max(0, Math.min(1, s.happy.value));
    const lid = Math.max(0.06, s.lid.value) * (1 - happy);
    for (const { el, x: ex, y: ey } of this.eyes) {
      el.setAttribute('transform', `translate(0 ${ey}) scale(1 ${num(Math.max(lid, 0.06))}) translate(0 ${-ey})`);
      el.setAttribute('opacity', happy > 0.75 ? 0 : 1);
    }
    this.happyEyes.setAttribute('opacity', happy > 0.75 ? 1 : 0);
    for (const iris of this.irises) {
      iris.setAttribute('transform', `translate(${num(s.eyeX.value)} ${num(s.eyeY.value)})`);
    }

    this.brows.setAttribute('transform', `translate(${num(x * 0.15)} ${num(s.brow.value)})`);
    this.blush.forEach((el) => el.setAttribute('opacity', num(Math.max(0, Math.min(0.85, s.blush.value)))));

    const open = Math.max(0, s.open.value);
    const smile = s.smile.value;
    const w = 7 + smile * 3 - open * 2;
    const my = 144 - smile * 2.5;
    const curve = my + smile * 6;
    this.mouth.setAttribute(
      'd',
      `M${num(120 - w)} ${num(my)} Q120 ${num(curve)} ${num(120 + w)} ${num(my)} Q120 ${num(curve + open * 18)} ${num(120 - w)} ${num(my)}Z`,
    );
    this.shadow.setAttribute('rx', num(46 * sx));
  }
}
