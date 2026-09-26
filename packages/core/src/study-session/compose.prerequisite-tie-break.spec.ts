/**
 * `[ILB-PLN-B1]` (`ol-egov.141.89.10.6`, olea-service): restores `prerequisite` as an ordering
 * input in the live composer, as a tie-band preference — never a gate. `[SESS-8.6]` retired
 * `composeQueue` and with it the only production read of a `prerequisite` edge for ordering;
 * `study-session/compose.ts` never read one. `[D-296]` (ruled 2026-09-23) restores it here, option
 * (b): "a tie-break in the live composer's ordering." Read `compose.ts`'s module doc section "F2.19
 * — a fifth, restored signal" before changing anything below.
 *
 * A dedicated file, not an addition to `compose.spec.ts` — this bead owns `compose.ts` only, and
 * `compose.spec.ts` is a shared file other lanes may be editing concurrently (`LANE-RULES-r2.md`).
 * Fixture helpers below are deliberately copied from `compose.spec.ts`'s own (unexported) `row`/
 * `rows`/`qa`/`flatDurations`/`replay`/`edge`/`passage` rather than imported, for the same reason.
 *
 * INV-3: every concept/course name below is coined for this test file.
 */

import { describe, expect, it } from 'vitest';
import type {
  ConceptRelation,
  RelationProvenanceKind,
  RelationSet,
  RelationType,
} from '../concept/relation.js';
import { servedRelations } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildComposedStudySession, composeSessionRows } from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures — copied from compose.spec.ts's own, not imported (see file doc).
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly course?: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
}

function row(spec: RowSpec, rank: number): GapRow {
  return {
    conceptName: spec.conceptName,
    conceptKey: spec.conceptName,
    course: spec.course ?? 'CRS101',
    gapClass: 'mastery-gap' as GapClass,
    rank,
    oracleRank: rank,
    priorityScore: spec.gapScore ?? 5,
    gapScore: spec.gapScore ?? 5,
    readiness: {
      assessmentFormat: 'unknown' as AssessmentFormat,
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: spec.masteryState ?? 'seed',
    targetAssessmentPath: null,
    assessmentFormat: 'unknown' as AssessmentFormat,
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: [],
    instrumentCount: 1,
    affordances: ['open-concept', 'build-session'],
  };
}

function rows(specs: readonly RowSpec[]): readonly GapRow[] {
  return specs.map((spec, index) => row(spec, index + 1));
}

function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

function flatDurations(seconds: number): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds,
    source: 'assumed' as const,
    sampleCount: 0,
  }));
  return {
    estimates,
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: () => seconds,
    sourceFor: () => 'assumed',
  };
}

/** A `ReplayResult` fixture: `lastReviewedDay`/`dueDay` per instrument, everything else absent. */
function replay(
  entries: Readonly<Record<string, { readonly lastReviewedDay: string; readonly dueDay: string }>>,
): ReplayResult {
  const states = new Map(
    Object.entries(entries).map(([instrumentId, { lastReviewedDay, dueDay }]) => [
      instrumentId,
      {
        instrumentId,
        state: {
          schemaVersion: 1 as const,
          due: `${dueDay}T00:00:00.000Z`,
          stability: 10,
          difficulty: 5,
          scheduledDays: 10,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review' as const,
          lastReview: `${lastReviewedDay}T00:00:00.000Z`,
        },
        reviewCount: 1,
        lastReviewedAt: `${lastReviewedDay}T00:00:00.000Z`,
      },
    ]),
  );
  return { states, replayedCount: states.size, skippedCount: 0 };
}

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

/** `from` is the prerequisite/subtype side, `to` the dependent/supertype side — the canonical
 * directed reading `concept/relation.ts`'s `ProposedRelation` doc states, matching
 * `compose.spec.ts`'s own `edge` helper. */
function edge(
  type: RelationType,
  from: string,
  to: string,
  provenance: RelationProvenanceKind = 'model-proposed',
): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance,
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

