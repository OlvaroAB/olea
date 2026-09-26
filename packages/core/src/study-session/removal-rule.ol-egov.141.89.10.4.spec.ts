// New test file for `ol-egov.141.89.10.4` ([ILB-PLN-4]), covering D-330's "one general rule
// covering all four removal causes together" acceptance criterion for the two files this bead
// owns in this directory (`build.ts`; `compose.ts`'s own D-330/D-351 citation-changed removal is
// already extensively covered in `compose.spec.ts`, run alongside this file as part of the same
// check — see this bead's report).
//
// `build.ts`/`compose.ts` never read a suspend, withdrawal or missing-note fact themselves — both
// modules' own docs state the posture explicitly: "the caller hands the fill an already-filtered
// index" (`compose.ts`'s `withholdInstruments` doc). So the FIRST three of D-330's four causes
// (suspended, withdrawn, note gone) reach this layer identically, as an instrument simply absent
// from the `ConceptInstrumentIndex` the caller builds — `plugin/src/review/session.ts`'s own
// splicing (F2.6 suspend, missing-note removal) is the production caller of that posture, outside
// this bead's owns. This suite proves the one property D-330 requires AT the layer this bead
// controls: removing an instrument from the index removes exactly that instrument's session slot,
// inserts no replacement, and leaves the remaining items' relative order untouched — the same
// invariant, structurally, regardless of which of the three causes made the instrument disappear.
import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudySession } from './build.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';

function row(conceptName: string, rank: number): GapRow {
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'CRS101',
    gapClass: 'mastery-gap' as GapClass,
    rank,
    oracleRank: rank,
    priorityScore: 5,
    gapScore: 5,
    readiness: {
      assessmentFormat: 'unknown' as AssessmentFormat,
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'seed' as OracleMasteryState,
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

function qa(instrumentId: string, conceptId: string): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds: [conceptId],
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

describe('D-330: one general removal rule reaches build.ts identically for suspended, withdrawn and note-gone', () => {
  // Three concepts, three instruments, ordered by rank (already 'given' — the shape
  // `buildComposedStudySession` hands this module, per its own doc). A generous budget so every
  // group fits and nothing is left out by the fill itself.
  const rows = [row('concept-1', 1), row('concept-2', 2), row('concept-3', 3)];
  const allRecords = [qa('i1', 'concept-1'), qa('i2', 'concept-2'), qa('i3', 'concept-3')];

  function buildWith(records: readonly QaInstrumentRecord[]) {
    return buildStudySession({
      rows,
      instruments: buildConceptInstrumentIndex(records),
      budgetMinutes: 30,
      durations: flatDurations(60),
      asOf: AS_OF,
      order: 'given',
    });
  }

  it('with every instrument present, all three concepts are served in rank order', () => {
    const model = buildWith(allRecords);
    expect(model.items.map((item) => item.instrumentId)).toEqual(['i1', 'i2', 'i3']);
    expect(model.items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  // The three causes below are indistinguishable to this module by construction — each is
  // simulated the one way this module's own doc says a caller may act on any of them: the
  // instrument is simply absent from the index handed to the fill. D-330's "one general rule"
  // is exactly the claim that this is not an accident of implementation for one cause but the
  // single mechanism all three share.
  it.each([
    ['suspended by her', allRecords.filter((r) => r.instrumentId !== 'i2')],
    ['withdrawn by her', allRecords.filter((r) => r.instrumentId !== 'i2')],
    ['its note gone from the vault', allRecords.filter((r) => r.instrumentId !== 'i2')],
  ])(
    '%s: the instrument leaves the session, nothing replaces it, and order is preserved',
    (_cause, records) => {
      const model = buildWith(records);
      const ids = model.items.map((item) => item.instrumentId);
      // Removed, not replaced: exactly the two survivors, nothing invented in `i2`'s place.
      expect(ids).toEqual(['i1', 'i3']);
      // Relative order preserved among what remains (renumbered contiguously, never reordered).
      expect(model.items.map((item) => item.position)).toEqual([1, 2]);
      // No item anywhere claims to be `concept-2`'s practice, and no `StudySessionItem` field
      // exists for a rating or a penalty in the first place — the shape itself cannot carry one.
      expect(model.items.some((item) => item.conceptName === 'concept-2')).toBe(false);
    },
  );

  it('removing every instrument leaves an honest empty session, never a fabricated one', () => {
    const model = buildWith([]);
    expect(model.items).toHaveLength(0);
  });
});
