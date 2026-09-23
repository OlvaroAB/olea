/**
 * Retrieval's request vocabulary for the evidence-and-sufficiency chain
 * (`docs/dev/intelligence-build/evd.md` §2, `[ILB-EVD-4]`).
 *
 * Pure vocabulary — no logic, and (like `types.ts` beside it) deliberately no
 * spec file of its own. **Not wired anywhere**: nothing in this package
 * builds a `RetrievalRequest` today, and no production caller constructs
 * one. These types exist so `applyScope` (`scopeFilter.ts`) and a future
 * chain-4 wiring bead (`[ILB-EVD-5]`) share one vocabulary rather than each
 * inventing its own strings for the same four consumers.
 *
 * **`operation` reuses `groundedContext.ts`'s existing five-way union
 * (`IntendedOperation`) rather than a second enum** — `evd.md` §2's request
 * shape (`request {purpose, conceptKey, conceptName, operation, scope}`)
 * names the same "define/explain/calculate/apply/compare" operation
 * `GroundingJudgeRequest.intendedOperation` already carries; inventing a
 * parallel union here would let the two drift.
 */

import type { IntendedOperation } from './groundedContext.js';

/**
 * Which of `evd.md` §1's four consumers is asking. Named for the consumer's
 * own question, not for the mechanism it happens to use today —
 * `instrument-evidence` is instrument drafting's "is there enough evidence
 * to author from"; the other three consume retrieval without a sufficiency
 * judgment of their own (`evd.md` §1's table).
 */
export type RetrievalPurpose =
  | 'instrument-evidence'
  | 'explain-why'
  | 'explain-back'
  | 'misconception-match';

/**
 * Which course-scoped material a request may draw from. `courses` is a list
 * of course codes (the same codes `../concept/course.ts`'s `courseFromPath`
 * derives, or a note's own `course` frontmatter — this type says nothing
 * about how a caller got them); `includeUncoursed` decides whether material
 * with no course at all is in or out. See `scopeFilter.ts`'s `applyScope`
 * for the policy this scope is applied under.
 */
export interface RetrievalScope {
  readonly courses: readonly string[];
  readonly includeUncoursed: boolean;
}

/**
 * `evd.md` §2's target request shape, narrowed to the fields this bead's
 * pure-logic slice actually uses — `conceptKey`/`conceptName` are a specific
 * consumer's concern (instrument drafting's existing request shape,
 * `packages/plugin/src/retrieval/draft-quiz-cards.ts`, outside this
 * package's scope) rather than something every purpose carries, so they are
 * left out rather than guessed at here. `operation` is optional because not
 * every purpose asks one today (`evd.md` §1's table: explain-back and
 * misconception-match retrieve without an operation).
 */
export interface RetrievalRequest {
  readonly purpose: RetrievalPurpose;
  readonly operation?: IntendedOperation;
  readonly scope: RetrievalScope;
}
