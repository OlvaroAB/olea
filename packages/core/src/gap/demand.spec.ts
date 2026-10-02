// `ol-egov.141.89.9.4`: when a declared demand counts as met now — `[D-349]`,
// OPEN (the attainment chain spec's proposal 5 in `olea-service`; failure
// classes N4 and N5). Built as a pure function over demands passed in, with
// the rule a REQUIRED argument so no reader adopts an unruled rule by default.
// Ids are structural placeholders, never fixture vocabulary (INV-3).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewLogEntry, ReviewLogRecord, VerdictLogRecord } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type InstrumentDemandReading,
  projectInstrumentDemands,
  readInstrumentDemand,
} from '../instrument/demand-reading.js';
import {
  instrumentTargetStorePath,
  type QuestionBindingBlock,
  questionBindingOf,
  writeInstrumentTarget,
} from '../instrument/target-store.js';
import { readAllConceptReadiness, readNeed } from '../mastery/attainment.js';
import { computeAllConceptMastery } from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import type { PaperDemand } from '../oracle/paper-types.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import { replaySchedulerStates } from '../session/replay.js';
import { FolderSource } from '../vault/folder-source.js';
import { type DemandRule, demandsMetNow, unmetDemandsByConcept } from './demand.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-03-01T09:00:00-04:00';
const SOON = new Date(Date.parse(T1) + DAY);
const MUCH_LATER = new Date(Date.parse(T1) + 200 * DAY);
const scheduler = createFsrsScheduler();

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r1',
    timestamp: T1,
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
    supportLevelShown: 'independent',
    ...overrides,
  };
}

function rejected(instrumentId: string): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId: `v-${instrumentId}`,
    timestamp: T1,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

function met(
  rule: DemandRule,
  entries: readonly ReviewLogEntry[],
  declared: readonly PaperDemand[],
  instrumentDemands: ReadonlyMap<string, readonly PaperDemand[]>,
  now: Date = SOON,
) {
  return demandsMetNow(
    {
      conceptId: 'concept-a',
      declaredDemands: declared,
      instrumentDemands,
      entries,
      validity: projectInstrumentValidity(entries),
      scheduler,
      now,
    },
    rule,
  );
}

const RECALL_FACT = new Map<string, readonly PaperDemand[]>([['qa:a:1', ['recall-a-fact']]]);

describe('(a) qualifying-review: the proposed conservative rule', () => {
  it('an independent, current, standing recall success from an instrument declaring the demand meets it', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], RECALL_FACT);
    expect([...result.met]).toEqual(['recall-a-fact']);
    expect(result.unmet).toEqual([]);
  });

  it('evidence of another demand never meets this one (N4)', () => {
    const result = met('qualifying-review', [review()], ['apply-to-unfamiliar-case'], RECALL_FACT);
    expect(result.unmet).toEqual(['apply-to-unfamiliar-case']);
  });

  it('a demand label on an assisted success does not meet it (N4)', () => {
    const result = met(
      'qualifying-review',
      [review({ supportLevelShown: 'prompted' })],
      ['recall-a-fact'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a quiz answer never shows unaided recall of a fact, whatever its label (N4)', () => {
    const quiz = review({ instrumentId: 'mcq:a:1', instrumentType: 'mcq' });
    const result = met(
      'qualifying-review',
      [quiz],
      ['recall-a-fact'],
      new Map([['mcq:a:1', ['recall-a-fact'] as const]]),
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a quiz answer can meet a demand other than recall-a-fact (recognition has no ladder)', () => {
    const quiz = review({ instrumentId: 'mcq:a:1', instrumentType: 'mcq' });
    delete (quiz as { supportLevelShown?: unknown }).supportLevelShown;
    const result = met(
      'qualifying-review',
      [quiz],
      ['compare-or-choose'],
      new Map([['mcq:a:1', ['compare-or-choose'] as const]]),
    );
    expect([...result.met]).toEqual(['compare-or-choose']);
  });

  it('a stale success (past due now) does not meet it', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], RECALL_FACT, MUCH_LATER);
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a failed review does not meet it', () => {
    const result = met(
      'qualifying-review',
      [review({ rating: 'again' })],
      ['recall-a-fact'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });
});

