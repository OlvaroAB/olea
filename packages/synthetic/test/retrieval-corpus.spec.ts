// retrieval-corpus.spec.ts — determinism, structural shape and vocabulary
// discipline for `retrieval-corpus.ts` + `queries.ts` (`olea-service`'s
// `ol-opmb.2` [TB-2]).
//
// Same reasoning as `world.spec.ts`'s own vocabulary check: this does NOT
// scan the real-vault snapshot (private repo, would silently stop running in
// CI if it did). It proves the property that actually matters — every word
// this module introduces is either a vetted CONCEPTS/COURSES token, a small
// closed hand-checked list of ordinary connective/administrative English, a
// bare number, or one of the FOUR deliberate gibberish tokens (never a real
// word in any language, never a course name, never specific to any real
// vault) — the same "is this word, in general, ordinary" question
// `check-inv3.mjs`'s advisory carve-out asks, answered by hand here.

import { describe, expect, it } from 'vitest';
import { findQuery, QUERIES } from '../src/queries.js';
import {
  ABSENT_CONCEPT_TOKENS,
  buildRetrievalIndex,
  RICH_CONCEPT_TOKENS,
  retrievalCorpusBlockCount,
  SPARSE_CONCEPT_TOKENS,
} from '../src/retrieval-corpus.js';
import { CONCEPTS, COURSES } from '../src/vocabulary.js';

const VETTED_TOKENS = new Set<string>([
  ...CONCEPTS.map((c) => c.conceptId.split(':').at(-1) as string),
  ...COURSES.map((c) => c.courseId.split(':').at(-1) as string),
]);

/**
 * Every non-vetted, non-numeric word used across `retrieval-corpus.ts`'s
 * templates and `queries.ts`'s query strings, hand-checked: ordinary
 * connective or administrative English, never a course code, a concept
 * name, or anything specific to any real vault. Extracted once (see the
 * bead's evidence notes for the extraction command) and then hand-verified
 * word by word, not regenerated automatically — a script that regenerates
 * its own oracle proves nothing.
 */
const ORDINARY_WORDS = new Set([
  'a',
  'about',
  'across',
  'additional',
  'administrative',
  'again',
  'against',
  'allocation',
  'alongside',
  'also',
  'and',
  'appear',
  'appears',
  'are',
  'arrangements',
  'as',
  'assessment',
  'attendance',
  'background',
  'both',
  'briefly',
  'calendar',
  'concept',
  'connected',
  'contact',
  'context',
  'continues',
  'coverage',
  'covered',
  'covering',
  'cross',
  'dates',
  'deadlines',
  'details',
  'discusses',
  'do',
  'earlier',
  'enrolment',
  'entry',
  'expanding',
  'explained',
  'figures',
  'filed',
  'following',
  'follows',
  'for',
  'from',
  'further',
  'general',
  'handouts',
  'header',
  'here',
  'holds',
  'holiday',
  'hours',
  'in',
  'information',
  'is',
  'item',
  'library',
  'list',
  'listed',
  'lists',
  'logged',
  'logistics',
  'material',
  'materials',
  'named',
  'no',
  'note',
  'noted',
  'notes',
  'noting',
  'number',
  'of',
  'office',
  'on',
  'outline',
  'paragraph',
  'passage',
  'previously',
  'printing',
  'reading',
  'recorded',
  'recordkeeping',
  'referenced',
  'relation',
  'returns',
  'revision',
  'room',
  'say',
  'scaffolding',
  'scheduling',
  'seating',
  'section',
  'see',
  'sessions',
  'staff',
  'submission',
  'the',
  'this',
  'timetable',
  'to',
  'under',
  'what',
  'with',
  'within',
  'yet',
]);

/** The four deliberate gibberish tokens (`queries.ts`'s `unans-gib-01`) — not real words in any language, never entered anywhere near a real vault. */
const GIBBERISH_WORDS = new Set(['vrelqz', 'xoffnamp', 'thwiggle', 'nzzrkt']);

function everyWord(texts: readonly string[]): readonly string[] {
  const words = new Set<string>();
  for (const text of texts) {
    for (const token of text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)) {
      words.add(token);
    }
  }
  return [...words];
}

