import { describe, expect, it, vi } from 'vitest';
import type { MisconceptionDigestEntry } from '../misconception/digest.js';
import {
  acceptExplainBackGrading,
  answerSpanOccurs,
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

// `ol-95vv.8` (`[D-303]`, `[D-386]`): the correctness call's D7.3 stamp rides
// from the judge caller through the accept, so an accepted verdict can be
// recorded in the review log's top-level field with its own stamp. No stamp
// arrived means no stamp carried — never invented.
describe('the correctness call’s stamp travels to the accept ([D-386])', () => {
  const stamp = { promptVersion: 'judge-7', modelId: 'judge-model' };

  it('carries a stamp the caller surfaced onto the pending grading and the accept', async () => {
    const callJudge = vi.fn().mockResolvedValue({ ...wireResponse(), stamp });
    const pending = await gradeExplainBack(baseInput(), callJudge);
    expect(pending.stamp).toEqual(stamp);
    expect(acceptExplainBackGrading(pending).stamp).toEqual(stamp);
  });

  it('carries none when the caller surfaced none, or surfaced null', async () => {
    for (const response of [wireResponse(), { ...wireResponse(), stamp: null }]) {
      const pending = await gradeExplainBack(baseInput(), vi.fn().mockResolvedValue(response));
      expect(Object.hasOwn(pending, 'stamp')).toBe(false);
      expect(Object.hasOwn(acceptExplainBackGrading(pending), 'stamp')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// [D-318]: the answer half of each reference — quoted words of her answer
// (features/F5-explain-it-back.md, "F5.3 / [D-318]" block)
// ---------------------------------------------------------------------------

describe('answerSpanOccurs — word for word, spacing aside ([D-318])', () => {
  const answer = 'Because Y causes Z,\n  and  W is the same as Y.';

  it('finds a span that occurs verbatim', () => {
    expect(answerSpanOccurs('W is the same as Y', answer)).toBe(true);
  });

  it('treats runs of spaces and line breaks as one space, and ignores edge whitespace', () => {
    expect(answerSpanOccurs('  Z, and W is ', answer)).toBe(true);
  });

  it('is case- and punctuation-sensitive: a paraphrase never passes as her words', () => {
    expect(answerSpanOccurs('because y causes z', answer)).toBe(false);
    expect(answerSpanOccurs('Z and W', answer)).toBe(false);
    expect(answerSpanOccurs('W is identical to Y', answer)).toBe(false);
  });

  it('an empty or whitespace-only span never occurs', () => {
    expect(answerSpanOccurs('', answer)).toBe(false);
    expect(answerSpanOccurs('   ', answer)).toBe(false);
  });
});

describe('groundCitations — quoted words of her answer ([D-318])', () => {
  const answer = 'Because Y causes Z, and W is the same as Y.';

  it('keeps a finding whose quoted words occur in her answer, exactly as quoted', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'confusion',
          description: 'treats W as Y',
          sourceBlockIds: ['blk-2'],
          answerSpans: ['W is the same as Y'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.citedIssues).toEqual([
      {
        kind: 'confusion',
        description: 'treats W as Y',
        sourceBlockIds: ['blk-2'],
        answerSpans: ['W is the same as Y'],
      },
    ]);
    expect(grounded.droppedCitationCount).toBe(0);
  });

  it('ADVERSARIAL: drops a finding whose every quotation is absent from her answer, and counts it', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'error',
          description: 'an invented quotation',
          sourceBlockIds: ['blk-1'],
          answerSpans: ['Y prevents Z'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.citedIssues).toEqual([]);
    expect(grounded.droppedCitationCount).toBe(1);
  });

  it('ADVERSARIAL: drops a misconception candidate quoting only words she never wrote, and counts it', () => {
    const response = wireResponse({
      misconceptionCandidates: [
        {
          concept: 'concept-y',
          statement: 'believes Y prevents Z',
          correction: 'Y drives Z',
          correctionSourceBlockIds: ['blk-1'],
          answerSpans: ['Y prevents Z'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.misconceptionCandidates).toEqual([]);
    expect(grounded.droppedMisconceptionCount).toBe(1);
  });

  it('keeps only the real quotation when an entry quotes one real passage and one invented one', () => {
    const response = wireResponse({
      misconceptionCandidates: [
        {
          concept: 'concept-y',
          confusedWith: 'concept-w',
          statement: 'believes W is Y',
          correction: 'Y is not the same as W',
          correctionSourceBlockIds: ['blk-2'],
          answerSpans: ['W is the same as Y', 'W and Y are one thing'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.misconceptionCandidates).toHaveLength(1);
    expect(grounded.misconceptionCandidates[0]?.answerSpans).toEqual(['W is the same as Y']);
    expect(grounded.droppedMisconceptionCount).toBe(0);
  });

  it('a finding that quotes nothing is unchanged, with no answerSpans key added', () => {
    const issue = {
      kind: 'omission' as const,
      description: 'never mentions W',
      sourceBlockIds: ['blk-2'],
    };
    const withAnswer = groundCitations(
      wireResponse({ citedIssues: [issue] }),
      SOURCE_BLOCKS,
      answer,
    );
    const withoutAnswer = groundCitations(wireResponse({ citedIssues: [issue] }), SOURCE_BLOCKS);
    expect(withAnswer).toEqual(withoutAnswer);
    expect(withAnswer.citedIssues[0]).toEqual(issue);
    expect(Object.hasOwn(withAnswer.citedIssues[0] ?? {}, 'answerSpans')).toBe(false);
  });

  it('an empty answerSpans list reads as quoting nothing: the entry is kept, the key removed', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'omission',
          description: 'never mentions W',
          sourceBlockIds: ['blk-2'],
          answerSpans: [],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.citedIssues).toEqual([
      { kind: 'omission', description: 'never mentions W', sourceBlockIds: ['blk-2'] },
    ]);
  });

  it('without her answer, quoted words cannot be checked: they are removed and the entry is otherwise kept', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'confusion',
          description: 'treats W as Y',
          sourceBlockIds: ['blk-2'],
          answerSpans: ['anything at all'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS);
    expect(grounded.citedIssues).toEqual([
      { kind: 'confusion', description: 'treats W as Y', sourceBlockIds: ['blk-2'] },
    ]);
    expect(grounded.droppedCitationCount).toBe(0);
  });

  it('an invented source id still drops the entry even when its quotation is real', () => {
    const response = wireResponse({
      citedIssues: [
        {
          kind: 'confusion',
          description: 'treats W as Y',
          sourceBlockIds: ['blk-does-not-exist'],
          answerSpans: ['W is the same as Y'],
        },
      ],
    });
    const grounded = groundCitations(response, SOURCE_BLOCKS, answer);
    expect(grounded.citedIssues).toEqual([]);
    expect(grounded.droppedCitationCount).toBe(1);
  });

  it('gradeExplainBack checks the quoted words against the answer it sent to the judge', async () => {
    const callJudge = vi.fn(async () =>
      wireResponse({
        citedIssues: [
          {
            kind: 'confusion',
            description: 'real quotation',
            sourceBlockIds: ['blk-2'],
            answerSpans: ['Y causes Z'],
          },
          {
            kind: 'error',
            description: 'invented quotation',
            sourceBlockIds: ['blk-1'],
            answerSpans: ['Y prevents Z'],
          },
        ],
      }),
    );
    const pending = await gradeExplainBack(baseInput(), callJudge);
    const grading = pending.grading;
    if (grading.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(grading.citedIssues.map((issue) => issue.description)).toEqual(['real quotation']);
    expect(grading.citedIssues[0]?.answerSpans).toEqual(['Y causes Z']);
    expect(grading.droppedCitationCount).toBe(1);
  });

  it('the telemetry summary stays counts only: a quoted span never appears in it (D-005)', async () => {
    const sentinel = 'SENTINEL-HER-WORDS';
    const callJudge = vi.fn(async () =>
      wireResponse({
        citedIssues: [
          {
            kind: 'confusion',
            description: 'x',
            sourceBlockIds: ['blk-2'],
            answerSpans: [sentinel],
          },
        ],
      }),
    );
    const pending = await gradeExplainBack(
      baseInput({ studentAnswer: `I wrote ${sentinel} here.` }),
      callJudge,
    );
    expect(JSON.stringify(summarizeGradingForTelemetry(pending))).not.toContain(sentinel);
  });
});
