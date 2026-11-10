# gibberish-voice

Procedural mumble speech for game characters. Pass a line of text and a few voice knobs and you get Animal Crossing / Banjo-style gibberish, synthesised live with the Web Audio API.

**[Try the voices in your browser](https://nclmasiero.github.io/gibberish-voice/)**

- **Zero dependencies and no audio files.** About 7 kB minified and gzipped.
- **The text shapes the voice.** You get one sound per syllable, vowels that follow the spelling, and melody and pauses that follow the punctuation. A name keeps its vowels every time it's said.
- **Distinct characters from a few numbers.** Old men, children, orcs, ghosts, robots. Size changes the vocal tract itself, so a big creature sounds big rather than like a pitched-down man.
- **Built for dialogue boxes.** An `onChar` callback runs on the audio clock, so a typewriter text box never drifts from the voice.
- **Deterministic.** The same text, voice and seed give sample-identical output.

```sh
npm i gibberish-voice
```

## Quick start

```ts
import { speak, presets } from 'gibberish-voice';

speak('Well met, traveller! Have you seen my cat?', presets.elder);
```

Make your own voice by spreading a preset and changing what you like, or start from scratch:

```ts
speak('You smell like elf. Pay the toll, or GO AROUND.', { ...presets.orc, rate: 1.2 });

speak('Psst. Over here.', { pitch: 180, size: 0.9, breathiness: 0.7, mouth: 0.4 });
```

### Typewriter text box

```ts
const box = document.querySelector('#dialogue')!;
box.textContent = '';

const line = speak(text, {
  ...presets.goblin,
  onChar: (char) => (box.textContent += char),
});

// Let the player skip, like in every RPG.
skipButton.onclick = () => {
  line.stop();
  box.textContent = text;
};

await line.done;
```

Browsers only allow audio after a user gesture, so call `speak` from a click or key handler at least once.

## Voice parameters

Every field is optional. Values outside a range are clamped.

| Parameter     | Range      | Default | What it does                                                                                          |
| ------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `pitch`       | 30–1200 Hz | `130`   | Base pitch. Man ≈ 110, woman ≈ 210, child ≈ 300, orc ≈ 70.                                            |
| `size`        | 0.5–2      | `1`     | Vocal tract size relative to an adult man. Scales all formants, so larger sounds bigger. Woman ≈ 0.86, child ≈ 0.75, orc ≈ 1.3. |
| `rate`        | 0.25–4     | `1`     | Speaking speed.                                                                                       |
| `melody`      | 0–1        | `0.5`   | Intonation range. `0` is a flat robot, `1` is sing-song.                                              |
| `breathiness` | 0–1        | `0.15`  | Air in the voice. `1` is a pure whisper.                                                              |
| `roughness`   | 0–1        | `0.1`   | Grit and growl: irregular pitch, shimmer and subharmonics.                                            |
| `shakiness`   | 0–1        | `0`     | Vocal tremor, as in old or frightened characters.                                                     |
| `mouth`       | 0–1        | `0.75`  | Articulation. `0` mutters through closed lips, `1` speaks clearly.                                    |
| `volume`      | 0–1        | `0.8`   | Output level.                                                                                         |
| `seed`        | any number | `0`     | A different take on the same line. The same seed always sounds the same.                              |

### Presets

`man`, `woman`, `child`, `elder`, `orc`, `giant`, `goblin`, `fairy`, `pirate`, `robot`, `ghost`, `sage`.

Presets are plain objects (`presets.orc` is `{ pitch: 68, size: 1.3, … }`), so read them, copy them, or spread them.

### Punctuation is the script

| Text                    | Voice                                          |
| ----------------------- | ---------------------------------------------- |
| `,` `;` `:`             | Short pause with a slight rise ("there's more") |
| `.`                     | Longer pause, pitch falls at the end            |
| `?`                     | Pitch rises on the last syllable                |
| `!`                     | Whole phrase starts higher and louder           |
| `...` or `…`            | Trails off: slower, quieter, falling            |
| `ALL CAPS`              | Shouted: louder, higher, brighter               |

## API

### `speak(text, options?): Speech`

Starts speaking right away and returns a handle. `options` takes every voice parameter above, plus:

| Option        | Type                                     | Description                                                        |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `context`     | `BaseAudioContext`                       | Context to play in. Defaults to a shared `AudioContext`.           |
| `destination` | `AudioNode`                              | Where to connect the voice, for routing into effects, analysers or buses. Defaults to `context.destination`. |
| `when`        | `number`                                 | Context time to start at. Defaults to now.                         |
| `onChar`      | `(char: string, index: number) => void`  | Called as each character is spoken (real-time contexts only).      |
| `onEnd`       | `() => void`                             | Called when the line finishes or is stopped.                       |

The returned `Speech` has:

- `duration: number`: length of the line in seconds.
- `startTime: number`: context time at which it starts.
- `done: Promise<void>`: resolves when the line has finished or was stopped.
- `stop(): void`: fades out quickly and stops. Safe to call more than once.

### `render(text, options?): Promise<AudioBuffer>`

Renders a line offline to a mono `AudioBuffer`, for pre-baking lines or exporting files. It takes the voice parameters plus `sampleRate` (default `44100`) and an optional `OfflineAudioContext` constructor.

### `presets`, `DEFAULT_VOICE`

The preset cast and the default voice values. The `Voice`, `SpeakOptions`, `Speech` and `PresetName` types are exported too.

## Node

Node has no built-in Web Audio, so pass in a context from [`node-web-audio-api`](https://www.npmjs.com/package/node-web-audio-api):

```ts
import { AudioContext, OfflineAudioContext } from 'node-web-audio-api';
import { speak, render, presets } from 'gibberish-voice';

// Play through the speakers
const context = new AudioContext();
await speak('Hello from the terminal!', { ...presets.fairy, context }).done;
await context.close();

// …or render to a buffer (write it out as WAV with any encoder)
const buffer = await render('Hello!', { ...presets.orc, OfflineAudioContext });
```

`scripts/render.mjs` in this repository renders every preset to WAV files and is a working example.

## How it works

This is a small source-filter speech synthesiser driven by a text analyser.

1. **Text → syllables.** Each word is split at its vowel groups. The spelling picks a vowel (`ee` → /i/, `oo` → /u/, `oy` → the /ɔɪ/ diphthong, silent final *e* lengthens the vowel before it), and the surrounding consonants are classed as stops, fricatives, nasals or liquids. Non-Latin scripts fall back to one syllable per character (CJK) or per two letters (other alphabets).
2. **Syllables → keyframes.** Each syllable becomes a swell of loudness. Consonants appear as dips (stops close the mouth, nasals hum) and as formant transitions toward their place of articulation, following locus theory. Pitch follows declination across the phrase, accents on stressed syllables, small random nudges, and the punctuation rules above.
3. **Keyframes → sound.** A glottal pulse wave, plus a sub-octave for roughness and filtered noise for breath, runs through four resonators in cascade, as in Klatt (1980). They are tuned to measured vowel formants (Peterson & Barney 1952, Hillenbrand et al. 1995) and scaled by `size`. Slow pitch drift, fast jitter and an optional 4–5 Hz tremor keep it from sounding mechanical.

Inspired by the Mythfall devlog on mumble speech, which makes the case that rhythm matters more than the sound itself, that small imperfections make a voice feel human, and that punctuation gives you the tune for free.

## Development

```sh
npm install
npm run dev        # demo page at http://localhost:5173
npm test           # unit + offline render tests (uses node-web-audio-api)
npm run build      # emits ESM + .d.ts to dist/
npm run render     # renders every preset to ./renders/*.wav
```

## License

MIT
