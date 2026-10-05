import { describe, expect, it } from 'vitest';
import { buildResolutionEvidenceEvent } from './events.js';
import { parseMisconceptionLog } from './parse.js';
import { projectMisconceptions } from './project.js';
import {
  type BeliefResolutionDecisionPort,
  type BeliefResolutionDecisionResult,
  decideBeliefResolution,
  decideResolutionEvidence,
  type ExplainBackResolutionCandidate,
  type RecallResolutionCandidate,
  runBeliefResolutionDecision,
  selectBeliefResolutionCandidates,
} from './resolution-evidence-decision.js';
import type {
  BeliefResolutionEvidence,
  BeliefResolutionOption,
  MisconceptionEvent,
  MisconceptionRecord,
} from './types.js';

// Synthetic study material only (INV-3) — invented concept ids throughout.

function explainBack(
  overrides: Partial<ExplainBackResolutionCandidate> = {},
): ExplainBackResolutionCandidate {
  return {
    source: 'explain-back',
    conceptId: 'concept-alpha',
    verdict: 'correct',
    hasOpenMisconceptionOnConcept: true,
    ...overrides,
  };
}

function recall(overrides: Partial<RecallResolutionCandidate> = {}): RecallResolutionCandidate {
  return {
    source: 'recall',
    conceptId: 'concept-alpha',
    instrumentType: 'qa',
    rating: 'good',
    hasOpenMisconceptionOnConcept: true,
    ...overrides,
  };
}

describe('decideResolutionEvidence — M2 (ol-egov.141.89.6.19)', () => {
  describe('explain-back source', () => {
    it('is "explanation" evidence on a correct verdict with an open misconception on the concept', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'correct' }))).toBe('explanation');
    });

    it('is not evidence on a partial verdict', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'partial' }))).toBeNull();
    });

    it('is not evidence on an incorrect verdict', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'incorrect' }))).toBeNull();
    });

    it("is not evidence on unable-to-assess (pass one's not-yet-built outcome, ol-0r92.105)", () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'unable-to-assess' }))).toBeNull();
    });

    it('is not evidence when no open misconception is recorded on the concept, even on a correct verdict', () => {
      expect(
        decideResolutionEvidence(
          explainBack({ verdict: 'correct', hasOpenMisconceptionOnConcept: false }),
        ),
      ).toBeNull();
    });
  });

  describe('recall source (qa/cloze)', () => {
    it('is "recall" evidence on a Good rating with an open misconception on the concept', () => {
      expect(decideResolutionEvidence(recall({ rating: 'good' }))).toBe('recall');
    });

    it('is "recall" evidence on a Hard rating — she still produced the answer herself', () => {
      expect(decideResolutionEvidence(recall({ rating: 'hard' }))).toBe('recall');
    });

    it('is "recall" evidence on an Easy rating', () => {
      expect(decideResolutionEvidence(recall({ rating: 'easy' }))).toBe('recall');
    });

    it('is not evidence on an Again rating', () => {
      expect(decideResolutionEvidence(recall({ rating: 'again' }))).toBeNull();
    });

    it('is not evidence when no open misconception is recorded on the concept, even on a passing rating', () => {
      expect(
        decideResolutionEvidence(recall({ rating: 'good', hasOpenMisconceptionOnConcept: false })),
      ).toBeNull();
    });

    it('fails closed on an unrecognised rating string rather than treating it as a pass', () => {
      // Defensive: this module does not import `Rating` from
      // `olea-contracts` (mirrors confusion-routing.ts's own reasoning) and
      // checks membership in the three known passing literals
      // ('hard'/'good'/'easy') rather than excluding just 'again' — a
      // resolution claim is the higher-harm direction to get wrong (it
      // downgrades a real misconception record), so an unexpected value
      // must never silently read as evidence, unlike confusion-routing.ts's
      // own fail-closed-to-no-offer case where the harmless default is to
      // NOT offer.
      expect(decideResolutionEvidence(recall({ rating: 'not-a-real-rating' }))).toBeNull();
    });
  });

  it('recognition (mcq) is unrepresentable — RecallResolutionCandidate.instrumentType excludes it at the type level', () => {
    // No runtime assertion possible (that is the point): `instrumentType`
    // is typed `'qa' | 'cloze'`, so `{ ...recall(), instrumentType: 'mcq' }`
    // is a compile error, not a value this function has to reject at
    // runtime. See types.ts's `ResolutionEvidenceKind` doc and this file's
    // module doc for why recognition never counts (M2, R7).
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [D-485] parts 1 and 2 (ol-egov.141.89.6.88): the belief-specific step.
// Synthetic ids and invented wording only (INV-3).
// ---------------------------------------------------------------------------

const STAMP = { taskId: 'task-resolve', promptVersion: '0.0.1', modelId: 'model-x' };
const T0 = '2026-08-16T09:00:00-04:00';

function record(overrides: Partial<MisconceptionRecord> = {}): MisconceptionRecord {
  return {
    id: 'm-a',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes the invented quantity always doubles.',
    correction: 'The invented quantity doubles only when the toy condition holds.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    firstSeen: T0,
    lastSeen: T0,
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-alpha:1',
    ...overrides,
  };
}

function decided(option: BeliefResolutionOption): BeliefResolutionDecisionResult {
  return { status: 'decided', option, provenance: STAMP };
}

/** A port answering from a fixed table; a missing id, a rejection or a sync throw are all failures. */
function fakePort(
  table: Readonly<Record<string, BeliefResolutionOption | 'reject' | 'throw' | 'failed'>>,
): BeliefResolutionDecisionPort & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    decide(candidate) {
      asked.push(candidate.id);
      const entry = table[candidate.id];
      if (entry === 'throw') throw new Error('synthetic sync failure');
      if (entry === 'reject') return Promise.reject(new Error('synthetic timeout'));
      if (entry === undefined || entry === 'failed') return Promise.resolve({ status: 'failed' });
      return Promise.resolve(decided(entry));
    },
  };
}

