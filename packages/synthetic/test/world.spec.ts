// world.spec.ts — determinism, vocabulary discipline and cross-reference
// integrity for `buildWorld` (`olea-service`'s `ol-opmb.1` [TB-1]).
//
// The vocabulary check does NOT scan the real-vault snapshot (that lives in
// the sibling private repo and a public-repo test that only passes when a
// private repo happens to be checked out alongside it is not a control —
// it is a control that silently stops running in CI). Instead it proves the
// property that actually matters here: this module introduces ZERO new
// coined tokens. `curriculum.ts` and `corpus.ts` build every identifier from
// `./vocabulary.ts`'s already-vetted `CONCEPTS`/`COURSES` tokens plus ordinary
// structural English — never a fresh proper noun. `ORDINARY_WORDS` below is a
// small, closed, hand-checked list of exactly the connective words this
// corpus's own scaffolding prose uses (never a course code, a concept name,
// or anything specific to any real vault — the same "is this word, in
// general, ordinary" question `check-inv3.mjs`'s advisory carve-out asks,
// answered by hand for a vocabulary this small rather than by importing that
// script's ~8800-word list across a package boundary). A newly coined proper
// noun slipped in by a future edit fails this test, because it is neither
// vocabulary nor a word on this list — the list is not meant to grow to
// accommodate one.

import { describe, expect, it } from 'vitest';
import {
  buildCorpus,
  buildCurriculum,
  buildWorld,
  CONCEPTS,
  COURSES,
  type WorldSpec,
} from '../src/index.js';

const SPEC: WorldSpec = {
  persona: 'struggler',
  seed: 'world-spec',
  startDate: '2027-02-01',
  days: 30,
  deviceId: 'syn-laptop',
  utcOffset: '+00:00',
  assessmentDayOffsets: [10, 25],
};

describe('buildWorld — determinism', () => {
  it('is byte-identical across two builds from the same spec', () => {
    const a = buildWorld(SPEC);
    const b = buildWorld(SPEC);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes bytes when the seed changes, so it is not accidentally constant', () => {
    const a = buildWorld(SPEC);
    const b = buildWorld({ ...SPEC, seed: 'a-different-seed' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

/** Every already-vetted token, bare (`melspar`, not `syn:concept:melspar`). */
const VETTED_TOKENS = new Set<string>([
  ...CONCEPTS.map((c) => c.conceptId.split(':').at(-1) as string),
  ...COURSES.map((c) => c.courseId.split(':').at(-1) as string),
]);

// Ordinary connective/structural English — closed, every entry hand-checked
// against "is this word, in general, ordinary" (see the module doc). Nothing
// here is a course code, a concept name, or specific to any real vault.
const ORDINARY_WORDS = new Set([
  'a',
  'across',
  'also',
  'an',
  'and',
  'appears',
  'at',
  'been',
  'but',
  'course',
  'covered',
  'explain',
  'form',
  'from',
  'has',
  'here',
  'in',
  'is',
  'it',
  'its',
  'named',
  'nothing',
  'notes',
  'of',
  'on',
  'outline',
  'q1',
  'q2',
  'q3',
  'reference',
  'relates',
  'reviewed',
  'see',
  'several',
  'sources',
  'to',
  'up',
  'upcoming',
  'with',
  'yet',
]);

function wordsIn(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function isKnownWord(word: string): boolean {
  if (VETTED_TOKENS.has(word)) return true;
  if (ORDINARY_WORDS.has(word)) return true;
  return /^\d+$/.test(word); // bare numbers (weights, page counts, …)
}

describe('buildWorld — vocabulary discipline (INV-3)', () => {
  it('uses no word in note prose or citation text beyond vetted vocabulary + ordinary English', () => {
    const corpus = buildCorpus();
    const curriculum = buildCurriculum();

    const texts: string[] = [
      ...corpus.notes.map((n) => n.body),
      ...curriculum.edges.flatMap((e) => e.citations.map((c) => c.questionText)),
    ];

    const unknown = new Set<string>();
    for (const text of texts) {
      for (const word of wordsIn(text)) {
        if (!isKnownWord(word)) unknown.add(word);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it('mints every path from the synthetic namespace prefix, never a bare vetted token', () => {
    const world = buildWorld(SPEC);
    const paths = [
      ...world.curriculum.assessments.map((a) => a.path),
      ...world.curriculum.edges.map((e) => e.assessmentPath),
      ...world.corpus.notes.map((n) => n.path),
      ...world.corpus.sourceCoverage.map((s) => s.sourcePath),
    ];
    for (const path of paths) expect(path.startsWith('syn:')).toBe(true);
  });
});

describe('buildWorld — cross-reference integrity', () => {
  it('every edge names a concept and course olea-synthetic actually invented', () => {
    const { edges } = buildCurriculum();
    const conceptIds = new Set(CONCEPTS.map((c) => c.conceptId));
    const courseIds = new Set(COURSES.map((c) => c.courseId));
    for (const edge of edges) {
      expect(conceptIds.has(edge.conceptName)).toBe(true);
      expect(courseIds.has(edge.course)).toBe(true);
    }
  });

  it('every edge targets a real assessment path from the same curriculum', () => {
    const { assessments, edges } = buildCurriculum();
    const paths = new Set(assessments.map((a) => a.path));
    for (const edge of edges) expect(paths.has(edge.assessmentPath)).toBe(true);
  });

  it('assessmentsWithNoEvidence names a real assessment that genuinely has no edge', () => {
    const { assessments, edges, assessmentsWithNoEvidence } = buildCurriculum();
    const paths = new Set(assessments.map((a) => a.path));
    const edgedPaths = new Set(edges.map((e) => e.assessmentPath));
    for (const path of assessmentsWithNoEvidence) {
      expect(paths.has(path)).toBe(true);
      expect(edgedPaths.has(path)).toBe(false);
    }
  });

  it('every ranked concept the curriculum evidences is a concept vocabulary.ts declares', () => {
    const { edges } = buildCurriculum();
    const conceptIds = new Set(CONCEPTS.map((c) => c.conceptId));
    for (const edge of edges) expect(conceptIds.has(edge.conceptName)).toBe(true);
  });

  it("kelvane is ranked by the curriculum but absent from the corpus's notes (F4.10 fixture)", () => {
    const { edges } = buildCurriculum();
    const { notes } = buildCorpus();
    const kelvane = 'syn:concept:kelvane';
    expect(edges.some((e) => e.conceptName === kelvane)).toBe(true);
    expect(notes.some((n) => n.conceptName === kelvane)).toBe(false);
  });

  it('the coverage scope can never claim exhaustiveness, by construction (ol-cvsc)', () => {
    const { sourceCoverage } = buildCorpus();
    const unreadable = sourceCoverage.filter((s) => s.outcome === 'unreadable');
    expect(unreadable.length).toBeGreaterThan(0);
  });
});
