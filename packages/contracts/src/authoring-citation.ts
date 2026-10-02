/**
 * The per-item citation fragment on `quiz.generate.v1` and `cards.generate.v1` (`[D-446]` option
 * (a), decision-sheet row 42; built by `ol-egov.141.89.2.29`). It is the draft-time half of naming
 * the passage an instrument rests on: the reading half is `olea-core`'s `source/passage-identity.ts`
 * and the accept half is the plugin's `sealCitationPassage` call at materialisation.
 *
 * **Why this file exists.** Both authoring tasks' request and response bodies are defined by the
 * Worker and restated by each client caller (see `./authoring-demand.ts` for that convention). This
 * file fixes only the ONE additive fragment the citation adds, so both sides parse it with one
 * definition and the vendored copy in the service makes any drift visible.
 *
 * ===========================================================================
 * THE FRAGMENT
 * ===========================================================================
 * Response only, per question and per card:
 *
 *  - `groundedIn` — the positions, 0-based, in the REQUEST's `sourceChunks` array, of the chunks the
 *    drafting model says the item rests on. Positions in the array the caller sent, never the
 *    numbers the model was shown: the Worker numbers only chunks with groundable content (a
 *    furniture-only chunk takes no number), so a shown number equals a request position only when
 *    nothing before it was dropped. The Worker maps every number back before the field leaves it.
 *
 * The request is unchanged.
 *
 * ===========================================================================
 * WHAT IT IS NOT
 * ===========================================================================
 *  - **Not evidence.** It is the model's own attribution, a claim. The Worker keeps a cited
 *    position only if that chunk shares at least one qualifying word with the item's own text, a
 *    weak floor. A caller lets it name a passage only once the wrong-citation rate is measured,
 *    because a wrong passage digest is worse than none: it would settle a changed passage as
 *    unchanged.
 *  - **Never a reason to fail an item.** Optional; a missing, malformed, empty or out-of-range value
 *    is no citation, and the item ships at whole-note grain. This differs from `declaredDemand`,
 *    which refuses.
 *  - **Not persisted.** A caller derives a passage digest from it (a field its records already
 *    carry) and drops it.
 *
 * ===========================================================================
 * SKEW
 * ===========================================================================
 * A Worker from before this fragment returns no `groundedIn` (its schema strips unknown keys), which
 * reads as no citation, exactly as before. Nothing in the request changes, so there is no
 * request-side skew.
 */

import { z } from 'zod';

/** The tasks whose items carry the fragment. The same pair as `AUTHORING_DEMAND_TASK_IDS`. */
export const AUTHORING_CITATION_TASK_IDS = Object.freeze([
  'cards.generate.v1',
  'quiz.generate.v1',
] as const);
export type AuthoringCitationTaskId = (typeof AUTHORING_CITATION_TASK_IDS)[number];

/**
 * One item's citation: 0-based positions in the request's `sourceChunks`, at least one. The Worker
 * omits the field rather than sending an empty list.
 */
export const authoringGroundedIn = z.array(z.number().int().min(0)).min(1);
export type AuthoringGroundedIn = z.infer<typeof authoringGroundedIn>;

/**
 * The response field, per item. Optional, and a malformed value reads as absent rather than failing
 * the item (`.catch`): a citation never costs an item, and on the Worker a model that writes this
 * field itself cannot spend the one retry on it (the Worker discards a model-written value and
 * writes its own).
 */
export const authoringGroundedInField = authoringGroundedIn.optional().catch(undefined);

/**
 * Reads one item's `groundedIn` against the request it answers. Returns the cited positions when the
 * value is well formed and every position names a chunk the caller sent (`< sentChunkCount`);
 * `undefined` otherwise. One defect voids the whole citation rather than keeping the part that
 * looked right, because a caller must never anchor an item to a chunk the response did not
 * unambiguously name.
 */
export function readAuthoringGroundedIn(
  value: unknown,
  sentChunkCount: number,
): readonly number[] | undefined {
  const parsed = authoringGroundedIn.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data.every((position) => position < sentChunkCount) ? parsed.data : undefined;
}
