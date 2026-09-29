/**
 * `ol-egov.141.89.6.75` (F5.3a, F5.2a, C5.11; `[D-296]`, row 40 of the 2026-09-29 decision-sheet
 * responses): once the causes partner resolves in production (`ol-egov.141.89.6.74`), the depth
 * judge is told a relation is expected and may report that she used the neighbour correctly. The
 * write that records the attempt then needs the neighbour's concept KEY for the F5.3a scheduling
 * observation. Before this bead nothing handed it one, `buildSchedulingObservationField` threw,
 * `modal.ts` caught the rejection, and that attempt's depth record and observation were both lost.
 * It was masked while the partner never resolved, so `relationExpected` was always false and the
 * judge's report was always dropped.
 *
 * This file drives the case from the production path, end to end, with no model call:
 *
 * 1. the REAL corpus stage and fold produce a keyed causes edge (`runCorpusRelationBatch`,
 *    `deriveRelationSet`), as `causes-partner-from-corpus-stage.spec.ts` does;
 * 2. the REAL partner reader (`request.ts`'s `resolveExplainBackCausesPartner`, reached in
 *    production from `main.ts` through `modal.ts`'s `resolveGradingSourceBlocks`) resolves the
 *    other end of that edge by key, from the subject's key;
 * 3. the grading material is composed from that partner the way `modal.ts` composes it, through
 *    the same exported core functions (`resolveGradingRelationContext`,
 *    `buildGradingSourceMaterial`), never re-implemented;
 * 4. the REAL `recordSoloGradeAndReview` runs it, over a scripted depth reply that reports the
 *    neighbour used, into the REAL `recordGradedExplainBackReview` and an in-memory vault, and the
 *    persisted log is read back.
 *
 * `modal.ts` extends Obsidian's `Modal` and cannot be imported under Vitest (see this directory's
 * `modal-solo-source-material.spec.ts`), so the modal's own hand-off to the write is pinned at
 * source level, in the last describe here.
 *
 * INV-3: every string is coined. No course code, note title or wording from any real vault.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildGradingSourceMaterial,
  type ConceptRecord,
  type ConceptRelation,
  type CorpusConcept,
  type CorpusRelationVerdictPort,
  type CorpusVerdict,
  deriveRelationSet,
  type ExplainBackPromptContext,
  type GradingSourceMaterial,
  mintOpaqueConceptKey,
  type RelationSet,
  readReviewLogFile,
  resolveGradingRelationContext,
  reviewLogPath,
  runCorpusRelationBatch,
  type SourceBlockRef,
  type WorkerTaskRequest,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveExplainBackCausesPartner } from '../../src/explain-back/request.js';
import {
  type RecordSoloGradeAndReviewParams,
  recordSoloGradeAndReview,
} from '../../src/explain-back/solo-review.js';
import type { GradingWiring } from '../../src/grading/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const CAUSE = 'Sustained heating';
const EFFECT = 'Volume expansion';
const CAUSE_KEY = mintOpaqueConceptKey(() => 'nonce-3f9a-cause');
const EFFECT_KEY = mintOpaqueConceptKey(() => 'nonce-7c21-effect');

function corpusConcept(name: string, key: string, sourcePath: string): CorpusConcept {
  return {
    name,
    key,
    aliases: [],
    anchor: { sourcePath, location: { page: 1, charRange: { start: 0, end: 40 } } },
  };
}

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

const CAUSES_A_TO_B: CorpusVerdict = {
  a: CAUSE,
  b: EFFECT,
  type: 'causes',
  direction: 'a-to-b',
  confidence: 0.8,
};

/** The corpus stage exactly as production runs it, folded the way the ingestion tick folds it. */
async function foldedRelationSet(): Promise<RelationSet> {
  const cause = corpusConcept(CAUSE, CAUSE_KEY, 'Lecture 3.md');
  const effect = corpusConcept(EFFECT, EFFECT_KEY, 'Lecture 4.md');
  const port: CorpusRelationVerdictPort = {
    verdict: async () => ({
      verdicts: [{ ...CAUSES_A_TO_B, aKey: CAUSE_KEY, bKey: EFFECT_KEY }],
    }),
  };
  const result = await runCorpusRelationBatch(port, {
    newConcepts: [cause],
    allConcepts: [cause, effect],
    signals: [{ kind: 'embedding-proximity', a: CAUSE, b: EFFECT }],
    passageText: (c) => `passage text for ${c.name}`,
  });
  return deriveRelationSet([], result.relations);
}

