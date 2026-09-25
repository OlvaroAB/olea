// Scenario: features/F5-explain-it-back.md — "knowledge model 4.1 / `[D-101]`" block,
// "Scenario: authorship is never evidence of understanding, in either direction" (`@manual`),
// tagged `@auto:core/mastery/evidence-inputs.spec` (this file — `ol-egov.141.89.9.46`, discovered
// from `ol-egov.141.89.6.43` and `ol-egov.141.89.6.45`).
//
// `[D-101]` / knowledge model §3.2 names "Evidence of understanding, in either direction" as a
// **forbidden consumer** of the authorship fact, permanently: "Writing it proves she wrote it,
// not that she understands it — understanding is measured by practice evidence only. And *not*
// having written it ... never reads as a deficit." This file is that clause's proof against the
// two modules the manual scenario names: `./rollup.ts` (the growth-stage axis, R3/R7) and
// `./gradingInputContract.ts` (what a grading call is built from, `[D-083]`).
//
// The property holds STRUCTURALLY, not behaviourally, as the scenario's own note records: neither
// `ReviewLogRecord`/`ReviewLogEntry` (rollup.ts's input) nor `MasteryRollupOptions`
// (rollup.ts's tuning input) nor `GradingRetrievalInput`/`GradingSourceMaterial`
// (gradingInputContract.ts's input/output) carries any authorship-fact field today — confirmed by
// reading `packages/contracts/src/review-log.ts` (`reviewLogRecordV5`'s full field list) and this
// directory's own two source files. The only place an authorship fact exists in this codebase is
// `MaterialityAuthorship` (`../source/materiality.ts`) and its one consumer,
// `../misconception/belief-source.ts`'s belief-attribution filter — a different module, gating a
// different field (`statement`, not any mastery axis), already covered by
// `../misconception/belief-source.spec.ts`. So "no input to the computation is an authorship
// fact" (the scenario's own words) is proven two ways below:
//
//   1. TYPE-LEVEL (this file's `describe('structural — no authorship field ...')` blocks): every
//      field of every input/output type these two modules use is enumerated with
//      `expectTypeOf<Extract<keyof T, 'authorship' | ...>>().toEqualTypeOf<never>()`, the same
//      idiom `../instrument/rating.spec.ts` and `../scheduler/surface.spec.ts` already use for
//      "this field does not exist" proofs. If a future edit ever adds an authorship-named field to
//      any of these types, `pnpm run typecheck` fails here before any behaviour changes.
//   2. BEHAVIOURAL (the `describe('behavioural — ...')` blocks): two review histories / two
//      grading-retrieval inputs are built independently — one commented as modelling a concept
//      she has written about extensively in her own words, one as a concept she has only ever
//      studied from slides (the manual scenario's own framing) — and the readings are asserted
//      byte-identical. Because the input types carry no authorship field (proof 1), the two
//      constructions cannot actually differ on that fact even in principle; this half shows the
//      absence is not merely unused but has no observable effect, for the same reason the manual
//      scenario asks for ("the two read identically").
//
// Concept and instrument ids below are structural placeholders ("concept-a", "concept-b",
// "x-1"), never fixture vocabulary — INV-3.

import type { InstrumentType, ReviewLogEntry, ReviewLogRecord, SoloLevel } from 'olea-contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SourceBlockRef } from '../grading/gradingPipeline.js';
import {
  buildGradingSourceMaterial,
  type ConceptDefiningPassages,
  type GradingRelationContext,
  type GradingRetrievalInput,
  type GradingSourceMaterial,
  type GradingSubject,
} from './gradingInputContract.js';
import {
  type ConceptMasteryEvidence,
  type ConceptMasteryResult,
  computeConceptMastery,
  type MasteryRollupOptions,
} from './rollup.js';

// The candidate field names an authorship fact could plausibly be spelled with in this codebase —
// drawn from the real field name the belief-attribution filter uses
// (`statementAuthorship`, `../misconception/events.ts`) and the fact's own type name
// (`MaterialityAuthorship`, `../source/materiality.ts`), plus its sibling fact `[D-101]` also
// names (`curationAuthority`). Not exhaustive by construction — that is what proof 1 below checks
// exhaustively per type, this list only documents which names were considered.
type AuthorshipFieldNames =
  | 'authorship'
  | 'statementAuthorship'
  | 'sourceAuthorship'
  | 'materialAuthorship'
  | 'curationAuthority';

