// `ol-egov.141.89.5.26` ([D-414], `ol-egov.141.89.48`): the demand-grain gap as data, and the
// re-ask on arrival. Every string is invented (INV-3); no test calls a model.
//
// What is pinned here, in the order the ruling and the two 2026-09-29 rulings put it:
//  - the row exists only for a KNOWN asked demand whose last verdict is not sufficient, and a
//    verdict at another demand says nothing about this one (G3);
//  - the three different reasons a case can be unresolved stay three values, and neither scope
//    uncertainty nor a taxonomy limit can ever read as insufficient material;
//  - the fold: only a sufficient verdict at the asked demand removes the row; a re-check that
//    cannot run keeps its own reason and the record exactly as it was;
//  - the evidence gate's outcomes (client c4cb3e4): only judge-rejected is an insufficiency;
//    threshold-blocked is not assessed, retrieval failure and outage each stay themselves;
//  - the orchestrator: which records an arrival re-asks, and that it never throws.

import { describe, expect, it } from 'vitest';
import type { PaperDemand } from '../oracle/paper-types.js';
import type { GroundingResult } from '../retrieval/groundedContext.js';
import {
  type AskedDemand,
  type DemandGapReading,
  fingerprintJudgedEvidence,
  foldSufficiencyAnswer,
  holdsOpenVerdict,
  RECHECK_NOT_RUN_REASONS,
  type ReaskOnArrivalDeps,
  readDemandGap,
  reaskOnArrival,
  type SufficiencyAnswer,
  type SufficiencyRecord,
  sufficiencyAnswerFromGrounding,
} from './demand-gap.js';

const KNOWN = (demand: PaperDemand): AskedDemand => ({ kind: 'known', demand });

function record(overrides: Partial<SufficiencyRecord> = {}): SufficiencyRecord {
  return {
    conceptKey: 'concept-a',
    demand: 'calculate',
    verdict: 'partial',
    evidenceFingerprint: 'fp-1',
    ...overrides,
  };
}

describe('readDemandGap: the row exists only for a known asked demand whose last verdict is not sufficient', () => {
  it.each(['partial', 'insufficient', 'conflicting'] as const)(
    'a %s verdict at the asked demand is a material-gap reading carrying the verdict and fingerprint',
    (verdict) => {
      expect(readDemandGap({ asked: KNOWN('calculate'), record: record({ verdict }) })).toEqual({
        kind: 'material-gap',
        demand: 'calculate',
        verdict,
        evidenceFingerprint: 'fp-1',
      });
    },
  );

  it('a sufficient verdict at the asked demand carries no row: the row goes', () => {
    expect(
      readDemandGap({ asked: KNOWN('calculate'), record: record({ verdict: 'sufficient' }) }),
    ).toBeUndefined();
  });

  it('no cached verdict, no row: the question was never asked at this demand', () => {
    expect(readDemandGap({ asked: KNOWN('calculate') })).toBeUndefined();
  });

  it('a verdict cached at another demand says nothing about this one, either way (G3)', () => {
    // An insufficient verdict at recall does not put a row on a calculate demand...
    expect(
      readDemandGap({
        asked: KNOWN('calculate'),
        record: record({ demand: 'recall-a-fact', verdict: 'insufficient' }),
      }),
    ).toBeUndefined();
    // ...and a sufficient verdict at recall never removes one, because it never read this demand.
    expect(
      readDemandGap({
        asked: KNOWN('calculate'),
        record: record({ demand: 'recall-a-fact', verdict: 'sufficient' }),
      }),
    ).toBeUndefined();
  });

  it('the reading carries the last re-check that could not run, kept apart from the verdict', () => {
    const reading = readDemandGap({
      asked: KNOWN('calculate'),
      record: record({ verdict: 'insufficient' }),
      recheck: { reason: 'threshold-blocked' },
    });
    expect(reading).toEqual({
      kind: 'material-gap',
      demand: 'calculate',
      verdict: 'insufficient',
      evidenceFingerprint: 'fp-1',
      recheck: { reason: 'threshold-blocked' },
    });
  });

  it('a recheck note is never attached to a reading that has no row', () => {
    expect(
      readDemandGap({
        asked: KNOWN('calculate'),
        record: record({ verdict: 'sufficient' }),
        recheck: { reason: 'check-unavailable' },
      }),
    ).toBeUndefined();
  });
});

