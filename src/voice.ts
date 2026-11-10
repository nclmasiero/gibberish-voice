/**
 * A voice is a handful of numbers. Every field is optional; anything left out
 * falls back to a neutral adult voice.
 */
export interface Voice {
  /** Base pitch in Hz. Man ≈ 110, woman ≈ 210, child ≈ 300, orc ≈ 70. Default `130`. */
  pitch?: number;
  /**
   * Vocal tract size relative to an adult man. Bigger creatures have longer
   * throats, which lowers every formant at once — that, not pitch, is what makes
   * a voice sound *big*. Woman ≈ 0.86, child ≈ 0.75, orc ≈ 1.25, giant ≈ 1.5.
   * Range `0.5–2`, default `1`.
   */
  size?: number;
  /** Speaking speed multiplier. `0.5` drawls, `2` gabbles. Range `0.25–4`, default `1`. */
  rate?: number;
  /** How sing-song the intonation is. `0` is a flat robot, `1` is very animated. Default `0.5`. */
  melody?: number;
  /** Air in the voice. `0` is clear, `1` is a pure whisper. Default `0.15`. */
  breathiness?: number;
  /** Grit and growl: irregular vocal folds and subharmonics. Default `0.1`. */
  roughness?: number;
  /** Shaky, quavering voice (vocal tremor), as in old or frightened characters. Default `0`. */
  shakiness?: number;
  /** How open the mouth is. `0` mutters through closed lips, `1` articulates clearly. Default `0.75`. */
  mouth?: number;
  /** Output level. Range `0–1`, default `0.8`. */
  volume?: number;
  /**
   * Variation seed. The same text with the same voice always sounds identical;
   * change the seed to get a different take on the same line.
   */
  seed?: number;
}

export type ResolvedVoice = Required<Voice>;

export const DEFAULT_VOICE: ResolvedVoice = {
  pitch: 130,
  size: 1,
  rate: 1,
  melody: 0.5,
  breathiness: 0.15,
  roughness: 0.1,
  shakiness: 0,
  mouth: 0.75,
  volume: 0.8,
  seed: 0,
};

const RANGES: Record<keyof Voice, readonly [number, number]> = {
  pitch: [30, 1200],
  size: [0.5, 2],
  rate: [0.25, 4],
  melody: [0, 1],
  breathiness: [0, 1],
  roughness: [0, 1],
  shakiness: [0, 1],
  mouth: [0, 1],
  volume: [0, 1],
  seed: [-Infinity, Infinity],
};

/** Fills in defaults and clamps every field into its valid range. */
export function resolveVoice(voice: Voice = {}): ResolvedVoice {
  const out = { ...DEFAULT_VOICE };
  for (const key of Object.keys(RANGES) as (keyof Voice)[]) {
    const value = voice[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const [min, max] = RANGES[key];
      out[key] = Math.min(max, Math.max(min, value));
    }
  }
  return out;
}

/** A ready-made cast. Spread one and override what you like: `{ ...presets.orc, rate: 1.2 }`. */
export const presets = {
  man: { pitch: 112, size: 1, rate: 1, melody: 0.45, breathiness: 0.12, roughness: 0.12, mouth: 0.75 },
  woman: { pitch: 205, size: 0.86, rate: 1.05, melody: 0.6, breathiness: 0.28, roughness: 0.05, mouth: 0.8 },
  child: { pitch: 290, size: 0.74, rate: 1.15, melody: 0.8, breathiness: 0.2, roughness: 0.04, mouth: 0.85 },
  elder: { pitch: 150, size: 0.97, rate: 0.78, melody: 0.5, breathiness: 0.42, roughness: 0.3, shakiness: 0.65, mouth: 0.6 },
  orc: { pitch: 68, size: 1.3, rate: 0.85, melody: 0.3, breathiness: 0.18, roughness: 0.75, mouth: 0.6 },
  giant: { pitch: 50, size: 1.6, rate: 0.6, melody: 0.25, breathiness: 0.1, roughness: 0.45, mouth: 0.7 },
  goblin: { pitch: 330, size: 0.78, rate: 1.45, melody: 0.95, breathiness: 0.1, roughness: 0.4, mouth: 0.8 },
  fairy: { pitch: 560, size: 0.62, rate: 1.4, melody: 0.85, breathiness: 0.5, roughness: 0, mouth: 0.9 },
  pirate: { pitch: 118, size: 1.08, rate: 0.95, melody: 0.55, breathiness: 0.2, roughness: 0.45, mouth: 0.22 },
  robot: { pitch: 120, size: 1, rate: 1, melody: 0, breathiness: 0, roughness: 0, shakiness: 0, mouth: 0.9 },
  ghost: { pitch: 160, size: 0.92, rate: 0.7, melody: 0.6, breathiness: 0.95, roughness: 0, shakiness: 0.3, mouth: 0.7 },
  sage: { pitch: 95, size: 1.1, rate: 0.72, melody: 0.35, breathiness: 0.3, roughness: 0.2, shakiness: 0.15, mouth: 0.55 },
} as const satisfies Record<string, Voice>;

export type PresetName = keyof typeof presets;
