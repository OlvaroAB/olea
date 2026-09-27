// `[D-386]` condition 3 (`ol-95vv.8`): the v5 -> v6 upgrade must preserve each
// recorded explain-back verdict's contribution to attainment. Folding the same
// log before and after the upgrade gives the same displayed stage and the same
// historical award for every concept, and the fold never requires a provenance
// stamp to count a legacy nested verdict.
//
// The log is the v5 golden that carries nested verdicts
// (`fixtures/review-log/2026-09-24.device-studio.v5-nested-verdict.jsonl`):
// a verdict that earns the top stage, a partial one, a correct one later
// superseded by an incorrect re-grade, and a depth grade with no verdict.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ReviewLogEntry,
  type ReviewLogRecord,
  readExplainBackCorrectness,
  reviewLogEntryV5,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { parseReviewLog } from '../review-log/parse.js';
import { type ConceptAttainment, readAllConceptAttainment } from './attainment.js';
import { projectInstrumentValidity } from './validity.js';

const FIXTURE = join(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'review-log',
  '2026-09-24.device-studio.v5-nested-verdict.jsonl',
);
const raw = readFileSync(FIXTURE, 'utf8');
const lines = raw.split('\n').filter((line) => line.trim() !== '');

/** The log as a v5 build read it: v5 records, as they were before the flip. */
const beforeUpgrade = lines.map(
  (line) => reviewLogEntryV5.parse(JSON.parse(line)) as unknown as ReviewLogEntry,
);
/** The same log as this build reads it: every line restamped to v6 by the one hop. */
const afterUpgrade = parseReviewLog(raw).records;

const CONCEPTS = ['cementation', 'bioturbation', 'imbrication', 'appoggiatura'];

function fold(entries: readonly ReviewLogEntry[]): ReadonlyMap<string, ConceptAttainment> {
  return readAllConceptAttainment(entries, CONCEPTS, projectInstrumentValidity(entries));
}

/** Stage, award and correction — what she is shown and what she keeps. */
function outcome(attainment: ConceptAttainment | undefined) {
  return {
    displayed: attainment?.displayed.state,
    award: attainment?.award ?? null,
    correction: attainment?.correction ?? null,
  };
}

/** Each nested verdict moved to the top-level field with its own stamp: the v6 writer's shape. */
function asTopLevelVerdicts(entries: readonly ReviewLogEntry[]): ReviewLogEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== 'review') return entry;
    const nested = entry.explainBackGrade?.correctness;
    if (nested === undefined || entry.explainBackGrade === undefined) return entry;
    const { correctness: _moved, ...grade } = entry.explainBackGrade;
    const record: ReviewLogRecord = {
      ...entry,
      explainBackGrade: grade,
      explainBackCorrectness: {
        verdict: nested,
        artifactProvenance: {
          taskId: 'explain-back.judge.v1',
          promptVersion: '2026-09-20',
          modelId: 'workers-ai:test-model',
        },
      },
    };
    return record;
  });
}

describe('[D-386] the v5 -> v6 upgrade preserves every verdict’s contribution to attainment', () => {
  it('the fixture really is an old-shape log carrying nested verdicts and nothing at the top level', () => {
    expect(afterUpgrade).toHaveLength(lines.length);
    expect(beforeUpgrade.every((entry) => entry.schemaVersion === (5 as never))).toBe(true);
    expect(afterUpgrade.every((entry) => entry.schemaVersion === 6)).toBe(true);
    const sources = afterUpgrade.map((entry) => readExplainBackCorrectness(entry as never)?.source);
    expect(sources.filter((source) => source === 'legacy-nested')).toHaveLength(4);
    expect(sources.includes('top-level')).toBe(false);
  });

  it('folds to the same displayed stage, historical award and correction for every concept', () => {
    const before = fold(beforeUpgrade);
    const after = fold(afterUpgrade);
    for (const conceptId of CONCEPTS) {
      expect(outcome(after.get(conceptId))).toEqual(outcome(before.get(conceptId)));
      expect(after.get(conceptId)?.displayed.evidence).toEqual(
        before.get(conceptId)?.displayed.evidence,
      );
    }
  });

  it('counts a legacy nested verdict with no provenance stamp: the fold is not vacuous', () => {
    const after = fold(afterUpgrade);
    // A nested `correct` at depth, independently shown: the top stage, awarded.
    expect(after.get('cementation')?.displayed.state).toBe('tree');
    expect(after.get('cementation')?.award?.attemptEventId).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    // A nested `partial` never earns it; neither does a depth grade with no verdict.
    expect(after.get('bioturbation')?.displayed.state).not.toBe('tree');
    expect(after.get('appoggiatura')?.displayed.state).not.toBe('tree');
    // A nested `correct` later superseded by an incorrect re-grade is a correction fact.
    const imbrication = after.get('imbrication');
    expect(imbrication?.displayed.state).not.toBe('tree');
    expect(imbrication?.correction?.facts.map((fact) => fact.kind)).toContain('regraded');
  });

  it('an old nested verdict and the same verdict in the new top-level field contribute identically', () => {
    const legacy = fold(afterUpgrade);
    const current = fold(asTopLevelVerdicts(afterUpgrade));
    for (const conceptId of CONCEPTS) {
      expect(outcome(current.get(conceptId))).toEqual(outcome(legacy.get(conceptId)));
    }
  });

  it('dropping the nested verdicts — what a stamp-demanding fold would do — changes the outcome, so the comparison can fail', () => {
    const stripped = afterUpgrade.map((entry) => {
      if (entry.kind !== 'review' || entry.explainBackGrade === undefined) return entry;
      const { correctness: _dropped, ...grade } = entry.explainBackGrade;
      return { ...entry, explainBackGrade: grade };
    });
    expect(fold(stripped).get('cementation')?.displayed.state).not.toBe('tree');
  });
});
