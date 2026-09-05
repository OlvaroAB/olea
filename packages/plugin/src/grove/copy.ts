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
 *
 * **The shrink receipt (`[D-184]`, F1.5(c)/F8.1/F8.3, `ol-v7r5.29`).**
 * `groveScopeCorrectionReceiptLine` is the one additional line F8.1's "the
 * same honesty runs in reverse" sentence promises: shown once, beside
 * `groveSummaryLine`'s own count, only on the read immediately after a
 * document's classification was corrected AWAY from a declared role and the
 * denominator fell as a result (`../../../core/src/scope/grove.ts`'s module
 * doc — the shrink is the SAME `buildGroveModel` path an addition already
 * uses, never a second one). It is never shown for a growth — F1.5(c)
 * already treats a growing denominator as "the system working," and
 * `groveSummaryLine`'s own updated numbers say that without ceremony.
 * **Not yet wired to a production caller**: the call site needs a durable
 * "prior `denominatorCount` per course" store, the same `data.json`
 * read-modify-write shape `./ground-streak-store.ts` already uses for its
 * own per-install state — `./provider.ts` and `./view.ts` are outside this
 * module's own `owns` set, so that wiring is follow-up work, named here so
 * it is not lost (see this bead's close notes).
 *
 * **The coverage split (`ol-l5og.18.18`, STY-8, fix item 2).**
 * `groveCoverageSplitLine` is a second templated line, rendered beside
 * `groveSummaryLine`'s own count on a `'declared'` course — see its own doc
 * for what it does and does not port from the kit.
 */

import type {
  GroveCourseSummary,
  GroveDeclaredState,
  UnreadableReason,
  VaultPath,
} from 'olea-core';
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

/**
 * The screen-level empty state (WBX-18, `ol-qm6u`): no course was found ANYWHERE in the vault —
 * `GroveViewState`'s `'model'` branch with zero `courses`, distinct from `GROVE_NO_SOURCE_*`
 * (a known course with nothing registered for it). Never a bare title with nothing under it —
 * same "never a bare, unexplained empty grid" principle F8.1's own designed empty state states
 * for the per-course case, applied one level up.
 */
export const GROVE_NO_COURSES_HEADING = 'No courses found yet';
export const GROVE_NO_COURSES_BODY =
  "Olea hasn't found any course in your vault yet. Register an objectives document or a past paper for a course (F1.5) to see its grove here.";

/** Plain-language label for a material gap (F4.10) — never a fourth olive noun (registry §6). */
export const GROVE_MATERIAL_GAP_LABEL = 'No material yet';

/**
 * `[D-196]`, F1.5(b), F8.1: heading over the unreadable-file list, shown
 * beside the designed-state ask and the readiness reading — never a
 * standing page of its own (the ruling explicitly rejects one).
 */
export const GROVE_UNREADABLE_HEADING = "Files Olea couldn't read here";

/**
 * The three `UnreadableReason` labels, verbatim from `[D-196]`'s own
 * wording — "a reason describes the reader, never the file." Each names the
 * lever available to her, per brief 36's lever test: convert the format,
 * re-save with real text, or register the file (F1.5) — the third is why
 * the ask and this list share one surface.
 */
const GROVE_UNREADABLE_REASON_LABEL: Readonly<Record<UnreadableReason, string>> = {
  'no-reader-for-format': 'No reader for this format yet — try converting it.',
  'image-only-no-text': 'Image only — no text found. Re-saving with a text layer may help.',
  'not-linked': 'Nothing here links to it yet — register it (F1.5) to include it.',
};

/** The label for one `UnreadableReason` — see `GROVE_UNREADABLE_REASON_LABEL`. */
export function groveUnreadableReasonLabel(reason: UnreadableReason): string {
  return GROVE_UNREADABLE_REASON_LABEL[reason];
}

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

/**
 * `ol-l5og.18.18` (STY-8), fix item 2 — the kit's own `growing / ground / no
 * material` three-way split (`Pass5bCoverage.jsx`'s `CandEGrove` header line:
 * "`{PLANTED_TOTAL}` have something growing · `{GROUND_TOTAL}` are ground,
 * waiting on Olea · `{NOMATERIAL_TOTAL}` have no material of yours yet").
 * **Only the presentational half of that fix** — the three counts are already
 * on `GroveCourseModel`'s `'declared'` branch (`cells.length -
 * summary.builtCount` for ground, `materialGaps.length` for the third), so
 * this is a render, not a new computation. **The kit's other half, a week
 * counter, is NOT ported here** — no field anywhere on `GroveCourseModel`,
 * `GroveCourseSummary` or the pipeline that builds them carries "which week
 * of the course this is," and no such computation exists elsewhere in this
 * codebase to reuse (checked: no `WeekContext`/`courseWeek` helper exists).
 * That is a data gap, not a styling one — same shape as the per-syllabus-unit
 * grouping `grove/view.ts`'s own module doc already declines to fabricate.
 * Three counts side by side, never their quotient — same F8.3 shape
 * `groveSummaryLine` already uses, just split three ways instead of two.
 */
export function groveCoverageSplitLine(
  growingCount: number,
  groundCount: number,
  materialGapCount: number,
): string {
  return `${growingCount} growing, ${groundCount} ground, ${materialGapCount} no material yet.`;
}

/**
 * F8.1's "same honesty runs in reverse" receipt (`[D-184]`, `ol-v7r5.29`):
 * shown ONCE, beside `groveSummaryLine`'s own count, on the read
 * immediately after a correction to a document's classification has
 * shrunk the denominator — never on a growth (F1.5(c) already treats that
 * as unremarkable; `groveSummaryLine`'s new numbers alone are the honest
 * statement of it). States two facts and nothing else — the document
 * that was reclassified, and the count it replaces — never a percentage
 * or a judgement about the correction ("this document was reclassified" is
 * a fact, not a fault).
 *
 * The caller is responsible for calling this ONLY when a shrink actually
 * happened (`newDenominatorCount < priorDenominatorCount`) — this function
 * states whatever numbers it is given rather than re-deciding direction,
 * matching `groveSummaryLine`'s own "never re-derive, only render" posture.
 */
export function groveScopeCorrectionReceiptLine(
  reclassifiedDocumentPath: VaultPath,
  priorDenominatorCount: number,
  newDenominatorCount: number,
): string {
  return (
    `${reclassifiedDocumentPath} was reclassified — this course's scope count ` +
    `updated from ${priorDenominatorCount} to ${newDenominatorCount}.`
  );
}

/**
 * `ol-l5og.18.2`, F8.1's grid styling pass, the kit's `Papers` mark
 * (`Pass5bCoverage.jsx`): "how often the exam has asked this... a weight,
 * not a score." Same sanctioned shape as `groveSummaryLine` — a count and a
 * denominator, side by side, never their quotient. `total` is the number of
 * REGISTERED past papers (`GroveCourseSummary.pastPaperSourcePaths.length`),
 * never a claim about how many exist; the caller renders nothing at all when
 * `total` is `0` (no past paper registered — an objectives document alone
 * can still make a course `'declared'`), matching that field's own doc.
 */
export function grovePapersLabel(citedIn: number, total: number): string {
  const paperNoun = total === 1 ? 'past paper' : 'past papers';
  return `Asked in ${citedIn} of ${total} registered ${paperNoun}.`;
}

/**
 * The grove's own legend (`ol-l5og.18.2`, F8.1's grid styling pass) — the
 * four growth-stage words get their label from `groveStateLabel` already;
 * these three cover what a legend needs to say and `groveStateLabel`/
 * `GROVE_MATERIAL_GAP_LABEL` do not already say on their own.
 */
export const GROVE_LEGEND_GROUND_NOTE =
  'Ground — your notes are here, nothing built from them yet.';
export const GROVE_LEGEND_MATERIAL_GAP_NOTE = `${GROVE_MATERIAL_GAP_LABEL} — nothing of yours to build from yet.`;
export const GROVE_LEGEND_PAPERS_NOTE =
  'Ticks show how many of the registered past papers asked this — a fact about the exam, never about you.';

/** Every string this module can render, for `test/grove/copy.spec.ts`'s honesty checks. */
export function allGroveStrings(): readonly string[] {
  return [
    GROVE_VIEW_TITLE,
    GROVE_UNAVAILABLE,
    GROVE_NO_SOURCE_HEADING,
    GROVE_NO_SOURCE_BODY,
    GROVE_INFERRED_DISCLAIMER,
    GROVE_EMPTY_COURSE,
    GROVE_NO_COURSES_HEADING,
    GROVE_NO_COURSES_BODY,
    GROVE_MATERIAL_GAP_LABEL,
    GROVE_UNREADABLE_HEADING,
    GROVE_VOLUNTEER_SECTION_HEADING,
    GROVE_VOLUNTEER_SECTION_NOTE,
    GROVE_GROUND_STALL_NOTE,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
    GROUND_LABEL,
    GROVE_LEGEND_GROUND_NOTE,
    GROVE_LEGEND_MATERIAL_GAP_NOTE,
    GROVE_LEGEND_PAPERS_NOTE,
    ...(['seed', 'sprout', 'sapling', 'tree'] as const).map((s) => MASTERY_DISPLAY[s].label),
    ...(['no-reader-for-format', 'image-only-no-text', 'not-linked'] as const).map(
      groveUnreadableReasonLabel,
    ),
  ];
}
