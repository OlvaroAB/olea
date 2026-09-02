/**
 * `heading-offer.ts` tests (F2.10, `[D-170]`/`[GEN-2]`, `ol-0r92.27`,
 * `ol-0r92.23`).
 *
 * INV-3: every heading, course, concept and question below is invented for
 * this suite — none copied from `docs/design/pass1/` or any real vault.
 *
 * Three things this file proves, one per `describe` block:
 * 1. **Accept drafts through the real per-concept path** and caches a
 *    `status: 'pending'` `DraftRecord` per question, keyed on the caller-
 *    resolved `ConceptRecord.key` (never the display name) — indistinguishable
 *    in the cache from a sweep-drafted record.
 * 2. **A refusal and an unparseable response are honest, non-throwing
 *    outcomes** — nothing is cached either way.
 * 3. **Dismiss persists nothing**: the vault is never written, and the
 *    dismissal is visible only through `isDismissed` on the SAME port
 *    instance (a fresh port remembers nothing).
 */
import type { ConceptRecord, HeadingOfferCandidate } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  createHeadingOfferPort,
  type HeadingOfferContext,
} from '../../src/review/heading-offer.js';
import { MemoryVaultSource } from '../generation/fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const NOW = new Date('2026-09-02T10:00:00-07:00');

function candidateFixture(overrides: Partial<HeadingOfferCandidate> = {}): HeadingOfferCandidate {
  return {
    headingText: 'Does chunking extend working memory capacity?',
    level: 2,
    blockIndex: 3,
    headingStart: 120,
    headingEnd: 168,
    coverageEnd: 400,
    rule: 'yes-no-inversion',
    ...overrides,
  };
}

function conceptFixture(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-key-chunking',
    name: 'Chunking',
    tier: 1,
    courses: ['COGS214'],
    sourcePaths: [NOTE_PATH],
    ...overrides,
  };
}

function contextFixture(overrides: Partial<HeadingOfferContext> = {}): HeadingOfferContext {
  return {
    courseCode: 'COGS214',
    concept: conceptFixture(),
    sourcePath: NOTE_PATH,
    ...overrides,
  };
}

function draftedResult(questionCount: number): DraftQuizCardsResult {
  return {
    status: 'drafted',
    request: {
      courseCode: 'COGS214',
      conceptName: 'Chunking',
      sourceChunks: ['her prose about chunking'],
      personalization: { voiceExemplars: { phrasing: [], terminology: [] } },
    },
    response: {
      ok: true,
      stamp: { promptVersion: '1.0.0', modelId: 'test-model' },
      result: {
        questions: Array.from({ length: questionCount }, (_, i) => ({
          stem: `Stem ${i}`,
          correctAnswer: 'Correct',
          distractors: ['A', 'B', 'C', 'D'],
          feedback: 'Feedback',
        })),
      },
    },
  };
}

function setUp(
  draftForConcept: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>,
) {
  const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
  const cache = createVaultDraftCacheStore(vault);
  const port = createHeadingOfferPort({
    // Never actually read — `draftForConcept` intercepts every call in
    // this suite, matching `pipeline.spec.ts`'s own posture for the
    // identical injectable seam.
    draftDeps: () => ({}) as DraftQuizCardsDeps,
    cache,
    now: () => NOW,
    draftForConcept,
  });
  return { vault, cache, port };
}

describe('accept — F2.10/[D-170]: creates the draft through the real per-concept path', () => {
  it('caches one pending DraftRecord per drafted question, keyed on the opaque concept key', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { cache, port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(2);
    });

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome.kind).toBe('drafted');
    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    expect(outcome.draftIds).toHaveLength(2);

    // The SAME request shape the automatic sweep sends — courseCode and
    // conceptName, nothing heading-specific — proving this calls the real
    // generation entry point rather than a heading-scoped reimplementation.
    expect(calledWith).toEqual({ courseCode: 'COGS214', conceptName: 'Chunking' });

    for (const draftId of outcome.draftIds) {
      const record = await cache.get(draftId);
      expect(record).not.toBeNull();
      expect(record?.status).toBe('pending');
      expect(record?.conceptIds).toEqual(['concept-key-chunking']);
      expect(record?.courseCode).toBe('COGS214');
      expect(record?.sourcePath).toBe(NOTE_PATH);
      expect(record?.instrumentId).toBeUndefined();
    }

    const pending = await cache.listPending();
    expect(pending).toHaveLength(2);
  });

  it('a refusal is a real outcome, not an error, and caches nothing', async () => {
    const { cache, port } = setUp(async () => ({ status: 'refused', reason: 'below-band' }));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'below-band' });
    if (outcome.kind === 'refused') {
      expect(outcome.copy.headline.length).toBeGreaterThan(0);
    }
    expect(await cache.listPending()).toHaveLength(0);
  });

  it('an unparseable response caches nothing', async () => {
    const { cache, port } = setUp(async () => ({
      status: 'drafted',
      request: {
        courseCode: 'COGS214',
        conceptName: 'Chunking',
        sourceChunks: [],
        personalization: { voiceExemplars: { phrasing: [], terminology: [] } },
      },
      response: { ok: false, error: 'malformed' },
    }));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toEqual({ kind: 'unparseable' });
    expect(await cache.listPending()).toHaveLength(0);
  });

  it('a drafted response with zero questions is reported unparseable, not a silent no-op', async () => {
    const { cache, port } = setUp(async () => draftedResult(0));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toEqual({ kind: 'unparseable' });
    expect(await cache.listPending()).toHaveLength(0);
  });

  it('F7.8: no Worker connection reports not-configured and never calls draftForConcept', async () => {
    let called = false;
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const cache = createVaultDraftCacheStore(vault);
    const port = createHeadingOfferPort({
      draftDeps: () => null,
      cache,
      now: () => NOW,
      draftForConcept: async () => {
        called = true;
        return draftedResult(1);
      },
    });

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toEqual({ kind: 'not-configured' });
    expect(called).toBe(false);
    expect(await cache.listPending()).toHaveLength(0);
  });
});

describe('dismiss — [D-170]: declines the offer itself, persists nothing (D7.1 authorises no field for it)', () => {
  it('writes nothing to the vault: the note is untouched and the draft cache stays empty', async () => {
    const { vault, cache, port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture();
    const before = vault.raw(NOTE_PATH);

    port.dismiss(candidate, NOTE_PATH);

    expect(vault.raw(NOTE_PATH)).toBe(before);
    expect(await cache.list()).toEqual([]);
  });

  it('isDismissed reflects the in-memory set on the SAME port only', () => {
    const { port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture();

    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(false);
    port.dismiss(candidate, NOTE_PATH);
    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(true);

    // A fresh port (a reloaded plugin) remembers nothing — the honest shape
    // of "not persisted."
    const { port: freshPort } = setUp(async () => draftedResult(1));
    expect(freshPort.isDismissed(candidate, NOTE_PATH)).toBe(false);
  });

  it('a dismissal is scoped to (sourcePath, headingStart) — a different heading is unaffected', () => {
    const { port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture({ headingStart: 120 });
    const otherHeading = candidateFixture({ headingStart: 500 });

    port.dismiss(candidate, NOTE_PATH);

    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(true);
    expect(port.isDismissed(otherHeading, NOTE_PATH)).toBe(false);
    expect(port.isDismissed(candidate, 'Other/Note.md')).toBe(false);
  });
});
