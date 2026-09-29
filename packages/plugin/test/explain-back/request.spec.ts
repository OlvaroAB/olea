/**
 * Pure-composition tests for `../../src/explain-back/request.ts` (`ol-12gs`).
 * No `obsidian` import anywhere in this file (INV-1) — mirrors
 * `review/explainWhy.spec.ts`'s shape for the same reason.
 */

import {
  type ConceptRecord,
  type ConceptRelation,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type RelationSet,
  type RelationSetEntry,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildExplainBackPromptContextFromInstrument,
  buildExplainBackPromptContextFromTopic,
  buildGradeExplainBackInputFromTypedAnswer,
  buildGradeSoloInputFromTypedAnswer,
  type FreeformTopicConceptCandidate,
  matchFreeformTopicToConcept,
  resolveExplainBackCausesPartner,
  resolveExplainBackRelationEdge,
  retrieveExplainBackSourceBlocks,
  shouldRunExplainBackDepthPass,
} from '../../src/explain-back/request.js';
import { clozeFixture, mcqFixture, qaFixture } from '../review/fixtures.js';

class RejectingEmbeddingProvider implements EmbeddingProvider {
  embed(): Promise<EmbedResult> {
    return Promise.reject(new Error('RejectingEmbeddingProvider: no embedding provider wired'));
  }
}

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

function indexWithBlocks(path: string, blocks: readonly string[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: [
      {
        path,
        courses: [],
        contentHash: 'unused',
        blocks: blocks.map((text, blockIndex) => ({
          blockIndex,
          kind: 'paragraph' as const,
          text,
        })),
      },
    ],
  };
}

async function fakeRetrieveDeps(keywordIndex: PersistedKeywordIndex) {
  const embeddingProvider = new RejectingEmbeddingProvider();
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: embeddingProvider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider };
}

describe('retrieveExplainBackSourceBlocks', () => {
  it('returns real chunk text, each carrying a stable blockId and its {path, blockIndex}', async () => {
    const keywordIndex = indexWithBlocks('course/note.md', ['a real passage about the topic']);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'a real passage about the topic',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block.text).toBe('a real passage about the topic');
    expect(blocks[0]?.path).toBe('course/note.md');
    expect(blocks[0]?.blockIndex).toBe(0);
    expect(blocks[0]?.block.blockId.length).toBeGreaterThan(0);
  });

  it('an empty index refuses honestly: [], never a thrown error', async () => {
    const keywordIndex = indexWithBlocks('course/empty.md', []);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'anything',
    );

    expect(blocks).toEqual([]);
  });

  it('two blocks mint two distinct blockIds', async () => {
    const keywordIndex = indexWithBlocks('course/note.md', [
      'first passage about the shared topic',
      'second passage about the shared topic',
    ]);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'shared topic',
    );

    const ids = blocks.map((entry) => entry.block.blockId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildExplainBackPromptContextFromInstrument', () => {
  it('a Q&A card carries its question and answer as referenceAnswer', () => {
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), []);
    expect(context.question).toBe(qaFixture().question);
    expect(context.referenceAnswer).toBe(qaFixture().answer);
    expect(context.sourceBlocks).toEqual([]);
    expect(context.misconceptionDigest).toEqual([]);
  });

  it('a cloze card renders the blank inline and the cloze text is the referenceAnswer', () => {
    const fixture = clozeFixture();
    const context = buildExplainBackPromptContextFromInstrument(fixture, []);
    expect(context.question).toBe(`${fixture.before}____${fixture.after}`);
    expect(context.referenceAnswer).toBe(fixture.clozeText);
  });

  it('an MCQ carries the stem and the correct option label as referenceAnswer', () => {
    const fixture = mcqFixture();
    const context = buildExplainBackPromptContextFromInstrument(fixture, []);
    expect(context.question).toBe(fixture.stem);
    expect(context.referenceAnswer).toBe(fixture.options[0]?.label);
  });

  it('carries retrieved source blocks through as GradeExplainBackInput.sourceBlocks', () => {
    const entry = { block: { blockId: 'b1', text: 'passage' }, path: 'p.md', blockIndex: 0 };
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), [entry]);
    expect(context.sourceBlocks).toEqual([{ blockId: 'b1', text: 'passage' }]);
  });
});