const SUBJECT_PASSAGES: readonly SourceBlockRef[] = [
  { blockId: 'subject-1', text: 'The effect, defined on its own terms.' },
];
const NEIGHBOUR_PASSAGES: readonly SourceBlockRef[] = [
  { blockId: 'neighbour-1', text: 'The cause, defined on its own terms.' },
];

function edgeProvenanceBlocks(edge: ConceptRelation): readonly SourceBlockRef[] {
  return [edge.introducingPassages.from, edge.introducingPassages.to].map((provenance) => ({
    blockId: `${provenance.sourcePath}#edge`,
    text: `edge passage from ${provenance.sourcePath}`,
  }));
}

/** What the production path hands the write for the effect concept as the subject: the partner, the material composed from it, and the key. */
async function relationalAttempt(): Promise<{
  readonly material: GradingSourceMaterial;
  readonly neighbourConceptId: string;
  readonly neighbourName: string;
  readonly context: ExplainBackPromptContext;
}> {
  const set = await foldedRelationSet();
  const partner = resolveExplainBackCausesPartner(
    { relations: () => set, conceptRecords: () => RECORDS },
    EFFECT_KEY,
  );
  if (partner === undefined) throw new Error('the partner reader found no causes partner');

  // What `modal.ts`'s `resolveGradingSourceBlocks` does with a partner: the wording goes to
  // retrieval (here, the coined neighbour passages), the key to everything that identifies.
  const relation = resolveGradingRelationContext({
    neighbourConceptId: partner.neighbourConceptId,
    edge: {
      evidence: 'current',
      provenance: partner.edge.provenance,
      introducingPassages: edgeProvenanceBlocks(partner.edge),
    },
  });
  const material = buildGradingSourceMaterial({
    subject: { subjectConceptId: EFFECT_KEY },
    subjectDefiningPassages: { conceptId: EFFECT_KEY, passages: SUBJECT_PASSAGES },
    relation,
    neighbourDefiningPassages: {
      conceptId: partner.neighbourConceptId,
      passages: NEIGHBOUR_PASSAGES,
    },
  });
  return {
    material,
    neighbourConceptId: partner.neighbourConceptId,
    neighbourName: partner.neighbourName,
    context: {
      question: 'Explain the volume change.',
      referenceAnswer: 'A reference answer.',
      sourceBlocks: material.sourceBlocks,
      misconceptionDigest: [],
    },
  };
}

function wiringReplying(result: Record<string, unknown>): GradingWiring {
  return {
    judgeCaller: null,
    killedBySustainedAuditFailure: false,
    misconceptionEmbedder: null,
    misconceptionEmbeddingCache: null,
    soloTransport: {
      send: async (_request: WorkerTaskRequest) => ({
        ok: true,
        stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'solo-test-model' },
        result,
      }),
    },
    acceptedObservationsByAttempt: new Map(),
  };
}

const RELATIONAL_REPLY_USING_NEIGHBOUR = {
  soloLevel: 'relational',
  rationale: 'Ties the effect back to its cause.',
  citedBlockIds: ['subject-1'],
  neighbourUseDemonstrated: true,
};

const NOW = () => new Date('2026-09-29T09:00:00Z');

/** The fields of a logged review this file reads, for a record read back off the union of log kinds. */
interface LoggedReview {
  readonly conceptIds: readonly string[];
  readonly schedulingObservation?: Readonly<Record<string, unknown>>;
}

async function write(
  grading: GradingWiring,
  params: Omit<
    RecordSoloGradeAndReviewParams,
    'instrumentId' | 'subjectConceptId' | 'attemptId'
  > & {
    attemptId?: string;
  },
) {
  const vault = memoryVault();
  const outcome = await recordSoloGradeAndReview(
    { grading, vault, deviceId: 'device-a', now: NOW },
    {
      instrumentId: 'explain-back:effect:1',
      attemptId: 'attempt-1',
      subjectConceptId: EFFECT_KEY,
      ...params,
    },
  );
  const file = await readReviewLogFile(vault, reviewLogPath('2026-09-29', 'device-a'));
  return { outcome, records: file.records, vault };
}

