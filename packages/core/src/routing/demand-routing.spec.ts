import { describe, expect, it } from 'vitest';
import { PAPER_GENERATOR_DECLARED_DEMANDS } from '../oracle/paper-blueprint.js';
import { PAPER_DEMANDS, type PaperGeneratorTaskId } from '../oracle/paper-types.js';
import {
  askFromDemand,
  askFromHeading,
  askFromInstrumentReading,
  type DemandAsk,
  NO_DEMAND_ASKED,
  questionWordOf,
  SWEEP_RECALL_ASK,
} from './demand-ask.js';
import {
  authoringDemandFields,
  DEMAND_ROUTING_REASONS,
  DemandRoutingCounter,
  demandRoutingReasonOf,
  routeDemandAsk,
  unmetAskOf,
} from './demand-routing.js';

// `[D-437]`, design `demand-carriage.md` §4 and §4.1, T18. INV-3: every heading and concept below
// is invented for this suite; none is copied from a real vault.

const QUIZ: PaperGeneratorTaskId = 'quiz.generate.v1';
const CARDS: PaperGeneratorTaskId = 'cards.generate.v1';

describe('questionWordOf: the question word as written, or null', () => {
  it('reads the leading wh-word with its case kept', () => {
    expect(questionWordOf('What is chunking?')).toBe('What');
    expect(questionWordOf('How does rehearsal work')).toBe('How');
    expect(questionWordOf('why does spacing help?')).toBe('why');
  });

  it('reads a wh-word that is not first, since the question word travels beside the whole heading', () => {
    expect(questionWordOf('Explain how signal averaging extracts a signal')).toBe('how');
    expect(questionWordOf('In which order do the stages run?')).toBe('which');
  });

  it('reads none from a yes/no question or a heading with no interrogative', () => {
    expect(questionWordOf('Does chunking extend working memory capacity?')).toBeNull();
    expect(questionWordOf('Critically analyse each approach')).toBeNull();
  });

  it('is not fooled by a wh-word inside a longer word, or by trailing punctuation', () => {
    expect(questionWordOf('Somewhere in the whorl?')).toBeNull();
    expect(questionWordOf('**Why?**')).toBe('Why');
  });
});

describe('askFromHeading: the full heading and its question word are the primary request (row 35)', () => {
  it('a definition heading is mapped, with the heading and question word kept as the source', () => {
    const ask = askFromHeading('What is chunking?');
    expect(ask.source).toEqual({ heading: 'What is chunking?', questionWord: 'What' });
    expect(ask.mapping).toEqual({ kind: 'mapped', demand: 'recall-a-fact' });
  });

  it('keeps the heading exactly as given, whatever the mapping read', () => {
    const heading = '**What  is chunking, and why does it matter?**';
    expect(askFromHeading(heading).source?.heading).toBe(heading);
  });

  it('a bare how or why is underspecified with its source kept, never none', () => {
    for (const heading of ['How does rehearsal work?', 'Why does spacing help?']) {
      const ask = askFromHeading(heading);
      expect(ask.mapping).toEqual({ kind: 'unmapped', reason: 'underspecified' });
      expect(ask.source?.heading).toBe(heading);
      expect(ask.source?.questionWord).not.toBeNull();
    }
  });

  it('a yes/no heading with no mapping is underspecified with no question word, never none', () => {
    const ask = askFromHeading('Does chunking extend working memory capacity?');
    expect(ask.mapping).toEqual({ kind: 'unmapped', reason: 'underspecified' });
    expect(ask.source).toEqual({
      heading: 'Does chunking extend working memory capacity?',
      questionWord: null,
    });
  });

  it('no heading ever reads as nothing asked unless it is blank', () => {
    expect(askFromHeading('Explain how signal averaging works').mapping.kind).toBe('unmapped');
    expect(askFromHeading('   ')).toBe(NO_DEMAND_ASKED);
    expect(askFromHeading('**')).toBe(NO_DEMAND_ASKED);
  });

  it('a derived numeric ask maps to calculate, which no generator serves yet', () => {
    const ask = askFromHeading('How many steps does the cycle have?');
    expect(ask.mapping).toEqual({ kind: 'mapped', demand: 'calculate' });
    expect(ask.source?.questionWord).toBe('How');
  });
});

describe('the declared constants and the other origins', () => {
  it('the sweep constant is recall intent with no source', () => {
    expect(SWEEP_RECALL_ASK).toEqual({
      source: null,
      mapping: { kind: 'mapped', demand: 'recall-a-fact' },
    });
    expect(Object.isFrozen(SWEEP_RECALL_ASK)).toBe(true);
  });

  it('a named demand (a planner need, a paper slot, a restated revision) has no source', () => {
    expect(askFromDemand('compare-or-choose')).toEqual({
      source: null,
      mapping: { kind: 'mapped', demand: 'compare-or-choose' },
    });
  });

  it('a revision restates only a declared reading; stale, unspecified and unreadable restate nothing', () => {
    expect(
      askFromInstrumentReading({
        kind: 'declared',
        demand: 'recall-a-fact',
        origin: 'sweep',
        responseForm: 'recognition',
      }),
    ).toEqual({ source: null, mapping: { kind: 'mapped', demand: 'recall-a-fact' } });
    expect(askFromInstrumentReading({ kind: 'stale', demand: 'recall-a-fact' })).toBe(
      NO_DEMAND_ASKED,
    );
    expect(askFromInstrumentReading({ kind: 'unspecified' })).toBe(NO_DEMAND_ASKED);
    expect(askFromInstrumentReading({ kind: 'unreadable' })).toBe(NO_DEMAND_ASKED);
  });
});

