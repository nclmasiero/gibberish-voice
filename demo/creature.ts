/**
 * The puppet on the stage. Its body is a picture of the voice parameters:
 *   pitch → colour, size → bulk, roughness → spiky outline, shakiness → tremble
 *   and heavy eyelids, breathiness → exhaled mist (and translucency when whispering),
 *   mouth → mouth width, melody → how much the brows bounce.
 * The mouth and waveform ring are driven by the real audio through an AnalyserNode.
 */
import type { Voice } from '../src/index.js';

type Params = Required<Omit<Voice, 'seed' | 'volume'>>;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const KEYS: (keyof Params)[] = ['pitch', 'size', 'rate', 'melody', 'breathiness', 'roughness', 'shakiness', 'mouth'];

/** Pitch → hue along a path that makes orcs green, men blue, women pink and fairies gold. */
export function hueForPitch(pitch: number): number {
  const stops: [number, number][] = [
    [45, 120],
    [110, 205],
    [210, 330],
    [330, 375],
    [600, 410],
  ];
  const lp = Math.log(pitch);
  if (lp <= Math.log(stops[0]![0])) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [p, h] = stops[i]!;
    if (lp <= Math.log(p)) {
      const [p0, h0] = stops[i - 1]!;
      const t = (lp - Math.log(p0)) / (Math.log(p) - Math.log(p0));
      return (h0 + (h - h0) * t) % 360;
    }
  }
  return stops[stops.length - 1]![1] % 360;
}

export class Creature {
  private ctx: CanvasRenderingContext2D;
  private shown: Params;
  private target: Params;
  private analyser: AnalyserNode | null = null;
  private wave = new Float32Array(1024);
  private level = 0;
  private particles: Particle[] = [];
  private blinkAt = 2;
  private blink = 0;
  private width = 0;
  private height = 0;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Per-vertex spike pattern so roughness reads as fur, not noise. */
  private spikes = Array.from({ length: 96 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 2.399) * Math.cos(i * 0.7));

  constructor(private canvas: HTMLCanvasElement, initial: Params) {
    this.ctx = canvas.getContext('2d')!;
    this.shown = { ...initial };
    this.target = { ...initial };
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  setVoice(voice: Params) {
    this.target = { ...voice };
  }

  attach(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.wave = new Float32Array(analyser.fftSize);
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame = (ms: number) => {
    const t = ms / 1000;
    this.update(t);
    this.draw(t);
    requestAnimationFrame(this.frame);
  };

  private update(t: number) {
    for (const k of KEYS) {
      const ease = k === 'pitch' ? 0.08 : 0.12;
      this.shown[k] += (this.target[k] - this.shown[k]) * ease;
    }

    let rms = 0;
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.wave);
      for (const x of this.wave) rms += x * x;
      rms = Math.sqrt(rms / this.wave.length);
    }
    const target = Math.min(1, rms * 5.5);
    this.level += (target - this.level) * (target > this.level ? 0.55 : 0.18);

    if (t > this.blinkAt) {
      this.blink = 1;
      this.blinkAt = t + 2.5 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - 0.12);
  }

  private draw(t: number) {
    const { ctx, width: w, height: h, shown: p } = this;
    const still = this.reduceMotion.matches;
    const level = this.level;
    ctx.clearRect(0, 0, w, h);

    const fit = Math.min(w, h * 1.3);
    const R = fit * (0.13 + 0.1 * Math.min(1, Math.max(0, (p.size - 0.55) / 1.1)));
    const tremble = still ? 0 : p.shakiness * (2 + level * 5) * Math.sin(t * Math.PI * 2 * 4.5);
    const bob = still ? 0 : Math.sin(t * 1.6) * R * 0.025;
    const cx = w / 2 + tremble;
    const cy = h * 0.47 + bob - level * R * 0.04;
    const hue = hueForPitch(p.pitch);
    const ghost = Math.max(0, (p.breathiness - 0.6) / 0.4);

    // Shadow on the floor.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(w / 2, cy + R * 1.18, R * (0.9 - ghost * 0.3), R * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawRing(cx, cy, R, hue);

    // Body.
    const squashX = 1 - level * 0.035;
    const squashY = 1 + level * 0.07;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(squashX, squashY);
    ctx.globalAlpha = 1 - ghost * 0.45;
    const n = this.spikes.length;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      let r = R;
      if (!still) r *= 1 + 0.025 * Math.sin(a * 3 + t * 0.9) + 0.012 * Math.sin(t * 2.2);
      const spike = this.spikes[i % n]!;
      r += R * p.roughness * 0.16 * (i % 2 === 0 ? spike : -0.35 * spike);
      if (!still && p.roughness > 0) r += R * p.roughness * level * 0.05 * Math.sin(i * 7 + t * 40);
      let y = Math.sin(a) * r;
      // Ghosts trail off into a wavy hem.
      if (ghost > 0 && Math.sin(a) > 0.2) y += ghost * R * 0.22 * (Math.sin(a) - 0.2) * (1 + 0.5 * Math.sin(Math.cos(a) * 9 + t * 3));
      const x = Math.cos(a) * r * 1.04;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const body = ctx.createRadialGradient(-R * 0.3, -R * 0.45, R * 0.1, 0, 0, R * 1.2);
    body.addColorStop(0, `hsl(${hue} 80% 72%)`);
    body.addColorStop(1, `hsl(${hue} 55% 46%)`);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, R * 0.035);
    ctx.strokeStyle = `hsl(${hue} 45% 22%)`;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Cheeks.
    ctx.fillStyle = `hsla(${(hue + 340) % 360} 90% 70% / 0.45)`;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * R * 0.52, R * 0.12, R * 0.13, R * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawEyes(R, hue, t, still, level);
    this.drawMouth(R, hue, level);
    ctx.restore();

