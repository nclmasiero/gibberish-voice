/**
 * Text analysis: turns a line of dialogue into phrases → words → syllables.
 *
 * English spelling is famously irregular, so this is a set of cheap heuristics
 * rather than a pronunciation dictionary. The goal is not correct speech, it is
 * mumble that has the *shape* of the text: one sound per syllable, vowels that
 * follow the spelling, and rhythm and melody that follow the punctuation.
 */
import {
  CONSONANTS,
  FUNCTION_WORDS,
  LONG_VOWELS,
  NEUTRAL_CONSONANT,
  OPEN_VOWELS,
  VOWEL_GROUPS,
  type Consonant,
  type VowelId,
} from './phonetics.js';
import { hashString } from './random.js';

export interface Syllable {
  /** One vowel, or two for a diphthong. */
  vowels: readonly VowelId[];
  /** Consonants before the vowel (at most two). */
  onset: Consonant[];
  /** Consonants after the vowel (at most two). */
  coda: Consonant[];
  /** Character range in the original text, `[start, end)`. */
  start: number;
  end: number;
  stressed: boolean;
}

export interface Word {
  syllables: Syllable[];
  /** ALL-CAPS word: spoken louder and higher. */
  shout: boolean;
  /** Short grammatical word (the, of, is…): spoken quicker and flatter. */
  minor: boolean;
  start: number;
  end: number;
}

export type Ending = 'none' | 'comma' | 'period' | 'question' | 'exclaim' | 'ellipsis' | 'dash';

export interface Phrase {
  words: Word[];
  ending: Ending;
  /** Character index just past the phrase's closing punctuation. */
  end: number;
}

const ENDING_PRIORITY: Record<Ending, number> = {
  none: 0,
  comma: 1,
  dash: 2,
  period: 3,
  ellipsis: 4,
  exclaim: 5,
  question: 6,
};

const TOKEN = /[\p{L}\p{M}\p{N}'’]+|\.{2,}|…|\s[-–—]+\s|[–—]+|[.,;:!?\n]/gu;
const HAS_ALNUM = /[\p{L}\p{N}]/u;
const SYLLABIC_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Yi}]/u;
const FALLBACK_VOWELS: readonly VowelId[] = ['a', 'e', 'i', 'o', 'u', 'ae', 'A', 'I', 'U'];
const FALLBACK_ONSETS = ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'g', 'd', 'b', 'p'];

function punctuationEnding(token: string): Ending {
  if (token.length > 1 && token.includes('.')) return 'ellipsis';
  switch (token.trim()[0]) {
    case '…':
      return 'ellipsis';
    case ',':
    case ';':
    case ':':
      return 'comma';
    case '!':
      return 'exclaim';
    case '?':
      return 'question';
    case '.':
    case '\n':
      return 'period';
    default:
      return 'dash';
  }
}

/** Splits text into phrases, each closed by punctuation (or the end of the text). */
export function parse(text: string): Phrase[] {
  const phrases: Phrase[] = [];
  let words: Word[] = [];

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const index = match.index;
    if (HAS_ALNUM.test(token)) {
      const word = analyzeWord(token, index);
      if (word.syllables.length > 0) words.push(word);
      continue;
    }
    const ending = punctuationEnding(token);
    const end = index + token.length;
    if (words.length > 0) {
      phrases.push({ words, ending, end });
      words = [];
    } else {
      // Repeated punctuation ("?!", "!!!") upgrades the previous phrase's ending.
      const last = phrases[phrases.length - 1];
      if (last && token !== '\n') {
        if (ENDING_PRIORITY[ending] > ENDING_PRIORITY[last.ending]) last.ending = ending;
        last.end = end;
      }
    }
  }
  if (words.length > 0) {
    phrases.push({ words, ending: 'none', end: words[words.length - 1]!.end });
  }
  return phrases;
}

interface Letter {
  ch: string;
  /** Index into the original text. */
  index: number;
  /** Carried a diacritic (é, ü…), so it is never silent. */
  marked: boolean;
}