describe('routeDemandAsk: every ask has an outcome and the source survives it', () => {
  it('a mapped word the generator declares is served, with its source', () => {
    const ask = askFromHeading('What is chunking?');
    expect(routeDemandAsk(ask, QUIZ)).toEqual({
      kind: 'served',
      demand: 'recall-a-fact',
      source: { heading: 'What is chunking?', questionWord: 'What' },
    });
  });

  it('a mapped word no generator declares is deferred, with its source', () => {
    const ask = askFromHeading('How many steps does the cycle have?');
    expect(routeDemandAsk(ask, QUIZ)).toEqual({
      kind: 'deferred',
      demand: 'calculate',
      source: { heading: 'How many steps does the cycle have?', questionWord: 'How' },
    });
  });

  it('an operation outside the vocabulary is unsupported, with its source and any label', () => {
    const source = { heading: 'Discuss the role of sleep', questionWord: null };
    const ask: DemandAsk = {
      source,
      mapping: { kind: 'unmapped', reason: 'outside-vocabulary', operation: 'discuss' },
    };
    expect(routeDemandAsk(ask, QUIZ)).toEqual({
      kind: 'unsupported',
      source,
      operation: 'discuss',
    });
    expect(
      routeDemandAsk({ source, mapping: { kind: 'unmapped', reason: 'outside-vocabulary' } }, QUIZ),
    ).toEqual({ kind: 'unsupported', source });
  });

  it('an underspecified ask stays unspecified with its source, neither served nor unsupported', () => {
    const ask = askFromHeading('Why does spacing help?');
    expect(routeDemandAsk(ask, QUIZ)).toEqual({
      kind: 'unspecified',
      reason: 'underspecified',
      source: { heading: 'Why does spacing help?', questionWord: 'Why' },
    });
  });

  it('nothing asked is unspecified with no source', () => {
    expect(routeDemandAsk(NO_DEMAND_ASKED, QUIZ)).toEqual({
      kind: 'unspecified',
      reason: 'none-asked',
      source: null,
    });
  });

  it('is served exactly when the routed generator declares the word, for every word and both generators', () => {
    for (const taskId of [QUIZ, CARDS]) {
      for (const demand of PAPER_DEMANDS) {
        const routing = routeDemandAsk(askFromDemand(demand), taskId);
        const declared = PAPER_GENERATOR_DECLARED_DEMANDS[taskId].includes(demand);
        expect(routing.kind).toBe(declared ? 'served' : 'deferred');
      }
    }
  });

  it('is pure: the same ask and generator give an equal outcome', () => {
    const ask = askFromHeading('What is chunking?');
    expect(routeDemandAsk(ask, QUIZ)).toEqual(routeDemandAsk(ask, QUIZ));
  });
});

describe('T18: an unserved ask is recorded as unmet with its source, never sent and never fulfilled (row 37)', () => {
  const DEFERRED_HEADING = 'How many steps does the cycle have?';
  const UNSUPPORTED_SOURCE = { heading: 'Discuss the role of sleep', questionWord: null };
  const unsupportedRouting = routeDemandAsk(
    {
      source: UNSUPPORTED_SOURCE,
      mapping: { kind: 'unmapped', reason: 'outside-vocabulary', operation: 'discuss' },
    },
    QUIZ,
  );
  const deferredRouting = routeDemandAsk(askFromHeading(DEFERRED_HEADING), QUIZ);

  it('comes back as an unmet ask with the full source heading intact', () => {
    expect(unmetAskOf(deferredRouting)).toEqual(deferredRouting);
    expect(unmetAskOf(deferredRouting)?.source?.heading).toBe(DEFERRED_HEADING);
    expect(unmetAskOf(unsupportedRouting)?.source).toEqual(UNSUPPORTED_SOURCE);
    expect(unmetAskOf(unsupportedRouting)).toMatchObject({
      kind: 'unsupported',
      operation: 'discuss',
    });
  });

  it('serves and unspecified are not unmet asks', () => {
    expect(unmetAskOf(routeDemandAsk(askFromHeading('What is chunking?'), QUIZ))).toBeNull();
    expect(unmetAskOf(routeDemandAsk(NO_DEMAND_ASKED, QUIZ))).toBeNull();
    expect(unmetAskOf(routeDemandAsk(askFromHeading('Why does spacing help?'), QUIZ))).toBeNull();
  });

  it('never becomes a declared demand: no demand and no heading is put on a drafting request', () => {
    for (const routing of [deferredRouting, unsupportedRouting]) {
      expect(authoringDemandFields(routing)).toEqual({});
    }
    // Nor does the "narrower" reading: an unserved word is not swapped for one a generator serves.
    expect(JSON.stringify(authoringDemandFields(deferredRouting))).not.toContain('recall-a-fact');
  });

  it('is never counted as fulfilment: it is filed under its own reason, apart from served', () => {
    const counter = new DemandRoutingCounter();
    counter.record('c1', deferredRouting);
    counter.record('c1', unsupportedRouting);
    expect(counter.total('served')).toBe(0);
    expect(counter.total('no-generator-serves')).toBe(1);
    expect(counter.total('outside-vocabulary')).toBe(1);
  });

  it('is not turned into a served ask by asking a different generator that also does not serve it', () => {
    expect(routeDemandAsk(askFromHeading(DEFERRED_HEADING), CARDS).kind).toBe('deferred');
  });
});