describe('a relational attempt whose depth judge reports neighbour use (ol-egov.141.89.6.75)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('keeps the depth grade and records the observation by the neighbour concept KEY, never its wording (F5.3a)', async () => {
    const attempt = await relationalAttempt();
    expect(attempt.material.candidateEdgeNomination).toBeNull();
    // The two ends are told apart: the key is an identity, the wording a retrieval query.
    expect(attempt.neighbourConceptId).toBe(CAUSE_KEY);
    expect(attempt.neighbourName).toBe(CAUSE);

    const { outcome, records } = await write(wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR), {
      context: attempt.context,
      answer: 'Her explanation of how the effect follows from its cause.',
      sourceMaterial: attempt.material,
      relationExpected: true,
      neighbourConceptId: attempt.neighbourConceptId,
    });

    expect(outcome).toMatchObject({ depth: 'graded', soloLevel: 'relational' });
    expect(outcome?.schedulingObservation).toEqual({ status: 'recorded' });
    expect(records).toHaveLength(1);
    const record = records[0] as unknown as LoggedReview;
    expect(record).toMatchObject({
      kind: 'review',
      instrumentType: 'explain-back',
      explainBackGrade: { soloLevel: 'relational' },
      schedulingObservation: { neighbourConceptId: CAUSE_KEY },
    });
    // C5.11: the scoring subject is unchanged and the neighbour is never a second scored concept.
    expect(record.conceptIds).toEqual([EFFECT_KEY]);
    expect(Object.keys(record.schedulingObservation ?? {})).toEqual(['neighbourConceptId']);
    expect(JSON.stringify(record)).not.toContain(attempt.neighbourName);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a neighbour key that never reached the write costs the attempt its observation and nothing else: the depth record is written whole, and the outcome says why', async () => {
    const attempt = await relationalAttempt();

    // The defensive path, kept after the modal began handing the key over: the material and the
    // relational flag arrive, the key does not (a caller that forgot it). Red before this bead: the
    // write threw, and the attempt's depth record was lost.
    const { outcome, records, vault } = await write(
      wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR),
      {
        context: attempt.context,
        answer: 'Her explanation of how the effect follows from its cause.',
        sourceMaterial: attempt.material,
        relationExpected: true,
      },
    );

    expect(outcome).toMatchObject({ depth: 'graded', soloLevel: 'relational' });
    expect(outcome?.schedulingObservation).toEqual({
      status: 'not-recorded',
      reason: 'no-neighbour-concept-id',
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      instrumentType: 'explain-back',
      conceptIds: [EFFECT_KEY],
      explainBackGrade: { soloLevel: 'relational' },
    });
    expect(records[0]).not.toHaveProperty('schedulingObservation');
    // The event cites content that is on the vault: one review-log file, one content record.
    expect(vault.writes).toHaveLength(2);
  });

  it('the failure is never silent: a content-free line names it, and it carries no wording of hers or the grader’s', async () => {
    const attempt = await relationalAttempt();

    await write(wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR), {
      context: attempt.context,
      answer: 'A distinctive sentence of hers that must never reach a log line.',
      sourceMaterial: attempt.material,
      relationExpected: true,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).toContain('no-neighbour-concept-id');
    expect(logged).not.toContain('distinctive sentence');
    expect(logged).not.toContain('Ties the effect back to its cause');
    expect(logged).not.toContain(CAUSE_KEY);
    expect(logged).not.toContain(EFFECT_KEY);
  });
});