describe('buildExplainBackPromptContextFromTopic', () => {
  it('wraps the topic into a question, honestly with no separate synthesized reference answer', () => {
    const entry = {
      block: { blockId: 'b1', text: 'a passage about photosynthesis' },
      path: 'p.md',
      blockIndex: 0,
    };
    const context = buildExplainBackPromptContextFromTopic('photosynthesis', [entry]);
    expect(context.question).toBe('In your own words: explain photosynthesis.');
    expect(context.referenceAnswer).toBe('a passage about photosynthesis');
  });

  it('joins multiple retrieved blocks for the referenceAnswer', () => {
    const entries = [
      { block: { blockId: 'b1', text: 'first' }, path: 'p.md', blockIndex: 0 },
      { block: { blockId: 'b2', text: 'second' }, path: 'p.md', blockIndex: 1 },
    ];
    const context = buildExplainBackPromptContextFromTopic('a topic', entries);
    expect(context.referenceAnswer).toBe('first\n\nsecond');
  });

  it('an empty retrieval yields an empty referenceAnswer — the caller decides whether that is gradeable', () => {
    const context = buildExplainBackPromptContextFromTopic('a topic', []);
    expect(context.referenceAnswer).toBe('');
  });
});

describe('buildGradeExplainBackInputFromTypedAnswer', () => {
  it('mirrors buildGradeExplainBackInputFromTranscript field for field, with a typed studentAnswer', () => {
    const context = buildExplainBackPromptContextFromTopic('a topic', []);
    const input = buildGradeExplainBackInputFromTypedAnswer('her typed answer', context);
    expect(input).toEqual({
      question: context.question,
      studentAnswer: 'her typed answer',
      referenceAnswer: context.referenceAnswer,
      sourceBlocks: context.sourceBlocks,
      misconceptionDigest: context.misconceptionDigest,
    });
  });
});

