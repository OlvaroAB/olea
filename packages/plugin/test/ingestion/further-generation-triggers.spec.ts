/**
 * `further-generation-triggers.ts` tests — GEN-3.5 (`ol-2zfj.136`), D-238's
 * top-band/format-ask/deck-served-out-or-lapsed generation triggers wired to
 * real state, and D-269's repeated-rejection trigger proved inactive.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import type {
  ConceptRecord,
  EnqueueInput,
  EnqueueResult,
  ListOptions,
  StudyPlanStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { enumerateVaultInstruments, provisionalConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  enqueueFurtherGenerationCallsForCourse,
  REPEATED_REJECTION_THRESHOLD_INACTIVE,
} from '../../src/ingestion/further-generation-triggers.js';

const NOW = new Date('2026-09-26T09:00:00.000Z');
const COURSE = 'PSYCH-A';

/** Same recording enqueuer role `generation-queue.spec.ts`'s own fixture fills. */
class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
  }
}

/**
 * `[ol-63e1]`: a concept unbound to any Zettelkasten note (tier 2 — every
 * concept in this suite's fixture vaults) resolves to
 * `provisionalConceptKey({name, boundNotePath: null})`, the same derivation
 * `enumerateVaultInstruments`'s own concept walk uses — computed here rather
 * than hand-picked, so this suite's `listConceptsForCourse` fake names the
 * SAME key the vault's own instrument index will file that concept's
 * instruments under.
 */
function concept(name: string, courses: readonly string[] = [COURSE]): ConceptRecord {
  return {
    name,
    key: provisionalConceptKey({ name, boundNotePath: null }),
    courses,
  } as ConceptRecord;
}

/** A minimal `VaultSource` over a literal map of files — mirrors `packages/core/test/session/memory-vault.ts`'s own fixture, kept local since it is not exported across the package boundary. */
function memoryVault(files: Readonly<Record<string, string>> = {}): VaultSource {
  const contents = new Map<VaultPath, string>(Object.entries(files));
  return {
    async list(options: ListOptions = {}) {
      const extensions = options.extensions?.map((ext) => ext.toLowerCase());
      return [...contents.keys()]
        .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
        .filter((path) => {
          if (extensions === undefined) return true;
          const dot = path.lastIndexOf('.');
          const ext = dot <= 0 ? undefined : path.slice(dot + 1).toLowerCase();
          return ext !== undefined && extensions.includes(ext);
        })
        .sort();
    },
    async read(path: VaultPath) {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`memoryVault: no such file ${path}`);
      return content;
    },
    async readBinary(path: VaultPath) {
      return new TextEncoder().encode(await this.read(path));
    },
    async write() {
      throw new Error('memoryVault: read-only in this suite');
    },
    async exists(path: VaultPath) {
      return contents.has(path);
    },
    watch(_handler: (event: VaultEvent) => void): Unsubscribe {
      return () => undefined;
    },
  };
}

function studyPlanStore(plan: StudyPlanEnvelope | null): StudyPlanStore {
  return {
    async load() {
      return plan;
    },
    async save() {
      /* unused by this suite */
    },
  };
}

function samplePlan(courses: StudyPlanEnvelope['body']['courses']): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: '2026-09-26T08:00:00.000Z',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: { asOf: '2026-09-26', courses },
  };
}

/** Frontmatter binding a note to `topic`, matching `enumerate.spec.ts`'s own fixture exactly. */
function frontmatter(topic: string, course = COURSE): string {
  return ['---', `topic: ${topic}`, `course: ${course}`, '---', ''].join('\n');
}

/** One real, parseable `olea-mcq` block — `enumerate.spec.ts`'s own `MCQ_BLOCK` fixture. */
const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'feedback: Because of the thing.',
  '```',
].join('\n');

/** A note bound to `topic` carrying one real, parseable `mcq` instrument. */
function mcqNote(topic: string): string {
  return [frontmatter(topic), MCQ_BLOCK, ''].join('\n');
}

const NO_REVIEWS = '';

