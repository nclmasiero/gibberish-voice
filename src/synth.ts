/**
 * Synthesis: a classic source–filter voice built from stock Web Audio nodes.
 *
 *   buzz (glottal source) ─┐
 *   sub-harmonic (growl) ──┼─ envelope ─┐
 *                          │            ├─ tremor/shimmer ─ F1 → F2 → F3 → F4 ─ shelf ─ limiter ─ out
 *   breath noise ─────────────envelope ─┘
 *
 * The four formant filters are 2-pole resonators in cascade (as in Klatt's
 * 1980 synthesiser). A Web Audio low-pass biquad with its Q given in dB is
 * exactly such a resonator: unity gain at DC and a peak of Q at the cutoff.
 * Pitch is perturbed by slow drift, fast jitter and an optional tremor LFO,
 * because perfectly steady pitch is the main thing that makes synthetic
 * voices sound robotic.
 */
import { BANDWIDTHS } from './phonetics.js';
import type { Key, Timeline } from './plan.js';
import { createRng, hashString } from './random.js';
import type { ResolvedVoice } from './voice.js';

export interface PlaybackOptions {
  /** Audio context to play in. Defaults to a shared `AudioContext` (browser). */
  context?: BaseAudioContext;
  /** Node to connect the voice to. Defaults to `context.destination`. */
  destination?: AudioNode;
  /** Context time (seconds) at which to start. Defaults to right now. */
  when?: number;
  /** Called as each character is spoken – drive a typewriter text box with it. */
  onChar?: (char: string, index: number) => void;
  /** Called once the line has finished (or was stopped). */
  onEnd?: () => void;
}

export interface Speech {
  /** Length of the line in seconds. */
  readonly duration: number;
  /** Context time at which the line starts. */
  readonly startTime: number;
  /** Resolves when the line has finished playing or was stopped. */
  readonly done: Promise<void>;
  /** Stops the line with a short fade-out. Safe to call more than once. */
  stop(): void;
}

let sharedContext: AudioContext | undefined;

export function defaultContext(): AudioContext {
  if (sharedContext) return sharedContext;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) {
    throw new Error(
      'gibberish-voice: no AudioContext available. In Node, pass one in, e.g. ' +
        "`speak(text, { context: new AudioContext() })` with AudioContext from 'node-web-audio-api'.",
    );
  }
  sharedContext = new Ctor();
  return sharedContext;
}

interface SharedBuffers {
  noise: AudioBuffer;
  wander: AudioBuffer;
}
const buffers = new WeakMap<BaseAudioContext, SharedBuffers>();
const BUFFER_SECONDS = 3;

/** White noise for breath, and smooth random "wander" for pitch drift/jitter. */
function sharedBuffers(ctx: BaseAudioContext): SharedBuffers {
  let b = buffers.get(ctx);
  if (b) return b;
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * BUFFER_SECONDS);
  const rng = createRng(0x9e3779b9);

  const noise = ctx.createBuffer(1, length, rate);
  const n = noise.getChannelData(0);
  for (let i = 0; i < length; i++) n[i] = rng() * 2 - 1;

  // Smooth noise: random knots 5 times a second, cosine-interpolated, in [-1, 1].
  // Played at a higher playbackRate it becomes fast jitter instead of slow drift.
  const wander = ctx.createBuffer(1, length, rate);
  const w = wander.getChannelData(0);
  const knotsPerSecond = 5;
  const knots = BUFFER_SECONDS * knotsPerSecond;
  const values = Array.from({ length: knots }, () => rng() * 2 - 1);
  const step = length / knots;
  for (let i = 0; i < length; i++) {
    const pos = i / step;
    const k = Math.floor(pos);
    const a = values[k % knots]!;
    const c = values[(k + 1) % knots]!; // wraps, so the buffer loops seamlessly
    const f = (1 - Math.cos((pos - k) * Math.PI)) / 2;
    w[i] = a + (c - a) * f;
  }

  b = { noise, wander };
  buffers.set(ctx, b);
  return b;
}

