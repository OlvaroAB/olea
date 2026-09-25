/**
 * `[ol-egov.141.89.6.18]`: whether `ExplainBackModal`'s `computeAcceptGrading`
 * (`./modal.ts`) may treat THIS attempt as the first full-depth explanation
 * of its concept ever — the gate `explainBackFullDepthEncouragement`
 * (`../review/copy.ts`) documents itself as needing and that, until this
 * bead, no caller supplied (that function's own doc: "No caller does so
 * yet"). `modal.ts`'s only caller called it unconditionally whenever the
 * accept result was `'accepted'`, so a REPEAT full-depth explanation of an
 * already-mastered concept printed the milestone sentence again — a fact
 * Olea had not measured (F6.8, "no invented progress"), and in effect a
 * correctness/depth verdict printed via wording (`[D-217]`).
 *
 * A separate, `obsidian`-free file rather than a function inside `modal.ts`
 * itself: `modal.ts` imports Obsidian's `Modal`, and `obsidian`'s
 * `package.json` `main` is `""`, so nothing that file exports can be
 * imported under Vitest at all (`modal-duration.spec.ts`'s own module doc).
 * `./solo-review.ts` already draws this same line for the same reason; this
 * file follows it so the gate is directly, behaviourally testable rather
 * than only checkable by matching source text.
 *
 * **Safe default: unconfirmed.** Returns `false` whenever first-time-ness
 * cannot actually be checked:
 * - `getMasteryState` is not wired — `main.ts`'s current
 *   `openExplainBackModal` construction call omits it (see that field's own
 *   doc on `ExplainBackModalDeps`, `./modal.ts`), so production behaviour
 *   today is the safe, suppressed default until a lane wires it.
 * - the attempt has no concept — a free-form, topic-seeded entry
 *   (`subjectConceptId === null`) has no growth stage to read at all.
 * - the growth stage itself reads as unknown (`null`). This is never
 *   treated as "not tree" by default — an unknown state means firstness is
 *   unconfirmed, not confirmed.
 *
 * **Where `getMasteryState` IS wired and returns a known stage:** growth
 * stage `tree` is a high-water mark reachable only through an explain-back
 * graded at sufficient depth (`olea-core`'s `mastery/rollup.ts` module doc,
 * R7/`[D-281]`) and it never regresses once reached. So a PRE-attempt read
 * of `tree` means a qualifying full-depth explanation already happened at
 * some earlier occasion — this attempt cannot be the first, whatever it
 * grades as now. Any other known stage (`seed`/`sprout`/`sapling`) means no
 * such explanation has ever landed, so this attempt, if it otherwise
 * qualifies, genuinely can be the first.
 *
 * **Call this BEFORE any write the accept flow makes** (the correctness
 * accept, then `deps.recordSoloGradeAndReview`'s own SOLO write) — a read
 * taken after either write could see the very attempt being graded and
 * always answer "not the first" for the wrong reason, or (if the mastery
 * projection lags the write) the right answer by accident. `modal.ts`'s
 * `computeAcceptGrading` resolves this at the top of the function for
 * exactly that reason.
 */

import type { MasteryState } from 'olea-contracts';

export function isConfirmedFirstFullDepth(
  subjectConceptId: string | null,
  getMasteryState: ((conceptId: string) => MasteryState | null) | undefined,
): boolean {
  if (getMasteryState === undefined || subjectConceptId === null) return false;
  const state = getMasteryState(subjectConceptId);
  return state !== null && state !== 'tree';
}
