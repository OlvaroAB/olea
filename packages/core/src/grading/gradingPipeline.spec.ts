import { describe, expect, it, vi } from 'vitest';
import type { MisconceptionDigestEntry } from '../misconception/digest.js';
import {
  acceptExplainBackGrading,
  discardExplainBackGrading,
  type ExplainBackGradingWireGraded,
  type ExplainBackGradingWireResponse,
  type ExplainBackJudgeWireRequest,
  type GradeExplainBackInput,
  type GroundedGrading,
  gradeExplainBack,
  groundCitations,
  type SourceBlockRef,
  summarizeGradingForTelemetry,
  toWireMisconceptionDigest,
  UnusableGradingInputError,
} from './gradingPipeline.js';
import { toRestatementOverlapEvidence } from './restatementOverlap.js';

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
  overrides: Partial<ExplainBackGradingWireGraded> = {},
): ExplainBackGradingWireGraded {
  return {
    outcome: 'graded',
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
    let seen: ExplainBackJudgeWireRequest | undefined;
    const callJudge = vi.fn(async (req: ExplainBackJudgeWireRequest) => {
      seen = req;
      return wireResponse();
    });
    const verbatimAnswer = SOURCE_BLOCKS.map((b) => b.text).join(' ');
    const result = await gradeExplainBack(
      baseInput({ studentAnswer: verbatimAnswer, sourceBlocks: SOURCE_BLOCKS }),
      callJudge,
    );
    // The overlap measurement is still reported — record-only, never gates.
    expect(result.overlap.containment).toBeGreaterThan(0.9);
    expect(callJudge).toHaveBeenCalledTimes(1);
    // `ol-0r92.99` / `[D-279]`: a high measurement travels to the judge as
    // evidence, but it never becomes a reason not to call the model — the
    // call above already happened before this assertion runs.
    expect(seen?.restatementOverlap?.containment).toBeGreaterThan(0.9);
  });

  it('ol-egov.141.89.6.25: the wire request carries restatementOverlap, computed from precheckRestatement via toRestatementOverlapEvidence', async () => {
    let seen: ExplainBackJudgeWireRequest | undefined;
    const callJudge = vi.fn(async (req: ExplainBackJudgeWireRequest) => {
      seen = req;
      return wireResponse();
    });
    const result = await gradeExplainBack(baseInput(), callJudge);
    // Same projection `summarizeGradingForTelemetry` and the module itself
    // use — the wire value is exactly the returned `overlap` measurement
    // narrowed to the evidence shape, not a separately recomputed number.
    expect(seen?.restatementOverlap).toEqual(toRestatementOverlapEvidence(result.overlap));
  });

  it('sends restatementOverlap on a low-overlap genuine answer too — never omitted, never gated on', async () => {
    let seen: ExplainBackJudgeWireRequest | undefined;
    const callJudge = vi.fn(async (req: ExplainBackJudgeWireRequest) => {
      seen = req;
      return wireResponse();
    });
    await gradeExplainBack(
      baseInput({ studentAnswer: 'A totally different, unrelated sentence about Q.' }),
      callJudge,
    );
    expect(seen?.restatementOverlap).toBeDefined();
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
    if (result.grading.outcome !== 'graded') throw new Error('expected a graded outcome');
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
    // Narrowed first — `pending.grading` is `GroundedGrading` (a union): this
    // is the exact narrowing `[D-321]` forces on every consumer.
    if (pending.grading.outcome !== 'graded') throw new Error('expected a graded outcome');
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
        outcome: 'graded' as const,
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

  // -------------------------------------------------------------------------
  // `[D-321]` / `ol-0r92.130` — the unable-to-assess outcome
  // -------------------------------------------------------------------------

  it('D-321 GUARD: refuses to accept an unable-to-assess pending grading, by name, not a bare TypeError', () => {
    const pending = {
      status: 'pending-review' as const,
      overlap: {
        containment: 0,
        lcsRatio: 0,
        jaccard: 0,
        ngramSize: 3,
        answerTokenCount: 0,
        sourceTokenCount: 1,
      },
      grading: { outcome: 'unable-to-assess' as const, reason: 'blank answer' },
    };
    // Without the guard, accessing `.citedIssues` on this shape would throw a
    // bare TypeError instead — this pins the NAMED guard (D-321's own
    // message), not just any throw.
    expect(() => acceptExplainBackGrading(pending)).toThrow(/unable-to-assess/);
  });

  it('discardExplainBackGrading also accepts an unable-to-assess pending grading — it never reads .grading at all', () => {
    const pending = {
      status: 'pending-review' as const,
      overlap: {
        containment: 0,
        lcsRatio: 0,
        jaccard: 0,
        ngramSize: 3,
        answerTokenCount: 0,
        sourceTokenCount: 1,
      },
      grading: { outcome: 'unable-to-assess' as const, reason: 'off-topic' },
    };
    expect(discardExplainBackGrading(pending)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `[D-321]` / `ol-0r92.130` — the unable-to-assess outcome, end to end
// ---------------------------------------------------------------------------

function unableToAssessWireResponse(reason = 'blank answer'): ExplainBackGradingWireResponse {
  return { outcome: 'unable-to-assess', reason };
}

describe('groundCitations — passes the unable-to-assess branch through unchanged', () => {
  it('never coerces it into the graded shape and carries the reason through', () => {
    const grounded = groundCitations(unableToAssessWireResponse('pure gibberish'), SOURCE_BLOCKS);
    expect(grounded).toEqual({ outcome: 'unable-to-assess', reason: 'pure gibberish' });
  });
});

describe('gradeExplainBack — end to end, an unable-to-assess model response', () => {
  it('the pipeline still measures overlap (record-only) but never grounds or grades', async () => {
    const callJudge = vi.fn().mockResolvedValue(unableToAssessWireResponse('no genuine attempt'));
    const pending = await gradeExplainBack(baseInput(), callJudge);
    expect(pending.grading).toEqual({ outcome: 'unable-to-assess', reason: 'no genuine attempt' });
    // Record-only measurement still runs — [D-138] never gated the model
    // call, and this outcome doesn't change that.
    expect(pending.overlap).toBeDefined();
  });

  it('TYPE-LEVEL: a consumer of GroundedGrading cannot read .verdict without narrowing outcome first', async () => {
    const callJudge = vi.fn().mockResolvedValue(wireResponse());
    const pending = await gradeExplainBack(baseInput(), callJudge);
    const grading: GroundedGrading = pending.grading;
    // @ts-expect-error — `verdict` does not exist on the unable-to-assess
    // member of the union; TS forces the `outcome === 'graded'` check below
    // before this field is reachable. This is the compile-time guarantee
    // `[D-321]`'s acceptance criterion asks for.
    const _unchecked: string = grading.verdict;
    if (grading.outcome === 'graded') {
      expect(grading.verdict).toBe('partial');
    } else {
      throw new Error('expected a graded outcome for this fixture');
    }
  });
});

describe('summarizeGradingForTelemetry — unable-to-assess never logs a verdict or content', () => {
  it('carries outcome and containment only — no verdict, no citation counts, no reason text', async () => {
    const sentinel = 'SENTINEL-UNABLE-TO-ASSESS-DO-NOT-LOG-9f2c';
    const callJudge = vi.fn().mockResolvedValue(unableToAssessWireResponse(sentinel));
    const pending = await gradeExplainBack(baseInput(), callJudge);
    const summary = summarizeGradingForTelemetry(pending);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(sentinel);
    expect(summary).toEqual({
      outcome: 'unable-to-assess',
      containment: pending.overlap.containment,
    });
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
        'outcome',
        'verdict',
      ].sort(),
    );
  });
});
