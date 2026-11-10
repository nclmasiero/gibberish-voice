/**
 * gibberish-voice — procedural mumble speech ("gibberish") for game characters.
 *
 * @example
 * import { speak, presets } from 'gibberish-voice';
 * speak('Well met, traveller!', { ...presets.elder, onChar: (c) => box.textContent += c });
 */
import { plan } from './plan.js';
import { schedule, type PlaybackOptions, type Speech } from './synth.js';
import { resolveVoice, type Voice } from './voice.js';

export { presets, DEFAULT_VOICE, type Voice, type PresetName } from './voice.js';
export type { PlaybackOptions, Speech } from './synth.js';

export interface SpeakOptions extends Voice, PlaybackOptions {}

/**
 * Speaks a line of text as mumble speech.
 *
 * The text is never pronounced; it shapes the voice. One sound per syllable,
 * vowels that follow the spelling, and pitch and pauses that follow the
 * punctuation. The same text and voice always produce the same sound.
 */
export function speak(text: string, options: SpeakOptions = {}): Speech {
  const voice = resolveVoice(options);
  return schedule(plan(text, voice), voice, text, options);
}

export interface RenderOptions extends Voice {
  /** Output sample rate. Default `44100`. */
  sampleRate?: number;
  /**
   * `OfflineAudioContext` constructor to render with. Defaults to the global one;
   * in Node pass the one from `node-web-audio-api`.
   */
  OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

/** Renders a line to an `AudioBuffer` instead of playing it — for pre-baking or exporting. */
export async function render(text: string, options: RenderOptions = {}): Promise<AudioBuffer> {
  const Ctor =
    options.OfflineAudioContext ??
    (globalThis as { OfflineAudioContext?: RenderOptions['OfflineAudioContext'] }).OfflineAudioContext;
  if (!Ctor) {
    throw new Error(
      "gibberish-voice: no OfflineAudioContext available. In Node, pass the one from 'node-web-audio-api'.",
    );
  }
  const voice = resolveVoice(options);
  const timeline = plan(text, voice);
  const sampleRate = options.sampleRate ?? 44100;
  const context = new Ctor(1, Math.max(1, Math.ceil((timeline.duration + 0.1) * sampleRate)), sampleRate);
  schedule(timeline, voice, text, { context, when: 0 });
  return context.startRendering();
}
