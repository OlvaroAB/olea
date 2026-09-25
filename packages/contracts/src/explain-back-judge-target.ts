/**
 * `explain-back.judge.v1`'s optional learning-target bundle, and the
 * response-envelope acknowledgement it requires — ruled by `[D-277 / TARGET-1]`
 * (`ol-egov.141.87`, ratifying the Fable response to
 * `docs/direction/briefs/78-learning-target.md`, private repo, cited by path
 * per INV-3). Landed by TARGET-2 (`ol-0r92.92`).
 *
 * **Additive only, one task's correctness request.** The correctness request
 * `explain-back.judge.v1` sends gains exactly one optional bundle; absence
 * means the previous grading path, byte-for-byte in prompt construction and
 * defaults (D-277g). `explain-back.solo.v1` — the SOLO depth verdict, a
 * separate task id — is unchanged and never receives this bundle (D-277g,
 * "the depth request is unchanged and never sees the bundle").
 *
 * **Why this lands here rather than beside the wire types `gradingPipeline.ts`
 * and `olea-service/src/tasks/explainBackJudge.ts` (private) already restate
 * per `workerJudgeCaller.ts`'s documented "restate the shape, never import the
 * private source" discipline.** This bundle is not a Worker implementation
 * detail the way the rest of that request/response shape is — it is the
 * ruled, versioned specification shape itself (D-277a: "a small immutable
 * specification"), the one piece of this wire contract a closed decision bead
 * fixes field-by-field. `worker.ts`'s header names this file's role: "this
 * file fixes the *envelope*, not the task payloads — task-specific
 * request/response shapes land per task id in `tasks.ts` and after." Fixing
 * it once here, importable by both the client-side request builder and (once
 * re-vendored) the private Worker task, is what makes "the same optional
 * bundle, or the request is refused" a checkable fact rather than two
 * independent restatements drifting apart — the drift risk D-277g's
 * compatibility table exists to catch (deployment skew, invalid metadata).
 *
 * **No dependency on `packages/core` (this package has none — `zod` only).**
 * `declaredDemand` restates `[D-262]`'s five-word demand vocabulary
 * (`packages/core/src/oracle/paper-types.ts`'s `PAPER_DEMANDS`) rather than
 * importing it, the same restatement discipline `paper-types.ts` itself
 * documents for `outcomes.extract.v1`'s private response shape. D-277h: "one
 * existing demand value, explicitly authoring intent" — nothing downstream
 * may read its presence as checked delivery.
 *
 * **Open field-type call, flagged rather than guessed (`sourceBasis`).**
 * D-277g names the field but does not describe its shape; the brief's own
 * table calls its whole illustration non-binding ("An illustrative
 * specification shape is...") and describes the field only as "source
 * identifiers and revisions supporting the criteria." This package already
 * has a precedent for "identifier plus revision marker" pairs
 * (`packages/core/src/retrieval/evidencePackage.ts`'s `sourceRevisions`,
 * keyed by source path to an optional revision string) — but the *persisted*
 * specification's own staleness binding ("the specification names the
 * question text and the source revisions it was validated with", D-277's
 * external-reading amendment, TARGET-3/`ol-2zfj.151`'s job) is a separate
 * mechanism from this wire field, which sits beside `citedIssues[].
 * sourceBlockIds` (`packages/core/src/grading/gradingPipeline.ts`) — bare
 * block/source identifiers naming which of the request's own source material
 * the criteria rest on. Implemented here as bare non-empty identifier
 * strings, matching that sibling field and the one concrete precedent in the
 * codebase (`scripts/harness/acceptance-workflow/lib.test.mjs`'s
 * `e1-target.v1` fixture, service repo, cited by path). Flagged in
 * TARGET-2's close evidence as a call made under residual ambiguity, not a
 * ruled type — revisit if TARGET-3's staleness binding turns out to need a
 * revision marker riding on this field too.
 */

import { z } from 'zod';

/**
 * The bundle's own schema version — distinct from `CONTRACT_VERSION`
 * (`worker.ts`), which versions the envelope. A bundle whose shape changes
 * incompatibly gets a new literal here, mirroring `tasks.ts`'s per-task `.vN`
 * naming convention.
 */
export const EXPLAIN_BACK_JUDGE_TARGET_SCHEMA_VERSION = 'explain-back-target.v1' as const;

/**
 * `[D-262]`'s five-word demand vocabulary, restated (see module doc). Adding
 * a sixth word is a Class C addition to `PAPER_DEMANDS`
 * (`packages/core/src/oracle/paper-types.ts`) and to this enum together, not
 * a change made in one file alone.
 */
