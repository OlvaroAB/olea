/**
 * `ol-egov.141.89.4.23` (`[D-296]`; row 40 of the 2026-09-29 decision-sheet responses): the
 * corpus stage now offers `causes`, so the relation-aware explain-back partner reader
 * (`explain-back/request.ts`'s `resolveExplainBackCausesPartner` and
 * `resolveExplainBackRelationEdge`, reached from `main.ts`'s `resolveExplainBackCausesPartner`
 * through `modal.ts`'s `resolveGradingSourceBlocks`) can finally be handed a causes edge that
 * production produced. Every sibling spec in this directory hand-builds its `ConceptRelation`;
 * this file's job is the one link none of them covers: an edge that comes out of the REAL corpus
 * stage (`runCorpusRelationBatch` -> `reconcileCorpusVerdicts`), through the REAL fold
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
 * **Identity: every id below is a concept KEY, the way production hands it (`ol-egov.141.89.6.74`).**
 * The subject id is `instrument.conceptIds[0]`, the opaque `ConceptRecord.key` (`ol-63e1`,
 * `core/src/session/enumerate.ts`), while `ConceptRelation.from`/`.to` are wordings, with the keys
 * only on `fromKey`/`toKey`. An earlier revision of this file handed the reader the WORDINGS as
 * ids and built edges with no keys, so the two sides of the comparison were the same string and
 * the reader could not fail; production never does that, and the reader could never resolve a
 * partner there. The concept records carry keys that equal no wording, and the edges carry keys.
 *
 * INV-3: every string is coined. No course code, note title or wording from any real vault.
 */

import {
  buildGradingSourceMaterial,
  buildSchedulingObservationField,
  type ConceptRecord,
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
import {
  resolveExplainBackCausesPartner,
  resolveExplainBackRelationEdge,
} from '../../src/explain-back/request.js';

const CAUSE = 'Sustained heating';
const EFFECT = 'Volume expansion';

/** Minted through the one opaque-key seam production uses, with a fixed nonce so the value is stable: `concept-key1:<nonce>`, never equal to any wording. */
const CAUSE_KEY = mintOpaqueConceptKey(() => 'nonce-3f9a-cause');
const EFFECT_KEY = mintOpaqueConceptKey(() => 'nonce-7c21-effect');

function concept(name: string, key: string, sourcePath: string): CorpusConcept {
  return {
    name,
    key,
    aliases: [],
    anchor: { sourcePath, location: { page: 1, charRange: { start: 0, end: 40 } } },
  };
}

/** The plugin's live concept records (main.ts's `this.conceptRecords`): a key and a wording each. */
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
  conceptRecord(CAUSE, CAUSE_KEY),
  conceptRecord(EFFECT, EFFECT_KEY),
];

function portReturning(verdicts: readonly CorpusVerdict[]): CorpusRelationVerdictPort {
  return { verdict: async () => ({ verdicts }) };
}

/**
 * The corpus stage exactly as production runs it (`corpusConceptsFrom` threads `ReadConcept.key`
 * onto every candidate, `ol-282w`), each verdict echoing its candidates' keys as the wire adapter
 * does (`a` is the cause concept, `b` the effect concept in every verdict below), folded the way
 * the ingestion tick folds it.
 */