describe('the three different reasons a case is unresolved stay separate (2026-09-29, cross-cutting)', () => {
  const cached = record({ verdict: 'insufficient' });

  it('an unknown assessment scope reads as its own cause, never as insufficient material, even beside a cached insufficient verdict', () => {
    const reading = readDemandGap({ asked: { kind: 'scope-unknown' }, record: cached });
    expect(reading).toEqual({ kind: 'unresolved', cause: 'assessment-scope-unknown' });
  });

  it('an attested operation the taxonomy does not support reads as its own cause, never as insufficient material', () => {
    const reading = readDemandGap({ asked: { kind: 'operation-unsupported' }, record: cached });
    expect(reading).toEqual({ kind: 'unresolved', cause: 'operation-unsupported' });
  });

  it('insufficient material for a known operation is the only case that reads as a material gap', () => {
    const readings: DemandGapReading[] = [
      readDemandGap({ asked: { kind: 'scope-unknown' }, record: cached }),
      readDemandGap({ asked: { kind: 'operation-unsupported' }, record: cached }),
      readDemandGap({ asked: KNOWN('calculate'), record: cached }),
    ].filter((reading): reading is DemandGapReading => reading !== undefined);
    expect(readings.map((reading) => reading.kind)).toEqual([
      'unresolved',
      'unresolved',
      'material-gap',
    ]);
    // Three asked states, three distinct readings: no two collapse into one.
    expect(new Set(readings.map((reading) => JSON.stringify(reading))).size).toBe(3);
  });

  it('an unresolved reading carries no verdict, no fingerprint and no demand: nothing it could be worded from', () => {
    const scope = readDemandGap({ asked: { kind: 'scope-unknown' }, record: cached });
    const operation = readDemandGap({ asked: { kind: 'operation-unsupported' }, record: cached });
    for (const reading of [scope, operation]) {
      expect(Object.keys(reading ?? {}).sort()).toEqual(['cause', 'kind']);
    }
  });
});

describe('holdsOpenVerdict: the records an arrival may re-ask', () => {
  it.each([
    ['partial', true],
    ['insufficient', true],
    ['conflicting', true],
    ['sufficient', false],
  ] as const)('%s -> %s', (verdict, expected) => {
    expect(holdsOpenVerdict(record({ verdict }))).toBe(expected);
  });
});

describe('foldSufficiencyAnswer: only a sufficient verdict at the asked demand removes the row', () => {
  const held = record({ verdict: 'insufficient', evidenceFingerprint: 'fp-1' });

  it('a sufficient verdict clears the row and records its own fingerprint', () => {
    const folded = foldSufficiencyAnswer(held, {
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: 'fp-2',
    });
    expect(folded.outcome).toEqual({ outcome: 'cleared' });
    expect(folded.record).toEqual({ ...held, verdict: 'sufficient', evidenceFingerprint: 'fp-2' });
    expect(holdsOpenVerdict(folded.record)).toBe(false);
  });

  it.each(['partial', 'insufficient', 'conflicting'] as const)(
    'a %s verdict keeps the row with its verdict and fingerprint updated',
    (verdict) => {
      const folded = foldSufficiencyAnswer(held, {
        kind: 'verdict',
        verdict,
        evidenceFingerprint: 'fp-2',
      });
      expect(folded.outcome).toEqual({ outcome: 'stays', verdict });
      expect(folded.record).toEqual({ ...held, verdict, evidenceFingerprint: 'fp-2' });
      expect(holdsOpenVerdict(folded.record)).toBe(true);
    },
  );

  it('the same verdict over the same fingerprint changes nothing and hands back the same record', () => {
    const folded = foldSufficiencyAnswer(held, {
      kind: 'verdict',
      verdict: 'insufficient',
      evidenceFingerprint: 'fp-1',
    });
    expect(folded.outcome).toEqual({ outcome: 'stays', verdict: 'insufficient' });
    expect(folded.record).toBe(held);
  });

  it('unchanged evidence asks nothing and leaves the record exactly as it was', () => {
    const folded = foldSufficiencyAnswer(held, { kind: 'evidence-unchanged' });
    expect(folded.outcome).toEqual({ outcome: 'evidence-unchanged' });
    expect(folded.record).toBe(held);
  });

  it.each(RECHECK_NOT_RUN_REASONS)(
    'a re-check that could not run (%s) keeps its own reason and the record exactly as it was, never sufficient',
    (reason) => {
      for (const verdict of ['partial', 'insufficient', 'conflicting'] as const) {
        const before = record({ verdict });
        const folded = foldSufficiencyAnswer(before, { kind: 'not-run', reason });
        expect(folded.outcome).toEqual({ outcome: 'not-run', reason });
        expect(folded.record).toBe(before);
        expect(folded.record.verdict).toBe(verdict);
        expect(holdsOpenVerdict(folded.record)).toBe(true);
      }
    },
  );

  it('never leaves a sufficient record standing on any answer but a sufficient verdict', () => {
    const answers: SufficiencyAnswer[] = [
      { kind: 'evidence-unchanged' },
      ...RECHECK_NOT_RUN_REASONS.map((reason) => ({ kind: 'not-run', reason }) as const),
      { kind: 'verdict', verdict: 'partial', evidenceFingerprint: 'x' },
      { kind: 'verdict', verdict: 'insufficient', evidenceFingerprint: 'x' },
      { kind: 'verdict', verdict: 'conflicting', evidenceFingerprint: 'x' },
    ];
    for (const answer of answers) {
      expect(foldSufficiencyAnswer(held, answer).record.verdict).not.toBe('sufficient');
    }
  });

  it('the not-run reasons are the five the evidence gate and the wire can produce, each its own word', () => {
    expect([...RECHECK_NOT_RUN_REASONS].sort()).toEqual([
      'check-unavailable',
      'could-not-decide',
      'demand-not-askable',
      'retrieval-failed',
      'threshold-blocked',
    ]);
  });
});