export const explainBackJudgeDemand = z.enum([
  'recall-a-fact',
  'calculate',
  'compare-or-choose',
  'apply-to-unfamiliar-case',
  'interpret-printed-result',
]);
export type ExplainBackJudgeDemand = z.infer<typeof explainBackJudgeDemand>;

/**
 * One adequacy criterion. `id` is local to the bundle (D-277g: "criterion
 * identifiers may be local to the bundle. They are useful for validation and
 * feedback without establishing global target identity") — never a claim of
 * cross-instrument identity.
 */
export const explainBackJudgeAdequacyCriterion = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type ExplainBackJudgeAdequacyCriterion = z.infer<typeof explainBackJudgeAdequacyCriterion>;

/**
 * One disqualifier. Same shape as a criterion, kept as its own name because
 * the two mean opposite things at the grader (D-277c): a disqualifier means
 * "cannot receive correct," never "must receive incorrect" — partial stays
 * partial.
 */
export const explainBackJudgeDisqualifier = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type ExplainBackJudgeDisqualifier = z.infer<typeof explainBackJudgeDisqualifier>;

/**
 * The optional bundle itself. Attach as `learningTarget` (an open naming
 * call — D-277g/the brief name the eight inner fields explicitly but never
 * the wrapper key) on `explain-back.judge.v1`'s correctness request only;
 * `explain-back.solo.v1`'s depth request never carries this field at all.
 *
 * `adequacyCriteria` and `sourceBasis` require at least one entry — a
 * specification with zero adequacy criteria or citing no source states
 * nothing checkable; `disqualifiers` may legitimately be empty (not every
 * item has one). These two minimums are this file's own design call, not
 * text D-277 states outright, and are the kind of thing "malformed" refusal
 * exercises in `explain-back-judge-target.spec.ts` pin down.
 */
export const explainBackJudgeLearningTarget = z.object({
  schemaVersion: z.literal(EXPLAIN_BACK_JUDGE_TARGET_SCHEMA_VERSION),
  declaredDemand: explainBackJudgeDemand,
  conditions: z.string().min(1),
  permittedSupport: z.string().min(1),
  adequacyCriteria: z.array(explainBackJudgeAdequacyCriterion).min(1),
  disqualifiers: z.array(explainBackJudgeDisqualifier),
  sourceBasis: z.array(z.string().min(1)).min(1),
  questionBinding: z.string().min(1),
});
export type ExplainBackJudgeLearningTarget = z.infer<typeof explainBackJudgeLearningTarget>;

/**
 * `learningTarget`, optional — the exact shape `explain-back.judge.v1`'s
 * correctness request gains. A caller that never sets this key sends
 * literally the same request it always did (D-277g: "absent means the
 * previous grading path, byte-for-byte in prompt construction and
 * defaults"); a caller that sets it to anything but a valid, versioned bundle
 * is refused rather than silently falling back (D-277g: "malformed or
 * unsupported bundles never silently become trusted criteria and never
 * disappear into legacy fallback").
 */
export const explainBackJudgeLearningTargetField = explainBackJudgeLearningTarget.optional();

/**
 * The response-envelope acknowledgement D-277g requires beyond the brief's
 * own field list ("the response envelope must acknowledge whether a
 * specification was applied, with its digest, so a new caller cannot record
 * as applied what an old server ignored"). Field names are this file's own
 * naming call (Class A) — neither D-277 nor the brief names them.
 *
 * `specificationDigest` identifies *which text* was applied (D-277b), never
 * sameness of asks; it is required exactly when `specificationApplied` is
 * true; and it is what lets a caller that sent a bundle tell "an old server
 * that has no acknowledgement field at all" (deployment skew: the whole
 * response is the older shape) apart from "a new server that received no
 * bundle to apply" (`specificationApplied: false`, no digest) apart from "a
 * new server that applied the bundle it was sent" (`specificationApplied:
 * true`, digest present). A malformed bundle is refused at the envelope
 * level (`errorResponse`, `worker.ts`) rather than reaching this
 * acknowledgement as a false `specificationApplied`.
 */
export const explainBackJudgeSpecificationAcknowledgement = z
  .object({
    specificationApplied: z.boolean(),
    specificationDigest: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.specificationApplied
        ? value.specificationDigest !== undefined
        : value.specificationDigest === undefined,
    {
      message:
        'specificationDigest must be present when specificationApplied is true, and absent otherwise.',
    },
  );
export type ExplainBackJudgeSpecificationAcknowledgement = z.infer<
  typeof explainBackJudgeSpecificationAcknowledgement
>;
