/**
 * F2.12's prerequisite-aware offer, end to end through a REAL `ReviewSession`
 * (`ol-egov.141.51.1.1` [INTERV-16], part 2).
 *
 * Every existing suite covers one link of this chain in isolation:
 * `../../src/review/prerequisite-evidence-wiring.ts`'s own spec proves
 * `createPrerequisiteEvidenceReader` classifies a prerequisite's evidence
 * correctly; `session.spec.ts`'s "F2.12 — the prerequisite-aware offer wired
 * into the review flow" suite proves `ReviewSession` threads whatever
 * `resolvePrerequisiteEvidence` returns onto `evaluateConfusionRouting`'s
 * `directPrerequisite` input — but both mock the OTHER end (a hand-written
 * `resolvePrerequisiteEvidence` fixture, or a hand-written
 * `evaluateConfusionRouting` fixture). Neither proves the two REAL pieces
 * compose: a real `createPrerequisiteEvidenceReader` (given real relations,
 * concepts and a real review log) feeding `olea-core`'s real
 * `evaluateConfusionRouting`, inside a real `ReviewSession`.
 *
 * This file is that proof, for [D-265] ruling 2's consumer behaviour: with
 * concepts supplied (the gap `main.ts`'s wiring closes, `main.ts:~3760`),
 * a weak or unknown direct prerequisite routes the F2.12 offer onto the
 * prerequisite, and a strong one leaves the ordinary offer standing.
 */
import type { ReviewLogEntry } from 'olea-contracts';
import type { ConceptRecord, ConceptRelation } from 'olea-core';
import { createFsrsScheduler, evaluateConfusionRouting } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createPrerequisiteEvidenceReader } from '../../src/review/prerequisite-evidence-wiring.js';
import { ReviewSession, type ReviewSessionDeps } from '../../src/review/session.js';
import {
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
  qaFixture,
  queueItem,
} from './fixtures.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const DEPENDENT_KEY = 'key-dependent';
const PREREQ_KEY = 'key-prereq';

function baseDeps(overrides: Partial<ReviewSessionDeps> = {}): ReviewSessionDeps {
  return {
    queue: [],
    scheduler: fakeScheduler(),
    reviewLog: fakeReviewLog(),
    suspendPort: fakeSuspendPort(),
    editPort: fakeEditPort(),
    noteExists: fakeNoteExists(),
    clock: fixedClock('2026-08-10T09:00:00Z'),
    draftAcceptPort: fakeDraftAcceptPort(),
    ...overrides,
  };
}

function concept(name: string, key: string): ConceptRecord {
  return {
    key,
    name,
    aliases: [],
    courses: [],
    sources: [],
    firstSeen: '2026-08-01T00:00:00.000Z',
  } as unknown as ConceptRecord;
}

function edge(type: ConceptRelation['type'], from: string, to: string): ConceptRelation {
  return {
    type,
    from,
    to,
    confidence: 0.9,
    provenance: 'hers',
    introducingPassages: {
      from: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
      to: { sourcePath: 'b.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
    },
  } as unknown as ConceptRelation;
}

function review(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptIds: readonly string[];
  readonly instrumentId?: string;
}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: overrides.instrumentId ?? `inst-${overrides.eventId}`,
    instrumentType: 'qa',
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
    conceptIds: [...overrides.conceptIds],
  } as unknown as ReviewLogEntry;
}

/** Four distinct successful days, recent enough that vitality reads `holding` at `NOW` (mirrors `prerequisite-evidence-wiring.spec.ts`'s identical fixture). */
function fourSpacedSuccesses(conceptId: string, instrumentId: string): ReviewLogEntry[] {
  return ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].map((day, index) =>
    review({
      eventId: `e-${conceptId}-${index}`,
      timestamp: `${day}T08:00:00+00:00`,
      conceptIds: [conceptId],
      instrumentId,
    }),
  );
}

/**
 * The real production resolver, closed over a review log that varies per
 * test — exactly the composition `open-session.ts:968` builds, over the SAME
 * relations/concepts `main.ts`'s `buildReviewSessionInput` now threads
 * (`relations: this.servedRelationEdges()` immediately followed by
 * `...(this.conceptRecords ? { concepts: this.conceptRecords } : {})`).
 */
function realResolverOver(entries: readonly ReviewLogEntry[]) {
  return createPrerequisiteEvidenceReader({
    entries,
    scheduler: createFsrsScheduler(),
    now: NOW,
    relations: [edge('prerequisite', 'Prereq', 'Dependent')],
    concepts: [concept('Prereq', PREREQ_KEY), concept('Dependent', DEPENDENT_KEY)],
  });
}

/** A failing instrument on the dependent concept, rated past the confusion-routing threshold. */
async function rateFailingInstrumentPastThreshold(session: ReviewSession): Promise<void> {
  await session.start();
  session.reveal();
  await session.rate('again');
}

describe('F2.12 prerequisite branch, real resolver + real decision ([D-265] ruling 2, ol-egov.141.51.1.1 part 2)', () => {
  it('unknown — no evidence at all for the prerequisite routes the offer onto it', async () => {
    const instrument = qaFixture({ conceptIds: [DEPENDENT_KEY] });
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(instrument)],
        scheduler: fakeScheduler(4),
        resolvePrerequisiteEvidence: realResolverOver([]),
        evaluateConfusionRouting,
      }),
    );

    await rateFailingInstrumentPastThreshold(session);

    expect(session.getConfusionRoutingOffer()).toEqual({
      instrument,
      promptText: expect.stringContaining('may trace to something earlier'),
      offerKind: 'prerequisite-alternative',
      prerequisiteConceptId: PREREQ_KEY,
    });
  });

  it('weak — some prerequisite evidence, below the sapling line, still routes the offer onto it', async () => {
    const instrument = qaFixture({ conceptIds: [DEPENDENT_KEY] });
    const entries = [
      review({ eventId: 'e-1', timestamp: '2026-08-20T08:00:00+00:00', conceptIds: [PREREQ_KEY] }),
    ];
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(instrument)],
        scheduler: fakeScheduler(4),
        resolvePrerequisiteEvidence: realResolverOver(entries),
        evaluateConfusionRouting,
      }),
    );

    await rateFailingInstrumentPastThreshold(session);

    const offer = session.getConfusionRoutingOffer();
    expect(offer?.offerKind).toBe('prerequisite-alternative');
    expect(offer?.prerequisiteConceptId).toBe(PREREQ_KEY);
  });

  it('strong — sapling/tree and holding vitality leaves the ordinary offer standing, with no prerequisite named', async () => {
    const instrument = qaFixture({ conceptIds: [DEPENDENT_KEY] });
    const entries = fourSpacedSuccesses(PREREQ_KEY, 'inst-prereq');
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(instrument)],
        scheduler: fakeScheduler(4),
        resolvePrerequisiteEvidence: realResolverOver(entries),
        evaluateConfusionRouting,
      }),
    );

    await rateFailingInstrumentPastThreshold(session);

    const offer = session.getConfusionRoutingOffer();
    expect(offer).toEqual({
      instrument,
      promptText: expect.stringContaining("That's usually not forgetting"),
      offerKind: 'explain-back',
    });
    expect(offer && 'prerequisiteConceptId' in offer).toBe(false);
  });
});
