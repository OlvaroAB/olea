/**
 * Every user-facing string `GroveView` can render (F8.1, F8.2, F8.3,
 * `ol-0r92.17`, real six-state computation `ol-o8eo`).
 *
 * One vocabulary site, same convention `today/copy.ts` and `gap/copy.ts`
 * hold for their own screens — `test/grove/copy.spec.ts` asserts over
 * `allGroveStrings()` so a string added here without adding it there is the
 * one way past the honesty test.
 *
 * **Vocabulary discipline (`docs/Olea_vocabulary_registry.md` §6).** Exactly
 * three olive nouns exist for this layer — `grove`, `ground`, `volunteer` —
 * and a **material gap** is deliberately named in plain language, never a
 * fourth olive noun (the registry's own "ground correction" ruling). The
 * four growth-stage words (`seed`/`sprout`/`sapling`/`tree`, F2.11) are used
 * verbatim, never re-worded, when mastery is read alongside scope — this
 * module never re-labels them, it reads `MASTERY_DISPLAY` from `olea-core`.
 *
 * **F8.3's ban is absolute here**: no percentage, ratio or single completion
 * figure may ever appear, on this screen or any other. `groveSummaryLine`
 * is the one templated string this module produces (the count and the
 * denominator's source, per concept summary) — `test/grove/copy.spec.ts`
 * sweeps a set of REPRESENTATIVE summaries through it (matching `gap/
 * copy.ts`'s own `coverageScopeStatement` convention) rather than trusting
 * `allGroveStrings()` alone, because a templated function's output is not a
 * fixed string `allGroveStrings()` could ever enumerate.
 *
 * **This module does not rename anything `ol-z0j9` left open.** The view
 * title, the command and `VIEW_TYPE_OLEA_GROVE` are unchanged — only the
 * copy a `'declared'` vs. `'inferred'` vs. `'no-registered-source'` course
 * now renders differs, per `./provider.ts`'s real `GroveCourseModel`.
 */

import type { GroveCourseSummary, GroveDeclaredState } from 'olea-core';
import { MASTERY_DISPLAY } from 'olea-core';

export const GROVE_VIEW_TITLE = 'Grove';

export const GROVE_UNAVAILABLE = 'Olea could not read your vault just now.';

/** F8.1 scenario 2's designed empty state — a course with no registered objectives document or past paper, and nothing of her own yet either. Never a bare, unexplained empty grid. */
export const GROVE_NO_SOURCE_HEADING = 'No grove yet';
export const GROVE_NO_SOURCE_BODY =
  'No objectives document or past paper has been registered for this course yet. Register one (F1.5) to see its grove.';

/**
 * F8.1 scenario 3's escape hatch, unchanged in wording from the `ol-0r92.17`
 * stand-in: renders on an `'inferred'` course, every time — never once and
 * then assumed. It deliberately never uses the word "grove" for the count
 * itself (`features/F8-concepts-scope.md`'s "a grove Olea alone inferred is
 * labelled a guess and never uses the word 'grove'" scenario) — the heading
 * above it names the screen, this line names the reading.
 */
export const GROVE_INFERRED_DISCLAIMER =
  'Built from what Olea has found in your notes for this course — not yet checked against a registered reading list or past paper.';

export const GROVE_EMPTY_COURSE = 'No concepts found here yet.';

/** Plain-language label for a material gap (F4.10) — never a fourth olive noun (registry §6). */
export const GROVE_MATERIAL_GAP_LABEL = 'No material yet';

/** Section heading over `volunteer` concepts — outside the declared count, never hidden (F8.2). */
export const GROVE_VOLUNTEER_SECTION_HEADING = 'Also growing here';
export const GROVE_VOLUNTEER_SECTION_NOTE =
  "Found in your notes, but not named by this course's registered objectives or past papers.";

/** F4.5's stall note for a persisting `ground` cell — information, never a verdict, never "not worth building" (`[D-063]`). */
export const GROVE_GROUND_STALL_NOTE = 'Still queued — this is taking longer than usual to build.';

export const OPEN_RETROSPECTIVE_ACTION = 'Open';

export const DISMISS_OFFER_ACTION = 'Not now';

/** `ground`'s own label — the one olive noun in this axis with no `MASTERY_DISPLAY` entry (it is not a growth stage). */
const GROUND_LABEL = 'ground';

/** The label for one of the five in-scope states (`ground` plus the four growth-stage words) — F2.11's words verbatim, never re-worded here. */
export function groveStateLabel(state: GroveDeclaredState): string {
  return state === 'ground' ? GROUND_LABEL : MASTERY_DISPLAY[state].label;
}

/**
 * F8.3's own sanctioned shape for a `'declared'` course's summary — the
 * count and the denominator's source, side by side, **never their
 * quotient**. `${builtCount} of ${denominatorCount}` states two facts, not
 * a division; matches `gap/copy.ts#coverageScopeStatement`'s identical
 * "read N of your M sources" convention for the same reason: naming both
 * numbers is what F8.1's own "a past paper registered in week seven grows
 * the denominator" scenario needs to stay safe to show.
 */
export function groveSummaryLine(summary: GroveCourseSummary): string {
  const sourceNoun = summary.denominatorSourcePaths.length === 1 ? 'source' : 'sources';
  return (
    `${summary.builtCount} of ${summary.denominatorCount} built, ` +
    `from ${summary.denominatorSourcePaths.length} registered ${sourceNoun}.`
  );
}

/** Every string this module can render, for `test/grove/copy.spec.ts`'s honesty checks. */
export function allGroveStrings(): readonly string[] {
  return [
    GROVE_VIEW_TITLE,
    GROVE_UNAVAILABLE,
    GROVE_NO_SOURCE_HEADING,
    GROVE_NO_SOURCE_BODY,
    GROVE_INFERRED_DISCLAIMER,
    GROVE_EMPTY_COURSE,
    GROVE_MATERIAL_GAP_LABEL,
    GROVE_VOLUNTEER_SECTION_HEADING,
    GROVE_VOLUNTEER_SECTION_NOTE,
    GROVE_GROUND_STALL_NOTE,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
    GROUND_LABEL,
    ...(['seed', 'sprout', 'sapling', 'tree'] as const).map((s) => MASTERY_DISPLAY[s].label),
  ];
}