describe('selectBeliefResolutionCandidates — [D-485] part 1', () => {
  it('keeps the open records on the concept, sorted by id', () => {
    const records = [
      record({ id: 'm-b', status: 'fading' }),
      record({ id: 'm-a' }),
      record({ id: 'm-r', status: 'resolved' }),
      record({ id: 'm-other', conceptId: 'concept-beta' }),
    ];
    const ids = selectBeliefResolutionCandidates({
      conceptId: 'concept-alpha',
      records,
      observedByAttempt: [],
    }).map((r) => r.id);
    expect(ids).toEqual(['m-a', 'm-b']);
  });

  it('fresh-candidate ordering: a record the same attempt created or re-observed is never a candidate', () => {
    const records = [record({ id: 'm-a' }), record({ id: 'm-b', status: 'fading' })];
    const ids = selectBeliefResolutionCandidates({
      conceptId: 'concept-alpha',
      records: [...records, record({ id: 'm-new' })],
      observedByAttempt: ['m-new', 'm-b'],
    }).map((r) => r.id);
    expect(ids).toEqual(['m-a']);
  });

  it('a record known only by a multiple-choice pick derived key is never a candidate', () => {
    const derived = record({ id: 'mcq-distractor:["instrument-q","concept-alpha","an option"]' });
    const ids = selectBeliefResolutionCandidates({
      conceptId: 'concept-alpha',
      records: [record({ id: 'm-a' }), derived],
      observedByAttempt: [],
    }).map((r) => r.id);
    expect(ids).toEqual(['m-a']);
  });
});

describe('decideBeliefResolution — [D-485] parts 1 and 2 (pure)', () => {
  it('only demonstrates names a record; silent, unclear and reasserts are recorded but name nothing', () => {
    const result = decideBeliefResolution(
      ['m-a', 'm-b', 'm-c', 'm-d'],
      new Map([
        ['m-a', decided('demonstrates')],
        ['m-b', decided('silent')],
        ['m-c', decided('unclear')],
        ['m-d', decided('reasserts')],
      ]),
    );
    expect(result.targetMisconceptionIds).toEqual(['m-a']);
    expect(result.decisions.map((d) => [d.misconceptionId, d.option])).toEqual([
      ['m-a', 'demonstrates'],
      ['m-b', 'silent'],
      ['m-c', 'unclear'],
      ['m-d', 'reasserts'],
    ]);
  });

  it('a failed, missing or unreadable result is recorded with no option and no stamp, and names nothing', () => {
    const result = decideBeliefResolution(
      ['m-a', 'm-b', 'm-c', 'm-d'],
      new Map<string, BeliefResolutionDecisionResult>([
        ['m-a', { status: 'failed' }],
        // m-b: no result at all
        [
          'm-c',
          { status: 'decided', option: 'maybe' as BeliefResolutionOption, provenance: STAMP },
        ],
        [
          'm-d',
          { status: 'decided', option: 'demonstrates', provenance: { ...STAMP, modelId: '' } },
        ],
      ]),
    );
    expect(result.targetMisconceptionIds).toEqual([]);
    for (const decision of result.decisions) {
      expect(decision.option).toBeNull();
      expect(decision.provenance).toBeNull();
    }
  });

  it('a result for an id that is not a candidate is ignored', () => {
    const result = decideBeliefResolution(
      ['m-a'],
      new Map([
        ['m-a', decided('silent')],
        ['m-new', decided('demonstrates')],
      ]),
    );
    expect(result.targetMisconceptionIds).toEqual([]);
    expect(result.decisions.map((d) => d.misconceptionId)).toEqual(['m-a']);
  });
});