describe('buildGradeSoloInputFromTypedAnswer (ol-cqz8)', () => {
  it('concept-only: sourceBlocks double as the omission denominator, relationExpected is always false', () => {
    const entries = [
      { block: { blockId: 'b1', text: 'first passage' }, path: 'p.md', blockIndex: 0 },
      { block: { blockId: 'b2', text: 'second passage' }, path: 'p.md', blockIndex: 1 },
    ];
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), entries);

    const input = buildGradeSoloInputFromTypedAnswer('her explanation', context);

    expect(input).toEqual({
      question: context.question,
      studentAnswer: 'her explanation',
      sourceMaterial: {
        sourceBlocks: context.sourceBlocks,
        omissionDenominator: context.sourceBlocks,
        candidateEdgeNomination: null,
      },
      relationExpected: false,
    });
  });

  it('an empty retrieval still produces a gradeable input — an empty answer against no source blocks', () => {
    const context = buildExplainBackPromptContextFromTopic('a topic', []);

    const input = buildGradeSoloInputFromTypedAnswer('', context);

    expect(input.sourceMaterial.sourceBlocks).toEqual([]);
    expect(input.sourceMaterial.omissionDenominator).toEqual([]);
    expect(input.sourceMaterial.candidateEdgeNomination).toBeNull();
    expect(input.relationExpected).toBe(false);
  });

  // `ol-egov.141.89.6.48`: F5.3 (`[D-083]`) — "the omission denominator is
  // the subject concept's defining material plus the edge's provenance
  // passages, and nothing wider... the neighbour contributes only what the
  // edge's passages say about it." Before this bead, `sourceMaterial` was
  // ALWAYS built from `context.sourceBlocks` alone, so a resolved causes
  // partner's full defining passages leaked into the denominator. This
  // block failed against the pre-existing two-argument signature (no third
  // parameter existed to carry a role-separated `sourceMaterial` in at
  // all — the call below would not type-check, and even ignoring that, the
  // function unconditionally set `omissionDenominator: context.sourceBlocks`
  // regardless of any extra argument), so it is the regression test for the
  // fix: with a causes partner present, the neighbour's own defining
  // passages are excluded from the denominator while the edge's own
  // provenance passages remain in it, and the full judge source is
  // unaffected.
  describe('a causes partner present (resolved.sourceMaterial supplied, edge-provenance case)', () => {
    const subjectBlock = { blockId: 'subject#0#0', text: 'subject defining passage' };
    const edgeBlock = { blockId: 'edge#0#0', text: 'edge provenance passage' };
    const neighbourBlock = { blockId: 'neighbour#0#0', text: "neighbour's own defining passage" };

    const entries = [
      { block: subjectBlock, path: 'subject.md', blockIndex: 0 },
      { block: edgeBlock, path: 'edge.md', blockIndex: 0 },
      { block: neighbourBlock, path: 'neighbour.md', blockIndex: 0 },
    ];
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), entries);

    const sourceMaterial = {
      // The correctness judge's full source (F5.2a) — subject, edge
      // provenance AND the neighbour's full defining passages.
      sourceBlocks: [subjectBlock, edgeBlock, neighbourBlock],
      // F5.3's narrower denominator — subject material plus the edge's own
      // provenance, never the neighbour's full defining passages.
      omissionDenominator: [subjectBlock, edgeBlock],
      candidateEdgeNomination: null,
    };

    it('excludes the neighbour defining passage from the denominator, keeps edge provenance', () => {
      const input = buildGradeSoloInputFromTypedAnswer('her explanation', context, {
        sourceMaterial,
        relationExpected: true,
      });

      expect(input.sourceMaterial.omissionDenominator).toEqual([subjectBlock, edgeBlock]);
      expect(input.sourceMaterial.omissionDenominator).not.toContainEqual(neighbourBlock);
    });

    it('leaves the correctness/depth source (sourceBlocks) at the full grading source, unchanged', () => {
      const input = buildGradeSoloInputFromTypedAnswer('her explanation', context, {
        sourceMaterial,
        relationExpected: true,
      });

      expect(input.sourceMaterial.sourceBlocks).toEqual([subjectBlock, edgeBlock, neighbourBlock]);
    });

    it('forwards the supplied relationExpected rather than the concept-only default', () => {
      const input = buildGradeSoloInputFromTypedAnswer('her explanation', context, {
        sourceMaterial,
        relationExpected: true,
      });

      expect(input.relationExpected).toBe(true);
    });
  });

  // F5.3's named degradation: "where no provenance exists, omission-scoring
  // is undefined... omission-scoring is simply absent rather than invented
  // against a denominator that isn't grounded." `null`, never `[]`
  // (`GradingSourceMaterial.omissionDenominator`'s own doc,
  // `mastery/gradingInputContract.ts`) — this must survive unchanged, not
  // collapse to the concept-only default.
  it('a supplied sourceMaterial with a null denominator (no provenance) is threaded through as null, never replaced by context.sourceBlocks', () => {
    const entries = [
      { block: { blockId: 'b1', text: 'subject passage' }, path: 's.md', blockIndex: 0 },
      { block: { blockId: 'b2', text: 'neighbour passage' }, path: 'n.md', blockIndex: 0 },
    ];
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), entries);

    const input = buildGradeSoloInputFromTypedAnswer('her explanation', context, {
      sourceMaterial: {
        sourceBlocks: context.sourceBlocks,
        omissionDenominator: null,
        candidateEdgeNomination: null,
      },
      relationExpected: true,
    });

    expect(input.sourceMaterial.omissionDenominator).toBeNull();
  });

  it('with no resolved argument at all (no partner), the pre-existing behaviour is unchanged: the whole grading source still doubles as the denominator', () => {
    const entries = [
      { block: { blockId: 'b1', text: 'first passage' }, path: 'p.md', blockIndex: 0 },
    ];
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), entries);

    const input = buildGradeSoloInputFromTypedAnswer('her explanation', context);

    expect(input.sourceMaterial.omissionDenominator).toEqual(input.sourceMaterial.sourceBlocks);
    expect(input.sourceMaterial.omissionDenominator).toEqual(context.sourceBlocks);
    expect(input.relationExpected).toBe(false);
  });
});