describe('(b) any-past-success: the alternative', () => {
  it('an assisted or stale success meets it', () => {
    const assisted = met(
      'any-past-success',
      [review({ supportLevelShown: 'guided' })],
      ['recall-a-fact'],
      RECALL_FACT,
      MUCH_LATER,
    );
    expect([...assisted.met]).toEqual(['recall-a-fact']);
  });

  it('evidence of another demand still never meets this one', () => {
    const result = met('any-past-success', [review()], ['calculate'], RECALL_FACT);
    expect(result.unmet).toEqual(['calculate']);
  });
});

describe('under every rule, proven-invalid evidence never meets a demand ([D-338] item 3)', () => {
  it('a rejected instrument meets nothing', () => {
    for (const rule of ['qualifying-review', 'any-past-success'] as const) {
      const result = met(rule, [review(), rejected('qa:a:1')], ['recall-a-fact'], RECALL_FACT);
      expect(result.unmet).toEqual(['recall-a-fact']);
    }
  });
});

// `ol-egov.141.89.9.84` (`[D-347]`'s split): an unresolved changed passage meets no demand until
// revalidated, under every rule; a revalidation that reads immaterial counts it again.
describe('an unresolved changed passage meets no demand until revalidated ([D-347])', () => {
  const run = (
    rule: DemandRule,
    revalidation: { at: string; state: 'material' | 'immaterial' }[],
  ) =>
    demandsMetNow(
      {
        conceptId: 'concept-a',
        declaredDemands: ['recall-a-fact'],
        instrumentDemands: RECALL_FACT,
        entries: [review()],
        validity: projectInstrumentValidity([review()]),
        scheduler,
        now: SOON,
        passageChanges: [{ instrumentIds: ['qa:a:1'], changedAt: T1, revalidation }],
      },
      rule,
    );
  it('is not met while pending or material, under either rule', () => {
    for (const rule of ['qualifying-review', 'any-past-success'] as const) {
      expect(run(rule, []).unmet).toEqual(['recall-a-fact']);
      expect(run(rule, [{ at: T1, state: 'material' }]).unmet).toEqual(['recall-a-fact']);
    }
  });
  it('is met again once revalidated immaterial', () => {
    expect(run('qualifying-review', [{ at: T1, state: 'immaterial' }]).unmet).toEqual([]);
  });
});

describe('the declared demands are the question; nothing is inferred (R7, N5)', () => {
  it('no declared demands means nothing unmet and nothing met — never a demand inferred from tier', () => {
    const result = met('qualifying-review', [review()], [], RECALL_FACT);
    expect(result.met.size).toBe(0);
    expect(result.unmet).toEqual([]);
  });

  it('an instrument that declares nothing meets nothing', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], new Map());
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('unmet keeps the declared order and has no duplicates', () => {
    const result = met(
      'qualifying-review',
      [],
      ['calculate', 'recall-a-fact', 'calculate'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['calculate', 'recall-a-fact']);
  });

  it('an unknown rule is a programmer error, loudly', () => {
    expect(() => met('bogus' as DemandRule, [review()], ['recall-a-fact'], RECALL_FACT)).toThrow(
      /rule/,
    );
  });
});

