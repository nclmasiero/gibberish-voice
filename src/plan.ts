/**
 * Planning: phrases/words/syllables → a list of keyframes for the synthesiser.
 *
 * Everything here is pure and deterministic. The synthesiser linearly ramps
 * every parameter from one keyframe to the next, so this module only decides
 * *what* the voice is doing *when*: how loud it is, the shape of the mouth
 * (formants), the pitch, and how much breath noise there is.
 */
import {
  CLOSED_MOUTH,
  VOWELS,
  type Consonant,
  type Formants,
  type Manner,
} from './phonetics.js';
import { createRng, hashString } from './random.js';
import { parse, type Ending, type Syllable } from './text.js';
import type { ResolvedVoice } from './voice.js';

export type Quad = [number, number, number, number];

export interface Key {
  /** Seconds from the start of the utterance. */
  t: number;
  /** Amplitude of the voiced (buzz) source. */
  voice: number;
  /** Amplitude of the aspiration (breath) noise. */
  noise: number;
  /** Formant frequencies F1–F4 in Hz, already scaled for the voice's size. */
  f: Quad;
  /** Fundamental frequency in Hz. */
  pitch: number;
  /** High-shelf gain in dB (brightness / vocal effort). */
  bright: number;
}

export interface Timeline {
  keys: Key[];
  /** Total length in seconds, including the release tail. */
  duration: number;
  /** For every UTF-16 index of the text, when that character is "spoken". */
  charTimes: number[];
}

/** Seconds per syllable at `rate: 1`. ≈ 6–7 syllables per second: brisk game chatter. */
const SYLLABLE = 0.15;
const LEAD_IN = 0.02;
const RELEASE = 0.07;

const PAUSES: Record<Ending, number> = {
  none: 0,
  comma: 0.22,
  dash: 0.3,
  period: 0.42,
  question: 0.42,
  exclaim: 0.42,
  ellipsis: 0.65,
};

interface ConsonantShape {
  /** Fraction of the syllable the consonant occupies. */
  length: number;
  voice: number;
  noise: number;
  /** How far formants move towards the consonant's own targets. */
  pull: number;
  /** Transition time into this segment, in seconds. */
  transition: number;
  bright: number;
}

const SHAPES: Record<Manner, { voiced: ConsonantShape; voiceless: ConsonantShape }> = {
  stop: {
    voiced: { length: 0.14, voice: 0.12, noise: 0, pull: 0.65, transition: 0.012, bright: -6 },
    voiceless: { length: 0.16, voice: 0, noise: 0, pull: 0.65, transition: 0.01, bright: 0 },
  },
  fricative: {
    voiced: { length: 0.18, voice: 0.25, noise: 0.12, pull: 0.6, transition: 0.02, bright: -2 },
    voiceless: { length: 0.2, voice: 0, noise: 0.2, pull: 0.6, transition: 0.02, bright: 0 },
  },
  aspirate: {
    voiced: { length: 0.15, voice: 0.05, noise: 0.42, pull: 0, transition: 0.02, bright: 0 },
    voiceless: { length: 0.15, voice: 0.05, noise: 0.42, pull: 0, transition: 0.02, bright: 0 },
  },
  nasal: {
    voiced: { length: 0.2, voice: 0.42, noise: 0, pull: 0.85, transition: 0.03, bright: -7 },
    voiceless: { length: 0.2, voice: 0.42, noise: 0, pull: 0.85, transition: 0.03, bright: -7 },
  },
  liquid: {
    voiced: { length: 0.18, voice: 0.55, noise: 0, pull: 0.8, transition: 0.035, bright: -3 },
    voiceless: { length: 0.18, voice: 0.55, noise: 0, pull: 0.8, transition: 0.035, bright: -3 },
  },
};

const shapeOf = (c: Consonant) => SHAPES[c.manner][c.voiced ? 'voiced' : 'voiceless'];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: Formants, b: Formants, t: number): Quad => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
  lerp(a[3], b[3], t),
];