describe('enqueueFurtherGenerationCallsForCourse — top-band (F4.2)', () => {
  it("a concept in the top band, with only mcq built, enqueues the other kind (qa, F2.14's listed order)", async () => {
    const conceptName = 'Osmosis';
    const built = concept(conceptName);
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(
        samplePlan([
          {
            course: COURSE,
            status: 'ranked',
            concepts: [
              {
                conceptId: built.key,
                rank: 1,
                weight: 1,
                examProximityDays: null,
                reasoning: 'top ranked',
                citations: [{ sourcePath: 'papers/p1.md', questionLabel: '1' }],
              },
            ],
          },
        ]),
      ),
      enqueuer,
      listConceptsForCourse: async () => [built],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'top-band',
      instrumentKind: 'qa',
      conceptKey: built.key,
    });
  });

  it('a concept outside the top band, with every other signal false, enqueues nothing', async () => {
    const conceptName = 'Rare topic';
    const built = concept(conceptName);
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(
        samplePlan([
          {
            course: COURSE,
            status: 'ranked',
            concepts: [1, 2, 3, 4, 5, 6].map((rank) => ({
              conceptId: rank === 6 ? built.key : `filler-${rank}`,
              rank,
              weight: 1 / rank,
              examProximityDays: null,
              reasoning: 'r',
              citations: [{ sourcePath: 'papers/p1.md', questionLabel: '1' }],
            })),
          },
        ]),
      ),
      enqueuer,
      listConceptsForCourse: async () => [built],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(0);
  });

  it('no plan at all: top-band never fires, but nothing throws', async () => {
    const conceptName = 'Osmosis';
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [concept(conceptName)],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(0);
  });
});

describe('enqueueFurtherGenerationCallsForCourse — dedup across two real signals (D-238 "the unit is the call")', () => {
  it('a concept both in the top band and deck-served-out enqueues exactly one call, not two', async () => {
    const conceptName = 'Osmosis';
    const notePath = `01 Courses/${COURSE}/note.md`;
    const built = concept(conceptName);
    const vaultFiles = { [notePath]: mcqNote(conceptName) };

    // Same real-id discovery `deck-served-out-or-lapsed`'s own test above
    // uses, so the review-log fixture below matches the note's real mcq
    // instrument id rather than a guessed one.
    const discovery = await enumerateVaultInstruments(memoryVault(vaultFiles), {
      under: `01 Courses/${COURSE}`,
    });
    const instrumentId = discovery.records[0]?.instrumentId;
    expect(instrumentId).toBeDefined();

    const vault = memoryVault({
      ...vaultFiles,
      '.olea/reviews/2026-09-20-device-1.jsonl': JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'e1',
        timestamp: '2026-09-20T09:00:00+00:00',
        instrumentId,
        instrumentType: 'mcq',
        conceptIds: [built.key],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      }),
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      // Rank 1 of 1 — top band per `isRankInTopBand`'s floor-at-1 rule — so
      // this concept ALSO satisfies deck-served-out-or-lapsed above.
      studyPlanStore: studyPlanStore(
        samplePlan([
          {
            course: COURSE,
            status: 'ranked',
            concepts: [
              {
                conceptId: built.key,
                rank: 1,
                weight: 1,
                examProximityDays: null,
                reasoning: 'top ranked',
                citations: [{ sourcePath: 'papers/p1.md', questionLabel: '1' }],
              },
            ],
          },
        ]),
      ),
      enqueuer,
      listConceptsForCourse: async () => [built],
      now: () => NOW,
    });

    // Two real signal sources both name 'qa' (the next undrafted kind after
    // 'mcq') for the same concept; `evaluateGenerationTriggers`'s
    // dedup-by-instrumentKind collapses them to one enqueued job, and
    // top-band keeps credit as the first trigger `generation/triggers.ts`
    // evaluates.
    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'top-band',
      instrumentKind: 'qa',
      conceptKey: built.key,
    });
  });
});