describe("sufficiencyAnswerFromGrounding: the evidence gate's outcomes (D-441, D-442) keep their own meanings", () => {
  const grounded: GroundingResult = {
    status: 'grounded',
    chunks: [{ path: 'a.md', blockIndex: 0, text: 'passage' } as never],
  };
  const refused = (reason: string): GroundingResult =>
    ({ status: 'refused', reason }) as unknown as GroundingResult;

  it('grounded is a sufficient verdict carrying the fingerprint of the evidence the judge read', () => {
    expect(sufficiencyAnswerFromGrounding(grounded, 'fp-9')).toEqual({
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: 'fp-9',
    });
  });

  it('judge-rejected is the ONLY insufficiency: the judge read the passages and found them not enough', () => {
    expect(sufficiencyAnswerFromGrounding(refused('judge-rejected'), 'fp-9')).toEqual({
      kind: 'verdict',
      verdict: 'insufficient',
      evidenceFingerprint: 'fp-9',
    });
  });

  it('a judge-rejected answer with no fingerprint cannot be recorded as a verdict: it is a check that could not be completed', () => {
    expect(sufficiencyAnswerFromGrounding(refused('judge-rejected'), undefined)).toEqual({
      kind: 'not-run',
      reason: 'check-unavailable',
    });
    expect(sufficiencyAnswerFromGrounding(grounded, undefined)).toEqual({
      kind: 'not-run',
      reason: 'check-unavailable',
    });
  });

  it.each(['below-composite-threshold', 'below-band'] as const)(
    '%s is threshold-blocked and not assessed, never an insufficiency',
    (reason) => {
      expect(sufficiencyAnswerFromGrounding(refused(reason), 'fp-9')).toEqual({
        kind: 'not-run',
        reason: 'threshold-blocked',
      });
    },
  );

  it.each(['no-hits', 'below-relevance-threshold'] as const)(
    '%s is a retrieval failure, never an insufficiency',
    (reason) => {
      expect(sufficiencyAnswerFromGrounding(refused(reason), undefined)).toEqual({
        kind: 'not-run',
        reason: 'retrieval-failed',
      });
    },
  );

  it.each(['composite-check-unavailable', 'judge-unavailable'] as const)(
    '%s is an outage: the check could not run',
    (reason) => {
      expect(sufficiencyAnswerFromGrounding(refused(reason), undefined)).toEqual({
        kind: 'not-run',
        reason: 'check-unavailable',
      });
    },
  );

  it('no refusal but judge-rejected can ever fold into an insufficient record', () => {
    const reasons = [
      'no-hits',
      'below-relevance-threshold',
      'below-composite-threshold',
      'composite-check-unavailable',
      'below-band',
      'judge-unavailable',
    ];
    for (const reason of reasons) {
      const answer = sufficiencyAnswerFromGrounding(refused(reason), 'fp-9');
      expect(answer.kind).toBe('not-run');
      const folded = foldSufficiencyAnswer(record({ verdict: 'partial' }), answer);
      expect(folded.record.verdict).toBe('partial');
    }
  });
});

