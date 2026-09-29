/**
 * `ol-egov.141.89.4.23` (`[D-296]`; row 40 of the 2026-09-29 decision-sheet responses): the
 * corpus stage now offers `causes`, so the relation-aware explain-back partner reader
 * (`explain-back/request.ts`'s `resolveExplainBackRelationEdge`, reached from
 * `main.ts`'s `resolveExplainBackCausesPartner` through `modal.ts`'s
 * `resolveGradingSourceBlocks`) can finally be handed a causes edge that production produced.
 * Every sibling spec in this directory hand-builds its `ConceptRelation`; this file's job is the
 * one link none of them covers: an edge that comes out of the REAL corpus stage
 * (`runCorpusRelationBatch` -> `reconcileCorpusVerdicts`), through the REAL fold
 * (`deriveRelationSet`), is what the reader receives, and what the grader is then handed follows
 * the ruling and nothing wider.
 *
 * What "only as the ruling allows" means here, each line a clause:
 * - F5.2a: the grader is handed the subject's defining passages, the edge's own provenance
 *   passages and the neighbour's defining passages — a lookup over what the edge records.
 * - F5.3: the omission denominator is the subject's material plus the edge's provenance, never
 *   the neighbour's defining passages; with no usable edge the denominator is undefined (`null`),
 *   never an invented one.
 * - F5.3a / C5.11: the neighbour is context. Its demonstrated use is a scheduling observation
 *   carrying only its concept id; the scoring subject never changes.
 * - rel.md section 3 Default 4: a stale edge is not served — the reader abstains, and the grader
 *   sees the "no edge" case.
 *
 * `modal.ts` and `main.ts` import `obsidian` and cannot be loaded under Vitest (see
 * `relation-composition-root.spec.ts`, which pins their call shape at source level, and
 * `resolve-grading-source-blocks-introducing-passages.spec.ts`). So the modal's own composition
 * step is exercised here through the same exported core functions it calls
 * (`resolveGradingRelationContext`, `buildGradingSourceMaterial`), never re-implemented, fed
 * with what the real reader returned. No model call, no network.
 *
 * **Identity, and why the first describe below is not enough on its own (`ol-egov.141.89.6.71`,
 * open question; bug bead `ol-egov.141.89.6.74`).** The first two describes hand the reader
 * concept NAMES as the subject and neighbour ids (`EFFECT`, `CAUSE`), so an edge endpoint's name
 * and the id compared with it are the same string and the comparison cannot fail. Production
 * never does that: the subject id is `instrument.conceptIds[0]`, the opaque `ConceptRecord.key`
 * (`ol-63e1`, `core/src/session/enumerate.ts`), while `ConceptRelation.from`/`.to` are names, with
 * the keys only on `fromKey`/`toKey`. The third describe uses those production identities.
 *
 * INV-3: every string is coined. No course code, note title or wording from any real vault.
 */

