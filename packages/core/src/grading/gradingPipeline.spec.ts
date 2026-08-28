import { describe, expect, it, vi } from 'vitest';
import type { MisconceptionDigestEntry } from '../misconception/digest.js';
import {
  acceptExplainBackGrading,
  discardExplainBackGrading,
  type ExplainBackGradingWireResponse,
  type ExplainBackJudgeWireRequest,
  type GradeExplainBackInput,
  gradeExplainBack,
  groundCitations,
  type SourceBlockRef,
  summarizeGradingForTelemetry,
  toWireMisconceptionDigest,
  UnusableGradingInputError,
} from './gradingPipeline.js';

// Synthetic, invented material throughout — never real vault content (INV-3).

const SOURCE_BLOCKS: SourceBlockRef[] = [
  { blockId: 'blk-1', text: 'The mechanism is Z, driven by Y.' },
  { blockId: 'blk-2', text: 'Y is not the same as W.' },
];

function baseInput(overrides: Partial<GradeExplainBackInput> = {}): GradeExplainBackInput {
  return {
    question: 'Why does X happen?',
    studentAnswer: 'Because Y causes Z.',
    referenceAnswer: 'Because Y drives Z via the mechanism.',
    sourceBlocks: SOURCE_BLOCKS,
    misconceptionDigest: [],
    ...overrides,
  };
}