describe('runBeliefResolutionDecision — the injected port', () => {
  it('asks the port once per candidate, and a failure on one never affects another', async () => {
    const port = fakePort({ 'm-a': 'demonstrates', 'm-b': 'reject', 'm-c': 'throw' });
    const result = await runBeliefResolutionDecision(port, [
      record({ id: 'm-a' }),
      record({ id: 'm-b' }),
      record({ id: 'm-c' }),
    ]);
    expect([...port.asked].sort()).toEqual(['m-a', 'm-b', 'm-c']);
    expect(result.targetMisconceptionIds).toEqual(['m-a']);
    expect(result.decisions.map((d) => d.option)).toEqual(['demonstrates', null, null]);
  });

  it('with no candidates the port is never called', async () => {
    const port = fakePort({});
    const result = await runBeliefResolutionDecision(port, []);
    expect(port.asked).toEqual([]);
    expect(result).toEqual({ targetMisconceptionIds: [], decisions: [] });
  });
});

describe('belief-specific resolution end to end: select, decide, build, write, read, fold', () => {
  const CITATION = { path: 'Courses/Sample/notes.md', blockIndex: 1 };
  const STATEMENT = 'Believes the invented quantity always doubles.';
  const CORRECTION = 'The invented quantity doubles only when the toy condition holds.';

  function observedEvent(id: string, eventId: string, timestamp = T0): MisconceptionEvent {
    return {
      schemaVersion: 1,
      kind: 'observed',
      eventId,
      timestamp,
      originInstrumentId: 'explain-back:concept-alpha:1',
      originReviewEventId: null,
      misconceptionId: id,
      conceptId: 'concept-alpha',
      confusedWithConceptId: null,
      statement: `${STATEMENT} (${id})`,
      correction: CORRECTION,
      citation: CITATION,
    };
  }

  /** One correct explanation attempt at `timestamp`, deciding through `port`; returns the log after it. */
  async function attempt(
    log: readonly MisconceptionEvent[],
    port: BeliefResolutionDecisionPort,
    timestamp: string,
    eventId: string,
    observedNow: readonly MisconceptionEvent[] = [],
  ): Promise<{ log: MisconceptionEvent[]; field: BeliefResolutionEvidence }> {
    const candidates = selectBeliefResolutionCandidates({
      conceptId: 'concept-alpha',
      records: projectMisconceptions(log),
      observedByAttempt: observedNow.flatMap((e) =>
        e.kind === 'observed' ? [e.misconceptionId] : [],
      ),
    });
    const field = await runBeliefResolutionDecision(port, candidates);
    const event = buildResolutionEvidenceEvent(
      {
        conceptId: 'concept-alpha',
        evidenceKind: 'explanation',
        originInstrumentId: 'explain-back:concept-alpha:2',
        originReviewEventId: null,
        timestamp,
        beliefResolution: field,
      },
      { generateEventId: () => eventId },
    );
    // Through the log's own text form, as the vault would hold it.
    const text = [...log, ...observedNow, event].map((e) => JSON.stringify(e)).join('\n');
    const parsed = parseMisconceptionLog(`${text}\n`);
    expect(parsed.invalidLines).toEqual([]);
    return { log: [...parsed.events], field };
  }

  const twoOpen = [observedEvent('m-a', 'e-a'), observedEvent('m-b', 'e-b')];
  const statuses = (log: readonly MisconceptionEvent[]) =>
    Object.fromEntries(projectMisconceptions(log).map((r) => [r.id, r.status]));

  it('missed resolution: an answer that corrects both beliefs moves both one step', async () => {
    const port = fakePort({ 'm-a': 'demonstrates', 'm-b': 'demonstrates' });
    const { log, field } = await attempt(twoOpen, port, '2026-08-16T10:00:00-04:00', 'e-ev');
    expect(field.targetMisconceptionIds).toEqual(['m-a', 'm-b']);
    expect(statuses(log)).toEqual({ 'm-a': 'fading', 'm-b': 'fading' });
  });

  it('collateral and premature resolution: two answers on A resolve A and leave B active', async () => {
    const port = fakePort({ 'm-a': 'demonstrates', 'm-b': 'silent' });
    const first = await attempt(twoOpen, port, '2026-08-16T10:00:00-04:00', 'e-ev1');
    expect(statuses(first.log)).toEqual({ 'm-a': 'fading', 'm-b': 'active' });
    const second = await attempt(first.log, port, '2026-08-16T11:00:00-04:00', 'e-ev2');
    expect(statuses(second.log)).toEqual({ 'm-a': 'resolved', 'm-b': 'active' });
  });

  it('silent, unclear and reasserts move nothing, and the decisions are still recorded', async () => {
    const log = [...twoOpen, observedEvent('m-c', 'e-c')];
    const port = fakePort({ 'm-a': 'silent', 'm-b': 'unclear', 'm-c': 'reasserts' });
    const after = await attempt(log, port, '2026-08-16T10:00:00-04:00', 'e-ev');
    expect(after.field.targetMisconceptionIds).toEqual([]);
    expect(after.field.decisions.map((d) => d.option)).toEqual(['silent', 'unclear', 'reasserts']);
    expect(statuses(after.log)).toEqual({ 'm-a': 'active', 'm-b': 'active', 'm-c': 'active' });
  });

  it('a failed or timed-out decision moves nothing; a successful one on the same answer still counts', async () => {
    const port = fakePort({ 'm-a': 'reject', 'm-b': 'demonstrates' });
    const after = await attempt(twoOpen, port, '2026-08-16T10:00:00-04:00', 'e-ev');
    expect(after.field.decisions.map((d) => [d.misconceptionId, d.option])).toEqual([
      ['m-a', null],
      ['m-b', 'demonstrates'],
    ]);
    expect(statuses(after.log)).toEqual({ 'm-a': 'active', 'm-b': 'fading' });
  });

  it('fresh-candidate ordering: records the attempt created or re-observed are never asked about and stay active', async () => {
    const T = '2026-08-16T10:00:00-04:00';
    // m-b was fading before this attempt; the attempt re-observes it and creates m-new.
    const fadedB = await attempt(
      twoOpen,
      fakePort({ 'm-a': 'silent', 'm-b': 'demonstrates' }),
      '2026-08-16T09:30:00-04:00',
      'e-ev0',
    );
    expect(statuses(fadedB.log)).toEqual({ 'm-a': 'active', 'm-b': 'fading' });
    // A port that would say demonstrates for everything.
    const port = fakePort({
      'm-a': 'demonstrates',
      'm-b': 'demonstrates',
      'm-new': 'demonstrates',
    });
    const after = await attempt(fadedB.log, port, T, 'e-ev1', [
      observedEvent('m-b', 'e-reobs', T),
      observedEvent('m-new', 'e-new', T),
    ]);
    expect(port.asked).toEqual(['m-a']);
    expect(after.field.targetMisconceptionIds).toEqual(['m-a']);
    expect(statuses(after.log)).toEqual({ 'm-a': 'fading', 'm-b': 'active', 'm-new': 'active' });
  });

  it('the written event carries no belief wording, correction or answer text (D-005)', async () => {
    const port = fakePort({ 'm-a': 'demonstrates', 'm-b': 'silent' });
    const { log } = await attempt(twoOpen, port, '2026-08-16T10:00:00-04:00', 'e-ev');
    const evidence = log.find((e) => e.kind === 'resolution-evidence');
    const text = JSON.stringify(evidence);
    expect(text).toContain('beliefResolution');
    expect(text).not.toContain('invented quantity');
    expect(text).not.toContain('toy condition');
  });
});
