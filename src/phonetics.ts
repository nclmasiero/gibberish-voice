/**
 * Acoustic-phonetic reference data.
 *
 * Vowel formants are adult-male averages from Peterson & Barney (1952) and
 * Hillenbrand et al. (1995). Consonant "loci" follow classic locus theory
 * (Delattre, Liberman & Cooper, 1955): the formant frequencies a vowel's
 * transitions point towards when it is next to a given place of articulation.
 * Those transitions are most of what makes a consonant audible, so we get
 * consonant colour without synthesising clicky noise bursts.
 */

/** F1–F4 in Hz for an adult male vocal tract. */
export type Formants = readonly [number, number, number, number];

export type VowelId =
  | 'i' // beet
  | 'I' // bit
  | 'e' // bet
  | 'ae' // bat
  | 'a' // father
  | 'o' // bought
  | 'U' // book
  | 'u' // boot
  | 'A' // but
  | 'er' // bird
  | 'schwa';

export const VOWELS: Record<VowelId, Formants> = {
  i: [270, 2290, 3010, 3500],
  I: [390, 1990, 2550, 3500],
  e: [530, 1840, 2480, 3500],
  ae: [660, 1720, 2410, 3500],
  a: [730, 1090, 2440, 3400],
  o: [570, 840, 2410, 3300],
  U: [440, 1020, 2240, 3300],
  u: [300, 870, 2240, 3300],
  A: [640, 1190, 2390, 3400],
  er: [490, 1350, 1690, 3300],
  schwa: [500, 1500, 2500, 3500],
};

/** Formants of a nearly closed, relaxed mouth (used for muttering). */
export const CLOSED_MOUTH: Formants = [300, 1250, 2400, 3400];

/** Typical formant bandwidths in Hz (F1–F4). */
export const BANDWIDTHS: Formants = [80, 100, 150, 250];

export type Manner = 'stop' | 'fricative' | 'nasal' | 'liquid' | 'aspirate';

export interface Consonant {
  manner: Manner;
  voiced: boolean;
  /** Formant targets during the consonant (locus or sonorant formants). */
  formants: Formants | null;
}

const LABIAL: Formants = [250, 800, 2200, 3300];
const ALVEOLAR: Formants = [300, 1700, 2600, 3500];
const VELAR: Formants = [300, 2000, 2300, 3400];
const PALATAL: Formants = [300, 2100, 2700, 3500];
const DENTAL: Formants = [300, 1500, 2600, 3500];

const c = (manner: Manner, voiced: boolean, formants: Formants | null): Consonant => ({
  manner,
  voiced,
  formants,
});

/** Single letters and digraphs, longest match first. */
export const CONSONANTS: Record<string, Consonant> = {
  sh: c('fricative', false, PALATAL),
  ch: c('fricative', false, PALATAL),
  th: c('fricative', true, DENTAL),
  ph: c('fricative', false, LABIAL),
  ng: c('nasal', true, [280, 1900, 2400, 3400]),
  ck: c('stop', false, VELAR),
  p: c('stop', false, LABIAL),
  b: c('stop', true, LABIAL),
  t: c('stop', false, ALVEOLAR),
  d: c('stop', true, ALVEOLAR),
  k: c('stop', false, VELAR),
  c: c('stop', false, VELAR),
  q: c('stop', false, VELAR),
  x: c('stop', false, VELAR),
  g: c('stop', true, VELAR),
  f: c('fricative', false, LABIAL),
  v: c('fricative', true, LABIAL),
  s: c('fricative', false, ALVEOLAR),
  z: c('fricative', true, ALVEOLAR),
  j: c('fricative', true, PALATAL),
  h: c('aspirate', false, null),
  m: c('nasal', true, [280, 1000, 2300, 3300]),
  n: c('nasal', true, [280, 1600, 2600, 3400]),
  l: c('liquid', true, [360, 1300, 2800, 3400]),
  r: c('liquid', true, [420, 1300, 1600, 3300]),
  w: c('liquid', true, [300, 700, 2200, 3300]),
  y: c('liquid', true, [280, 2200, 2900, 3500]),
};

/** Fallback for any other letter. */
export const NEUTRAL_CONSONANT: Consonant = c('stop', true, ALVEOLAR);

/** Vowel spellings. Two ids = a diphthong (formants glide between them). */
export const VOWEL_GROUPS: Record<string, readonly VowelId[]> = {
  a: ['ae'],
  e: ['e'],
  i: ['I'],
  o: ['a'],
  u: ['A'],
  y: ['I'],
  ee: ['i'],
  ea: ['i'],
  ie: ['i'],
  ei: ['e', 'i'],
  ey: ['e', 'i'],
  ai: ['e', 'i'],
  ay: ['e', 'i'],
  oo: ['u'],
  ou: ['a', 'U'],
  ow: ['o', 'U'],
  oa: ['o', 'U'],
  oe: ['o', 'U'],
  oi: ['o', 'i'],
  oy: ['o', 'i'],
  au: ['o'],
  aw: ['o'],
  ue: ['u'],
  ui: ['u'],
  ew: ['i', 'u'],
  ia: ['i', 'A'],
  io: ['i', 'o'],
  eo: ['i', 'o'],
  ua: ['u', 'a'],
};

/** Vowel quality when lengthened by a silent final "e" (make, time, home). */
export const LONG_VOWELS: Record<string, readonly VowelId[]> = {
  a: ['e', 'i'],
  e: ['i'],
  i: ['a', 'i'],
  o: ['o', 'U'],
  u: ['u'],
  y: ['a', 'i'],
};

/** Vowel quality in an open, single-syllable word (go, me, hi, ma). */
export const OPEN_VOWELS: Record<string, readonly VowelId[]> = {
  a: ['a'],
  e: ['i'],
  i: ['a', 'i'],
  o: ['o', 'U'],
  u: ['u'],
  y: ['a', 'i'],
};

/** Short, usually unstressed English words. They are spoken quicker and flatter. */
export const FUNCTION_WORDS = new Set(
  (
    'a an the and or but of to in on at by for with from as is am are was were be ' +
    'it its i you he she we they me him her us them my your his our their this that ' +
    'do does did has have had will would can could shall should not no so if then than ' +
    "i'm it's you're don't can't let's"
  ).split(' '),
);
