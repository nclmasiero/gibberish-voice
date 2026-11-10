import { OfflineAudioContext } from 'node-web-audio-api';
import { describe, expect, it } from 'vitest';
import { presets, render, speak } from '../src/index.js';

// node-web-audio-api's types are structurally compatible with the DOM ones.
const Offline = OfflineAudioContext as unknown as typeof globalThis.OfflineAudioContext;
const LINE = 'Well met, traveller! Have you seen my cat?';

function stats(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let nan = 0;
  for (const x of data) {
    if (Number.isNaN(x)) nan++;
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  return { peak, rmsDb: 10 * Math.log10(sum / data.length + 1e-12), nan };
}

describe('render', () => {
  it.each(Object.entries(presets))('renders the %s preset cleanly', async (_, voice) => {
    const buffer = await render(LINE, { ...voice, sampleRate: 22050, OfflineAudioContext: Offline });
    const { peak, rmsDb, nan } = stats(buffer);
    expect(nan).toBe(0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.05);
    // Every preset should land in a similar loudness window.
    expect(rmsDb).toBeGreaterThan(-28);
    expect(rmsDb).toBeLessThan(-12);
  });

  it('is sample-identical for the same input', async () => {
    const a = await render(LINE, { sampleRate: 22050, OfflineAudioContext: Offline });
    const b = await render(LINE, { sampleRate: 22050, OfflineAudioContext: Offline });
    expect(a.getChannelData(0)).toEqual(b.getChannelData(0));
  });

  it('renders silence-only text without throwing', async () => {
    const buffer = await render('...', { sampleRate: 22050, OfflineAudioContext: Offline });
    expect(stats(buffer).peak).toBeLessThan(1e-3);
  });

  it('throws a helpful error when no OfflineAudioContext exists', async () => {
    await expect(render('hi')).rejects.toThrow(/OfflineAudioContext/);
  });
});

describe('speak', () => {
  it('schedules onto a given context and resolves when finished', async () => {
    const context = new Offline(1, 22050 * 4, 22050);
    let ended = false;
    const speech = speak('Hello there!', { context, onEnd: () => (ended = true) });
    expect(speech.duration).toBeGreaterThan(0.3);
    expect(speech.duration).toBeLessThan(3);
    await context.startRendering();
    await speech.done;
    expect(ended).toBe(true);
  });

  it('throws a helpful error when no AudioContext exists', () => {
    expect(() => speak('hi')).toThrow(/AudioContext/);
  });
});