// `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): a review is evidence for the one concept it
// scored — the first id of its own list — and for no concept it merely names. A demand is met
// for a concept only by a review that scored that concept.
describe('a review credits only its scored concept ([D-423])', () => {
  const twoTopics = review({ conceptIds: ['concept-a', 'concept-b'] });

  it('meets the demand for the first-listed (scored) concept', () => {
    const result = met('qualifying-review', [twoTopics], ['recall-a-fact'], RECALL_FACT);
    expect([...result.met]).toEqual(['recall-a-fact']);
  });

  it('meets nothing for a concept the record names only as context', () => {
    for (const rule of ['qualifying-review', 'any-past-success'] as const) {
      const result = demandsMetNow(
        {
          conceptId: 'concept-b',
          declaredDemands: ['recall-a-fact'],
          instrumentDemands: RECALL_FACT,
          entries: [twoTopics],
          validity: projectInstrumentValidity([twoTopics]),
          scheduler,
          now: SOON,
        },
        rule,
      );
      expect([...result.met], rule).toEqual([]);
      expect(result.unmet, rule).toEqual(['recall-a-fact']);
    }
  });

  it('a record written with another concept first credits that one, whatever the note lists today', () => {
    const reordered = review({ conceptIds: ['concept-b', 'concept-a'] });
    const result = met('qualifying-review', [reordered], ['recall-a-fact'], RECALL_FACT);
    expect([...result.met]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// `ol-egov.141.89.2.27` (B5), `[D-437]` design section 4.7 and tests T8, T9, T10 and the fold half
// of T11: the rule LIVE, its `instrumentDemands` input read from real target records through the
// B1 reading and projection (`../instrument/demand-reading.ts`), never a hand-built map. The
// records are written here with the writer, in a spec file: T7 scans only non-spec sources, and
// B5's own sources name no writer. `[D-349]` is ruled (option (a), `qualifying-review`).
// ---------------------------------------------------------------------------------------------

const QA_BLOCK: QuestionBindingBlock = { type: 'qa', front: 'a question', back: 'an answer' };
const MCQ_BLOCK: QuestionBindingBlock = { type: 'mcq', stem: 'a stem', answer: 'B' };

describe('the demand rule, live over the target-record projection (T8 to T11)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-demand-live-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function declare(
    instrumentId: string,
    block: QuestionBindingBlock,
    demand: PaperDemand,
    origin: 'heading-cue' | 'sweep' = 'heading-cue',
  ): Promise<void> {
    await writeInstrumentTarget(vault, {
      instrumentId,
      declaredDemand: demand,
      origin,
      questionBinding: await questionBindingOf(block),
      authoredAt: '2026-09-29T10:00:00.000Z',
      generator: { taskId: 'cards.generate.v1', promptVersion: '1.8.0' },
    });
  }

  /** What the gap view's composition root does: read each instrument against its CURRENT block, then project. */
  async function projection(
    blocks: ReadonlyMap<string, QuestionBindingBlock>,
  ): Promise<ReadonlyMap<string, readonly PaperDemand[]>> {
    const readings = new Map<string, InstrumentDemandReading>();
    for (const [instrumentId, block] of blocks) {
      readings.set(instrumentId, await readInstrumentDemand(vault, instrumentId, block));
    }
    return projectInstrumentDemands(readings);
  }

  const CARD = new Map([['qa:a:1', QA_BLOCK]]);

  describe('T8: the dormant rule, live', () => {
    it('a recall-declared card success leaves calculate unmet', async () => {
      await declare('qa:a:1', QA_BLOCK, 'recall-a-fact');
      const result = met('qualifying-review', [review()], ['calculate'], await projection(CARD));
      expect(result.met.size).toBe(0);
      expect(result.unmet).toEqual(['calculate']);
    });

    it('a calculate-declared success meets it', async () => {
      await declare('qa:a:1', QA_BLOCK, 'calculate');
      const result = met('qualifying-review', [review()], ['calculate'], await projection(CARD));
      expect([...result.met]).toEqual(['calculate']);
      expect(result.unmet).toEqual([]);
    });

    it('narrower practice never meets a more demanding requirement: one card, two requirements, only its own is met', async () => {
      await declare('qa:a:1', QA_BLOCK, 'recall-a-fact');
      const result = met(
        'qualifying-review',
        [review()],
        ['recall-a-fact', 'calculate'],
        await projection(CARD),
      );
      expect([...result.met]).toEqual(['recall-a-fact']);
      expect(result.unmet).toEqual(['calculate']);
    });

    it("an unspecified instrument's successes meet nothing, and the reading wrote nothing", async () => {
      const demands = await projection(CARD);
      expect(demands.size).toBe(0);
      for (const rule of ['qualifying-review', 'any-past-success'] as const) {
        const result = met(rule, [review()], ['recall-a-fact', 'calculate'], demands);
        expect(result.met.size, rule).toBe(0);
        expect(result.unmet, rule).toEqual(['recall-a-fact', 'calculate']);
      }
      expect(await vault.exists(instrumentTargetStorePath('qa:a:1'))).toBe(false);
    });

    it("row 38: a multiple-choice item authored with the sweep's recall intent is declared intent that meets nothing", async () => {
      await declare('mcq:a:1', MCQ_BLOCK, 'recall-a-fact', 'sweep');
      const blocks = new Map([['mcq:a:1', MCQ_BLOCK]]);
      const reading = await readInstrumentDemand(vault, 'mcq:a:1', MCQ_BLOCK);
      expect(reading).toMatchObject({ kind: 'declared', responseForm: 'recognition' });
      const quiz = review({ instrumentId: 'mcq:a:1', instrumentType: 'mcq' });
      // The projection stays faithful to the declaration ...
      const demands = await projection(blocks);
      expect(demands.get('mcq:a:1')).toEqual(['recall-a-fact']);
      // ... and the fold's own rule is what stops a recognition review meeting a recall requirement.
      const result = met('qualifying-review', [quiz], ['recall-a-fact'], demands);
      expect(result.met.size).toBe(0);
      expect(result.unmet).toEqual(['recall-a-fact']);
    });

    it('T11, fold half: a hand edit that breaks the question binding makes the instrument declare none, and the record is untouched', async () => {
      await declare('qa:a:1', QA_BLOCK, 'recall-a-fact');
      const before = await vault.read(instrumentTargetStorePath('qa:a:1'));
      const edited = new Map([
        ['qa:a:1', { type: 'qa', front: 'a question', back: 'a different answer' } as const],
      ]);
      const demands = await projection(edited);
      expect(demands.has('qa:a:1')).toBe(false);
      const result = met('qualifying-review', [review()], ['recall-a-fact'], demands);
      expect(result.unmet).toEqual(['recall-a-fact']);
      expect(await vault.read(instrumentTargetStorePath('qa:a:1'))).toBe(before);
      // Restoring the text restores the reading: staleness belongs to the pair, not to the file.
      const restored = met(
        'qualifying-review',
        [review()],
        ['recall-a-fact'],
        await projection(CARD),
      );
      expect(restored.unmet).toEqual([]);
    });

    it('an unreadable file declares none, and is not read as declared on trust', async () => {
      await vault.write(instrumentTargetStorePath('qa:a:1'), '{ not a record');
      const demands = await projection(CARD);
      expect(demands.size).toBe(0);
      const result = met('qualifying-review', [review()], ['recall-a-fact'], demands);
      expect(result.unmet).toEqual(['recall-a-fact']);
    });
  });

  describe('T9: invariance, adding or removing target records changes demand readings only', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ eventId: 'r1', timestamp: T1 }),
      review({ eventId: 'r2', timestamp: new Date(Date.parse(T1) + DAY).toISOString() }),
      review({
        eventId: 'r3',
        instrumentId: 'mcq:a:1',
        instrumentType: 'mcq',
        timestamp: new Date(Date.parse(T1) + 1.5 * DAY).toISOString(),
      }),
    ];
    const NOW = new Date(Date.parse(T1) + 2 * DAY);

    /** Every ordinary reading of the same entries: the ladder, mastery, the replayed schedule, readiness and need. */
    function ordinary() {
      const validity = projectInstrumentValidity(entries);
      const readiness = readAllConceptReadiness(entries, ['concept-a'], scheduler, NOW, validity);
      return JSON.stringify({
        mastery: [...computeAllConceptMastery(entries, ['concept-a'])],
        schedule: [...replaySchedulerStates(entries, scheduler).states],
        readiness: [...readiness],
        need: [...readiness].map(([id, reading]) => [id, readNeed(reading)]),
      });
    }

    it('writing and removing records moves the demand reading and nothing the ordinary readers see', async () => {
      const blocks = new Map<string, QuestionBindingBlock>([
        ['qa:a:1', QA_BLOCK],
        ['mcq:a:1', MCQ_BLOCK],
      ]);
      const unmetNow = async () =>
        met('qualifying-review', entries, ['calculate'], await projection(blocks), NOW).unmet;

      const baseline = ordinary();
      expect(await unmetNow()).toEqual(['calculate']);

      await declare('qa:a:1', QA_BLOCK, 'calculate');
      expect(await unmetNow()).toEqual([]);
      expect(ordinary()).toBe(baseline);

      await vault.delete(instrumentTargetStorePath('qa:a:1'));
      expect(await unmetNow()).toEqual(['calculate']);
      expect(ordinary()).toBe(baseline);
    });

    it('the ordinary readers take no target record, so no record can reach them: the same entries always read the same', () => {
      expect(ordinary()).toBe(ordinary());
    });
  });

  describe('T10: no upgrade, a predecessor never meets the demand its successor declares', () => {
    it("a predecessor's successes leave the successor's demand unmet, and the predecessor gains no record", async () => {
      // A revision mints a successor id; only the successor was authored with a demand.
      await declare('qa:a:2', QA_BLOCK, 'calculate');
      const blocks = new Map([
        ['qa:a:1', QA_BLOCK],
        ['qa:a:2', QA_BLOCK],
      ]);
      const demands = await projection(blocks);
      expect(demands.get('qa:a:2')).toEqual(['calculate']);
      expect(demands.has('qa:a:1')).toBe(false);

      const predecessorOnly = met('qualifying-review', [review()], ['calculate'], demands);
      expect(predecessorOnly.met.size).toBe(0);
      expect(predecessorOnly.unmet).toEqual(['calculate']);
      expect(await vault.exists(instrumentTargetStorePath('qa:a:1'))).toBe(false);

      // The successor's own success does meet it: the demand is read by the exact instrument id.
      const successor = review({ eventId: 'r-successor', instrumentId: 'qa:a:2' });
      const both = met('qualifying-review', [review(), successor], ['calculate'], demands);
      expect([...both.met]).toEqual(['calculate']);
    });

    it("the reverse holds too: a successor's record is never read as its predecessor's", async () => {
      await declare('qa:a:2', QA_BLOCK, 'calculate');
      const demands = await projection(
        new Map([
          ['qa:a:1', QA_BLOCK],
          ['qa:a:2', QA_BLOCK],
        ]),
      );
      const successorOnly = review({ instrumentId: 'qa:a:2' });
      const onlyPredecessorDeclared = new Map(demands);
      onlyPredecessorDeclared.delete('qa:a:2');
      expect(
        met('qualifying-review', [successorOnly], ['calculate'], onlyPredecessorDeclared).unmet,
      ).toEqual(['calculate']);
    });
  });
});