async function foldedRelationSet(verdicts: readonly CorpusVerdict[]): Promise<RelationSet> {
  const cause = concept(CAUSE, CAUSE_KEY, 'Lecture 3.md');
  const effect = concept(EFFECT, EFFECT_KEY, 'Lecture 4.md');
  const result = await runCorpusRelationBatch(
    portReturning(verdicts.map((verdict) => ({ ...verdict, aKey: CAUSE_KEY, bKey: EFFECT_KEY }))),
    {
      newConcepts: [cause],
      allConcepts: [cause, effect],
      signals: [{ kind: 'embedding-proximity', a: CAUSE, b: EFFECT }],
      passageText: (c) => `passage text for ${c.name}`,
    },
  );
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

/** What main.ts hands the reader: both live reads, as thunks. */
function depsFor(set: RelationSet) {
  return { relations: () => set, conceptRecords: () => RECORDS };
}

/** An older edge, replayed from a record written before either stage threaded keys through: wordings only. */
function withoutEndpointKeys(set: RelationSet): RelationSet {
  return {
    ...set,
    entries: set.entries.map((entry) => {
      const {
        fromKey: _fromKey,
        toKey: _toKey,
        ...bare
      } = entry.edge as ConceptRelation & {
        readonly fromKey?: string;
        readonly toKey?: string;
      };
      return { ...entry, edge: bare, attestations: [bare] };
    }),
  };
}

describe('the partner reader receives a causes relation the corpus stage produced (ol-egov.141.89.4.23)', () => {
  it('resolves the edge with the subject as the effect, and with the subject as the cause', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const asEffect = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);
    const asCause = resolveExplainBackRelationEdge(depsFor(set), CAUSE_KEY, EFFECT_KEY);

    expect(asEffect?.type).toBe('causes');
    expect(asCause).toEqual(asEffect);
  });

  it('what it receives reads a-to-b as cause to effect and records both endpoints’ introducing passages', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const edge = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);

    expect(edge?.from).toBe(CAUSE);
    expect(edge?.to).toBe(EFFECT);
    expect(edge?.provenance).toBe('model-proposed');
    expect(edge?.introducingPassages.from.sourcePath).toBe('Lecture 3.md');
    expect(edge?.introducingPassages.to.sourcePath).toBe('Lecture 4.md');
  });

  it('a b-to-a verdict is received the other way round: the second concept is the cause', async () => {
    const set = await foldedRelationSet([{ ...CAUSES_A_TO_B, direction: 'b-to-a' }]);

    const edge = resolveExplainBackRelationEdge(depsFor(set), CAUSE_KEY, EFFECT_KEY);

    expect(edge?.from).toBe(EFFECT);
    expect(edge?.to).toBe(CAUSE);
  });

  it('abstains once the edge is stale: a stale causes edge is not served, exactly as if none existed', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    expect(
      resolveExplainBackRelationEdge(depsFor(withEvidence(set, 'stale')), EFFECT_KEY, CAUSE_KEY),
    ).toBeUndefined();
    // The same set, current, is served — so the abstention above is the gate, not an empty set.
    expect(
      resolveExplainBackRelationEdge(depsFor(withEvidence(set, 'current')), EFFECT_KEY, CAUSE_KEY),
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
    expect(resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY)).toBeUndefined();
    expect(resolveExplainBackCausesPartner(depsFor(set), EFFECT_KEY)).toBeUndefined();
    expect(resolveExplainBackCausesPartner(depsFor(set), CAUSE_KEY)).toBeUndefined();
  });

  it('receives nothing from a causes verdict that named no direction: the corpus stage never mints it', async () => {
    const set = await foldedRelationSet([{ a: CAUSE, b: EFFECT, type: 'causes', confidence: 0.9 }]);

    expect(set.entries).toEqual([]);
    expect(resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY)).toBeUndefined();
  });

  it('a pair the corpus stage judged unrelated leaves the reader with no partner (the ordinary concept-only prompt)', async () => {
    const set = await foldedRelationSet([]);

    expect(resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY)).toBeUndefined();
    expect(resolveExplainBackCausesPartner(depsFor(set), EFFECT_KEY)).toBeUndefined();
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

/** Composes the material for the effect concept as the subject and the cause as its neighbour, both by key. */
function materialFor(edge: ConceptRelation | undefined) {
  const named =
    edge === undefined
      ? { neighbourConceptId: CAUSE_KEY, edge: undefined }
      : {
          neighbourConceptId: CAUSE_KEY,
          edge: {
            evidence: 'current' as const,
            provenance: edge.provenance,
            introducingPassages: edgeProvenanceBlocks(edge),
          },
        };
  const relation = resolveGradingRelationContext(named);
  return buildGradingSourceMaterial({
    subject: { subjectConceptId: EFFECT_KEY },
    subjectDefiningPassages: { conceptId: EFFECT_KEY, passages: SUBJECT_PASSAGES },
    relation,
    neighbourDefiningPassages: { conceptId: CAUSE_KEY, passages: NEIGHBOUR_PASSAGES },
  });
}

describe('what the grader is handed for a corpus-produced causes partner (F5.2a, F5.3, F5.3a)', () => {
  it('F5.2a: the subject’s passages, the edge’s own passages and the neighbour’s passages, in that order', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const edge = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);
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
    const edge = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);

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
    const edge = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);
    expect(edge).toBeUndefined();

    // With no served edge the prompt still names no partner from the graph; the composition step
    // then runs its no-edge branch (`resolveRelationProvenance(undefined)`).
    const material = materialFor(undefined);

    expect(material.omissionDenominator).toBeNull();
    expect(material.candidateEdgeNomination).toEqual({
      subjectConceptId: EFFECT_KEY,
      neighbourConceptId: CAUSE_KEY,
    });
  });

  it('C5.11 / F5.3a: the neighbour’s demonstrated use is a scheduling observation carrying only its concept id — the scoring subject is unchanged', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const edge = resolveExplainBackRelationEdge(depsFor(set), EFFECT_KEY, CAUSE_KEY);
    const material = materialFor(edge);

    const observation = buildSchedulingObservationField({
      neighbourUseDemonstrated: true,
      neighbourConceptId: CAUSE_KEY,
    });

    expect(observation).toEqual({ neighbourConceptId: CAUSE_KEY });
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

describe('the partner reader is given production identities: the subject and neighbour are concept keys (ol-egov.141.89.6.74)', () => {
  it('what the corpus stage produces names the endpoints by wording and carries their keys beside them, and no key equals a name', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const edge = set.entries[0]?.edge as ConceptRelation & {
      readonly fromKey?: string;
      readonly toKey?: string;
    };

    expect([edge.from, edge.to]).toEqual([CAUSE, EFFECT]);
    expect([edge.fromKey, edge.toKey]).toEqual([CAUSE_KEY, EFFECT_KEY]);
    // The fact that hid the defect: a comparison of a wording with a key can never hold.
    expect(CAUSE_KEY).not.toBe(CAUSE);
    expect(EFFECT_KEY).not.toBe(EFFECT);
  });

  // The two bodies below were `it.fails` (committed with the proof, olea `6bb66b4`) until the fix
  // landed: an edge is a partner of a subject when the subject's KEY is the edge's key at one end.
  it('finds the edge for a subject given by its key, whichever end of the edge the subject is', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    // No concept records at all: the edge carries its own keys, so it resolves on them alone.
    const asEffect = resolveExplainBackRelationEdge(
      { relations: () => set },
      EFFECT_KEY,
      CAUSE_KEY,
    );
    const asCause = resolveExplainBackRelationEdge({ relations: () => set }, CAUSE_KEY, EFFECT_KEY);

    expect(asEffect?.type).toBe('causes');
    expect(asCause).toEqual(asEffect);
  });

  it('a stale edge is still withheld and a current one served, when the ids are keys', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

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

  it('a wording is not an identity: the same edge is not found when the subject is given by its name', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    expect(resolveExplainBackRelationEdge(depsFor(set), EFFECT, CAUSE)).toBeUndefined();
    expect(resolveExplainBackCausesPartner(depsFor(set), EFFECT)).toBeUndefined();
  });

  it('a concept the edge does not touch has no partner', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const other = mintOpaqueConceptKey(() => 'nonce-0000-other');

    expect(resolveExplainBackCausesPartner(depsFor(set), other)).toBeUndefined();
  });
});

