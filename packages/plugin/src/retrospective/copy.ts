/**
 * Every string the retrospective view shows her (F8.8, `[POST-1]`/`ol-r68l`,
 * mechanics ruled `[D-134]`).
 *
 * **Why a copy module and not strings in `view.ts`.** Same split
 * `gap/copy.ts` and `course-setup/copy.ts` already draw, for the same
 * reason: every sentence here is a claim this surface makes about her
 * evidence, and F8.8 governs it "with more force rather than less" than any
 * other surface in the product (the temptation to summarise is greatest at
 * the end of something). `view.ts` renders what this module hands it and
 * decides nothing.
 *
 * **These strings are PROPOSED, not ratified.** DSN-2's own kit
 * (`docs/design/dsn2-retrospective/NOTES.md` §3, olea-service) says outright
 * that "every user-facing string on the surface... is written by this
 * drawing under the voice charter and is a proposal" — `[D-134]` approved
 * the drawing's STRUCTURE (three groupings, the stated too-early count, the
 * scope fact occupying the no-score headline position), never a specific
 * sentence. What follows is this bead's own attempt at those constraints,
 * Class B (a reversible default), not a second ratification.
 *
 * **Constraints this module must satisfy on every string it returns:**
 *
 *  - **No score, no percentage, no ratio** (F8.3, cited by F8.8 "with more
 *    force"). Every function below composes independent counts into a
 *    sentence; none divides one by another.
 *  - **No claim about the paper** (F4.9, principle 10). Olea holds review
 *    evidence, never an opinion about how the assessment went.
 *  - **No verdict** (principle 12): fact and consequence, nothing about
 *    effort, discipline or lateness.
 *  - **No warmth** (registry §9 V5): the end of an assessment is not on the
 *    closed list of marked moments, so nothing here celebrates.
 *  - **V1**: the subject is her material or Olea's own evidence limits, not
 *    "Olea did X to her" framing.
 *
 * **INV-1.** No `obsidian` import here — unit-tested under Vitest, which is
 * the whole point of the split.
 */

import type {
  RetrospectiveCarriesLine,
  RetrospectiveConceptLine,
  RetrospectiveOfferStatus,
  RetrospectiveReading,
  RetrospectiveScopeOrigin,
} from 'olea-core';

export const RETROSPECTIVE_VIEW_TITLE = 'Assessment retrospective';

/** Registry §1 display words — the vitality axis, verbatim, never abbreviated. */
export function vitalityLabel(vitality: RetrospectiveConceptLine['vitality']): string {
  switch (vitality) {
    case 'holding':
      return 'holding';
    case 'tending':
      return 'needs tending';
    case 'early':
      return 'too early to say';
  }
}

/**
 * The headline, filling the space a grade would occupy — DSN-2's central
 * finding, structurally approved by `[D-134]`. A count with its source,
 * never a quotient (F8.3), and the honesty clamp stated up front (F4.9):
 * Olea holds review evidence and nothing about the paper.
 */
export function scopeFactLine(reading: RetrospectiveReading): string {
  const noun = reading.scopeCount === 1 ? 'concept' : 'concepts';
  return (
    `${reading.course}'s assessment covered ${reading.scopeCount} ${noun}. ` +
    'Olea holds review evidence for them, and nothing about the assessment itself.'
  );
}

/**
 * D-134 Q6: the scope's origin is stated, visibly, so a stated fact (F1.7)
 * and an evidence-derived set never borrow each other's authority.
 */
export function scopeOriginLine(origin: RetrospectiveScopeOrigin): string {
  return origin === 'assessment-stated'
    ? 'source · the assessment’s own recorded scope'
    : 'source · drawn from your review history, not the assessment’s own words';
}

export const HELD_SECTION_HEADING = 'What held';
export const FADED_SECTION_HEADING = 'What faded';
export const CARRIES_SECTION_HEADING = 'What carries forward';

/**
 * DSN-2 `NOTES.md` §1 / `README.md`, structurally approved: a STATED COUNT,
 * never a fourth grouping. Phrased as two counts read together, never a
 * computed fraction or percentage — no division happens here.
 */
export function tooEarlyCountLine(reading: RetrospectiveReading): string | null {
  if (reading.tooEarlyCount === 0) return null;
  const noun = reading.tooEarlyCount === 1 ? 'concept has' : 'concepts have';
  return (
    `${reading.tooEarlyCount} of the ${reading.scopeCount} ${noun} no completed practice ` +
    'review yet — too early to say anything durable about them.'
  );
}

/** One line for a held/faded concept — F2.11 co-presence: stage and vitality, always together. */
export function conceptLine(line: RetrospectiveConceptLine): string {
  return `${line.conceptName} — ${line.stage}, ${vitalityLabel(line.vitality)}`;
}

/**
 * One "what carries" line. `otherCourses` names every other course sharing
 * the concept (never narrowed to one, per F8.7's own rule); the same-course
 * fallback (D-134 Q3) reads against the term's last assessment instead.
 */