/** Both concepts overdue by the same whole day, everything else equal — a real `overdueDays` tie. */
function tiedOverdueRows(names: readonly [string, string]): {
  readonly gapRows: readonly GapRow[];
  readonly instrumentIndex: ReturnType<typeof buildConceptInstrumentIndex>;
  readonly replayed: ReplayResult;
} {
  const gapRows = rows(names.map((conceptName) => ({ conceptName })));
  const instrumentIndex = buildConceptInstrumentIndex(names.map((name) => qa(`i-${name}`, [name])));
  const replayed = replay(
    Object.fromEntries(
      names.map((name) => [`i-${name}`, { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' }]),
    ),
  );
  return { gapRows, instrumentIndex, replayed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeSessionRows: `[ILB-PLN-B1]` direct-prerequisite tie-band preference', () => {
  it('a tied pair is ordered by prerequisite: the prerequisite sorts before its dependent', () => {
    // Both concepts overdue the same whole day, no F2.19 relatedness/assessment/arrival signal
    // supplied — a real exact tie with no other reason to prefer one over the other, so the ONLY
    // thing that can decide adjacency inside the band is the prerequisite edge.
    const { gapRows, instrumentIndex, replayed } = tiedOverdueRows(['Integrals', 'Derivatives']);
    // `Derivatives` (from) should be solid before `Integrals` (to) is attempted — the incoming
    // fixture order is deliberately the OPPOSITE, so a pass would prove the edge moved something.
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [edge('prerequisite', 'Derivatives', 'Integrals')],
    });
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Derivatives', 'Integrals']);
  });

  it('with no prerequisite edge supplied, the tied pair keeps its `overdue-first` residual order (no-op proof)', () => {
    const { gapRows, instrumentIndex, replayed } = tiedOverdueRows(['Integrals', 'Derivatives']);
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });
    // `gapScore` ties too (both default 5), so this is `overdueFirst`'s own `conceptName` fallback
    // — 'Derivatives' < 'Integrals' — unrelated to the prerequisite edge, which is absent here.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Derivatives', 'Integrals']);
  });

  it('a non-tied case is left unaffected: urgency (`overdue-first`) is never overridden across bands', () => {
    // `Integrals` is far more overdue than its own prerequisite `Derivatives` — a real product
    // situation (she fell behind on the advanced concept while still current on the basic one).
    // `[D-296]`/the module doc: prerequisite acts strictly INSIDE an exact tie band and must never
    // promote a less-overdue prerequisite ahead of a more-overdue dependent.
    const gapRows = rows([
      { conceptName: 'Integrals', gapScore: 9 },
      { conceptName: 'Derivatives', gapScore: 1 },
    ]);
    const instrumentIndex = buildConceptInstrumentIndex([
      qa('i-Integrals', ['Integrals']),
      qa('i-Derivatives', ['Derivatives']),
    ]);
    const replayed = replay({
      'i-Integrals': { lastReviewedDay: '2026-07-01', dueDay: '2026-07-15' }, // long overdue
      'i-Derivatives': { lastReviewedDay: '2026-09-10', dueDay: '2026-09-13' }, // barely overdue
    });
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [edge('prerequisite', 'Derivatives', 'Integrals')],
    });
    // Still overdue-first: the far-more-overdue dependent is NOT pushed behind its barely-overdue
    // prerequisite, because the two are not in the same exact-`overdueDays` band.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Integrals', 'Derivatives']);
  });

  it('an item with a missing/unresolved prerequisite edge stays eligible — never a gate', () => {
    // The edge names a prerequisite concept ("Limits") that is not among this session's own rows
    // at all (not yet due, not in scope, whatever the reason) — an unconfirmed/unresolved edge
    // endpoint. `[D-296]`'s reading: a false or unresolved edge costs order, never membership.
    const { gapRows, instrumentIndex, replayed } = tiedOverdueRows(['Integrals', 'Derivatives']);
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [edge('prerequisite', 'Limits', 'Integrals')],
    });
    // Both concepts are still composed — nothing was excluded by the unresolved edge.
    expect(new Set(result.orderedRows.map((r) => r.conceptName))).toEqual(
      new Set(['Integrals', 'Derivatives']),
    );
    // And the fill survives it too — the same "never a gate" claim, one layer down.
    const session = buildComposedStudySession({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetMinutes: 20,
      relations: [edge('prerequisite', 'Limits', 'Integrals')],
    });
    expect(new Set(session.model.items.map((item) => item.conceptName))).toEqual(
      new Set(['Integrals', 'Derivatives']),
    );
  });

  it("three concepts in a cycle inside one tie band keep the band's ordinary (incoming) order", () => {
    // A model-proposed edge set can perfectly well contain a cycle (`concept/prerequisite-order.ts`'s
    // own doc) — the ordering is a preference the material offered, never a constraint the queue
    // may fail on, so a cycle inside one band must leave that band exactly as `overdue-first`/F2.19
    // already ordered it (here: alphabetical by name, the residual tiebreak, since no other signal
    // is supplied).
    const names: readonly [string, string] = ['Alpha', 'Beta'];
    const gapRows = rows([
      { conceptName: 'Alpha' },
      { conceptName: 'Beta' },
      { conceptName: 'Gamma' },
    ]);
    const instrumentIndex = buildConceptInstrumentIndex(
      ['Alpha', 'Beta', 'Gamma'].map((name) => qa(`i-${name}`, [name])),
    );
    const replayed = replay(
      Object.fromEntries(
        ['Alpha', 'Beta', 'Gamma'].map((name) => [
          `i-${name}`,
          { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
        ]),
      ),
    );
    void names; // documents intent; the fixture uses all three names above
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [
        edge('prerequisite', 'Alpha', 'Beta'),
        edge('prerequisite', 'Beta', 'Gamma'),
        edge('prerequisite', 'Gamma', 'Alpha'), // closes the cycle
      ],
    });
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it("applies per-endpoint freshness (rel.md §3 Default 4): a stale endpoint's edge never orders anything, a current one still does", () => {
    // Two otherwise-identical `RelationSet`s, one marked `'current'`, one `'stale'` — the exact
    // shape `concept/relation.ts`'s own fold produces (`RelationSetEntry.evidence`). This module
    // has no `RelationEvidenceState` of its own to check; the freshness gate is `servedRelations`,
    // the SAME function `docs/dev/intelligence-build/rel.md` §3 Default 4 names as the one path a
    // reader may use — never a raw, ungated read of the per-proposition cache.
    const currentEdge = edge('prerequisite', 'Derivatives', 'Integrals');
    const relationSet: RelationSet = {
      entries: [
        {
          key: 'prerequisite\u0000Derivatives\u0000Integrals',
          stage: 'corpus',
          edge: currentEdge,
          triageStanding: 'candidate',
          evidence: 'current',
          attestations: [currentEdge],
        },
        {
          key: 'prerequisite\u0000StaleFrom\u0000StaleTo',
          stage: 'corpus',
          edge: edge('prerequisite', 'StaleFrom', 'StaleTo'),
          triageStanding: 'candidate',
          evidence: 'stale',
          attestations: [edge('prerequisite', 'StaleFrom', 'StaleTo')],
        },
      ],
      mergedDuplicates: 0,
      contradictions: 0,
      droppedUnemittable: 0,
    };
    const served = servedRelations(relationSet);
    // The gate did its job before this test even calls the composer: only the current edge survives.
    expect(served.map((e) => e.from)).toEqual(['Derivatives']);

    const { gapRows, instrumentIndex, replayed } = tiedOverdueRows(['Integrals', 'Derivatives']);
    const result = composeSessionRows({
      rows: gapRows,
      instruments: instrumentIndex,
      replay: replayed,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: served,
    });
    // The current edge still orders the tied pair — freshness gating one edge does not disable the
    // whole signal.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Derivatives', 'Integrals']);
  });
});