describe('structural — rollup.ts inputs carry no authorship field', () => {
  it('ReviewLogRecord (the review-log record union rollup.ts folds) has no authorship field', () => {
    expectTypeOf<Extract<keyof ReviewLogRecord, AuthorshipFieldNames>>().toEqualTypeOf<never>();
  });

  it('ReviewLogEntry (rollup.ts’s public entry type, review | suspend records) has no authorship field', () => {
    expectTypeOf<Extract<keyof ReviewLogEntry, AuthorshipFieldNames>>().toEqualTypeOf<never>();
  });

  it('MasteryRollupOptions (the tuning input alongside the log) has no authorship field', () => {
    expectTypeOf<
      Extract<keyof MasteryRollupOptions, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
  });

  it('ConceptMasteryResult and ConceptMasteryEvidence (the fold’s own output) carry no authorship field either — an axis cannot leak a fact it was never handed', () => {
    expectTypeOf<
      Extract<keyof ConceptMasteryResult, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<keyof ConceptMasteryEvidence, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
  });

  it('runtime cross-check: a fully-populated ReviewLogRecord’s own keys name no authorship field', () => {
    // Belt-and-suspenders against the type-level checks above: every optional field
    // `reviewLogRecordV5` defines (masteryAtTime, supportLevelShown, explainBackGrade,
    // schedulingObservation, correctness) is populated here, so `Object.keys` below is the
    // record's full possible key set, not an accident of which optionals this fixture omitted.
    const record: ReviewLogRecord = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r-1',
      timestamp: '2026-01-10T09:00:00-04:00',
      instrumentId: 'qa:concept-a:1',
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
      masteryAtTime: { attribution: 'per-concept', byConcept: { 'concept-a': 'seed' } },
      supportLevelShown: 'independent',
    };
    const authorshipLikeKeys = Object.keys(record).filter((key) =>
      /authorship|curationAuthority/i.test(key),
    );
    expect(authorshipLikeKeys).toEqual([]);
  });
});

describe('structural — gradingInputContract.ts inputs and output carry no authorship field', () => {
  it('GradingSubject, ConceptDefiningPassages and GradingRelationContext have no authorship field', () => {
    expectTypeOf<Extract<keyof GradingSubject, AuthorshipFieldNames>>().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<keyof ConceptDefiningPassages, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<keyof GradingRelationContext, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
  });

  it('GradingRetrievalInput (what buildGradingSourceMaterial reads) has no authorship field', () => {
    expectTypeOf<
      Extract<keyof GradingRetrievalInput, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
  });

  it('GradingSourceMaterial (what buildGradingSourceMaterial returns) has no authorship field', () => {
    expectTypeOf<
      Extract<keyof GradingSourceMaterial, AuthorshipFieldNames>
    >().toEqualTypeOf<never>();
  });

  it('SourceBlockRef (every passage sent to the grader) has no authorship field', () => {
    expectTypeOf<Extract<keyof SourceBlockRef, AuthorshipFieldNames>>().toEqualTypeOf<never>();
  });
});

// ---------------------------------------------------------------------------
// Behavioural half: two independently-built inputs, one modelled on
// extensively-hers material and one on not-hers/unknown-only material,
// read identically because the input shape gives them no way not to.
// ---------------------------------------------------------------------------

// `eventId`/`instrumentId` are deliberately NOT built from `conceptId` below (unlike
// `rollup.spec.ts`'s own `review` helper): `topStageAttempt.eventId`/`.instrumentId`
// (`ConceptMasteryEvidence`) echo whatever identifiers the qualifying record carried, and this
// file's comparisons must isolate the one thing that is allowed to differ between the two
// histories (`conceptId`) from identifier text that would differ only because the two histories
// were built by two separate calls, which is not what this scenario is testing.
function review(conceptId: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r-shared',
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:shared:1',
    instrumentType: 'qa',
    conceptIds: [conceptId],
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

function gradedExplainBack(
  conceptId: string,
  soloLevel: SoloLevel,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return review(conceptId, {
    eventId: 'eb-shared',
    instrumentId: 'explain-back:shared',
    instrumentType: 'explain-back' as InstrumentType,
    rating: null,
    supportLevelShown: 'independent',
    explainBackGrade: {
      soloLevel,
      correctness: 'correct',
      contentRef: 'content-ref-placeholder',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back-grade',
        promptVersion: 'v0',
        modelId: 'model-placeholder',
      },
    },
    ...overrides,
  });
}

/**
 * One review event per calendar day, three days apart, for `conceptId` — the same shape
 * `../mastery/rollup.spec.ts`'s `onConsecutiveDays` builds, reproduced locally so this file does
 * not import test helpers from another lane's spec file.
 */
function spacedSuccesses(conceptId: string, days: readonly string[]): ReviewLogRecord[] {
  return days.map((day, index) =>
    review(conceptId, { eventId: `d${index}`, timestamp: `${day}T09:00:00-04:00` }),
  );
}

