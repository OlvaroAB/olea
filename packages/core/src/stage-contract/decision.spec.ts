/**
 * The Decision stage contract (`ol-egov.141.89.20`): the three outcome
 * kinds, the step's own words, the candidate/fallback cascade behind one
 * `DecisionSeat`, and the envelope check a consumer runs at a boundary.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import {
  cascadeDecisionSeats,
  type DecisionOutcome,
  type DecisionSeat,
  type DecisionVocabulary,
  decisionEnvelopeProblems,
  decisionWord,
  isDecisionVerdict,
} from './decision.js';
import type { StageProvenance, StageSeat } from './provenance.js';

type Word = 'yes' | 'no';

const VOCABULARY: DecisionVocabulary<Word> = {
  verdicts: ['yes', 'no'],
  undecided: 'cannot-tell',
};

function provenance(seat: StageSeat): StageProvenance {
  return {
    producer: {
      kind: 'model',
      seat,
      taskId: 'example.decide.v1',
      stamp: { promptVersion: `${seat}-prompt-1`, modelId: `${seat}-model` },
    },
    evidenceDigests: ['digest-a'],
  };
}

function verdict(seat: StageSeat, word: Word, confidence?: number): DecisionOutcome<Word> {
  return {
    kind: 'verdict',
    verdict: word,
    payload: null,
    ...(confidence !== undefined ? { confidence } : {}),
    provenance: provenance(seat),
  };
}

function seatReturning(outcome: DecisionOutcome<Word>): DecisionSeat<string, Word> & {
  calls: number;
} {
  const seat = {
    calls: 0,
    async decide(_request: string) {
      seat.calls++;
      return outcome;
    },
  };
  return seat;
}

describe('decisionWord: the step keeps its own words', () => {
  it('reads a verdict as itself', () => {
    expect(decisionWord(VOCABULARY, verdict('candidate', 'yes'))).toBe('yes');
  });

  it("reads undecided as the step's own undecided word, and unavailable as the envelope's when the step has none", () => {
    const undecided: DecisionOutcome<Word> = {
      kind: 'undecided',
      basis: 'abstained',
      provenance: provenance('candidate'),
    };
    const unavailable: DecisionOutcome<Word> = {
      kind: 'unavailable',
      cause: 'offline',
      provenance: provenance('candidate'),
    };
    expect(decisionWord(VOCABULARY, undecided)).toBe('cannot-tell');
    expect(decisionWord(VOCABULARY, unavailable)).toBe('unavailable');
    expect(decisionWord({ verdicts: ['yes', 'no'] }, undecided)).toBe('undecided');
  });

  it('keeps cannot-tell apart from unavailable: two kinds, two words', () => {
    const undecided: DecisionOutcome<Word> = {
      kind: 'undecided',
      basis: 'abstained',
      provenance: provenance('candidate'),
    };
    const unavailable: DecisionOutcome<Word> = {
      kind: 'unavailable',
      cause: 'call-failed',
      provenance: provenance('candidate'),
    };
    expect(undecided.kind).not.toBe(unavailable.kind);
    expect(decisionWord(VOCABULARY, undecided)).not.toBe(decisionWord(VOCABULARY, unavailable));
    expect(isDecisionVerdict(undecided)).toBe(false);
    expect(isDecisionVerdict(unavailable)).toBe(false);
  });
});

describe('cascadeDecisionSeats: candidate and fallback behind one interface', () => {
  it('returns a candidate verdict unchanged when no bar is set, never calling the fallback', async () => {
    const candidate = seatReturning(verdict('candidate', 'yes'));
    const fallback = seatReturning(verdict('fallback', 'no'));
    const seat = cascadeDecisionSeats({ taskId: 'example.decide.v1', candidate, fallback });
    expect(await seat.decide('q')).toEqual(verdict('candidate', 'yes'));
    expect(fallback.calls).toBe(0);
  });

  it('keeps a candidate verdict at or above the bar', async () => {
    const candidate = seatReturning(verdict('candidate', 'yes', 0.9));
    const fallback = seatReturning(verdict('fallback', 'no'));
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate,
      fallback,
      confidenceBar: 0.9,
    });
    expect(await seat.decide('q')).toEqual(verdict('candidate', 'yes', 0.9));
    expect(fallback.calls).toBe(0);
  });

  it('hands a below-bar verdict to the fallback and records why', async () => {
    const candidate = seatReturning(verdict('candidate', 'yes', 0.89));
    const fallback = seatReturning(verdict('fallback', 'no'));
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate,
      fallback,
      confidenceBar: 0.9,
    });
    const outcome = await seat.decide('q');
    expect(outcome.kind).toBe('verdict');
    expect(isDecisionVerdict(outcome) && outcome.verdict).toBe('no');
    expect(outcome.provenance.producer).toEqual(provenance('fallback').producer);
    expect(outcome.provenance.escalation).toEqual({
      from: provenance('candidate').producer,
      because: 'below-confidence-bar',
    });
  });

  it('hands a verdict with no confidence to the fallback when a bar is set', async () => {
    const candidate = seatReturning(verdict('candidate', 'yes'));
    const fallback = seatReturning(verdict('fallback', 'yes'));
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate,
      fallback,
      confidenceBar: 0.5,
    });
    const outcome = await seat.decide('q');
    expect(fallback.calls).toBe(1);
    expect(outcome.provenance.escalation?.because).toBe('below-confidence-bar');
  });

  it('hands an undecided candidate to the fallback', async () => {
    const candidate = seatReturning({
      kind: 'undecided',
      basis: 'abstained',
      provenance: provenance('candidate'),
    });
    const fallback = seatReturning(verdict('fallback', 'yes'));
    const seat = cascadeDecisionSeats({ taskId: 'example.decide.v1', candidate, fallback });
    const outcome = await seat.decide('q');
    expect(isDecisionVerdict(outcome) && outcome.verdict).toBe('yes');
    expect(outcome.provenance.escalation?.because).toBe('undecided');
  });

  it('does not hand an unavailable candidate on unless the step opts in', async () => {
    const unavailable: DecisionOutcome<Word> = {
      kind: 'unavailable',
      cause: 'timeout',
      provenance: provenance('candidate'),
    };
    const fallback = seatReturning(verdict('fallback', 'yes'));
    const plain = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: seatReturning(unavailable),
      fallback,
    });
    expect(await plain.decide('q')).toEqual(unavailable);
    expect(fallback.calls).toBe(0);

    const optedIn = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: seatReturning(unavailable),
      fallback,
      escalateUnavailable: true,
    });
    const outcome = await optedIn.decide('q');
    expect(fallback.calls).toBe(1);
    expect(outcome.provenance.escalation?.because).toBe('unavailable');
  });

  it('returns the fallback outcome as the answer even when the fallback itself fails', async () => {
    const candidate = seatReturning({
      kind: 'undecided',
      basis: 'abstained',
      provenance: provenance('candidate'),
    });
    const fallback = seatReturning({
      kind: 'unavailable',
      cause: 'offline',
      provenance: provenance('fallback'),
    });
    const seat = cascadeDecisionSeats({ taskId: 'example.decide.v1', candidate, fallback });
    const outcome = await seat.decide('q');
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.provenance.escalation?.because).toBe('undecided');
  });

  it('with no fallback, turns a below-bar verdict into undecided, keeping its confidence and provenance', async () => {
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: seatReturning(verdict('candidate', 'yes', 0.4)),
      fallback: null,
      confidenceBar: 0.9,
    });
    expect(await seat.decide('q')).toEqual({
      kind: 'undecided',
      basis: 'below-confidence-bar',
      confidence: 0.4,
      provenance: provenance('candidate'),
    });
  });

  it('with no fallback, returns an undecided candidate as it came', async () => {
    const undecided: DecisionOutcome<Word> = {
      kind: 'undecided',
      basis: 'abstained',
      provenance: provenance('candidate'),
    };
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: seatReturning(undecided),
      fallback: null,
    });
    expect(await seat.decide('q')).toEqual(undecided);
  });

  it('turns a throwing seat into unavailable rather than an uncaught error', async () => {
    const throwing: DecisionSeat<string, Word> = {
      decide: async () => {
        throw new Error('boom');
      },
    };
    const seat = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: throwing,
      fallback: null,
    });
    const outcome = await seat.decide('q');
    expect(outcome).toEqual({
      kind: 'unavailable',
      cause: 'call-failed',
      provenance: {
        producer: { kind: 'model', seat: 'candidate', taskId: 'example.decide.v1', stamp: null },
        evidenceDigests: [],
      },
    });
  });

  it('is itself a DecisionSeat: a caller holds the same interface with or without a fallback', async () => {
    const single: DecisionSeat<string, Word> = seatReturning(verdict('candidate', 'no'));
    const cascaded: DecisionSeat<string, Word> = cascadeDecisionSeats({
      taskId: 'example.decide.v1',
      candidate: seatReturning(verdict('candidate', 'no')),
      fallback: seatReturning(verdict('fallback', 'yes')),
    });
    for (const seat of [single, cascaded]) {
      const outcome = await seat.decide('q');
      expect(decisionEnvelopeProblems(outcome, VOCABULARY)).toEqual([]);
    }
  });
});

describe('decisionEnvelopeProblems: the contract test at a boundary', () => {
  it('accepts every well-formed outcome, including after a JSON round trip', () => {
    const outcomes: DecisionOutcome<Word>[] = [
      verdict('candidate', 'yes', 0.7),
      { kind: 'undecided', basis: 'nothing-to-decide-from', provenance: provenance('candidate') },
      {
        kind: 'unavailable',
        cause: 'service-refused',
        serviceCode: 'upstream-error',
        provenance: provenance('candidate'),
      },
      {
        ...verdict('fallback', 'no'),
        provenance: {
          ...provenance('fallback'),
          escalation: { from: provenance('candidate').producer, because: 'undecided' },
        },
      },
    ];
    for (const outcome of outcomes) {
      expect(decisionEnvelopeProblems(outcome, VOCABULARY)).toEqual([]);
      expect(decisionEnvelopeProblems(JSON.parse(JSON.stringify(outcome)), VOCABULARY)).toEqual([]);
    }
  });

  it('rejects a verdict outside the closed set: an undecided word is not a verdict', () => {
    expect(
      decisionEnvelopeProblems(
        { ...verdict('candidate', 'yes'), verdict: 'cannot-tell' },
        VOCABULARY,
      ),
    ).toContain('outcome.verdict is not one of the step verdicts');
  });

  it('rejects an unknown kind, basis or cause, and a confidence outside [0, 1]', () => {
    expect(decisionEnvelopeProblems({ kind: 'maybe' }, VOCABULARY)).toEqual([
      'outcome.kind is not verdict, undecided or unavailable',
    ]);
    expect(
      decisionEnvelopeProblems(
        { kind: 'undecided', basis: 'shrug', provenance: provenance('candidate') },
        VOCABULARY,
      ),
    ).toContain('outcome.basis is not a known undecided basis');
    expect(
      decisionEnvelopeProblems(
        { kind: 'unavailable', cause: 'gremlins', provenance: provenance('candidate') },
        VOCABULARY,
      ),
    ).toContain('outcome.cause is not a known unavailable cause');
    expect(
      decisionEnvelopeProblems({ ...verdict('candidate', 'yes'), confidence: 1.5 }, VOCABULARY),
    ).toContain('outcome.confidence is present but not a number in [0, 1]');
  });

  it('rejects a service code on a cause other than service-refused', () => {
    expect(
      decisionEnvelopeProblems(
        {
          kind: 'unavailable',
          cause: 'offline',
          serviceCode: 'upstream-error',
          provenance: provenance('candidate'),
        },
        VOCABULARY,
      ),
    ).toContain('outcome.serviceCode is present but the cause is not service-refused');
  });

  it('rejects a missing provenance or payload', () => {
    const { provenance: _dropped, ...noProvenance } = verdict('candidate', 'yes');
    expect(decisionEnvelopeProblems(noProvenance, VOCABULARY)).toContain(
      'outcome.provenance is not an object',
    );
    const { payload: _payload, ...noPayload } = verdict('candidate', 'yes') as unknown as {
      payload: null;
    } & Record<string, unknown>;
    expect(decisionEnvelopeProblems(noPayload, VOCABULARY)).toContain('outcome.payload is missing');
  });
});
