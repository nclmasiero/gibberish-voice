import { describe, expect, it } from 'vitest';
import { parse } from '../src/text.js';

const shape = (text: string) =>
  parse(text).map((p) => ({
    ending: p.ending,
    words: p.words.map((w) => w.syllables.map((s) => text.slice(s.start, s.end)).join('-')),
  }));

describe('parse', () => {
  it('splits phrases on punctuation', () => {
    expect(shape('Hello there, traveller! Who are you? Well...').map((p) => p.ending)).toEqual([
      'comma',
      'exclaim',
      'question',
      'ellipsis',
    ]);
  });

  it('gives the last phrase an implicit ending', () => {
    expect(shape('no punctuation here')[0]!.ending).toBe('none');
  });

  it('merges repeated punctuation into the strongest ending', () => {
    const phrases = parse('Really?! No!!!');
    expect(phrases.map((p) => p.ending)).toEqual(['question', 'exclaim']);
  });

  it('produces roughly one syllable per vowel group', () => {
    expect(shape('banana')[0]!.words).toEqual(['ba-na-na']);
    expect(shape('traveller')[0]!.words).toEqual(['tra-vel-ler']);
    expect(shape('queen')[0]!.words).toEqual(['queen']);
  });

  it('treats a final e as silent', () => {
    expect(shape('make time')[0]!.words).toEqual(['make', 'time']);
    const [make] = parse('make')[0]!.words;
    expect(make!.syllables[0]!.vowels).toEqual(['e', 'i']);
  });

  it('maps spellings to vowels and diphthongs', () => {
    const vowels = (word: string) => parse(word)[0]!.words[0]!.syllables.map((s) => s.vowels.join('+'));
    expect(vowels('see')).toEqual(['i']);
    expect(vowels('moon')).toEqual(['u']);
    expect(vowels('boy')).toEqual(['o+i']);
    expect(vowels('night')).toEqual(['a+i']);
    expect(vowels('her')).toEqual(['er']);
    expect(vowels('hello')).toEqual(['e', 'o+U']);
  });

  it('flags shouted and function words', () => {
    const [phrase] = parse('the DRAGON is HERE');
    expect(phrase!.words.map((w) => w.shout)).toEqual([false, true, false, true]);
    expect(phrase!.words.map((w) => w.minor)).toEqual([true, false, true, false]);
  });

  it('does not treat a lone capital I as shouting', () => {
    expect(parse('I am')[0]!.words[0]!.shout).toBe(false);
  });

  it('covers every character of each word with exactly one syllable', () => {
    const text = 'Strengths, rhythm and squirrels.';
    for (const word of parse(text).flatMap((p) => p.words)) {
      expect(word.syllables[0]!.start).toBe(word.start);
      expect(word.syllables.at(-1)!.end).toBe(word.end);
      word.syllables.slice(1).forEach((s, i) => expect(s.start).toBe(word.syllables[i]!.end));
    }
  });

  it('handles words without vowels', () => {
    expect(shape('hmm, shh.')[0]!.words).toEqual(['hmm']);
  });

  it('handles accents, non-Latin scripts and digits', () => {
    expect(shape('café')[0]!.words).toEqual(['ca-fé']);
    expect(parse('你好')[0]!.words[0]!.syllables).toHaveLength(2);
    expect(parse('Привет')[0]!.words[0]!.syllables).toHaveLength(3);
    expect(parse('42')[0]!.words[0]!.syllables).toHaveLength(2);
  });

  it('returns nothing for empty or punctuation-only text', () => {
    expect(parse('')).toEqual([]);
    expect(parse(' ... !? ')).toEqual([]);
  });
});