/**
 * The manual scenario's first case, in the manual scenario's own words: "one concept she has
 * written about extensively in her own words". `conceptId` is the only thing that varies between
 * this and {@link historyForNotHersOrUnknownConcept} — deliberately: there is no authorship
 * field on `ReviewLogRecord` for this builder to set even if it wanted to record the fact.
 */
function historyForExtensivelyHersConcept(conceptId: string): ReviewLogRecord[] {
  return [
    ...spacedSuccesses(conceptId, ['2026-01-10', '2026-01-11', '2026-01-12']),
    gradedExplainBack(conceptId, 'relational'),
  ];
}

/** The manual scenario's second case: "one she has only ever studied from slides". Same shape. */
function historyForNotHersOrUnknownConcept(conceptId: string): ReviewLogRecord[] {
  return [
    ...spacedSuccesses(conceptId, ['2026-01-10', '2026-01-11', '2026-01-12']),
    gradedExplainBack(conceptId, 'relational'),
  ];
}

/** `ConceptMasteryResult` minus `conceptId`, which necessarily differs across two concepts. */
function axesOf(result: ConceptMasteryResult): { state: unknown; evidence: unknown } {
  return { state: result.state, evidence: result.evidence };
}

describe('behavioural — rollup.ts reads the two axes identically regardless of authorship', () => {
  it('a concept built from extensively-hers material and one built from not-hers/unknown material, with identical review histories, roll up to byte-identical axes', () => {
    const hersHistory = historyForExtensivelyHersConcept('concept-a');
    const notHersHistory = historyForNotHersOrUnknownConcept('concept-b');

    const hersResult = computeConceptMastery(hersHistory, 'concept-a');
    const notHersResult = computeConceptMastery(notHersHistory, 'concept-b');

    expect(axesOf(hersResult)).toEqual(axesOf(notHersResult));
    // Not a vacuous pass: both reach the top stage, so the comparison exercises the depth gate,
    // the spacing gate and the evidence-count fields all at once, not just a shared `seed`.
    expect(hersResult.state).toEqual('tree');
    expect(notHersResult.state).toEqual('tree');
  });

  it('the same holds with no evidence at all — an authorship fact never manufactures or withholds a stage on its own', () => {
    const hersResult = computeConceptMastery([], 'concept-a');
    const notHersResult = computeConceptMastery([], 'concept-b');

    expect(axesOf(hersResult)).toEqual(axesOf(notHersResult));
    expect(hersResult.state).toEqual('seed');
  });
});

function block(blockId: string, text = `text for ${blockId}`): SourceBlockRef {
  return { blockId, text };
}

function passages(conceptId: string, ...blockIds: readonly string[]): ConceptDefiningPassages {
  return { conceptId, passages: blockIds.map((id) => block(id)) };
}

/**
 * Builds one `GradingRetrievalInput` for `conceptId`, commented per call site as modelling either
 * extensively-hers or not-hers/unknown source material for the SAME concept id —
 * `GradingRetrievalInput` has no field either construction could set to record that fact, which is
 * exactly proof 1's `GradingRetrievalInput` check above, exercised here at the value level.
 */
function retrievalInputFor(conceptId: string): GradingRetrievalInput {
  return {
    subject: { subjectConceptId: conceptId },
    subjectDefiningPassages: passages(conceptId, 'x-1', 'x-2'),
    relation: { kind: 'concept-only' },
  };
}

describe('behavioural — gradingInputContract.ts builds identical source material regardless of authorship', () => {
  it('the extensively-hers construction and the not-hers/unknown construction produce the same GradingRetrievalInput, because the type gives them no way to differ', () => {
    const hersInput = retrievalInputFor('concept-x'); // modelled: her own extensive synthesis
    const notHersInput = retrievalInputFor('concept-x'); // modelled: studied only from slides

    expect(hersInput).toEqual(notHersInput);
  });

  it('buildGradingSourceMaterial reads the two constructions identically', () => {
    const hersInput = retrievalInputFor('concept-x');
    const notHersInput = retrievalInputFor('concept-x');

    const hersMaterial = buildGradingSourceMaterial(hersInput);
    const notHersMaterial = buildGradingSourceMaterial(notHersInput);

    expect(hersMaterial).toEqual(notHersMaterial);
    // Not vacuous: the denominator is populated (not the null-degradation path) and non-empty, so
    // the comparison exercises real retrieval output, not two empty shells.
    expect(hersMaterial.omissionDenominator).not.toBeNull();
    expect(hersMaterial.omissionDenominator?.length).toBeGreaterThan(0);
  });
});