function analyzeWord(token: string, start: number): Word {
  const lower = token.toLowerCase().replace(/’/g, "'");
  const syllables: Syllable[] = [];
  let latin: Letter[] = [];
  let alphabetRun: Letter[] = [];
  let hasUpper = false;
  let hasLower = false;
  let letterCount = 0;

  const flushLatin = () => {
    if (latin.length) syllables.push(...syllabifyLatin(latin));
    latin = [];
  };
  const flushAlphabet = () => {
    // Non-Latin alphabets (Cyrillic, Greek, Arabic…): roughly one syllable per two letters.
    for (let i = 0; i < alphabetRun.length; i += 2) {
      const chunk = alphabetRun.slice(i, i + 2);
      syllables.push(fallbackSyllable(chunk.map((l) => l.ch).join(''), chunk[0]!.index));
    }
    alphabetRun = [];
  };

  let offset = 0;
  for (const ch of token) {
    const index = start + offset;
    offset += ch.length;
    if (ch === "'" || ch === '’' || /\p{M}/u.test(ch)) continue;
    if (/\p{L}/u.test(ch)) {
      letterCount++;
      if (ch !== ch.toLowerCase()) hasUpper = true;
      if (ch !== ch.toUpperCase()) hasLower = true;
    }
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/^[a-z]+$/.test(base)) {
      flushAlphabet();
      for (const b of base) latin.push({ ch: b, index, marked: base !== ch.toLowerCase() });
    } else if (/\p{N}/u.test(ch) || SYLLABIC_SCRIPT.test(ch)) {
      flushLatin();
      flushAlphabet();
      syllables.push(fallbackSyllable(ch, index));
    } else if (/\p{L}/u.test(ch)) {
      flushLatin();
      alphabetRun.push({ ch, index, marked: false });
    }
  }
  flushLatin();
  flushAlphabet();

  // Contiguous character ranges, so every character maps to a syllable.
  const end = start + token.length;
  syllables.forEach((s, i) => {
    s.start = i === 0 ? start : Math.max(s.start, syllables[i - 1]!.start);
    s.end = i === syllables.length - 1 ? end : syllables[i + 1]!.start;
  });

  const minor = FUNCTION_WORDS.has(lower);
  if (!minor && syllables.length > 0) {
    const stressIndex =
      syllables.length > 1 && /(tion|sion|ic|ique)$/.test(lower) ? syllables.length - 2 : 0;
    syllables[stressIndex]!.stressed = true;
  }

  return {
    syllables,
    shout: letterCount >= 2 && hasUpper && !hasLower,
    minor,
    start,
    end,
  };
}

/** A deterministic syllable for characters we have no spelling rules for. */
function fallbackSyllable(chars: string, index: number): Syllable {
  const h = hashString(chars);
  const onset = FALLBACK_ONSETS[h % FALLBACK_ONSETS.length]!;
  return {
    vowels: [FALLBACK_VOWELS[(h >>> 8) % FALLBACK_VOWELS.length]!],
    onset: onset ? [CONSONANTS[onset]!] : [],
    coda: [],
    start: index,
    end: index + chars.length,
    stressed: false,
  };
}

const isVowelLetter = (ch: string | undefined) => ch !== undefined && 'aeiou'.includes(ch);