describe('a review whose grade a corrected contest proved wrong meets no demand ([D-338] item 3)', () => {
  it('the rule reads the same standing evidence as readiness and the recognition credit', () => {
    const entries = [review({ eventId: 'wrong-grade' })];
    const validity = {
      ...projectInstrumentValidity(entries),
      correctedEvidence: new Map([
        [
          'wrong-grade',
          {
            reviewEventId: 'wrong-grade',
            instrumentId: 'qa:a:1',
            resolutionEventId: 'resolution',
            at: T1,
          },
        ],
      ]),
    };
    for (const rule of ['qualifying-review', 'any-past-success'] as const) {
      const result = demandsMetNow(
        {
          conceptId: 'concept-a',
          declaredDemands: ['recall-a-fact'],
          instrumentDemands: RECALL_FACT,
          entries,
          validity,
          scheduler,
          now: SOON,
        },
        rule,
      );
      expect(result.met.size, rule).toBe(0);
      expect(result.unmet, rule).toEqual(['recall-a-fact']);
    }
  });
});

// The supplier the gap view's composition root calls: one `demandsMetNow` per concept whose
// declared demands were READ, and no entry for any other.
describe('unmetDemandsByConcept: supplied only for concepts whose declared demands were read', () => {
  const base = {
    instrumentDemands: RECALL_FACT,
    entries: [review()] as readonly ReviewLogEntry[],
    validity: projectInstrumentValidity([review()]),
    scheduler,
    now: SOON,
  };

  it('nothing read anywhere (no declared demands supplied) gives no entry for any concept', () => {
    const none = unmetDemandsByConcept({ ...base, declaredDemands: undefined });
    expect(none.size).toBe(0);
  });

  it('a concept whose demands were not read has NO entry: absent, never []', () => {
    const result = unmetDemandsByConcept({
      ...base,
      declaredDemands: new Map([['concept-a', ['recall-a-fact', 'calculate'] as const]]),
    });
    expect(result.has('concept-b')).toBe(false);
    expect(result.get('concept-b')).toBeUndefined();
    expect(result.get('concept-a')).toEqual(['calculate']);
  });

  it('a concept read with nothing declared is present as [], distinct from a concept never read', () => {
    const result = unmetDemandsByConcept({
      ...base,
      declaredDemands: new Map([['concept-a', []]]),
    });
    expect(result.has('concept-a')).toBe(true);
    expect(result.get('concept-a')).toEqual([]);
    expect(result.has('concept-b')).toBe(false);
  });

  it('runs the ruled rule, qualifying-review: a stale success does not meet, where the alternative would', () => {
    const declared = new Map([['concept-a', ['recall-a-fact'] as const]]);
    const later = { ...base, now: MUCH_LATER, declaredDemands: declared };
    expect(unmetDemandsByConcept(later).get('concept-a')).toEqual(['recall-a-fact']);
    expect(
      met('any-past-success', [review()], ['recall-a-fact'], RECALL_FACT, MUCH_LATER).unmet,
    ).toEqual([]);
  });

  it('each concept is answered from the reviews that scored it (D-423), from one shared replay', () => {
    const entries = [
      review({ eventId: 'ra', conceptIds: ['concept-a'] }),
      review({ eventId: 'rb', instrumentId: 'qa:b:1', conceptIds: ['concept-b'], rating: 'again' }),
    ];
    const result = unmetDemandsByConcept({
      ...base,
      entries,
      validity: projectInstrumentValidity(entries),
      instrumentDemands: new Map([
        ['qa:a:1', ['recall-a-fact'] as const],
        ['qa:b:1', ['recall-a-fact'] as const],
      ]),
      declaredDemands: new Map([
        ['concept-a', ['recall-a-fact'] as const],
        ['concept-b', ['recall-a-fact'] as const],
      ]),
    });
    expect(result.get('concept-a')).toEqual([]);
    expect(result.get('concept-b')).toEqual(['recall-a-fact']);
  });

  it('agrees, concept for concept, with demandsMetNow called directly', () => {
    const declared = new Map([
      ['concept-a', ['recall-a-fact', 'calculate', 'recall-a-fact'] as const],
    ]);
    const viaSupplier = unmetDemandsByConcept({ ...base, declaredDemands: declared });
    const direct = met(
      'qualifying-review',
      [review()],
      ['recall-a-fact', 'calculate', 'recall-a-fact'],
      RECALL_FACT,
    );
    expect(viaSupplier.get('concept-a')).toEqual(direct.unmet);
  });
});
