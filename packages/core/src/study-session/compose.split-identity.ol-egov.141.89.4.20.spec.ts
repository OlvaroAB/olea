/**
 * `ol-egov.141.89.4.20` (`[D-402]`): `study-session/compose.ts`'s
 * `prerequisiteConceptKeysFromEdges` joined a `prerequisite` edge's endpoints by name
 * (`keyOfName.get(edge.from)`/`.get(edge.to)`) alone. Since `[D-402]`, one wording can name one
 * identity per course, and `nameToKeyFromRows`'s name→key map is first-occurrence-wins over
 * EVERY row `composeSessionRows` was handed (`allRows`, before `[STEER-1]`'s course/topic filter
 * narrows the composed set) — so a wording shared by two courses' rows could resolve a
 * `prerequisite` edge to the WRONG course's `conceptKey`, one that is not even present in the
 * band actually being ordered, silently dropping a real prerequisite signal. The fix: prefer the
 * edge's own `fromKey`/`toKey` (`../concept/related-concept-keys.js`'s `RelationWithEndpointKeys`,
 * `[D-088]`'s opaque key) and fall back to the name join only when the edge carries neither.
 *
 * A dedicated file, not an addition to `compose.spec.ts` or
 * `compose.prerequisite-tie-break.spec.ts` — this bead owns `compose.ts` only, and both of those
 * are shared files other lanes may be editing concurrently. Fixture helpers are copied from
 * `compose.spec.ts`'s own (unexported) `row`/`rows`/`qa`/`flatDurations`/`replay`/`passage`
 * rather than imported, matching the tie-break file's own stated reason.
 *
 * INV-3: every concept/course name below is coined for this test file.
 */

import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationProvenanceKind, RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { composeSessionRows } from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures — copied from compose.spec.ts's own, not imported (see file doc).
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly course?: string;
  /** Defaults to `conceptName` — set explicitly to diverge, the shape a split D-402 identity takes. */
  readonly conceptKey?: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
}

function row(spec: RowSpec, rank: number): GapRow {
  return {
    conceptName: spec.conceptName,
    conceptKey: spec.conceptKey ?? spec.conceptName,
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

/** `from` is the prerequisite/subtype side, `to` the dependent/supertype side, matching
 * `compose.spec.ts`'s own `edge` helper. `fromKey`/`toKey` are `[D-088]`'s opaque endpoint keys,
 * carried structurally (`../concept/related-concept-keys.js`'s `RelationWithEndpointKeys`) —
 * present exactly when the caller under test wants to exercise the keyed-preference path. */
function edge(
  type: RelationType,
  from: string,
  to: string,
  keys?: { readonly fromKey?: string; readonly toKey?: string },
  provenance: RelationProvenanceKind = 'model-proposed',
): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance,
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
    ...keys,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeSessionRows: prerequisite adjacency keys an endpoint by fromKey/toKey first (`ol-egov.141.89.4.20`, `[D-402]`)', () => {
  it("split wording: a name shared with another course does not steal the edge — the edge resolves to the SAME course's identity via fromKey/toKey", () => {
    // `nameToKeyFromRows` is first-occurrence-wins over `allRows`, so the decoy 'Zeta' row from
    // `OTHER` — listed FIRST, outside the `courses` filter below — would poison a name-only join:
    // `keyOfName.get('Zeta')` would resolve to the decoy's key, which is not present in `TARGET`'s
    // own band at all, so a name-only join drops the edge entirely (an unresolved endpoint). The
    // edge's own `fromKey`/`toKey` name `TARGET`'s real rows instead, and must win.
    const theRows = rows([
      { conceptName: 'Zeta', course: 'OTHER', conceptKey: 'Zeta#OTHER', gapScore: 5 },
      { conceptName: 'Zeta', course: 'TARGET', conceptKey: 'Zeta#TARGET', gapScore: 5 },
      { conceptName: 'Alpha', course: 'TARGET', conceptKey: 'Alpha#TARGET', gapScore: 5 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-zeta-other', ['Zeta#OTHER']),
      qa('i-zeta-target', ['Zeta#TARGET']),
      qa('i-alpha-target', ['Alpha#TARGET']),
    ]);
    const tiedOverdue = replay({
      'i-zeta-other': { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
      'i-zeta-target': { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
      'i-alpha-target': { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
    });

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: tiedOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      courses: ['TARGET'],
      relations: [
        edge('prerequisite', 'Zeta', 'Alpha', { fromKey: 'Zeta#TARGET', toKey: 'Alpha#TARGET' }),
      ],
    });

    // Alphabetically ('Alpha' < 'Zeta') is the OPPOSITE of this order — a pass proves the keyed
    // prerequisite edge, not the residual name tiebreak, decided the order.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Zeta', 'Alpha']);
  });

  it('unsplit wording (no keys on the edge): the plain name join still orders the tied pair — the fallback is unchanged', () => {
    const theRows = rows([
      { conceptName: 'Beta', course: 'TARGET', gapScore: 5 },
      { conceptName: 'Gamma', course: 'TARGET', gapScore: 5 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-beta', ['Beta']),
      qa('i-gamma', ['Gamma']),
    ]);
    const tiedOverdue = replay({
      'i-beta': { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
      'i-gamma': { lastReviewedDay: '2026-08-01', dueDay: '2026-09-01' },
    });

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: tiedOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // No `fromKey`/`toKey` — this edge has never carried them; the name join must still resolve it.
      relations: [edge('prerequisite', 'Gamma', 'Beta')],
    });

    // Alphabetically ('Beta' < 'Gamma') is the OPPOSITE of this order — a pass proves the
    // keyless edge's name join still moved the pair, exactly as before this bead.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Gamma', 'Beta']);
  });
});
