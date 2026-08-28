import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CandidateEdgeNomination,
  GradingSourceMaterial,
} from '../mastery/gradingInputContract.js';
import { readContentRecord } from '../review-log/content-store.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  type AcceptedSoloGrading,
  acceptSoloGrading,
  buildExplainBackGradeReviewFields,
  discardSoloGrading,
  type ExplainBackSoloWireResponse,
  type GradeSoloInput,
  gradeSolo,
  groundSoloResponse,
  type PendingSoloGrading,
  summarizeSoloGradingForTelemetry,
  writeSoloGradingContent,
} from './explainBackSolo.js';
import type { SourceBlockRef } from './gradingPipeline.js';

// Synthetic, invented material throughout — never real vault content (INV-3).

const SOURCE_BLOCKS: SourceBlockRef[] = [
  { blockId: 'blk-1', text: 'Interference is retrieval competition.' },
];

function sourceMaterial(overrides: Partial<GradingSourceMaterial> = {}): GradingSourceMaterial {
  return {
    sourceBlocks: SOURCE_BLOCKS,
    omissionDenominator: SOURCE_BLOCKS,
    candidateEdgeNomination: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<GradeSoloInput> = {}): GradeSoloInput {
  return {
    question: 'Explain interference theory.',
    studentAnswer: 'Old memories block new ones.',
    sourceMaterial: sourceMaterial(),
    relationExpected: false,
    ...overrides,
  };
}

function wireResponse(
  overrides: Partial<ExplainBackSoloWireResponse> = {},
): ExplainBackSoloWireResponse {
  return {
    soloLevel: 'unistructural',
    rationale: 'Names one relevant element, unelaborated.',
    citedBlockIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groundSoloResponse — the anti-confabulation layer (INV-5)
// ---------------------------------------------------------------------------

describe('groundSoloResponse — refuses rather than confabulates', () => {
  it('keeps a real citedBlockIds entry and drops a fabricated one', () => {
    const response = wireResponse({ citedBlockIds: ['blk-1', 'blk-fabricated'] });
    const grounded = groundSoloResponse(response, SOURCE_BLOCKS, false);
    expect(grounded.citedBlockIds).toEqual(['blk-1']);
    expect(grounded.droppedCitationCount).toBe(1);
  });

  it('reports citationsAvailable false when no source blocks were sent at all', () => {
    const grounded = groundSoloResponse(wireResponse(), [], false);
    expect(grounded.citationsAvailable).toBe(false);
    expect(grounded.droppedCitationCount).toBe(0);
  });

  it('drops neighbourUseDemonstrated when relationExpected is false — a second scoring dimension outside what was asked (C5.11)', () => {
    const response = wireResponse({ neighbourUseDemonstrated: true });
    const grounded = groundSoloResponse(response, SOURCE_BLOCKS, false);
    expect(Object.hasOwn(grounded, 'neighbourUseDemonstrated')).toBe(false);
  });

  it('keeps neighbourUseDemonstrated when relationExpected is true', () => {
    const response = wireResponse({ neighbourUseDemonstrated: true });
    const grounded = groundSoloResponse(response, SOURCE_BLOCKS, true);
    expect(grounded.neighbourUseDemonstrated).toBe(true);
  });

  it('leaves soloLevel and rationale untouched — this hook only handles the citation/neighbour surface', () => {
    const response = wireResponse({ soloLevel: 'relational', rationale: 'x' });
    const grounded = groundSoloResponse(response, SOURCE_BLOCKS, false);
    expect(grounded.soloLevel).toBe('relational');
    expect(grounded.rationale).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// gradeSolo — the pipeline
// ---------------------------------------------------------------------------

describe('gradeSolo', () => {
  it('builds its wire request from GradingSourceMaterial, not from scratch', async () => {
    let sentRequest: unknown;
    const callSolo = async (req: unknown) => {
      sentRequest = req;
      return wireResponse();
    };

    await gradeSolo(baseInput(), callSolo);

    expect(sentRequest).toEqual({
      question: 'Explain interference theory.',
      studentAnswer: 'Old memories block new ones.',
      sourceBlocks: SOURCE_BLOCKS,
      relationExpected: false,
    });
  });

  it('sets relationExpected true exactly when the caller says the source material was relational', async () => {
    let sentRequest: { relationExpected?: boolean } | undefined;
    const callSolo = async (req: { relationExpected?: boolean }) => {
      sentRequest = req;
      return wireResponse();
    };

    await gradeSolo(baseInput({ relationExpected: true }), callSolo);

    expect(sentRequest?.relationExpected).toBe(true);
  });

  it('returns a PendingSoloGrading, never an accepted one (INV-6)', async () => {
    const pending = await gradeSolo(baseInput(), async () => wireResponse());
    expect(pending.status).toBe('pending-review');
    expect(pending).not.toHaveProperty('status', 'accepted');
  });

  it('threads candidateEdgeNomination through unchanged, from the source material', async () => {
    const nomination: CandidateEdgeNomination = {
      subjectConceptId: 'concept-x',
      neighbourConceptId: 'concept-y',
    };
    const pending = await gradeSolo(
      baseInput({ sourceMaterial: sourceMaterial({ candidateEdgeNomination: nomination }) }),
      async () => wireResponse(),
    );
    expect(pending.candidateEdgeNomination).toEqual(nomination);
  });

  it('grounds the response before returning it — a fabricated citation never survives', async () => {
    const pending = await gradeSolo(baseInput(), async () =>
      wireResponse({ citedBlockIds: ['blk-fabricated'] }),
    );
    expect(pending.citedBlockIds).toEqual([]);
    expect(pending.droppedCitationCount).toBe(1);
  });

  it('an empty studentAnswer is honestly gradable — never refused (no UnusableGradingInputError analog)', async () => {
    const pending = await gradeSolo(baseInput({ studentAnswer: '' }), async () =>
      wireResponse({ soloLevel: 'prestructural' }),
    );
    expect(pending.soloLevel).toBe('prestructural');
  });

  it('adversarial empty-context case: no sourceBlocks, a fabricated citation and an out-of-scope neighbour claim — both dropped, a level is still owed', async () => {
    const pending = await gradeSolo(
      baseInput({ sourceMaterial: sourceMaterial({ sourceBlocks: [] }), relationExpected: false }),
      async () =>
        wireResponse({
          soloLevel: 'unistructural',
          citedBlockIds: ['blk-never-sent'],
          neighbourUseDemonstrated: true,
        }),
    );
    expect(pending.soloLevel).toBe('unistructural');
    expect(pending.citedBlockIds).toEqual([]);
    expect(pending.neighbourUseDemonstrated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The accept step (INV-6)
// ---------------------------------------------------------------------------

describe('acceptSoloGrading / discardSoloGrading', () => {
  it('turns a pending grading into an accepted one, unchanged', async () => {
    const pending = await gradeSolo(baseInput(), async () =>
      wireResponse({ soloLevel: 'relational' }),
    );
    const accepted = acceptSoloGrading(pending);
    expect(accepted.status).toBe('accepted');
    expect(accepted.soloLevel).toBe('relational');
  });

  it('rejects an unrecognised soloLevel defensively, even though nothing this module produces can fail it', () => {
    const hostile = {
      status: 'pending-review',
      soloLevel: 'expert',
      rationale: 'x',
      citedBlockIds: [],
      citationsAvailable: false,
      droppedCitationCount: 0,
      candidateEdgeNomination: null,
    } as unknown as PendingSoloGrading;
    expect(() => acceptSoloGrading(hostile)).toThrow(/not one of the five SOLO levels/);
  });

  it('discardSoloGrading returns null — a rejected grading can never be forwarded by mistake', async () => {
    const pending = await gradeSolo(baseInput(), async () => wireResponse());
    expect(discardSoloGrading(pending)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildExplainBackGradeReviewFields — rides the subject's own event, never a second one
// ---------------------------------------------------------------------------

describe('buildExplainBackGradeReviewFields', () => {
  const accepted: AcceptedSoloGrading = {
    status: 'accepted',
    soloLevel: 'relational',
    rationale: 'Connects both mechanisms under one principle.',
    citedBlockIds: ['blk-1'],
  };

  it("produces explainBackGrade matching contracts/review-log.ts's shape exactly", () => {
    const fields = buildExplainBackGradeReviewFields({
      accepted,
      contentRef: 'content-ref-abc123',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back.solo.v1',
        promptVersion: '1.0.0',
        modelId: 'test-model',
      },
    });
    expect(fields.explainBackGrade).toEqual({
      soloLevel: 'relational',
      contentRef: 'content-ref-abc123',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back.solo.v1',
        promptVersion: '1.0.0',
        modelId: 'test-model',
      },
    });
  });

  it('schedulingObservation is undefined (absent), not null, when neighbourUseDemonstrated was never set', () => {
    const fields = buildExplainBackGradeReviewFields({
      accepted,
      contentRef: 'content-ref-abc123',
      revisionOf: null,
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
    });
    expect(fields.schedulingObservation).toBeUndefined();
    expect(Object.hasOwn(fields, 'schedulingObservation')).toBe(true);
  });

  it('schedulingObservation carries the neighbourConceptId when demonstrated use was true — never read from the model', () => {
    const acceptedRelational: AcceptedSoloGrading = { ...accepted, neighbourUseDemonstrated: true };
    const fields = buildExplainBackGradeReviewFields({
      accepted: acceptedRelational,
      contentRef: 'content-ref-abc123',
      revisionOf: null,
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
      neighbourConceptId: 'concept-y',
    });
    expect(fields.schedulingObservation).toEqual({ neighbourConceptId: 'concept-y' });
  });

  it('throws when neighbourUseDemonstrated is true but no neighbourConceptId was supplied', () => {
    const acceptedRelational: AcceptedSoloGrading = { ...accepted, neighbourUseDemonstrated: true };
    expect(() =>
      buildExplainBackGradeReviewFields({
        accepted: acceptedRelational,
        contentRef: 'content-ref-abc123',
        revisionOf: null,
        artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
      }),
    ).toThrow(/neighbourConceptId/);
  });

  it('carries revisionOf through as an explicit value, never silently defaulted', () => {
    const fields = buildExplainBackGradeReviewFields({
      accepted,
      contentRef: 'content-ref-abc123',
      revisionOf: 'evt-prior-123',
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
    });
    expect(fields.explainBackGrade.revisionOf).toBe('evt-prior-123');
  });
});

// ---------------------------------------------------------------------------
// writeSoloGradingContent — mints a real [D-077] contentRef (ol-95vv.3)
// ---------------------------------------------------------------------------

describe('writeSoloGradingContent', () => {
  const accepted: AcceptedSoloGrading = {
    status: 'accepted',
    soloLevel: 'relational',
    rationale: 'Connects both mechanisms under one principle.',
    citedBlockIds: ['blk-1'],
  };

  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-solo-content-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes her answer and the grader rationale, and returns an id readable back from the content store', async () => {
    const vault = new FolderSource(tempRoot);
    const contentRef = await writeSoloGradingContent(
      vault,
      { accepted, studentAnswer: 'Old memories block new ones.' },
      { deviceId: 'desktop-1' },
    );

    expect(typeof contentRef).toBe('string');
    expect(contentRef.length).toBeGreaterThan(0);

    const stored = await readContentRecord(vault, contentRef);
    expect(stored).toEqual({
      status: 'found',
      record: {
        contentId: contentRef,
        studentAnswer: 'Old memories block new ones.',
        feedback: accepted.rationale,
      },
    });
  });

  it('carries misconceptionDetail through when the caller supplies one', async () => {
    const vault = new FolderSource(tempRoot);
    const contentRef = await writeSoloGradingContent(
      vault,
      {
        accepted,
        studentAnswer: 'Old memories block new ones.',
        misconceptionDetail: 'treats interference as forgetting rather than competition',
      },
      { deviceId: 'desktop-1' },
    );

    const stored = await readContentRecord(vault, contentRef);
    expect(stored.status === 'found' && stored.record.misconceptionDetail).toBe(
      'treats interference as forgetting rather than competition',
    );
  });

  it('the returned contentRef is fit to pass straight into buildExplainBackGradeReviewFields', async () => {
    const vault = new FolderSource(tempRoot);
    const contentRef = await writeSoloGradingContent(
      vault,
      { accepted, studentAnswer: 'Old memories block new ones.' },
      { deviceId: 'desktop-1' },
    );

    const fields = buildExplainBackGradeReviewFields({
      accepted,
      contentRef,
      revisionOf: null,
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
    });
    expect(fields.explainBackGrade.contentRef).toBe(contentRef);
  });

  it('two devices minting content for the same grading moment never collide', async () => {
    const vault = new FolderSource(tempRoot);
    const a = await writeSoloGradingContent(
      vault,
      { accepted, studentAnswer: 'from desktop' },
      { deviceId: 'desktop' },
    );
    const b = await writeSoloGradingContent(
      vault,
      { accepted, studentAnswer: 'from mobile' },
      { deviceId: 'mobile' },
    );
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Telemetry — never content (D-005)
// ---------------------------------------------------------------------------

describe('summarizeSoloGradingForTelemetry', () => {
  it('never includes rationale', async () => {
    const sentinel = 'SENTINEL-DO-NOT-LOG-SOLO-77ab';
    const pending: PendingSoloGrading = await gradeSolo(baseInput(), async () =>
      wireResponse({ rationale: sentinel }),
    );
    const summary = summarizeSoloGradingForTelemetry(pending);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(sentinel);
    expect(Object.keys(summary).sort()).toEqual(
      ['citedBlockCount', 'droppedCitationCount', 'neighbourUseDemonstrated', 'soloLevel'].sort(),
    );
  });
});
