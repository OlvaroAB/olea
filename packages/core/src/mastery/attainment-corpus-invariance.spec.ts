// `ol-egov.141.89.9.59` ([D-414], `ol-egov.141.89.48`): two invariants in the
// attainment chain.
//
// (a) Adding a document to the corpus, or drafting a deeper instrument for a
// concept already in scope, produces no `ReviewLogEntry` of `kind: 'review'`
// — the only kind `./rollup.ts`'s `indexEntries` folds into
// `recordsByConcept` / `instrumentTypesByConcept`, and therefore the only
// kind `readAllConceptReadiness`, `readNeed` and
// `readAllEligibleConceptVitality` can ever see (every other kind is
// dropped at `indexEntries`'s `if (entry.kind !== 'review') continue`).
// A `'source-registered'` event is exactly "a document named to the corpus"
// (F1.5, `[D-226]`) and an `'explain-back-offered'` event is exactly "a
// deeper instrument offered, not yet answered" — its own module doc in
// `olea-contracts`' `review-log.ts` says outright "no fold, growth stage or
// vitality reading reads it." This fixture proves the consequence at the
// reading, not just at the fold: every concept's readiness and need is
// bit-for-bit unchanged after either event, and moves only for the concept
// she actually answers.
//
// (b) Evidence at a narrower demand never meets a deeper one is an existing
// case class, not restated here: `../gap/demand.spec.ts`'s
// "evidence of another demand never meets this one (N4)" (an instrument
// declaring only `recall-a-fact` evidence against a declared
// `apply-to-unfamiliar-case` demand — the narrower-does-not-cover-deeper
// case by name) and its "(b) any-past-success" sibling "evidence of another
// demand still never meets this one". `../gap/readiness-demand-ruling.spec.ts`'s
// module comment independently names this "criterion (4)... already tested
// there [`../gap/demand.ts`] and in `./need-row.spec.ts`'s unmet-demand
// gate; not restated here" — the same restraint this file follows.
//
// Ids are structural placeholders, never fixture vocabulary (INV-3).

import type {
  ExplainBackOfferLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
  SourceRegisteredLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { Scheduler } from '../scheduler/types.js';
import { readAllConceptReadiness, readAllEligibleConceptVitality, readNeed } from './attainment.js';
import { HOLDING_CUT } from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r-default',
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

function recall(
  eventId: string,
  timestamp: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return review({ eventId, timestamp, supportLevelShown: 'independent', ...overrides });
}

/** "A document named to the corpus" (F1.5, `[D-226]`) — never a fold's input. */
function sourceRegistered(
  eventId: string,
  timestamp: string,
  overrides: Partial<SourceRegisteredLogRecord> = {},
): SourceRegisteredLogRecord {
  return {
    schemaVersion: 6,
    kind: 'source-registered',
    eventId,
    timestamp,
    path: 'concept-a-source.md',
    role: 'objectives',
    course: 'course-a',
    ...overrides,
  };
}

/** "A deeper instrument drafted", offered but not yet answered — no rating, no grade. */
function explainBackOffered(
  eventId: string,
  timestamp: string,
  overrides: Partial<ExplainBackOfferLogRecord> = {},
): ExplainBackOfferLogRecord {
  return {
    schemaVersion: 6,
    kind: 'explain-back-offered',
    eventId,
    timestamp,
    conceptIds: ['concept-a'],
    trigger: 'on-demand',
    instrumentId: 'eb:a:2',
    ...overrides,
  } as ExplainBackOfferLogRecord;
}

const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const T3 = '2026-01-14T09:00:00-04:00';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.parse(T3) + DAY);

const scheduler: Scheduler = createFsrsScheduler();
const CONCEPT_IDS = ['concept-a', 'concept-b'];

function readingsAt(entries: readonly ReviewLogEntry[]) {
  const validity = projectInstrumentValidity(entries);
  const readiness = readAllConceptReadiness(entries, CONCEPT_IDS, scheduler, NOW, validity);
  const vitality = readAllEligibleConceptVitality(
    entries,
    CONCEPT_IDS,
    scheduler,
    NOW,
    HOLDING_CUT,
    validity,
  );
  const need = new Map(
    CONCEPT_IDS.map((id) => {
      const perConcept = readiness.get(id);
      if (perConcept === undefined) throw new Error(`no readiness reading for ${id}`);
      return [id, readNeed(perConcept)] as const;
    }),
  );
  return { readiness, vitality, need };
}

describe('(a) [D-414]: a corpus addition or a drafted-but-unanswered instrument moves nothing until she answers', () => {
  const baseline: readonly ReviewLogEntry[] = [
    recall('r-a1', T1, { conceptIds: ['concept-a'], instrumentId: 'qa:a:1' }),
    recall('r-b1', T1, { conceptIds: ['concept-b'], instrumentId: 'qa:b:1' }),
  ];

  it('adding a document and drafting a deeper instrument for a concept already in scope leaves every readiness, vitality and need reading unchanged', () => {
    const before = readingsAt(baseline);

    const withCorpusAndInstrumentAdditions: readonly ReviewLogEntry[] = [
      ...baseline,
      sourceRegistered('src-1', T2),
      explainBackOffered('ebo-1', T2, { conceptIds: ['concept-a'], instrumentId: 'eb:a:2' }),
    ];
    const after = readingsAt(withCorpusAndInstrumentAdditions);

    for (const id of CONCEPT_IDS) {
      expect(after.readiness.get(id)).toEqual(before.readiness.get(id));
      expect(after.vitality.get(id)).toEqual(before.vitality.get(id));
      expect(after.need.get(id)).toEqual(before.need.get(id));
    }
    // Sanity: the baseline itself is not vacuous — concept-a really has an
    // eligible reading, so "unchanged" is a real claim, not two nulls agreeing.
    expect(before.readiness.get('concept-a')?.weakest?.instrumentId).toBe('qa:a:1');
  });

  it('once she answers, only the answered concept’s readiness, vitality and need move', () => {
    const withCorpusAndInstrumentAdditions: readonly ReviewLogEntry[] = [
      ...baseline,
      sourceRegistered('src-1', T2),
      explainBackOffered('ebo-1', T2, { conceptIds: ['concept-a'], instrumentId: 'eb:a:2' }),
    ];
    const before = readingsAt(withCorpusAndInstrumentAdditions);

    const sheAnswers: readonly ReviewLogEntry[] = [
      ...withCorpusAndInstrumentAdditions,
      recall('r-a2', T3, { conceptIds: ['concept-a'], instrumentId: 'qa:a:2', rating: 'good' }),
    ];
    const after = readingsAt(sheAnswers);

    // concept-a moves: a second eligible instrument now feeds its fold.
    expect(after.readiness.get('concept-a')?.instrumentsRead).toBe(2);
    expect(before.readiness.get('concept-a')?.instrumentsRead).toBe(1);
    expect(after.readiness.get('concept-a')).not.toEqual(before.readiness.get('concept-a'));
    expect(after.need.get('concept-a')).not.toEqual(before.need.get('concept-a'));

    // concept-b, never touched by the new answer, is bit-for-bit unchanged.
    expect(after.readiness.get('concept-b')).toEqual(before.readiness.get('concept-b'));
    expect(after.vitality.get('concept-b')).toEqual(before.vitality.get('concept-b'));
    expect(after.need.get('concept-b')).toEqual(before.need.get('concept-b'));
  });
});