describe('enqueueFurtherGenerationCallsForCourse — format-ask (F4.8/D7.1)', () => {
  it('her observed instrument-type order (D7.1) asking for a kind not yet built fires format-ask', async () => {
    const conceptName = 'Osmosis';
    // Three real reviews of a qa instrument elsewhere in the vault establish
    // 'qa' as her most-observed kind — real D7.1 state, not an injected flag.
    const reviewLines = ['e1', 'e2', 'e3']
      .map((eventId) =>
        JSON.stringify({
          schemaVersion: 5,
          kind: 'review',
          eventId,
          timestamp: '2026-09-20T09:00:00+00:00',
          instrumentId: 'other-inst-1',
          instrumentType: 'qa',
          conceptIds: ['Some other concept'],
          rating: 'good',
          wasUnsure: false,
          durationMs: null,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
        }),
      )
      .join('\n');
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-20-device-1.jsonl': reviewLines,
    });
    const built = concept(conceptName);
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      // No plan at all: top-band cannot fire, isolating this test to format-ask.
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [built],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'format-ask',
      instrumentKind: 'qa',
      conceptKey: built.key,
    });
  });

  it('a known F4.8 format match wins over the observed order', async () => {
    const conceptName = 'Osmosis';
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [concept(conceptName)],
      formatMatchFor: () => 'cloze',
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'format-ask',
      instrumentKind: 'cloze',
    });
  });
});

describe('enqueueFurtherGenerationCallsForCourse — deck-served-out-or-lapsed (F2.12)', () => {
  it('every built instrument served at least once (deck served out) fires the trigger', async () => {
    const conceptName = 'Osmosis';
    const notePath = `01 Courses/${COURSE}/note.md`;
    const built = concept(conceptName);
    const vaultFiles = { [notePath]: mcqNote(conceptName) };

    // Discover the REAL provisional instrument id `enumerateVaultInstruments`
    // derives for this note's sole mcq block, rather than guessing its
    // format — the review-log fixture below must match it exactly for
    // `replaySchedulerStates` to find a served state.
    const discovery = await enumerateVaultInstruments(memoryVault(vaultFiles), {
      under: `01 Courses/${COURSE}`,
    });
    const instrumentId = discovery.records[0]?.instrumentId;
    expect(instrumentId).toBeDefined();

    const vault = memoryVault({
      ...vaultFiles,
      '.olea/reviews/2026-09-20-device-1.jsonl': JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'e1',
        timestamp: '2026-09-20T09:00:00+00:00',
        instrumentId,
        instrumentType: 'mcq',
        conceptIds: [built.key],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      }),
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [built],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'deck-served-out-or-lapsed',
      conceptKey: built.key,
    });
  });

  it('a never-served deck does not fire deck-served-out-or-lapsed', async () => {
    const conceptName = 'Osmosis';
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [concept(conceptName)],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(0);
  });
});

describe('D-269: repeated-rejection stays inactive', () => {
  it('the inactive threshold is not a finite number any real rejection count could reach', () => {
    expect(Number.isFinite(REPEATED_REJECTION_THRESHOLD_INACTIVE)).toBe(false);
    expect(0 < REPEATED_REJECTION_THRESHOLD_INACTIVE).toBe(true);
    expect(1_000_000 < REPEATED_REJECTION_THRESHOLD_INACTIVE).toBe(true);
    expect(Number.MAX_SAFE_INTEGER < REPEATED_REJECTION_THRESHOLD_INACTIVE).toBe(true);
  });

  it('with every other trigger condition false, nothing is ever enqueued — never a repeated-rejection call', async () => {
    const conceptName = 'Never triggered';
    const vault = memoryVault({
      [`01 Courses/${COURSE}/note.md`]: mcqNote(conceptName),
      '.olea/reviews/2026-09-01-device-1.jsonl': NO_REVIEWS,
    });
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: studyPlanStore(null),
      enqueuer,
      listConceptsForCourse: async () => [concept(conceptName)],
      now: () => NOW,
    });

    expect(enqueuer.calls).toHaveLength(0);
  });
});

describe('enqueueFurtherGenerationCallsForCourse — never throws', () => {
  it('a rejecting listConceptsForCourse is logged and swallowed, matching the arrival-call posture', async () => {
    const enqueuer = new RecordingEnqueuer();
    await expect(
      enqueueFurtherGenerationCallsForCourse(COURSE, {
        vault: memoryVault(),
        studyPlanStore: studyPlanStore(null),
        enqueuer,
        listConceptsForCourse: async () => {
          throw new Error('boom');
        },
        now: () => NOW,
      }),
    ).resolves.toBeUndefined();
    expect(enqueuer.calls).toHaveLength(0);
  });
});