describe('the neighbour is the OTHER end from the subject, named by key and by wording (ol-egov.141.89.6.74)', () => {
  it('a subject on the effect side has the cause as its neighbour', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const partner = resolveExplainBackCausesPartner(depsFor(set), EFFECT_KEY);

    expect(partner?.neighbourConceptId).toBe(CAUSE_KEY);
    expect(partner?.neighbourName).toBe(CAUSE);
    expect(partner?.edge.type).toBe('causes');
  });

  it('a subject on the cause side has the effect as its neighbour, never itself', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    const partner = resolveExplainBackCausesPartner(depsFor(set), CAUSE_KEY);

    expect(partner?.neighbourConceptId).toBe(EFFECT_KEY);
    expect(partner?.neighbourName).toBe(EFFECT);
    expect(partner?.neighbourConceptId).not.toBe(CAUSE_KEY);
  });

  it('the neighbour follows the subject, not the edge’s direction: a b-to-a verdict changes the edge, not who the neighbour is', async () => {
    const set = await foldedRelationSet([{ ...CAUSES_A_TO_B, direction: 'b-to-a' }]);

    expect(resolveExplainBackCausesPartner(depsFor(set), EFFECT_KEY)?.neighbourConceptId).toBe(
      CAUSE_KEY,
    );
    expect(resolveExplainBackCausesPartner(depsFor(set), CAUSE_KEY)?.neighbourConceptId).toBe(
      EFFECT_KEY,
    );
  });

  it('the wording is a retrieval query and the key is the identity: the material built from a cause-side subject is named by keys throughout', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const partner = resolveExplainBackCausesPartner(depsFor(set), CAUSE_KEY);
    expect(partner).toBeDefined();
    if (partner === undefined) return;

    // What modal.ts does with a partner: the wording goes to retrieval, the key to everything
    // that identifies. `buildGradingSourceMaterial` checks each passage record names the id it
    // was given, so a wording standing in for a key would throw here.
    const relation = resolveGradingRelationContext({
      neighbourConceptId: partner.neighbourConceptId,
      edge: {
        evidence: 'current',
        provenance: partner.edge.provenance,
        introducingPassages: edgeProvenanceBlocks(partner.edge),
      },
    });
    const material = buildGradingSourceMaterial({
      subject: { subjectConceptId: CAUSE_KEY },
      subjectDefiningPassages: { conceptId: CAUSE_KEY, passages: SUBJECT_PASSAGES },
      relation,
      neighbourDefiningPassages: {
        conceptId: partner.neighbourConceptId,
        passages: NEIGHBOUR_PASSAGES,
      },
    });

    expect(relation).toMatchObject({ kind: 'relation', neighbourConceptId: EFFECT_KEY });
    expect(material.omissionDenominator).toEqual([
      ...SUBJECT_PASSAGES,
      ...edgeProvenanceBlocks(partner.edge),
    ]);
  });

  it('an edge with no keys of its own (an older replay) resolves through the exact name join over the concept records, and only with them', async () => {
    const set = withoutEndpointKeys(await foldedRelationSet([CAUSES_A_TO_B]));

    const partner = resolveExplainBackCausesPartner(depsFor(set), EFFECT_KEY);

    expect(partner?.neighbourConceptId).toBe(CAUSE_KEY);
    expect(partner?.neighbourName).toBe(CAUSE);
    expect(
      resolveExplainBackRelationEdge({ relations: () => set }, EFFECT_KEY, CAUSE_KEY),
    ).toBeUndefined();
  });

  it('a neighbour that matches no concept record has no wording to retrieve by and is not a partner', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);
    const onlyTheSubject = {
      relations: () => set,
      conceptRecords: () => [RECORDS[1] as ConceptRecord],
    };

    expect(resolveExplainBackCausesPartner(onlyTheSubject, EFFECT_KEY)).toBeUndefined();
  });

  it('a stale edge yields no partner, and neither does an absent or empty graph', async () => {
    const set = await foldedRelationSet([CAUSES_A_TO_B]);

    expect(
      resolveExplainBackCausesPartner(depsFor(withEvidence(set, 'stale')), EFFECT_KEY),
    ).toBeUndefined();
    expect(resolveExplainBackCausesPartner({}, EFFECT_KEY)).toBeUndefined();
    expect(
      resolveExplainBackCausesPartner(
        { relations: () => null, conceptRecords: () => RECORDS },
        EFFECT_KEY,
      ),
    ).toBeUndefined();
  });
});