import {
  buildGradingSourceMaterial,
  buildSchedulingObservationField,
  type ConceptRelation,
  type CorpusConcept,
  type CorpusRelationVerdictPort,
  type CorpusVerdict,
  deriveRelationSet,
  mintOpaqueConceptKey,
  type RelationSet,
  resolveGradingRelationContext,
  runCorpusRelationBatch,
  type SourceBlockRef,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { resolveExplainBackRelationEdge } from '../../src/explain-back/request.js';

const CAUSE = 'Sustained heating';
const EFFECT = 'Volume expansion';

function concept(name: string, sourcePath: string): CorpusConcept {
  return {
    name,
    aliases: [],
    anchor: { sourcePath, location: { page: 1, charRange: { start: 0, end: 40 } } },
  };
}

function portReturning(verdicts: readonly CorpusVerdict[]): CorpusRelationVerdictPort {
  return { verdict: async () => ({ verdicts }) };
}

/** Runs the real corpus stage over one nominated pair and folds its output exactly as the plugin's ingestion tick does. */
async function foldedRelationSet(verdicts: readonly CorpusVerdict[]): Promise<RelationSet> {
  const result = await runCorpusRelationBatch(portReturning(verdicts), {
    newConcepts: [concept(CAUSE, 'Lecture 3.md')],
    allConcepts: [concept(CAUSE, 'Lecture 3.md'), concept(EFFECT, 'Lecture 4.md')],
    signals: [{ kind: 'embedding-proximity', a: CAUSE, b: EFFECT }],
    passageText: (c) => `passage text for ${c.name}`,
  });
  return deriveRelationSet([], result.relations);
}

const CAUSES_A_TO_B: CorpusVerdict = {
  a: CAUSE,
  b: EFFECT,
  type: 'causes',
  direction: 'a-to-b',
  confidence: 0.8,
};

/** The whole set's evidence state changed, the way per-endpoint freshness does it for an edited source (rel.md section 3 Default 4). */
function withEvidence(set: RelationSet, evidence: 'current' | 'stale'): RelationSet {
  return { ...set, entries: set.entries.map((entry) => ({ ...entry, evidence })) };
}

describe('the partner reader receives a causes relation the corpus stage produced (ol-egov.141.89.4.23)', () => {
  it('resolves the edge with the subject as the effect, and with the subject as the cause', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const asEffect = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);
    const asCause = resolveExplainBackRelationEdge({ relations: () => set }, CAUSE, EFFECT);

    expect(asEffect?.type).toBe('causes');
    expect(asCause).toEqual(asEffect);
  });

  it('what it receives reads a-to-b as cause to effect and records both endpoints’ introducing passages', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const edge = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);

    expect(edge?.from).toBe(CAUSE);
    expect(edge?.to).toBe(EFFECT);
    expect(edge?.provenance).toBe('model-proposed');
    expect(edge?.introducingPassages.from.sourcePath).toBe('Lecture 3.md');
    expect(edge?.introducingPassages.to.sourcePath).toBe('Lecture 4.md');
  });

  it('a b-to-a verdict is received the other way round: the second concept is the cause', async () => {
    const set = await foldedRelationSet([{ ...CAUSES_A_TO_B, direction: 'b-to-a' }]);

    const edge = resolveExplainBackRelationEdge({ relations: () => set }, CAUSE, EFFECT);

    expect(edge?.from).toBe(EFFECT);
    expect(edge?.to).toBe(CAUSE);
  });

  it('abstains once the edge is stale: a stale causes edge is not served, exactly as if none existed', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    expect(
      resolveExplainBackRelationEdge(
        { relations: () => withEvidence(set, 'stale') },
        EFFECT,
        CAUSE,
      ),
    ).toBeUndefined();
    // The same set, current, is served — so the abstention above is the gate, not an empty set.
    expect(
      resolveExplainBackRelationEdge(
        { relations: () => withEvidence(set, 'current') },
        EFFECT,
        CAUSE,
      ),
    ).toBeDefined();
  });

  it('does not treat a prerequisite or a contrasts-with verdict on the same pair as a causes partner', async () => {
    const set = await foldedRelationSet([
      { a: CAUSE, b: EFFECT, type: 'prerequisite', direction: 'a-to-b', confidence: 0.7 },
      { a: CAUSE, b: EFFECT, type: 'contrasts-with', confidence: 0.6 },
    ]);

    expect(set.entries.map((entry) => entry.edge.type).sort()).toEqual([
      'contrasts-with',
      'prerequisite',
    ]);
    expect(resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE)).toBeUndefined();
  });

  it('receives nothing from a causes verdict that named no direction: the corpus stage never mints it', async () => {
    const set = await foldedRelationSet([{ a: CAUSE, b: EFFECT, type: 'causes', confidence: 0.9 }]);

    expect(set.entries).toEqual([]);
    expect(resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE)).toBeUndefined();
  });

  it('a pair the corpus stage judged unrelated leaves the reader with no partner (the ordinary concept-only prompt)', async () => {
    const set = await foldedRelationSet([]);

    expect(resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// What the grader is handed once the reader has returned the edge
// ---------------------------------------------------------------------------

const SUBJECT_PASSAGES: readonly SourceBlockRef[] = [
  { blockId: 'subject-defining-1', text: 'The subject concept, defined.' },
];
const NEIGHBOUR_PASSAGES: readonly SourceBlockRef[] = [
  { blockId: 'neighbour-defining-1', text: 'The neighbour concept, defined on its own terms.' },
];

/** The edge's own introducing passages, resolved to citable blocks the way `modal.ts`'s `resolveEdgeIntroducingPassages` does through its port — one block per endpoint. */
function edgeProvenanceBlocks(edge: ConceptRelation): readonly SourceBlockRef[] {
  return [edge.introducingPassages.from, edge.introducingPassages.to].map((provenance) => ({
    blockId: `${provenance.sourcePath}#edge`,
    text: `edge passage from ${provenance.sourcePath}`,
  }));
}

function materialFor(edge: ConceptRelation | undefined) {
  const named =
    edge === undefined
      ? { neighbourConceptId: CAUSE, edge: undefined }
      : {
          neighbourConceptId: CAUSE,
          edge: {
            evidence: 'current' as const,
            provenance: edge.provenance,
            introducingPassages: edgeProvenanceBlocks(edge),
          },
        };
  const relation = resolveGradingRelationContext(named);
  return buildGradingSourceMaterial({
    subject: { subjectConceptId: EFFECT },
    subjectDefiningPassages: { conceptId: EFFECT, passages: SUBJECT_PASSAGES },
    relation,
    neighbourDefiningPassages: { conceptId: CAUSE, passages: NEIGHBOUR_PASSAGES },
  });
}

describe('what the grader is handed for a corpus-produced causes partner (F5.2a, F5.3, F5.3a)', () => {
  it('F5.2a: the subject’s passages, the edge’s own passages and the neighbour’s passages, in that order', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const edge = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);
    expect(edge).toBeDefined();

    const material = materialFor(edge);

    expect(material.sourceBlocks).toEqual([
      ...SUBJECT_PASSAGES,
      ...edgeProvenanceBlocks(edge as ConceptRelation),
      ...NEIGHBOUR_PASSAGES,
    ]);
    expect(material.candidateEdgeNomination).toBeNull();
  });

  it('F5.3: the omission denominator is the subject’s material plus the edge’s provenance — never the neighbour’s defining passages', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const edge = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);

    const material = materialFor(edge);

    expect(material.omissionDenominator).toEqual([
      ...SUBJECT_PASSAGES,
      ...edgeProvenanceBlocks(edge as ConceptRelation),
    ]);
    for (const block of NEIGHBOUR_PASSAGES) {
      expect(material.omissionDenominator).not.toContainEqual(block);
    }
  });

  it('a stale edge is the "no edge" case: omission scoring is undefined (null, not empty), and the event is a record-only candidate nomination', async () => {
    const set = withEvidence(await foldedRelationSet([CAUSES_A_TO_B]), 'stale');
    const edge = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);
    expect(edge).toBeUndefined();

    // With no served edge the prompt still names no partner from the graph; the composition step
    // then runs its no-edge branch (`resolveRelationProvenance(undefined)`).
    const material = materialFor(undefined);

    expect(material.omissionDenominator).toBeNull();
    expect(material.candidateEdgeNomination).toEqual({
      subjectConceptId: EFFECT,
      neighbourConceptId: CAUSE,
    });
  });

  it('C5.11 / F5.3a: the neighbour’s demonstrated use is a scheduling observation carrying only its concept id — the scoring subject is unchanged', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const edge = resolveExplainBackRelationEdge({ relations: () => set }, EFFECT, CAUSE);
    const material = materialFor(edge);

    const observation = buildSchedulingObservationField({
      neighbourUseDemonstrated: true,
      neighbourConceptId: CAUSE,
    });

    expect(observation).toEqual({ neighbourConceptId: CAUSE });
    expect(Object.keys(observation ?? {})).toEqual(['neighbourConceptId']);
    // The material is exactly three fields — blocks, a denominator, a nomination — and none of
    // them is a place a mastery estimate or a second scoring target could live (R9).
    expect(Object.keys(material).sort()).toEqual([
      'candidateEdgeNomination',
      'omissionDenominator',
      'sourceBlocks',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Production identities: the subject id is a concept record key, not a name
// ---------------------------------------------------------------------------

/** Minted through the one opaque-key seam production uses, with a fixed nonce so the value is stable: `concept-key1:<nonce>`, never equal to any wording. */
const CAUSE_KEY = mintOpaqueConceptKey(() => 'nonce-3f9a-cause');
const EFFECT_KEY = mintOpaqueConceptKey(() => 'nonce-7c21-effect');

function keyedConcept(name: string, key: string, sourcePath: string): CorpusConcept {
  return { ...concept(name, sourcePath), key };
}

/**
 * The corpus stage exactly as production runs it (`corpusConceptsFrom` threads `ReadConcept.key`
 * onto every candidate, `ol-282w`), the verdict echoing each candidate's key as the wire adapter
 * does, folded the way the ingestion tick folds it.
 */
async function foldedKeyedRelationSet(verdict: CorpusVerdict): Promise<RelationSet> {
  const cause = keyedConcept(CAUSE, CAUSE_KEY, 'Lecture 3.md');
  const effect = keyedConcept(EFFECT, EFFECT_KEY, 'Lecture 4.md');
  const result = await runCorpusRelationBatch(portReturning([verdict]), {
    newConcepts: [cause],
    allConcepts: [cause, effect],
    signals: [{ kind: 'embedding-proximity', a: CAUSE, b: EFFECT }],
    passageText: (c) => `passage text for ${c.name}`,
  });
  return deriveRelationSet([], result.relations);
}

const KEYED_CAUSES_A_TO_B: CorpusVerdict = {
  ...CAUSES_A_TO_B,
  aKey: CAUSE_KEY,
  bKey: EFFECT_KEY,
};

describe('the partner reader is given production identities: the subject and neighbour are concept keys (ol-egov.141.89.6.74)', () => {
  it('what the corpus stage produces names the endpoints by wording and carries their keys beside them, and no key equals a name', async () => {
    const set = await foldedKeyedRelationSet(KEYED_CAUSES_A_TO_B);

    const edge = set.entries[0]?.edge as ConceptRelation & {
      readonly fromKey?: string;
      readonly toKey?: string;
    };

    expect([edge.from, edge.to]).toEqual([CAUSE, EFFECT]);
    expect([edge.fromKey, edge.toKey]).toEqual([CAUSE_KEY, EFFECT_KEY]);
    // The fact that hid the defect: the comparison in the reader can only hold if these were equal.
    expect(CAUSE_KEY).not.toBe(CAUSE);
    expect(EFFECT_KEY).not.toBe(EFFECT);
  });

  // KNOWN DEFECT, pinned with `it.fails` so the tree stays green until the fix lands. These two
  // bodies are the required behaviour: an edge is a partner of a subject when the subject's KEY is
  // the edge's key at one end (`fromKey`/`toKey` first, then the name -> key join over the concept
  // records, the order every other relation reader uses). Today `resolveExplainBackRelationEdge`
  // (and `main.ts`'s `resolveExplainBackCausesPartner` before it) compares `edge.from`/`.to` (names)
  // with the key, so the edge is never found. When the fix lands these two go red as "expected to
  // fail, passed": change `it.fails` to `it`.
  it.fails('finds the edge for a subject given by its key, whichever end of the edge the subject is', async () => {
    const set = await foldedKeyedRelationSet(KEYED_CAUSES_A_TO_B);

    const asEffect = resolveExplainBackRelationEdge(
      { relations: () => set },
      EFFECT_KEY,
      CAUSE_KEY,
    );
    const asCause = resolveExplainBackRelationEdge({ relations: () => set }, CAUSE_KEY, EFFECT_KEY);

    expect(asEffect?.type).toBe('causes');
    expect(asCause).toEqual(asEffect);
  });

  it.fails('a stale edge is still withheld and a current one served, when the ids are keys', async () => {
    const set = await foldedKeyedRelationSet(KEYED_CAUSES_A_TO_B);

    expect(
      resolveExplainBackRelationEdge(
        { relations: () => withEvidence(set, 'current') },
        EFFECT_KEY,
        CAUSE_KEY,
      ),
    ).toBeDefined();
    expect(
      resolveExplainBackRelationEdge(
        { relations: () => withEvidence(set, 'stale') },
        EFFECT_KEY,
        CAUSE_KEY,
      ),
    ).toBeUndefined();
  });
});