// `ol-egov.141.89.6.30`: rel.md section 1's "Explain-back partner (causes)"
// row, resolved through the SAME gated read (`servedRelations`) every other
// reader uses — a stale endpoint is excluded there, never by a second,
// hand-rolled filter in this file (rel.md section 3 Default 4).
//
// `ol-egov.141.89.6.74`: the fixtures are production-shaped. An instrument's
// subject id is a concept KEY, never a wording, and an edge's `from`/`to` are
// wordings with the keys on the optional `fromKey`/`toKey`; every id below is a
// key that equals no wording. An earlier revision used the wording as the id and
// built edges with no keys, which made the comparison under test unable to fail.
describe('resolveExplainBackRelationEdge (rel.md section 1, "Explain-back partner (causes)")', () => {
  const COUGH = 'cough';
  const BRONCHITIS = 'bronchitis';
  const COUGH_KEY = 'concept-key1:nonce-cough';
  const BRONCHITIS_KEY = 'concept-key1:nonce-bronchitis';
  const OTHER_KEY = 'concept-key1:nonce-other';
  const WHEEZE = 'wheeze';
  const WHEEZE_KEY = 'concept-key1:nonce-wheeze';

  type KeyedEdge = ConceptRelation & { readonly fromKey?: string; readonly toKey?: string };

  function causesEdge(from: string, to: string, keys?: { from: string; to: string }): KeyedEdge {
    return {
      type: 'causes',
      from,
      to,
      ...(keys === undefined ? {} : { fromKey: keys.from, toKey: keys.to }),
      provenance: 'model-proposed',
      confidence: 0.8,
      introducingPassages: {
        from: { sourcePath: 'course/note.md', location: { page: 1 } },
        to: { sourcePath: 'course/note.md', location: { page: 1 } },
      },
    };
  }

  /** The cough causes bronchitis edge as the corpus stage produces it: wordings, and their keys beside them. */
  const keyedEdge = (): KeyedEdge =>
    causesEdge(COUGH, BRONCHITIS, { from: COUGH_KEY, to: BRONCHITIS_KEY });

  function conceptRecord(name: string, key: string): ConceptRecord {
    return {
      key,
      name,
      aliases: [],
      courses: [],
      sources: [],
      firstSeen: '2026-08-01T00:00:00.000Z',
    } as unknown as ConceptRecord;
  }

  const RECORDS: readonly ConceptRecord[] = [
    conceptRecord(COUGH, COUGH_KEY),
    conceptRecord(BRONCHITIS, BRONCHITIS_KEY),
    conceptRecord(WHEEZE, WHEEZE_KEY),
  ];

  function relationSetEntry(
    edge: ConceptRelation,
    evidence: RelationSetEntry['evidence'],
  ): RelationSetEntry {
    return {
      key: `${edge.type}\u0000${edge.from}\u0000${edge.to}`,
      stage: 'corpus',
      edge,
      triageStanding: 'candidate',
      evidence,
      attestations: [edge],
    };
  }

  function relationSetOf(entries: readonly RelationSetEntry[]): RelationSet {
    return { entries, mergedDuplicates: 0, contradictions: 0, droppedUnemittable: 0 };
  }

  function depsFor(relations: RelationSet | null) {
    return { relations: () => relations, conceptRecords: () => RECORDS };
  }

  it('a current causes edge between the subject and the named neighbour resolves, whichever end the subject is', () => {
    const edge = keyedEdge();
    const relations = relationSetOf([relationSetEntry(edge, 'current')]);

    expect(resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, COUGH_KEY)).toEqual(
      edge,
    );
    expect(resolveExplainBackRelationEdge(depsFor(relations), COUGH_KEY, BRONCHITIS_KEY)).toEqual(
      edge,
    );
  });

  it('an edge that carries its own keys resolves with no concept records at all', () => {
    const edge = keyedEdge();
    const relations = relationSetOf([relationSetEntry(edge, 'current')]);

    expect(
      resolveExplainBackRelationEdge({ relations: () => relations }, BRONCHITIS_KEY, COUGH_KEY),
    ).toEqual(edge);
  });

  it('an edge with wordings only (an older replay) resolves through the exact name join over the concept records', () => {
    const edge = causesEdge(COUGH, BRONCHITIS);
    const relations = relationSetOf([relationSetEntry(edge, 'current')]);

    expect(resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, COUGH_KEY)).toEqual(
      edge,
    );
  });

  it('an endpoint that resolves to no key never matches: wordings only and no records is no partner', () => {
    const relations = relationSetOf([relationSetEntry(causesEdge(COUGH, BRONCHITIS), 'current')]);

    expect(
      resolveExplainBackRelationEdge({ relations: () => relations }, BRONCHITIS_KEY, COUGH_KEY),
    ).toBeUndefined();
    expect(
      resolveExplainBackRelationEdge(
        { relations: () => relations, conceptRecords: () => [] },
        BRONCHITIS_KEY,
        COUGH_KEY,
      ),
    ).toBeUndefined();
  });

  it('a wording is not an identity: the same edge does not resolve when the ids are the wordings', () => {
    const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);

    expect(resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS, COUGH)).toBeUndefined();
  });

  it('an edge between the subject and some other concept is not the edge for the named pair', () => {
    const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);

    expect(
      resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, OTHER_KEY),
    ).toBeUndefined();
  });

  // Beside the current case directly above: same edge shape, only
  // `evidence` differs — a stale endpoint is excluded, never served, exactly
  // as if no edge existed at all (Default 4's abstention).
  it('a stale causes edge between the same pair is excluded, resolving to undefined', () => {
    const relations = relationSetOf([relationSetEntry(keyedEdge(), 'stale')]);

    expect(
      resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, COUGH_KEY),
    ).toBeUndefined();
  });

  it.each(['contrasts-with', 'prerequisite'] as const)(
    'a current %s edge between the same pair is not served here: no clause has this reader consume it',
    (type) => {
      const relations = relationSetOf([relationSetEntry({ ...keyedEdge(), type }, 'current')]);

      expect(
        resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, COUGH_KEY),
      ).toBeUndefined();
    },
  );

  it('no candidate edge for the pair at all resolves to undefined, unaffected by freshness', () => {
    const relations = relationSetOf([]);

    expect(
      resolveExplainBackRelationEdge(depsFor(relations), BRONCHITIS_KEY, COUGH_KEY),
    ).toBeUndefined();
  });

  it('an absent relations reader (no production caller wired yet) resolves to undefined, never throws', () => {
    expect(resolveExplainBackRelationEdge({}, BRONCHITIS_KEY, COUGH_KEY)).toBeUndefined();
  });

  it('a null RelationSet (no corpus-relation batch has folded one in yet) resolves to undefined', () => {
    expect(
      resolveExplainBackRelationEdge(depsFor(null), BRONCHITIS_KEY, COUGH_KEY),
    ).toBeUndefined();
  });

  describe('resolveExplainBackCausesPartner: the neighbour is the OTHER end from the subject', () => {
    it('a subject on the effect side has the cause as its neighbour, by key and by wording', () => {
      const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);

      const partner = resolveExplainBackCausesPartner(depsFor(relations), BRONCHITIS_KEY);

      expect(partner?.neighbourConceptId).toBe(COUGH_KEY);
      expect(partner?.neighbourName).toBe(COUGH);
      expect(partner?.edge).toEqual(keyedEdge());
    });

    it('a subject on the cause side has the effect as its neighbour, never itself', () => {
      const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);

      const partner = resolveExplainBackCausesPartner(depsFor(relations), COUGH_KEY);

      expect(partner?.neighbourConceptId).toBe(BRONCHITIS_KEY);
      expect(partner?.neighbourName).toBe(BRONCHITIS);
    });

    it('an edge of wordings only resolves the same way through the name join', () => {
      const relations = relationSetOf([relationSetEntry(causesEdge(COUGH, BRONCHITIS), 'current')]);

      const partner = resolveExplainBackCausesPartner(depsFor(relations), COUGH_KEY);

      expect(partner?.neighbourConceptId).toBe(BRONCHITIS_KEY);
      expect(partner?.neighbourName).toBe(BRONCHITIS);
    });

    it('the neighbour’s wording is the record’s current one, which can differ from the wording the edge was minted with', () => {
      const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);
      const renamed = {
        relations: () => relations,
        conceptRecords: () => [
          conceptRecord(COUGH, COUGH_KEY),
          conceptRecord('acute bronchitis', BRONCHITIS_KEY),
        ],
      };

      const partner = resolveExplainBackCausesPartner(renamed, COUGH_KEY);

      expect(partner?.neighbourConceptId).toBe(BRONCHITIS_KEY);
      expect(partner?.neighbourName).toBe('acute bronchitis');
    });

    it('a neighbour with no concept record has no wording to retrieve by and is not a partner', () => {
      const relations = relationSetOf([relationSetEntry(keyedEdge(), 'current')]);
      const missingNeighbour = {
        relations: () => relations,
        conceptRecords: () => [conceptRecord(COUGH, COUGH_KEY)],
      };

      expect(resolveExplainBackCausesPartner(missingNeighbour, COUGH_KEY)).toBeUndefined();
    });

    it('other edge types touching the subject are skipped, and the causes edge after them is found', () => {
      const relations = relationSetOf([
        relationSetEntry({ ...causesEdge(COUGH, WHEEZE), type: 'prerequisite' }, 'current'),
        relationSetEntry(
          {
            ...causesEdge(COUGH, WHEEZE, { from: COUGH_KEY, to: WHEEZE_KEY }),
            type: 'contrasts-with',
          },
          'current',
        ),
        relationSetEntry(keyedEdge(), 'current'),
      ]);

      const partner = resolveExplainBackCausesPartner(depsFor(relations), COUGH_KEY);

      expect(partner?.neighbourConceptId).toBe(BRONCHITIS_KEY);
      expect(partner?.edge.type).toBe('causes');
    });

    it('a stale edge, an absent reader and a null graph all yield no partner', () => {
      const stale = relationSetOf([relationSetEntry(keyedEdge(), 'stale')]);

      expect(resolveExplainBackCausesPartner(depsFor(stale), COUGH_KEY)).toBeUndefined();
      expect(resolveExplainBackCausesPartner({}, COUGH_KEY)).toBeUndefined();
      expect(resolveExplainBackCausesPartner(depsFor(null), COUGH_KEY)).toBeUndefined();
    });
  });
});