describe('buildRetrievalIndex — determinism', () => {
  it('is byte-identical across two builds', () => {
    const a = buildRetrievalIndex();
    const b = buildRetrievalIndex();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('documents stay in ascending-path order', () => {
    const index = buildRetrievalIndex();
    const paths = index.documents.map((d) => d.path);
    expect(paths).toEqual([...paths].sort());
  });
});

describe('buildRetrievalIndex — coverage shape (retrieval-corpus.ts module doc)', () => {
  it('exceeds 100 chunks — the structural floor marginP99 needs to ever be nonzero', () => {
    expect(retrievalCorpusBlockCount()).toBeGreaterThan(100);
  });

  it('every RICH_CONCEPT_TOKENS document names its own token', () => {
    const index = buildRetrievalIndex();
    for (const token of RICH_CONCEPT_TOKENS) {
      const doc = index.documents.find((d) => d.path.endsWith(`:${token}`));
      expect(doc, `no document for rich token ${token}`).toBeDefined();
      expect(doc?.blocks.length).toBeGreaterThan(5);
      expect(doc?.blocks.every((b) => b.text.includes(token))).toBe(true);
    }
  });

  it('every SPARSE_CONCEPT_TOKENS document names its own token, in far fewer blocks', () => {
    const index = buildRetrievalIndex();
    for (const token of SPARSE_CONCEPT_TOKENS) {
      const doc = index.documents.find((d) => d.path.endsWith(`:${token}`));
      expect(doc, `no document for sparse token ${token}`).toBeDefined();
      expect(doc?.blocks.length).toBe(3);
    }
  });

  it('ABSENT_CONCEPT_TOKENS never appear anywhere in the corpus text', () => {
    const index = buildRetrievalIndex();
    const allText = index.documents
      .flatMap((d) => d.blocks.map((b) => b.text))
      .join(' ')
      .toLowerCase();
    for (const token of ABSENT_CONCEPT_TOKENS) {
      expect(allText.includes(token)).toBe(false);
    }
  });

  it('RICH/SPARSE/ABSENT token sets are disjoint and RICH ∪ SPARSE ∪ ABSENT = every CONCEPTS token', () => {
    const all = new Set([
      ...RICH_CONCEPT_TOKENS,
      ...SPARSE_CONCEPT_TOKENS,
      ...ABSENT_CONCEPT_TOKENS,
    ]);
    expect(all.size).toBe(
      RICH_CONCEPT_TOKENS.length + SPARSE_CONCEPT_TOKENS.length + ABSENT_CONCEPT_TOKENS.length,
    );
    const conceptTokens = new Set(CONCEPTS.map((c) => c.conceptId.split(':').at(-1) as string));
    expect(all).toEqual(conceptTokens);
  });
});

describe('vocabulary discipline (INV-3, ol-opmb parent bead)', () => {
  it('every word in the retrieval corpus is a vetted token, an ordinary word, or a bare number', () => {
    const index = buildRetrievalIndex();
    const texts = index.documents.flatMap((d) => d.blocks.map((b) => b.text));
    const offenders = everyWord(texts).filter(
      (word) => !VETTED_TOKENS.has(word) && !ORDINARY_WORDS.has(word) && Number.isNaN(Number(word)),
    );
    expect(offenders).toEqual([]);
  });

  it('every word in the query set is a vetted token, an ordinary word, a bare number, or a declared gibberish token', () => {
    const offenders = everyWord(QUERIES.map((q) => q.query)).filter(
      (word) =>
        !VETTED_TOKENS.has(word) &&
        !ORDINARY_WORDS.has(word) &&
        !GIBBERISH_WORDS.has(word) &&
        Number.isNaN(Number(word)),
    );
    expect(offenders).toEqual([]);
  });

  it('the gibberish query carries none of the vetted vocabulary and none of the ordinary words', () => {
    const gibberish = findQuery('unans-gib-01');
    expect(gibberish).toBeDefined();
    const words = everyWord([gibberish?.query ?? '']);
    for (const word of words) {
      expect(VETTED_TOKENS.has(word)).toBe(false);
      expect(ORDINARY_WORDS.has(word)).toBe(false);
      expect(GIBBERISH_WORDS.has(word)).toBe(true);
    }
  });
});

describe('QUERIES', () => {
  it('has exactly one query per RICH/SPARSE/ABSENT token plus one gibberish query, all unique ids', () => {
    expect(QUERIES.length).toBe(
      RICH_CONCEPT_TOKENS.length + SPARSE_CONCEPT_TOKENS.length + ABSENT_CONCEPT_TOKENS.length + 1,
    );
    expect(new Set(QUERIES.map((q) => q.id)).size).toBe(QUERIES.length);
  });

  it('labels agree with retrieval-corpus.ts coverage classes', () => {
    for (const q of QUERIES) {
      if (q.conceptToken === null) continue; // the gibberish query
      if (RICH_CONCEPT_TOKENS.includes(q.conceptToken)) expect(q.label).toBe('answerable');
      else if (SPARSE_CONCEPT_TOKENS.includes(q.conceptToken)) expect(q.label).toBe('near-miss');
      else if (ABSENT_CONCEPT_TOKENS.includes(q.conceptToken)) expect(q.label).toBe('unanswerable');
      else throw new Error(`query ${q.id} targets an unrecognised concept token ${q.conceptToken}`);
    }
  });
});