function syllabifyLatin(letters: Letter[]): Syllable[] {
  const s = letters.map((l) => l.ch).join('');
  const n = s.length;

  // 1. Classify each letter as vowel (part of a nucleus), consonant, or silent.
  const kind: ('v' | 'c' | 'silent')[] = [];
  for (let i = 0; i < n; i++) {
    const ch = s[i]!;
    if (isVowelLetter(ch)) {
      // "qu" → the u is really a w.
      kind.push(ch === 'u' && s[i - 1] === 'q' ? 'c' : 'v');
    } else if (ch === 'y') {
      kind.push(i > 0 && !isVowelLetter(s[i + 1]) ? 'v' : 'c');
    } else if (ch === 'w') {
      kind.push(i > 0 && kind[i - 1] === 'v' && !isVowelLetter(s[i + 1]) ? 'v' : 'c');
    } else if (ch === 'g' && s[i + 1] === 'h' && i > 0 && kind[i - 1] === 'v') {
      kind.push('silent', 'silent'); // night, though
      i++;
    } else {
      kind.push('c');
    }
  }

  // 2. Find vowel groups (nuclei).
  const groups: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 'v') continue;
    const from = i;
    while (i + 1 < n && kind[i + 1] === 'v') i++;
    groups.push({ from, to: i + 1 });
  }

  // 3. Silent final "e" (make, time, table) – and it lengthens the vowel before it.
  let lengthened = -1;
  const last = groups[groups.length - 1];
  if (
    groups.length > 1 &&
    last &&
    last.from === n - 1 &&
    s[n - 1] === 'e' &&
    !letters[n - 1]!.marked &&
    kind[n - 2] === 'c'
  ) {
    groups.pop();
    kind[n - 1] = 'silent';
    const prev = groups[groups.length - 1]!;
    if (prev.to - prev.from === 1 && last.from - prev.to === 1) lengthened = groups.length - 1;
  }

  if (groups.length === 0) {
    // "hmm", "shh", "brr": a hum around a neutral vowel.
    return [
      {
        vowels: ['schwa'],
        onset: clamp2(consonantUnits(s, kind, 0, n).map((u) => u.consonant)),
        coda: [],
        start: letters[0]!.index,
        end: letters[n - 1]!.index + 1,
        stressed: false,
      },
    ];
  }

  // 4. Distribute consonant clusters between nuclei (V-CV, VC-CV).
  const syllables: Syllable[] = groups.map((g, gi) => ({
    vowels: vowelsFor(s, g.from, g.to, gi === lengthened, groups.length, gi),
    onset: [],
    coda: [],
    start: letters[g.from]!.index,
    end: letters[g.to - 1]!.index + 1,
    stressed: false,
  }));

  for (let gi = 0; gi <= groups.length; gi++) {
    const from = gi === 0 ? 0 : groups[gi - 1]!.to;
    const to = gi === groups.length ? n : groups[gi]!.from;
    const units = consonantUnits(s, kind, from, to);
    if (units.length === 0) continue;
    const cons = units.map((u) => u.consonant);
    if (gi === 0) {
      syllables[0]!.onset = clamp2(cons);
      syllables[0]!.start = letters[units[0]!.pos]!.index;
    } else if (gi === groups.length) {
      syllables[gi - 1]!.coda = clamp2(cons);
    } else {
      const split = units.length <= 1 ? 0 : 1;
      syllables[gi - 1]!.coda = clamp2(cons.slice(0, split));
      syllables[gi]!.onset = clamp2(cons.slice(split));
      syllables[gi]!.start = letters[units[split]!.pos]!.index;
    }
  }
  return syllables;
}

function clamp2<T>(units: T[]): T[] {
  return units.length > 2 ? [units[0]!, units[units.length - 1]!] : units;
}

/** Consonant letters in `[from, to)` → consonant units, merging digraphs (sh, th, ng…). */
function consonantUnits(
  s: string,
  kind: string[],
  from: number,
  to: number,
): { consonant: Consonant; pos: number }[] {
  const units: { consonant: Consonant; pos: number }[] = [];
  for (let i = from; i < to; i++) {
    if (kind[i] !== 'c') continue;
    const pair = CONSONANTS[s.slice(i, i + 2)];
    if (pair && i + 1 < to && kind[i + 1] === 'c') {
      units.push({ consonant: pair, pos: i });
      i++;
    } else {
      const ch = s[i]!;
      // The u in "qu" behaves like a w.
      units.push({ consonant: CONSONANTS[ch === 'u' ? 'w' : ch] ?? NEUTRAL_CONSONANT, pos: i });
    }
  }
  return units;
}

function vowelsFor(
  s: string,
  from: number,
  to: number,
  lengthened: boolean,
  groupCount: number,
  groupIndex: number,
): readonly VowelId[] {
  const g = s.slice(from, to);
  const next = s[to];
  const isLast = groupIndex === groupCount - 1;

  if (lengthened) return LONG_VOWELS[g] ?? VOWEL_GROUPS[g]!;
  if (g.length === 1) {
    // R-coloured vowels: her, bird, turn / car / for.
    if (next === 'r' && !isVowelLetter(s[to + 1]) && s[to + 1] !== 'y') {
      if ('eiu'.includes(g)) return ['er'];
      if (g === 'a') return ['a'];
      if (g === 'o') return ['o'];
    }
    if (isLast && to === s.length) {
      if (groupCount === 1) return OPEN_VOWELS[g] ?? VOWEL_GROUPS[g]!; // go, me, hi
      if (g === 'y' || g === 'i') return ['i']; // happy, taxi
      if (g === 'o') return ['o', 'U']; // hello
      if (g === 'a') return ['A']; // sofa
    }
    // Long before a silent "gh" (night, though) or "ld" (cold, mild).
    if (s.startsWith('gh', to) || s.startsWith('ld', to)) return LONG_VOWELS[g] ?? VOWEL_GROUPS[g]!;
  }
  const direct = VOWEL_GROUPS[g] ?? VOWEL_GROUPS[g.slice(0, 2)];
  if (direct) return direct;
  const first = VOWEL_GROUPS[g[0]!]!;
  const final = VOWEL_GROUPS[g[g.length - 1]!]!;
  return [first[0]!, final[final.length - 1]!];
}