function wireResponse(
  overrides: Partial<ExplainBackGradingWireResponse> = {},
): ExplainBackGradingWireResponse {
  return {
    verdict: 'partial',
    feedback: 'Close, but you have not distinguished Y from W.',
    missedPoints: ['the distinction between Y and W'],
    citedIssues: [],
    misconceptionCandidates: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groundCitations — the anti-confabulation layer (INV-5)
// ---------------------------------------------------------------------------

describe('groundCitations — refuses rather than confabulates on an invented citation', () => {
  it('keeps a citedIssues entry whose sourceBlockIds are all real', () => {
    const response = wireResponse({
      citedIssues: [
        { kind: 'omission', description: 'never mentions W', sourceBlockIds: ['blk-2'] },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS);
    expect(grounded.citedIssues).toHaveLength(1);
    expect(grounded.droppedCitationCount).toBe(0);
  });

  it('ADVERSARIAL: drops a citedIssues entry citing a blockId the caller never supplied', () => {
    // The confabulation this pipeline exists to catch: the model invents a
    // plausible-looking id instead of citing something real.
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'error',
          description: 'a fabricated point',
          sourceBlockIds: ['blk-does-not-exist'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS);
    expect(grounded.citedIssues).toEqual([]);
    expect(grounded.droppedCitationCount).toBe(1);
  });

  it('ADVERSARIAL: empty source-block context — any citation offered is refused, not surfaced', () => {
    const response = wireResponse({
      citedIssues: [
        { kind: 'omission', description: 'invented anyway', sourceBlockIds: ['blk-1'] },
      ],
      misconceptionCandidates: [
        {
          concept: 'Y',
          statement: 'invented',
          correction: 'invented',
          correctionSourceBlockIds: ['blk-1'],
        },
      ],
    });
    const grounded = groundCitations(response, []);
    expect(grounded.citedIssues).toEqual([]);
    expect(grounded.misconceptionCandidates).toEqual([]);
    expect(grounded.citationsAvailable).toBe(false);
    expect(grounded.droppedCitationCount).toBe(1);
    expect(grounded.droppedMisconceptionCount).toBe(1);
  });

  it('keeps only the valid ids when an entry mixes a real id with a fabricated one', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'confusion',
          description: 'mixed citation',
          sourceBlockIds: ['blk-1', 'blk-fabricated'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS);
    expect(grounded.citedIssues).toEqual([
      { kind: 'confusion', description: 'mixed citation', sourceBlockIds: ['blk-1'] },
    ]);
    expect(grounded.droppedCitationCount).toBe(0);
  });

  it('drops a misconceptionCandidate the same way, independently of citedIssues', () => {
    const response = wireResponse({
      misconceptionCandidates: [
        {
          concept: 'Y',
          statement: 'treats Y as W',
          correction: 'Y is not W',
          correctionSourceBlockIds: ['blk-invented'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS);
    expect(grounded.misconceptionCandidates).toEqual([]);
    expect(grounded.droppedMisconceptionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// N-013 mutation proof for groundCitations — see report for the revert
// ---------------------------------------------------------------------------
// A mutation that deletes the `.filter((id) => knownIds.has(id))` calls in
// `groundCitations` (i.e. trusts every id the model returns) was applied by
// hand and reverted; both "ADVERSARIAL" tests above failed with the filter
// removed (fabricated ids surfaced unchanged) and passed once it was
// restored, byte-identical to before. Not left in the source: N-013 asks
// that the mutation be proved and reported, not that it ship.

describe('gradeExplainBack — the pipeline (pre-check, model call, grounding)', () => {
  it('INV-5: refuses rather than confabulates on an empty referenceAnswer — never calls the model', async () => {
    const callJudge = vi.fn();
    await expect(
      gradeExplainBack(baseInput({ referenceAnswer: '   ' }), callJudge),
    ).rejects.toThrow(UnusableGradingInputError);
    expect(callJudge).not.toHaveBeenCalled();
  });

  it('always calls the model, even for a verbatim paste — [D-138] deleted the gating threshold', async () => {
    const callJudge = vi.fn().mockResolvedValue(wireResponse());
    const verbatimAnswer = SOURCE_BLOCKS.map((b) => b.text).join(' ');
    const result = await gradeExplainBack(
      baseInput({ studentAnswer: verbatimAnswer, sourceBlocks: SOURCE_BLOCKS }),
      callJudge,
    );
    // The overlap measurement is still reported — record-only, never gates.
    expect(result.overlap.containment).toBeGreaterThan(0.9);
    expect(callJudge).toHaveBeenCalledTimes(1);
  });

  it('calls the model and grounds its response', async () => {
    const callJudge = vi.fn().mockResolvedValue(
      wireResponse({
        citedIssues: [
          {
            kind: 'omission',
            description: 'never mentions W',
            sourceBlockIds: ['blk-2', 'blk-fake'],
          },
        ],
      }),
    );
    const result = await gradeExplainBack(baseInput(), callJudge);
    expect(result.grading.citedIssues).toEqual([
      { kind: 'omission', description: 'never mentions W', sourceBlockIds: ['blk-2'] },
    ]);
  });

  it("sends the digest through toWireMisconceptionDigest's minimal shape, never the full store record", async () => {
    const digest: MisconceptionDigestEntry[] = [
      {
        id: 'm-1',
        conceptId: 'concept-y',
        statement: 'treats Y as W',
        status: 'active',
        occurrenceCount: 3,
      },
    ];
    let seen: ExplainBackJudgeWireRequest | undefined;
    const callJudge = vi.fn(async (req: ExplainBackJudgeWireRequest) => {
      seen = req;
      return wireResponse();
    });
    await gradeExplainBack(baseInput({ misconceptionDigest: digest }), callJudge);
    expect(seen?.misconceptionDigest).toEqual([
      { concept: 'concept-y', statement: 'treats Y as W' },
    ]);
  });
});

describe('toWireMisconceptionDigest', () => {
  it('drops id/status/occurrenceCount, keeps only concept + statement', () => {
    const entries: MisconceptionDigestEntry[] = [
      {
        id: 'm-1',
        conceptId: 'concept-alpha',
        statement: 'S',
        status: 'fading',
        occurrenceCount: 2,
      },
    ];
    expect(toWireMisconceptionDigest(entries)).toEqual([
      { concept: 'concept-alpha', statement: 'S' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The accept step (INV-6)
// ---------------------------------------------------------------------------

describe('acceptExplainBackGrading / discardExplainBackGrading — INV-6', () => {
  it('turns a pending grading into an accepted one, carrying the grounded fields through', async () => {
    const callJudge = vi.fn().mockResolvedValue(
      wireResponse({
        citedIssues: [{ kind: 'omission', description: 'x', sourceBlockIds: ['blk-1'] }],
      }),
    );
    const pending = await gradeExplainBack(baseInput(), callJudge);
    const accepted = acceptExplainBackGrading(pending);
    expect(accepted.status).toBe('accepted');
    expect(accepted.citedIssues).toEqual(pending.grading.citedIssues);
    expect(accepted.verdict).toBe(pending.grading.verdict);
  });

  it('discard returns null — nothing downstream can mistake a rejected grading for an accepted one', async () => {
    const callJudge = vi.fn().mockResolvedValue(wireResponse());
    const pending = await gradeExplainBack(baseInput(), callJudge);
    expect(discardExplainBackGrading(pending)).toBeNull();
  });

  it('refuses to accept a grading carrying an ungrounded citation (defence in depth)', () => {
    // Hand-built, bypassing groundCitations, the way a caller never should —
    // exactly the "defensive, not redundant" case acceptGeneratedMcq argues for.
    const tampered = {
      status: 'pending-review' as const,
      overlap: {
        containment: 0,
        lcsRatio: 0,
        jaccard: 0,
        ngramSize: 3,
        answerTokenCount: 1,
        sourceTokenCount: 1,
      },
      grading: {
        verdict: 'incorrect' as const,
        feedback: 'x',
        missedPoints: [],
        citedIssues: [{ kind: 'omission' as const, description: 'x', sourceBlockIds: [] }],
        misconceptionCandidates: [],
        citationsAvailable: true,
        droppedCitationCount: 0,
        droppedMisconceptionCount: 0,
      },
    };
    expect(() => acceptExplainBackGrading(tampered)).toThrow(/ungrounded issue/);
  });
});

// ---------------------------------------------------------------------------
// Never log content
// ---------------------------------------------------------------------------

describe('summarizeGradingForTelemetry — never logs content', () => {
  it('carries no trace of feedback, missedPoints, citations or misconception text', async () => {
    const sentinel = 'SENTINEL-GRADING-DO-NOT-LOG-71cd';
    const callJudge = vi.fn().mockResolvedValue(
      wireResponse({
        feedback: `feedback mentioning ${sentinel}`,
        missedPoints: [sentinel],
        citedIssues: [{ kind: 'omission', description: sentinel, sourceBlockIds: ['blk-1'] }],
        misconceptionCandidates: [
          {
            concept: sentinel,
            statement: sentinel,
            correction: sentinel,
            correctionSourceBlockIds: ['blk-1'],
          },
        ],
      }),
    );
    const pending = await gradeExplainBack(
      baseInput({ question: sentinel, studentAnswer: sentinel }),
      callJudge,
    );
    const summary = summarizeGradingForTelemetry(pending);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(sentinel);
    expect(Object.keys(summary).sort()).toEqual(
      [
        'citedIssueCount',
        'containment',
        'droppedCitationCount',
        'droppedMisconceptionCount',
        'misconceptionCandidateCount',
        'verdict',
      ].sort(),
    );
  });
});