describe('authoringDemandFields: what a routing puts on the drafting request (T3, wire half)', () => {
  it('a served heading sends the mapping and the whole heading with its question word', () => {
    const routing = routeDemandAsk(askFromHeading('What is chunking?'), QUIZ);
    expect(authoringDemandFields(routing)).toEqual({
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: 'What is chunking?', questionWord: 'What' },
    });
  });

  it('a served heading with no question word sends the heading alone', () => {
    const routing = routeDemandAsk(askFromHeading('Define chunking'), QUIZ);
    expect(authoringDemandFields(routing)).toEqual({
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: 'Define chunking' },
    });
  });

  it('the sweep constant sends the demand only, since no heading is behind it', () => {
    expect(authoringDemandFields(routeDemandAsk(SWEEP_RECALL_ASK, QUIZ))).toEqual({
      intendedDemand: 'recall-a-fact',
    });
  });

  it('an unspecified or unserved ask sends neither field', () => {
    for (const ask of [
      NO_DEMAND_ASKED,
      askFromHeading('Why does spacing help?'),
      askFromHeading('Does chunking extend working memory capacity?'),
      askFromHeading('How many steps does the cycle have?'),
    ]) {
      expect(authoringDemandFields(routeDemandAsk(ask, QUIZ))).toEqual({});
    }
  });

  it('never sends a blank heading', () => {
    const routing = routeDemandAsk(
      {
        source: { heading: '  ', questionWord: null },
        mapping: { kind: 'mapped', demand: 'recall-a-fact' },
      },
      QUIZ,
    );
    expect(authoringDemandFields(routing)).toEqual({ intendedDemand: 'recall-a-fact' });
  });
});

describe('DemandRoutingCounter: outcomes counted per concept and per reason', () => {
  it('counts each reason for each concept, in a fixed order', () => {
    const counter = new DemandRoutingCounter();
    const served = routeDemandAsk(askFromHeading('What is chunking?'), QUIZ);
    const deferred = routeDemandAsk(askFromHeading('How many steps does the cycle have?'), QUIZ);
    const underspecified = routeDemandAsk(askFromHeading('Why does spacing help?'), QUIZ);
    const none = routeDemandAsk(NO_DEMAND_ASKED, QUIZ);

    counter.record('concept-b', underspecified);
    counter.record('concept-a', served);
    counter.record('concept-a', served);
    counter.record('concept-a', deferred);
    counter.record('concept-b', none);

    expect(counter.counts()).toEqual([
      { conceptKey: 'concept-a', reason: 'served', count: 2 },
      { conceptKey: 'concept-a', reason: 'no-generator-serves', count: 1 },
      { conceptKey: 'concept-b', reason: 'underspecified', count: 1 },
      { conceptKey: 'concept-b', reason: 'none-asked', count: 1 },
    ]);
    expect(counter.total('served')).toBe(2);
    expect(counter.total('none-asked')).toBe(1);
    expect(counter.total('outside-vocabulary')).toBe(0);
  });

  it('records inline, returning the routing unchanged', () => {
    const counter = new DemandRoutingCounter();
    const routing = routeDemandAsk(askFromHeading('What is chunking?'), QUIZ);
    expect(counter.record('c', routing)).toBe(routing);
  });

  it('names one reason per outcome and covers every reason', () => {
    const outcomes = [
      routeDemandAsk(askFromDemand('recall-a-fact'), QUIZ),
      routeDemandAsk(askFromDemand('calculate'), QUIZ),
      routeDemandAsk(
        { source: null, mapping: { kind: 'unmapped', reason: 'outside-vocabulary' } },
        QUIZ,
      ),
      routeDemandAsk(askFromHeading('Why does spacing help?'), QUIZ),
      routeDemandAsk(NO_DEMAND_ASKED, QUIZ),
    ];
    expect(outcomes.map(demandRoutingReasonOf)).toEqual([...DEMAND_ROUTING_REASONS]);
  });

  it('holds only opaque keys and counts: nothing of the heading is in a count', () => {
    const counter = new DemandRoutingCounter();
    counter.record(
      'concept-a',
      routeDemandAsk(askFromHeading('How many steps does the cycle have?'), QUIZ),
    );
    expect(JSON.stringify(counter.counts())).not.toContain('steps');
  });
});