    this.drawMist(cx, cy + R * 0.2 * squashY, R, level, p.breathiness);
  }

  private drawEyes(R: number, hue: number, t: number, still: boolean, level: number) {
    const { ctx, shown: p } = this;
    const e = R * 0.17 * Math.min(1.35, 1 / Math.sqrt(p.size));
    const lid = Math.max(this.blink, 0.08 + p.shakiness * 0.42 + (p.mouth < 0.35 ? 0.15 : 0));
    const look = still ? 0 : Math.sin(t * 0.7) * e * 0.25;
    const browLift = level * p.melody * R * 0.12;

    for (const s of [-1, 1]) {
      const ex = s * R * 0.34;
      const ey = -R * 0.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, e, e * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e2240';
      ctx.beginPath();
      ctx.arc(ex + look, ey + e * 0.15, e * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + look - e * 0.18, ey - e * 0.05, e * 0.15, 0, Math.PI * 2);
      ctx.fill();

      // Eyelid.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(ex, ey, e * 1.05, e * 1.15, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `hsl(${hue} 50% 40%)`;
      ctx.fillRect(ex - e * 1.2, ey - e * 1.2, e * 2.4, e * 2.3 * lid);
      ctx.restore();

      // Brow: bounces with the voice, more for melodic voices; angry tilt when rough.
      ctx.strokeStyle = `hsl(${hue} 45% 22%)`;
      ctx.lineWidth = Math.max(2.5, R * 0.045);
      ctx.lineCap = 'round';
      const by = ey - e * 1.45 - browLift;
      const tilt = -(p.roughness - 0.3) * e * 0.6;
      ctx.beginPath();
      ctx.moveTo(ex - s * e * 0.85, by - tilt);
      ctx.lineTo(ex + s * e * 0.85, by + tilt);
      ctx.stroke();
    }
  }

  private drawMouth(R: number, hue: number, level: number) {
    const { ctx, shown: p } = this;
    const mw = R * (0.16 + 0.32 * p.mouth);
    const open = level * R * 0.42 * (0.35 + 0.65 * p.mouth);
    const my = R * 0.22;
    ctx.strokeStyle = `hsl(${hue} 45% 22%)`;
    ctx.lineWidth = Math.max(2.5, R * 0.035);
    if (open < 2) {
      ctx.beginPath();
      ctx.moveTo(-mw, my);
      ctx.quadraticCurveTo(0, my + R * 0.09, mw, my);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(-mw, my);
    ctx.quadraticCurveTo(0, my - open * 0.25, mw, my);
    ctx.quadraticCurveTo(mw * 0.9, my + open, 0, my + open);
    ctx.quadraticCurveTo(-mw * 0.9, my + open, -mw, my);
    ctx.closePath();
    ctx.fillStyle = '#3a1630';
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ff7aa2';
    ctx.beginPath();
    ctx.ellipse(0, my + open * 0.95, mw * 0.55, open * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRing(cx: number, cy: number, R: number, hue: number) {
    const { ctx, wave } = this;
    const ringR = R * 1.45;
    const points = 160;
    const step = Math.max(1, Math.floor(wave.length / points));
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2 - Math.PI / 2;
      const s = wave[(i % points) * step] ?? 0;
      const r = ringR + s * R * 0.9;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(${hue} 90% 75% / ${0.18 + this.level * 0.6})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawMist(mx: number, my: number, R: number, level: number, breathiness: number) {
    const { ctx } = this;
    if (!this.reduceMotion.matches && level > 0.05 && Math.random() < breathiness * level * 1.6) {
      this.particles.push({
        x: mx + (Math.random() - 0.5) * R * 0.3,
        y: my,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 0.4 + Math.random() * 0.9,
        life: 1,
        size: R * (0.05 + Math.random() * 0.08),
      });
    }
    ctx.fillStyle = '#fff';
    this.particles = this.particles.filter((q) => {
      q.x += q.vx;
      q.y += q.vy;
      q.vy *= 0.97;
      q.size *= 1.015;
      q.life -= 0.016;
      if (q.life <= 0) return false;
      ctx.globalAlpha = q.life * 0.35;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
  }
}