describe('fingerprintJudgedEvidence', () => {
  // A deterministic stand-in for the platform hash: identity is what matters, not the digest.
  const hash = async (text: string) => `h(${text.length}:${text})`;

  it('is the same for the same refs and the same text, and moves when either moves', async () => {
    const base = {
      refs: [
        { path: 'a.md', blockIndex: 1 },
        { path: 'b.md', blockIndex: 0 },
      ],
      context: 'one\n\ntwo',
    };
    const same = await fingerprintJudgedEvidence(base, hash);
    expect(await fingerprintJudgedEvidence({ ...base }, hash)).toBe(same);
    expect(await fingerprintJudgedEvidence({ ...base, context: 'one\n\ntwo!' }, hash)).not.toBe(
      same,
    );
    expect(
      await fingerprintJudgedEvidence({ ...base, refs: [...base.refs].reverse() }, hash),
    ).not.toBe(same);
    expect(
      await fingerprintJudgedEvidence({ ...base, refs: [{ path: 'a.md', blockIndex: 2 }] }, hash),
    ).not.toBe(same);
  });

  it('carries neither a path nor any of her text in the value it returns', async () => {
    const value = await fingerprintJudgedEvidence(
      { refs: [{ path: 'notes/secret-name.md', blockIndex: 0 }], context: 'a private sentence' },
      async () => 'digest-only',
    );
    expect(value).toBe('digest-only');
  });
});