export function carriesLine(line: RetrospectiveCarriesLine): string {
  if (line.otherCourses.length > 0) {
    const courseNoun = line.otherCourses.length === 1 ? 'course' : 'courses';
    return `${line.conceptName} — also in scope for ${line.otherCourses.join(', ')} (${courseNoun})`;
  }
  return `${line.conceptName} — carries into this course's own remaining assessment`;
}

/**
 * DSN-2 draws a concept row as two columns, not one sentence: the name, and a
 * quiet column carrying the stage and vitality together
 * (`docs/design/dsn2-retrospective/retrospective-surface.html:90-93`, and the
 * rows in frames 04-06). `conceptLine` / `carriesLine` above are the one-line
 * form the vault note is written from (`note-writer.ts`) and are unchanged;
 * these four are the same content split for the screen.
 *
 * They are deliberately a PAIR. F2.11's co-presence rule (`[D-116]`) says a
 * surface carries both axes or neither, and the drawing's own note on frame 04
 * says why it binds hardest here: `holding` is the value carrying no mark, so a
 * stage rendered alone is indistinguishable from one rendered as holding, and
 * "the omission reads as the most flattering of the three". A caller rendering
 * `conceptRowName` without `conceptRowDetail` is making exactly that omission.
 */
export function conceptRowName(line: RetrospectiveConceptLine): string {
  return line.conceptName;
}

export function conceptRowDetail(line: RetrospectiveConceptLine): string {
  return `${line.stage}, ${vitalityLabel(line.vitality)}`;
}

export function carriesRowName(line: RetrospectiveCarriesLine): string {
  return line.conceptName;
}

export function carriesRowDetail(line: RetrospectiveCarriesLine): string {
  if (line.otherCourses.length > 0) {
    const courseNoun = line.otherCourses.length === 1 ? 'course' : 'courses';
    return `also in scope for ${line.otherCourses.join(', ')} (${courseNoun})`;
  }
  return "carries into this course's own remaining assessment";
}

/**
 * The count in a grouping's panel head (`retrospective-surface.html:331`,
 * `.bar .meta`). A count of the rows directly beneath it, with the grouping as
 * its own denominator — never a quotient, and never added to another
 * grouping's count (F8.3; F6.2 binds harder still on the carries section,
 * which is an overlay rather than a third bucket).
 */
export function sectionCountLine(count: number): string {
  return `${count} ${count === 1 ? 'concept' : 'concepts'}`;
}

/** No mark, no percentage, no claim about the paper — F8.3/F4.9, stated once rather than repeated per line (D-134 Q2). */
export const HONESTY_DISCLAIMER =
  'This reading comes from your practice history alone. Olea never saw the assessment and never saw your answers.';

/**
 * F8.8: "small, and offered once ... it stays available from the course
 * afterwards and does not chase her." The empty-scope case still needs a
 * sentence — silence would read as a broken screen, not as "no evidence
 * gathered".
 */
export function emptyScopeLine(): string {
  return 'No review evidence was gathered for this assessment’s concepts before it passed.';
}

/**
 * F8.8 free text (Sep 2026, `[D-190]`): "on acceptance she may add an
 * optional line of her own, offered at the moment she keeps the note,
 * written beneath a heading of her own in the same note — read by nothing".
 * The heading her line lands under, once she supplies one. Echoes the
 * registry's own "in your own words" phrasing (§1, the `tree` stage) —
 * the same idea of her unassisted wording, applied here to a line about
 * herself rather than a graded explanation of a concept — while remaining a
 * plain heading, not a registry term.
 */
export const OWN_WORDS_SECTION_HEADING = 'In your own words';

/**
 * Offered ONLY at the keep gesture (`[D-190]`) — not a box on the reading
 * itself, so this string is never rendered until she has already chosen to
 * accept. States the guarantee plainly rather than leaving her to assume
 * it: nothing reads the line back (D-190's structural "no reader" argument),
 * and it is never logged (D-005 — counts only, never content).
 */
export const OWN_WORDS_PROMPT =
  'Add a line of your own, if you want one. It is saved with this note, under its own heading — nothing in Olea reads it.';

/** Placeholder text for the optional single-line input — never persisted itself. */
export const OWN_WORDS_PLACEHOLDER = 'Optional, one line, yours alone';

/**
 * The standing offer card's copy (D-134 Q1: "one standing card that stays
 * visible until opened or dismissed"). `null` means no card should be shown
 * at all — `view.ts`/whatever future Home-or-grove host renders this must
 * treat `null` as "nothing to draw", never as an empty card.
 *
 * **Not wired to any live surface as of this bead** — see
 * `offer-card.ts`'s module doc for why (neither Home nor the grove exist yet
 * as plugin views).
 */
export function offerCardLine(status: RetrospectiveOfferStatus, course: string): string | null {
  if (status !== 'offered') return null;
  return `${course}'s assessment has passed. A short retrospective is ready when you are.`;
}