export function plan(text: string, voice: ResolvedVoice): Timeline {
  const phrases = parse(text);
  const rng = createRng(hashString(text, voice.seed));
  const keys: Key[] = [];
  const charTimes: number[] = new Array<number>(text.length).fill(NaN);

  const base = SYLLABLE / voice.rate;
  const tract = 1 / voice.size;
  const R = voice.melody;
  // Breathiness trades buzz for air; at 1 the voice is a pure whisper.
  const voicing = 1 - 0.94 * voice.breathiness ** 2;
  const breath = 0.03 + 2.2 * voice.breathiness ** 2;
  const mouthOpen = 0.2 + 0.8 * voice.mouth;
  const mouthBright = (voice.mouth - 0.75) * 10;

  /** Vowel/consonant formants → this voice's mouth openness and tract length. */
  const shape = (f: Formants): Quad => {
    const m = mix(CLOSED_MOUTH, f, mouthOpen);
    return [m[0] * tract, m[1] * tract, m[2] * tract, m[3] * tract];
  };
  const hz = (semitones: number) => voice.pitch * 2 ** (semitones / 12);

  let t = LEAD_IN;
  let last: Key = {
    t: 0,
    voice: 0,
    noise: 0,
    f: shape(VOWELS.schwa),
    pitch: voice.pitch,
    bright: mouthBright,
  };
  keys.push(last);

  /** Adds a keyframe; amplitudes are given before voicing/breath are applied. */
  const key = (at: number, amp: number, noise: number, f: Quad, st: number, bright: number) => {
    const k: Key = {
      t: Math.max(at, last.t + 0.001),
      voice: amp * voicing,
      noise: noise + amp * breath,
      f,
      pitch: hz(st),
      bright: bright + mouthBright,
    };
    keys.push(k);
    last = k;
  };
  /** Holds the previous key's values (but silences it) at a given time. */
  const silence = (at: number) => key(at, 0, 0, last.f, Math.log2(last.pitch / voice.pitch) * 12, last.bright - mouthBright);

  for (const phrase of phrases) {
    const total = phrase.words.reduce((n, w) => n + w.syllables.length, 0);
    const ending = phrase.ending;
    const exclaim = ending === 'exclaim';
    const phraseLift = exclaim ? 4 * R : 0;
    const phraseGain = exclaim ? 1.12 : 1;
    let k = 0;

    phrase.words.forEach((word, wi) => {
      word.syllables.forEach((syl, si) => {
        const p = total > 1 ? k / (total - 1) : 0;
        const fromEnd = total - 1 - k;
        const final = fromEnd === 0;
        k++;

        // ---- Duration ------------------------------------------------------
        let dur = base * (0.92 + 0.16 * rng());
        if (syl.stressed) dur *= 1.15;
        if (word.minor) dur *= 0.8;
        if (syl.vowels.length > 1) dur *= 1.15;
        dur *= 1 + 0.06 * (syl.onset.length + syl.coda.length);
        if (final && ending !== 'none') dur *= 1.35; // phrase-final lengthening
        if (ending === 'ellipsis' && fromEnd < 2) dur *= 1.3;
        if (word.shout) dur *= 1.1;

        // ---- Pitch (in semitones relative to the voice's base pitch) --------
        const declination = (1.2 - 2.4 * p) * 1.5 * R; // pitch drifts down across a phrase
        const accent = syl.stressed ? 2.2 * R : word.minor ? -0.5 * R : 0;
        const nudge = (rng() - 0.5) * 2 * R;
        const shout = word.shout ? 3 + 2 * R : 0;
        const st0 = declination + nudge + phraseLift + shout;
        let stPeak = st0 + accent;
        let stEnd = st0 - 0.4 * R;
        if (final) {
          if (ending === 'question') {
            stPeak = st0 + 3 * R;
            stEnd = st0 + 10 * R; // questions rise at the end
          } else if (ending === 'comma') {
            stEnd = st0 + 1.5 * R; // continuation rise
          } else if (ending === 'ellipsis') {
            stEnd = st0 - 3 * R;
          } else {
            stEnd = st0 - 4 * R; // final lowering
          }
        }

        // ---- Loudness -----------------------------------------------------
        let amp = (syl.stressed ? 1 : word.minor ? 0.72 : 0.84) * (1 - 0.15 * p) * phraseGain;
        if (word.shout) amp *= 1.35;
        if (ending === 'ellipsis' && fromEnd < 2) amp *= 0.6;
        const bright = (word.shout ? 4 : 0) + (exclaim ? 1.5 : 0) + (syl.stressed ? 0.5 : 0);

        const start = t;
        emitSyllable(syl, start, dur, amp, st0, stPeak, stEnd, bright, si === 0);
        mapChars(syl, start, start + dur);
        t = start + dur;

        // Brief dip between words so they don't smear into one long word.
        const lastInWord = si === word.syllables.length - 1;
        if (lastInWord && wi < phrase.words.length - 1) {
          const gap = base * 0.16;
          key(t + gap * 0.5, 0.05, 0, last.f, stEnd, bright);
          t += gap;
        }
      });
    });

    // Release, then pause according to punctuation.
    silence(t + RELEASE);
    t += RELEASE + PAUSES[ending] / voice.rate;
  }

  // ---- Syllable → keyframes -----------------------------------------------
  function emitSyllable(
    syl: Syllable,
    start: number,
    dur: number,
    amp: number,
    st0: number,
    stPeak: number,
    stEnd: number,
    bright: number,
    wordInitial: boolean,
  ) {
    const v1 = VOWELS[syl.vowels[0]!];
    const v2 = VOWELS[syl.vowels[syl.vowels.length - 1]!];
    const onsetLen = Math.min(0.45, syl.onset.reduce((s, c) => s + shapeOf(c).length, 0)) * dur;
    const codaLen = Math.min(0.35, syl.coda.reduce((s, c) => s + shapeOf(c).length * 0.8, 0)) * dur;
    const vowelStart = start + onsetLen;
    const vowelEnd = start + dur - codaLen;
    const vowelLen = vowelEnd - vowelStart;

    // Onset consonants.
    if (syl.onset.length === 0 && wordInitial) {
      // Vowel-initial word: a soft glottal onset from silence.
      key(start, 0, 0, shape(v1), st0, bright);
    }
    let cursor = start;
    const onsetScale = onsetLen / Math.max(1e-6, syl.onset.reduce((s, c) => s + shapeOf(c).length, 0) * dur);
    for (const c of syl.onset) {
      const len = shapeOf(c).length * dur * onsetScale;
      consonant(c, cursor, cursor + len, v1, amp, st0, bright);
      cursor += len;
    }

    // Voiceless stops are aspirated on release (the puff of air after p, t, k).
    const lastOnset = syl.onset[syl.onset.length - 1];
    if (lastOnset?.manner === 'stop' && !lastOnset.voiced) {
      const f = shape(mix(v1, lastOnset.formants ?? v1, 0.5));
      key(vowelStart + 0.006, 0.08 * amp, 0.35 * amp, f, st0, bright + 2);
    }

    // The vowel: swell up, hold, let go – with formants gliding for diphthongs.
    const attack = Math.min(0.035, vowelLen * 0.3);
    key(vowelStart + attack, amp * 0.92, 0, shape(v1), st0, bright);
    const mid = syl.vowels.length > 1 ? mix(v1, v2, 0.25) : v1;
    key(vowelStart + vowelLen * 0.5, amp, 0, shape(mid), stPeak, bright);
    const end = syl.vowels.length > 1 ? v2 : mix(v1, VOWELS.schwa, 0.12);
    key(vowelEnd, amp * 0.8, 0, shape(end), stEnd, bright);

    // Coda consonants.
    cursor = vowelEnd;
    const codaScale = codaLen / Math.max(1e-6, syl.coda.reduce((s, c) => s + shapeOf(c).length * 0.8, 0) * dur);
    for (const c of syl.coda) {
      const len = shapeOf(c).length * 0.8 * dur * codaScale;
      consonant(c, cursor, cursor + len, v2, amp, stEnd, bright);
      cursor += len;
    }
  }

  function consonant(
    c: Consonant,
    from: number,
    to: number,
    vowel: Formants,
    amp: number,
    st: number,
    bright: number,
  ) {
    const s = shapeOf(c);
    const f = shape(c.formants ? mix(vowel, c.formants, s.pull) : vowel);
    const tr = Math.min(s.transition, (to - from) * 0.5);
    key(from + tr, s.voice * amp, s.noise * amp, f, st, bright + s.bright);
    key(to, s.voice * amp, s.noise * amp, f, st, bright + s.bright);
  }

  function mapChars(syl: Syllable, t0: number, t1: number) {
    const span = Math.max(1, syl.end - syl.start);
    for (let i = syl.start; i < syl.end; i++) {
      charTimes[i] = t0 + ((i - syl.start) / span) * (t1 - t0);
    }
  }

  // Characters outside syllables (spaces, punctuation) appear right after the
  // character before them, so a text box types punctuation and *then* pauses.
  let prev = 0;
  for (let i = 0; i < charTimes.length; i++) {
    if (Number.isNaN(charTimes[i])) charTimes[i] = prev;
    else prev = charTimes[i]!;
  }

  return { keys, duration: last.t + 0.05, charTimes };
}