describe('reaskOnArrival: an arrival re-asks the concepts it bears on that hold an open verdict', () => {
  interface Harness {
    readonly deps: ReaskOnArrivalDeps;
    readonly saved: SufficiencyRecord[];
    readonly asked: { conceptKey: string; demand: PaperDemand; previousFingerprint: string }[];
  }

  function harness(
    records: readonly SufficiencyRecord[],
    answer: (
      request: Parameters<ReaskOnArrivalDeps['ask']>[0],
    ) => Promise<SufficiencyAnswer> | SufficiencyAnswer,
    overrides: Partial<ReaskOnArrivalDeps> = {},
  ): Harness {
    const saved: SufficiencyRecord[] = [];
    const asked: Harness['asked'] = [];
    const courseOf: Record<string, string> = {
      'concept-a': 'CRS-A',
      'concept-b': 'CRS-A',
      'concept-c': 'CRS-B',
    };
    const deps: ReaskOnArrivalDeps = {
      listRecords: async () => records,
      saveRecord: async (next) => {
        saved.push(next);
      },
      resolveConcept: (conceptKey) =>
        courseOf[conceptKey] === undefined
          ? undefined
          : { conceptKey, conceptName: `name of ${conceptKey}`, course: courseOf[conceptKey] },
      ask: async (request) => {
        asked.push({
          conceptKey: request.concept.conceptKey,
          demand: request.demand,
          previousFingerprint: request.previousFingerprint,
        });
        return answer(request);
      },
      ...overrides,
    };
    return { deps, saved, asked };
  }

  const ARRIVAL = { courses: ['CRS-A'] as const };

  it('re-asks a concept holding a partial verdict in the arriving course, at the demand that was asked, and saves the new verdict', async () => {
    const held = record({ conceptKey: 'concept-a', demand: 'calculate', verdict: 'partial' });
    const h = harness([held], () => ({
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: 'fp-2',
    }));
    const reports = await reaskOnArrival(h.deps, ARRIVAL);
    expect(h.asked).toEqual([
      { conceptKey: 'concept-a', demand: 'calculate', previousFingerprint: 'fp-1' },
    ]);
    expect(h.saved).toEqual([{ ...held, verdict: 'sufficient', evidenceFingerprint: 'fp-2' }]);
    expect(reports).toEqual([{ conceptKey: 'concept-a', demand: 'calculate', outcome: 'cleared' }]);
  });

  it('re-asks a concept holding an insufficient verdict too, and keeps the row when the answer is still not sufficient', async () => {
    const held = record({ verdict: 'insufficient' });
    const h = harness([held], () => ({
      kind: 'verdict',
      verdict: 'partial',
      evidenceFingerprint: 'fp-2',
    }));
    const reports = await reaskOnArrival(h.deps, ARRIVAL);
    expect(h.saved).toEqual([{ ...held, verdict: 'partial', evidenceFingerprint: 'fp-2' }]);
    expect(reports[0]?.outcome).toBe('stays');
  });

  it('never re-asks a concept whose last verdict is sufficient', async () => {
    const h = harness([record({ verdict: 'sufficient' })], () => {
      throw new Error('must not be asked');
    });
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([]);
    expect(h.asked).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it('never re-asks a concept in a course the arrival does not belong to', async () => {
    const h = harness([record({ conceptKey: 'concept-c', verdict: 'partial' })], () => {
      throw new Error('must not be asked');
    });
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([]);
    expect(h.asked).toEqual([]);
  });

  it('re-asks each open record of the arriving course once, in the order listed, one at a time', async () => {
    const order: string[] = [];
    let live = 0;
    let peak = 0;
    const h = harness(
      [
        record({ conceptKey: 'concept-a', demand: 'calculate' }),
        record({ conceptKey: 'concept-b', demand: 'recall-a-fact', verdict: 'insufficient' }),
        record({ conceptKey: 'concept-c', demand: 'calculate' }),
      ],
      async (request) => {
        live += 1;
        peak = Math.max(peak, live);
        order.push(request.concept.conceptKey);
        await Promise.resolve();
        live -= 1;
        return { kind: 'evidence-unchanged' };
      },
    );
    await reaskOnArrival(h.deps, ARRIVAL);
    expect(order).toEqual(['concept-a', 'concept-b']);
    expect(peak).toBe(1);
  });

  it('writes nothing when the evidence did not change or the re-check could not run', async () => {
    for (const answer of [
      { kind: 'evidence-unchanged' },
      { kind: 'not-run', reason: 'threshold-blocked' },
      { kind: 'not-run', reason: 'check-unavailable' },
    ] as const) {
      const h = harness([record({ verdict: 'insufficient' })], () => answer);
      const reports = await reaskOnArrival(h.deps, ARRIVAL);
      expect(h.saved).toEqual([]);
      expect(reports).toHaveLength(1);
      expect(reports[0]?.outcome).toBe(
        answer.kind === 'not-run' ? 'not-run' : 'evidence-unchanged',
      );
    }
  });

  it('a not-run report names its own reason, so a caller can show the row with it', async () => {
    const h = harness([record()], () => ({ kind: 'not-run', reason: 'retrieval-failed' }));
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([
      {
        conceptKey: 'concept-a',
        demand: 'calculate',
        outcome: 'not-run',
        reason: 'retrieval-failed',
      },
    ]);
  });

  it('an ask that throws is an outage for that record only: the others are still asked, and nothing flips to sufficient', async () => {
    const h = harness(
      [
        record({ conceptKey: 'concept-a', demand: 'calculate' }),
        record({ conceptKey: 'concept-b', demand: 'calculate' }),
      ],
      (request) => {
        if (request.concept.conceptKey === 'concept-a') throw new Error('transport down');
        return { kind: 'verdict', verdict: 'sufficient', evidenceFingerprint: 'fp-2' };
      },
    );
    const reports = await reaskOnArrival(h.deps, ARRIVAL);
    expect(reports).toEqual([
      {
        conceptKey: 'concept-a',
        demand: 'calculate',
        outcome: 'not-run',
        reason: 'check-unavailable',
      },
      { conceptKey: 'concept-b', demand: 'calculate', outcome: 'cleared' },
    ]);
    expect(h.saved.map((saved) => saved.conceptKey)).toEqual(['concept-b']);
  });

  it('a save that fails leaves the row as it was and says so, and never claims the row was cleared', async () => {
    const h = harness(
      [record()],
      () => ({ kind: 'verdict', verdict: 'sufficient', evidenceFingerprint: 'fp-2' }),
      {
        saveRecord: async () => {
          throw new Error('disk full');
        },
      },
    );
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([
      { conceptKey: 'concept-a', demand: 'calculate', outcome: 'save-failed' },
    ]);
  });

  it('a concept that no longer resolves is skipped and named, never asked', async () => {
    const h = harness([record({ conceptKey: 'gone' })], () => {
      throw new Error('must not be asked');
    });
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([
      { conceptKey: 'gone', demand: 'calculate', outcome: 'concept-unresolved' },
    ]);
  });

  it('a record store that cannot be listed is no re-check at all, and never throws', async () => {
    const h = harness(
      [],
      () => {
        throw new Error('must not be asked');
      },
      {
        listRecords: async () => {
          throw new Error('unreadable');
        },
      },
    );
    expect(await reaskOnArrival(h.deps, ARRIVAL)).toEqual([]);
  });

  it('an arrival with no course re-asks nothing', async () => {
    const h = harness([record()], () => {
      throw new Error('must not be asked');
    });
    expect(await reaskOnArrival(h.deps, { courses: [] })).toEqual([]);
  });
});