describe('the four outcomes of the observation stay apart (ol-egov.141.89.6.75)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('not-observed: a relational prompt whose judge reported no neighbour use is an honest absence, not a failure', async () => {
    const attempt = await relationalAttempt();

    const { outcome, records } = await write(
      wiringReplying({ ...RELATIONAL_REPLY_USING_NEIGHBOUR, neighbourUseDemonstrated: false }),
      {
        context: attempt.context,
        answer: 'Her explanation.',
        sourceMaterial: attempt.material,
        relationExpected: true,
        neighbourConceptId: attempt.neighbourConceptId,
      },
    );

    expect(outcome?.schedulingObservation).toEqual({ status: 'not-observed' });
    expect(records[0]).not.toHaveProperty('schedulingObservation');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('not-observed: a concept-only prompt drops a neighbour-use claim the model had no business making (C5.11)', async () => {
    const { outcome, records } = await write(wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR), {
      context: {
        question: 'Explain the volume change.',
        referenceAnswer: 'A reference answer.',
        sourceBlocks: SUBJECT_PASSAGES,
        misconceptionDigest: [],
      },
      answer: 'Her explanation.',
    });

    expect(outcome).toMatchObject({ depth: 'graded' });
    expect(outcome?.schedulingObservation).toEqual({ status: 'not-observed' });
    expect(records[0]).not.toHaveProperty('schedulingObservation');
  });

  it('not-run: with no depth grade there was no judgement to record, and that is neither of the above', async () => {
    const attempt = await relationalAttempt();
    const grading = wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR);
    // The correctness verdict she accepted, so the skipped-depth event is written at all.
    // biome-ignore lint/suspicious/noExplicitAny: the memo's value type is the accept result this test scripts.
    (grading.acceptedObservationsByAttempt as Map<string, any>).set(
      'attempt-1',
      Promise.resolve({
        status: 'accepted' as const,
        accepted: {
          status: 'accepted' as const,
          verdict: 'incorrect' as const,
          feedback: 'Not yet.',
          missedPoints: [],
          citedIssues: [],
          misconceptionCandidates: [],
          stamp: { promptVersion: 'judge-7', modelId: 'judge-model' },
        },
        observations: [],
      }),
    );

    const { outcome, records } = await write(grading, {
      context: attempt.context,
      answer: 'Her explanation.',
      sourceMaterial: attempt.material,
      relationExpected: true,
      neighbourConceptId: attempt.neighbourConceptId,
      depthPass: 'skipped',
    });

    expect(outcome?.depth).toBe('skipped');
    expect(outcome?.schedulingObservation).toEqual({ status: 'not-run' });
    expect(records[0]).not.toHaveProperty('schedulingObservation');
    expect(records[0]).not.toHaveProperty('explainBackGrade');
  });

  it('recorded, not-observed, not-recorded and not-run are four different outcomes', async () => {
    const attempt = await relationalAttempt();
    const relational = {
      context: attempt.context,
      answer: 'Her explanation.',
      sourceMaterial: attempt.material,
      relationExpected: true,
    };

    const recorded = await write(wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR), {
      ...relational,
      neighbourConceptId: attempt.neighbourConceptId,
    });
    const notObserved = await write(
      wiringReplying({ ...RELATIONAL_REPLY_USING_NEIGHBOUR, neighbourUseDemonstrated: false }),
      { ...relational, neighbourConceptId: attempt.neighbourConceptId },
    );
    const notRecorded = await write(wiringReplying(RELATIONAL_REPLY_USING_NEIGHBOUR), relational);

    const statuses = [recorded, notObserved, notRecorded].map(
      (attemptResult) => attemptResult.outcome?.schedulingObservation.status,
    );
    expect(statuses).toEqual(['recorded', 'not-observed', 'not-recorded']);
    expect(new Set(statuses).size).toBe(3);
    // Only the failure leaves a line behind; the two ordinary outcomes are silent because nothing failed.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The modal's hand-off — source-level, because `modal.ts` cannot be imported under Vitest
// ---------------------------------------------------------------------------

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this directory's `modal-solo-source-material.spec.ts`. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the modal hands the neighbour key to the write (ol-egov.141.89.6.75)', () => {
  const modal = codeOf('explain-back/modal.ts');

  it('resolveGradingSourceBlocks names the partner by key when it composes the relation, so the key exists at the point the material is built', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/const \{ edge, neighbourConceptId, neighbourName \} = partner;/);
    expect(body).toMatch(/named = \{\s*neighbourConceptId,/);
  });

  it('the accepted-attempt call to recordSoloGradeAndReview carries prompt.neighbourConceptId beside the material', () => {
    const start = modal.indexOf('this.deps.recordSoloGradeAndReview({');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('});', start);
    const call = modal.slice(start, end);
    expect(call).toMatch(/neighbourConceptId/);
    expect(call).toMatch(/prompt\.neighbourConceptId/);
  });
});
