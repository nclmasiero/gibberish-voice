import { describe, expect, it } from 'vitest';
import { plan } from '../src/plan.js';
import { resolveVoice, presets } from '../src/voice.js';

const LINE = 'Well met, traveller! Have you seen my cat? She ran off... again.';

describe('plan', () => {
  it('is deterministic for the same text, voice and seed', () => {
    expect(plan(LINE, resolveVoice({}))).toEqual(plan(LINE, resolveVoice({})));
  });

  it('varies with the seed', () => {
    expect(plan(LINE, resolveVoice({ seed: 1 }))).not.toEqual(plan(LINE, resolveVoice({ seed: 2 })));
  });

  it('produces strictly increasing keyframe times and finite values', () => {
    for (const voice of Object.values(presets)) {
      const { keys } = plan(LINE, resolveVoice(voice));
      for (let i = 1; i < keys.length; i++) expect(keys[i]!.t).toBeGreaterThan(keys[i - 1]!.t);
      for (const k of keys) {
        for (const v of [k.voice, k.noise, k.pitch, k.bright, ...k.f]) expect(Number.isFinite(v)).toBe(true);
        expect(k.voice).toBeGreaterThanOrEqual(0);
        expect(k.pitch).toBeGreaterThan(0);
      }
    }
  });

  it('starts and ends in silence', () => {
    const { keys } = plan(LINE, resolveVoice({}));
    expect(keys[0]!.voice).toBe(0);
    expect(keys.at(-1)!.voice).toBe(0);
  });

  it('speaks faster with a higher rate', () => {
    const slow = plan(LINE, resolveVoice({ rate: 0.5 })).duration;
    const fast = plan(LINE, resolveVoice({ rate: 2 })).duration;
    expect(slow / fast).toBeCloseTo(4, 0);
  });

  it('pauses longer at full stops than at commas', () => {
    const comma = plan('one, two', resolveVoice({})).duration;
    const stop = plan('one. two', resolveVoice({})).duration;
    expect(stop).toBeGreaterThan(comma);
  });

  it('raises the pitch at the end of a question', () => {
    const voice = resolveVoice({ melody: 0.6 });
    const peak = (text: string) => {
      const { keys } = plan(text, voice);
      return keys.filter((k) => k.voice > 0).at(-1)!.pitch;
    };
    expect(peak('You are here?')).toBeGreaterThan(peak('You are here.') * 1.2);
  });

  it('keeps a perfectly flat pitch when melody is 0', () => {
    const { keys } = plan('A flat robotic line, with a pause.', resolveVoice({ pitch: 150, melody: 0 }));
    for (const k of keys) expect(k.pitch).toBeCloseTo(150, 6);
  });

  it('lowers formants for bigger vocal tracts', () => {
    const f2 = (size: number) => Math.max(...plan('see', resolveVoice({ size })).keys.map((k) => k.f[1]));
    expect(f2(1.5)).toBeLessThan(f2(1));
    expect(f2(0.7)).toBeGreaterThan(f2(1));
  });

  it('maps every character to a non-decreasing time', () => {
    const { charTimes, duration } = plan(LINE, resolveVoice({}));
    expect(charTimes).toHaveLength(LINE.length);
    for (let i = 1; i < charTimes.length; i++) expect(charTimes[i]!).toBeGreaterThanOrEqual(charTimes[i - 1]!);
    expect(charTimes.at(-1)!).toBeLessThan(duration);
  });

  it('handles empty text', () => {
    const { keys, duration, charTimes } = plan('', resolveVoice({}));
    expect(keys).toHaveLength(1);
    expect(duration).toBeGreaterThan(0);
    expect(charTimes).toEqual([]);
  });
});

describe('resolveVoice', () => {
  it('fills defaults and clamps out-of-range values', () => {
    const v = resolveVoice({ pitch: 99999, rate: -1, breathiness: 2, mouth: Number.NaN });
    expect(v.pitch).toBe(1200);
    expect(v.rate).toBe(0.25);
    expect(v.breathiness).toBe(1);
    expect(v.mouth).toBe(0.75);
  });
});