describe('matchFreeformTopicToConcept ([D-322])', () => {
  function candidate(
    overrides: Partial<FreeformTopicConceptCandidate> = {},
  ): FreeformTopicConceptCandidate {
    return { conceptId: 'concept-a', names: ['Mitosis'], courses: ['BIO101'], ...overrides };
  }

  it('a unique exact match (case- and whitespace-insensitive) resolves to that concept id', () => {
    const result = matchFreeformTopicToConcept(
      '  mitosis  ',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis'] })],
      null,
    );
    expect(result).toEqual({ kind: 'unique', conceptId: 'concept-a' });
  });

  it('matches against any of a candidate’s names — display name, prior names or aliases alike', () => {
    const result = matchFreeformTopicToConcept(
      'cell division',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis', 'Cell division'] })],
      null,
    );
    expect(result).toEqual({ kind: 'unique', conceptId: 'concept-a' });
  });

  it('nothing matches: no-match, never a guess', () => {
    const result = matchFreeformTopicToConcept(
      'photosynthesis',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis'] })],
      null,
    );
    expect(result).toEqual({ kind: 'no-match' });
  });

  it('never a fuzzy or partial match — a substring of a candidate’s name does not resolve', () => {
    const result = matchFreeformTopicToConcept(
      'mito',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis'] })],
      null,
    );
    expect(result).toEqual({ kind: 'no-match' });
  });

  it('two different concepts sharing one name, with no course known: ambiguous, never a guess', () => {
    const result = matchFreeformTopicToConcept(
      'polymer',
      [
        candidate({ conceptId: 'concept-chem', names: ['Polymer'], courses: ['CHEM101'] }),
        candidate({ conceptId: 'concept-bio', names: ['Polymer'], courses: ['BIO101'] }),
      ],
      null,
    );
    expect(result).toEqual({ kind: 'ambiguous', conceptIds: ['concept-chem', 'concept-bio'] });
  });

  it('course-aware: knowing the course narrows a same-named pair to a unique match', () => {
    const candidates = [
      candidate({ conceptId: 'concept-chem', names: ['Polymer'], courses: ['CHEM101'] }),
      candidate({ conceptId: 'concept-bio', names: ['Polymer'], courses: ['BIO101'] }),
    ];

    expect(matchFreeformTopicToConcept('polymer', candidates, 'BIO101')).toEqual({
      kind: 'unique',
      conceptId: 'concept-bio',
    });
    expect(matchFreeformTopicToConcept('polymer', candidates, 'CHEM101')).toEqual({
      kind: 'unique',
      conceptId: 'concept-chem',
    });
  });

  it('a course code that matches no candidate at all is no-match, not a fallback to the wider set', () => {
    const result = matchFreeformTopicToConcept(
      'mitosis',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis'], courses: ['BIO101'] })],
      'CHEM101',
    );
    expect(result).toEqual({ kind: 'no-match' });
  });

  it('a concept taught in several courses matches once, by id, not once per course row', () => {
    const result = matchFreeformTopicToConcept(
      'mitosis',
      [candidate({ conceptId: 'concept-a', names: ['Mitosis'], courses: ['BIO101', 'BIO102'] })],
      null,
    );
    expect(result).toEqual({ kind: 'unique', conceptId: 'concept-a' });
  });

  it('an empty candidate list is no-match, never throws', () => {
    expect(matchFreeformTopicToConcept('mitosis', [], null)).toEqual({ kind: 'no-match' });
  });
});

describe('shouldRunExplainBackDepthPass ([D-286])', () => {
  it('runs the depth pass for a correct verdict', () => {
    expect(shouldRunExplainBackDepthPass('correct')).toBe(true);
  });

  it("runs the depth pass for a partial verdict too, per the ruling's own carve-out", () => {
    expect(shouldRunExplainBackDepthPass('partial')).toBe(true);
  });

  it('skips the depth pass for a clearly incorrect verdict', () => {
    expect(shouldRunExplainBackDepthPass('incorrect')).toBe(false);
  });
});