/** Harmonic amplitudes falling at `tilt` × 6 dB/octave – a glottal pulse train with lip radiation. */
function glottalWave(ctx: BaseAudioContext, tilt: number): PeriodicWave {
  const harmonics = 64;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) imag[n] = 1 / n ** tilt;
  return ctx.createPeriodicWave(real, imag);
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5);
  }
  return curve;
}
let clipCurve: Float32Array<ArrayBuffer> | undefined;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Schedules a planned line on an audio context. */
export function schedule(
  timeline: Timeline,
  voice: ResolvedVoice,
  text: string,
  options: PlaybackOptions = {},
): Speech {
  const ctx = options.context ?? defaultContext();
  const offline = 'startRendering' in ctx;
  if (!offline && (ctx as AudioContext).state === 'suspended') {
    void (ctx as AudioContext).resume().catch(() => {});
  }

  const when = options.when ?? ctx.currentTime + 0.02;
  const end = when + timeline.duration;
  const rng = createRng(hashString(text, voice.seed ^ 0x5bd1e995));
  const { noise, wander } = sharedBuffers(ctx);
  const nyquistSafe = ctx.sampleRate * 0.45;
  const { breathiness, roughness, shakiness, melody } = voice;

  // ---- Sources --------------------------------------------------------------
  const buzz = ctx.createOscillator();
  buzz.setPeriodicWave(glottalWave(ctx, 1.05 + 0.5 * breathiness - 0.15 * roughness));
  const sub = ctx.createOscillator();
  sub.setPeriodicWave(glottalWave(ctx, 1.4));
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55 * clamp((roughness - 0.25) / 0.75, 0, 1);

  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = 'highpass';
  breathFilter.frequency.value = 400;

  // ---- Pitch perturbation (all in cents, into both oscillators' detune) ------
  const drift = ctx.createBufferSource();
  drift.buffer = wander;
  drift.loop = true;
  drift.playbackRate.value = 0.6;
  const driftGain = ctx.createGain();
  driftGain.gain.value = 10 * melody + 25 * roughness + 15 * shakiness;

  const jitter = ctx.createBufferSource();
  jitter.buffer = wander;
  jitter.loop = true;
  jitter.playbackRate.value = 9; // ≈ 45 Hz wobble: roughness rather than melody
  const jitterGain = ctx.createGain();
  jitterGain.gain.value = 70 * roughness ** 1.3 + 3 * Math.min(1, melody * 3);

  const tremor = ctx.createOscillator();
  tremor.frequency.value = 4.5 + (rng() - 0.5) * 0.8; // physiological tremor sits around 4–7 Hz
  const tremorPitch = ctx.createGain();
  tremorPitch.gain.value = 90 * shakiness;
  const tremorAmp = ctx.createGain();
  tremorAmp.gain.value = 0.35 * shakiness;
  const shimmer = ctx.createGain();
  shimmer.gain.value = 0.3 * roughness;

  for (const mod of [driftGain, jitterGain, tremorPitch]) {
    mod.connect(buzz.detune);
    mod.connect(sub.detune);
  }
  drift.connect(driftGain);
  jitter.connect(jitterGain);
  jitter.connect(shimmer);
  tremor.connect(tremorPitch);
  tremor.connect(tremorAmp);

  // ---- Envelopes & filter chain --------------------------------------------
  const voiceEnv = ctx.createGain();
  const breathEnv = ctx.createGain();
  const ampMod = ctx.createGain(); // 1 ± tremor ± shimmer
  tremorAmp.connect(ampMod.gain);
  shimmer.connect(ampMod.gain);

  buzz.connect(voiceEnv);
  sub.connect(subGain).connect(voiceEnv);
  breath.connect(breathFilter).connect(breathEnv);
  voiceEnv.connect(ampMod);
  breathEnv.connect(ampMod);

  const formants = BANDWIDTHS.map(() => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    return f;
  });
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 2200;
  const makeup = ctx.createGain();
  makeup.gain.value = 0.16;
  const limiter = ctx.createWaveShaper();
  limiter.curve = clipCurve ??= softClipCurve();
  const master = ctx.createGain();
  master.gain.value = voice.volume;

  let node: AudioNode = ampMod;
  for (const f of formants) node = node.connect(f);
  node.connect(shelf).connect(makeup).connect(limiter).connect(master);
  master.connect(options.destination ?? ctx.destination);

  // ---- Automation ------------------------------------------------------------
  const widen = 1 + 0.8 * breathiness; // breathy voices have damped, wider formants
  const automate = (param: AudioParam, value: (k: Key) => number) => {
    const keys = timeline.keys;
    param.setValueAtTime(value(keys[0]!), when);
    for (let i = 1; i < keys.length; i++) {
      param.linearRampToValueAtTime(value(keys[i]!), when + keys[i]!.t);
    }
  };
  automate(voiceEnv.gain, (k) => k.voice);
  automate(breathEnv.gain, (k) => k.noise);
  automate(buzz.frequency, (k) => k.pitch);
  automate(sub.frequency, (k) => k.pitch / 2);
  automate(shelf.gain, (k) => k.bright);
  formants.forEach((filter, i) => {
    const bw = BANDWIDTHS[i]! * widen;
    automate(filter.frequency, (k) => Math.min(k.f[i]!, nyquistSafe));
    automate(filter.Q, (k) => clamp(20 * Math.log10(Math.min(k.f[i]!, nyquistSafe) / bw), 0, 30));
  });

  // ---- Start / stop ----------------------------------------------------------
  const sources: AudioScheduledSourceNode[] = [buzz, sub, breath, drift, jitter, tremor];
  const offset = (s: number) => (rng() * BUFFER_SECONDS * s) % BUFFER_SECONDS;
  buzz.start(when);
  sub.start(when);
  tremor.start(when);
  breath.start(when, offset(1));
  drift.start(when, offset(1));
  jitter.start(when, offset(1));
  const stopAt = end + 0.05;
  for (const s of sources) s.stop(stopAt);

  let finished = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));

  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearInterval(timer);
    master.disconnect();
    resolveDone();
    options.onEnd?.();
  };
  buzz.onended = finish;

  // Character callbacks, polled against the audio clock so they never drift.
  if (options.onChar && !offline) {
    const onChar = options.onChar;
    const chars: { char: string; index: number; time: number }[] = [];
    let index = 0;
    for (const char of text) {
      chars.push({ char, index, time: timeline.charTimes[index] ?? 0 });
      index += char.length;
    }
    let next = 0;
    const tick = () => {
      const elapsed = ctx.currentTime - when;
      while (next < chars.length && chars[next]!.time <= elapsed) {
        const c = chars[next++]!;
        onChar(c.char, c.index);
      }
      if (next >= chars.length && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    timer = setInterval(tick, 8);
    tick();
  }

  return {
    duration: timeline.duration,
    startTime: when,
    done,
    stop() {
      if (finished) return;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const now = ctx.currentTime;
      const at = Math.max(now, when);
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, at + 0.03);
      for (const s of sources) s.stop(at + 0.04);
    },
  };
}
