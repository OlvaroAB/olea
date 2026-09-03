/**
 * Every string the registry view shows her (F8.4/F8.5, `[REG-1]`, `ol-4v2l`,
 * `[D-135]`). Same split `retrospective/copy.ts` draws, for the same reason:
 * `view.ts` renders what this module hands it and decides nothing, so the
 * vocabulary this surface owes to `docs/Olea_vocabulary_registry.md` lives in
 * exactly one place.
 *
 * **These strings are PROPOSED, not ratified** — Class B, this bead's own
 * report, reversible. What IS ratified, and binding on every string here:
 *
 * - **No `Delete`, anywhere, and no dialog explaining that delete is not
 *   really delete** (F8.5's hard clamp). Every withdrawal affordance below
 *   says *withdraw* / *restore*.
 * - **`graft` is never printed; `offshoot` stays internal** (`[D-135]`).
 *   This view does not print either — it has no split/merge surface at all
 *   (F8.6, `[D-135]`: not in v0.9), so the question does not arise, and no
 *   function here accepts a lineage argument that could tempt one into being
 *   added later.
 * - **"Pruning" is triage vocabulary, not this surface's** (registry §3:
 *   "mostly internal and triage-facing — prefer the plain term in
 *   student-facing copy"). *Withdraw* / *restore* are that plain term.
 * - **Mastery vocabulary is F2.11's, verbatim** (`../../core/mastery/display`'s
 *   `MASTERY_DISPLAY` for stage; the three vitality words below, matching
 *   `retrospective/copy.ts`'s own `vitalityLabel`).
 * - **One concept, stated — never a ladder or a field** (vocabulary registry
 *   §1's own width table: "One concept · any width · Neither — a single
 *   concept has no distribution; stage and vitality, stated"). This view
 *   shows one concept per row, so every mastery line here is prose, never a
 *   sprig or a distribution.
 * - **Facts about the vault and its instruments, never about her compliance**
 *   (this bead's brief). Nothing here says "you haven't reviewed this" or
 *   "you should study this concept" — every sentence states what Olea holds,
 *   never what she has or hasn't done about it.
 * - **F8.4b (`[D-175]`) adds the per-instrument explain-back history line**
 *   (`explainBackHistoryRowLine` and its helpers below) — genuinely NEW
 *   copy, permitted because F8.4b's own ratified clause defines this
 *   surface. No scoreboard: one attempt, one date, one depth phrase, never
 *   a total or a streak.
 *
 * **INV-1.** No `obsidian` import here — unit-tested under Vitest.
 */

import type { SoloLevel } from 'olea-contracts';
import {
  formatSourceCitation,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type RegistrySourceLocation,
  type Vitality,
} from 'olea-core';

/**
 * F8.4b's per-instrument explain-back history row. Derived by indexed
 * access rather than imported by name: `RegistryExplainBackHistoryRow`
 * (`packages/core/src/registry/types.ts`) is not yet re-exported from
 * `olea-core`'s package index — that file has a live concurrent edit from
 * another lane this run found in progress, and this bead's `owns` does not
 * cover it. `RegistryInstrumentSummary` (already exported) carries the same
 * shape on its `explainBackHistory` field, so this alias needs no index.ts
 * change at all. Safe to replace with a direct import once that export
 * lands.
 */
type ExplainBackHistoryRow = RegistryInstrumentSummary['explainBackHistory'][number];

export const REGISTRY_VIEW_TITLE = 'Concepts and instruments';

export const REGISTRY_EMPTY_LINE =
  'Olea has not found any concepts in this vault yet — nothing to browse.';

export const REGISTRY_UNAVAILABLE_LINE = 'Olea could not read your vault just now.';

/** F2.11 axis 2, in the registry's own words — matching `retrospective/copy.ts`'s `vitalityLabel` mapping (registry §1), since vitality has one ratified word set and this view renders it independently of that module (see this file's doc). */
export function vitalityLabel(vitality: Vitality): string {
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
 * The stated stage-and-vitality line for one concept row (vocabulary
 * registry §1: "a single concept has no distribution; stage and vitality,
 * stated"). `stageLabel` is `MASTERY_DISPLAY[state].label`, passed in so
 * this module needs no dependency beyond the type it already imports for
 * `Vitality`.
 */
export function masteryStatedLine(
  stageLabel: string,
  vitality: RegistryConceptEntry['vitality'],
): string {
  return `${stageLabel} — ${vitalityLabel(vitality.value)}`;
}

/** The course-association line (C7.2, M:N) — a fact about the vault, never ranked or judged. */
export function coursesLine(courses: readonly string[]): string {
  if (courses.length === 0) return 'No course association yet.';
  const noun = courses.length === 1 ? 'course' : 'courses';
  return `${noun}: ${courses.join(', ')}`;
}

/** Display-only alias note (F8.4's rename) — states the fact of a prior name, never a claim about why it changed. */
export function aliasesLine(aliases: readonly string[]): string | null {
  if (aliases.length === 0) return null;
  const noun = aliases.length === 1 ? 'name' : 'names';
  return `Previous ${noun}: ${aliases.join(', ')}`;
}

/** F2.16 — explain-back is recorded, never scored into the instrument mix (see `../../core/registry/build.ts`'s doc). States the count, nothing about whether it is "enough". */
export function explainBackLine(summary: RegistryConceptEntry['explainBack']): string | null {
  if (!summary.attempted) return null;
  const noun = summary.attemptCount === 1 ? 'time' : 'times';
  return `Explained back ${summary.attemptCount} ${noun}.`;
}

/**
 * F8.4b's SOLO-depth reading, in the reporting voice (GLOSSARY SOLO rule 5:
 * the raw level name and a number are both forbidden to her; rule 1: grade
 * the response, never label the student — "this explanation connects two
 * ideas" is legal, "you are at multistructural level" is not). These five
 * phrases are new copy this bead coins under F8.4b's own permission ("new
 * copy strings are permitted here because F8.4b defines the surface") —
 * there is no prior ratified SOLO-depth wordlist anywhere in this codebase
 * or the vocabulary registry to reuse. The top phrase, "full depth", is not
 * invented: it matches `docs/Olea_vocabulary_registry.md` §9's own V5
 * worked example ("explained at full depth") verbatim, rather than a second
 * phrase for the same idea. `no scoreboard` (F8.4b): this reads one
 * attempt's depth, never a running total or a streak.
 */
export function explainBackDepthPhrase(soloLevel: SoloLevel): string {
  switch (soloLevel) {
    case 'prestructural':
      return 'at surface level';
    case 'unistructural':
      return 'with one point made';
    case 'multistructural':
      return 'with several points, not yet connected';
    case 'relational':
      return 'with the points tied together';
    case 'extended-abstract':
      return 'at full depth';
  }
}

/**
 * F8.4b: "formatted per existing date conventions... no new date format
 * introduced here" — reuses `course-setup/copy.ts`'s `lastCorrectClause`
 * convention (`12 Aug 2026`, `en-GB`, short month) rather than inventing a
 * second scheme for the registry. Not imported from that module directly
 * (a different feature's owned file); the three format options are the
 * whole of what would be shared, so restating them here costs less than a
 * cross-feature dependency for three literals.
 */
function historyDateLabel(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** F8.4b's `[D-095]` contested marker — names the re-review state, exactly as the clause requires, never silently dropping the reading it is about. */
export const EXPLAIN_BACK_HISTORY_CONTESTED_MARKER = 'under re-review';

export const EXPLAIN_BACK_HISTORY_HEADING = 'Explain-back history';

/**
 * F8.4b's one history row: "Explained [depth phrase] on [date]", with the
 * `[D-095]` contested marker appended when this row is the instrument's
 * current graded attempt and it is presently quarantined. Never the raw
 * `soloLevel` name, never a number, and never the student's answer text or
 * the grader's feedback — those stay behind `[D-077]`'s content store,
 * which this surface never resolves.
 */
export function explainBackHistoryRowLine(row: ExplainBackHistoryRow): string {
  const line = `Explained ${explainBackDepthPhrase(row.soloLevel)} on ${historyDateLabel(row.timestamp)}.`;
  return row.contested ? `${line} (${EXPLAIN_BACK_HISTORY_CONTESTED_MARKER})` : line;
}

/** F8.5's withdrawal state, at either grain — a fact about the record, never a verdict. */
export const WITHDRAWN_LABEL = 'Withdrawn';
export const WITHDRAWN_NOTE =
  'Withdrawn from circulation. Nothing is deleted — its history and evidence stay, and it can be restored at any time.';

export const WITHDRAW_CONCEPT_ACTION = 'Withdraw this concept';
export const RESTORE_CONCEPT_ACTION = 'Restore this concept';
export const WITHDRAW_INSTRUMENT_ACTION = 'Withdraw';
export const RESTORE_INSTRUMENT_ACTION = 'Restore';
export const EDIT_INSTRUMENT_ACTION = 'Edit in Obsidian';
export const RENAME_ACTION = 'Rename';

export const SHOW_WITHDRAWN_LABEL = 'Show withdrawn concepts';

/**
 * F8.4a's note-offer standing affordance (`[D-176]`, `ol-r1by`) — genuinely
 * NEW copy, permitted for the same reason F8.4b's explain-back phrases are:
 * the clause defines this surface and no prior ratified wording exists for
 * it. States a fact about the concept's standing, never a nudge about her
 * compliance (this file's own rule) — nothing here says she "should" write a
 * note, matching `HEADING_OFFER_ACCEPT_LABEL`/`HEADING_OFFER_DISMISS_LABEL`'s
 * own plain-verb, no-pressure tone (`review/heading-offer.ts`, F2.10's
 * offer — a different object, same register: "Create a card" / "Not now").
 * `[D-176]`'s own clause is explicit the offer is rare and never chases her,
 * so this is one line, one accept, one decline, no urgency language.
 */
export const NOTE_OFFER_LINE =
  'This concept is carrying real weight. Olea could create a note for it in your Zettelkasten.';
export const NOTE_OFFER_ACCEPT_ACTION = 'Create the note';
export const NOTE_OFFER_DECLINE_ACTION = 'Not now';

/**
 * `[D-203]`'s duplicate-title state — genuinely NEW copy, permitted for the
 * same reason F8.4a's/F8.4b's are (the clause defines this surface). States
 * the fact and the evidence — which two notes — never a nudge, and never a
 * chooser: `duplicateTitleLine` names both notes but offers no way to pick
 * between them, matching the ratified clause's own "nothing is chosen for
 * her". `DUPLICATE_TITLE_LABEL` mirrors `WITHDRAWN_LABEL`'s badge shape one
 * section up.
 */
export const DUPLICATE_TITLE_LABEL = 'Duplicate title';

/** `[D-203]`'s structural reason, plus the evidence and what would clear it — one line, in her terms, on the row itself. */
export function duplicateTitleLine(notePaths: readonly string[]): string {
  return `Two of your notes share this title, so Olea cannot tell them apart: ${notePaths.join(', ')}. Nothing is bound until you rename one of them.`;
}

export const INSTRUMENTS_SECTION_HEADING = 'Instruments';
export const NO_INSTRUMENTS_LINE = 'No instruments yet for this concept.';

/** `[D-171]`'s section heading for a concept's or instrument's list of vault locations it was derived from — never a citation string, always a place to go. */
export const SOURCE_LOCATIONS_HEADING = 'Sources';

/** One instrument's per-location open affordance — "open", never a citation preposition, matching `EDIT_INSTRUMENT_ACTION`'s own plain-verb form. */
export const OPEN_SOURCE_LOCATION_ACTION = 'Open source';

/**
 * One source-location button's label (`[D-171]`) — the note it can be
 * opened at, plus the passage grain when one is known.
 *
 * **Updated `ol-2zfj.25` (F8.4 amended Sep 2026 — `[D-171]`):** this used
 * to say "never a page number" and render heading only. `ol-2zfj.25`'s
 * display rule — `location.section ?? page/slide-appropriate fallback` —
 * now applies here via `olea-core`'s `formatSourceCitation`: a page-bearing
 * PDF-like source shows `p. N`, a `.pptx` source shows `slide N` (the
 * contract type's own convention — `page` IS the slide number, there is no
 * separate slide field), and `section`/`heading` are used exactly as that
 * formatter documents. Still an affordance to click, not a formal citation
 * with punctuation rules — just an honest one now that shows the grain she
 * can use to place it.
 */
export function sourceLocationLabel(location: RegistrySourceLocation): string {
  return formatSourceCitation(location);
}

/** One instrument row's label — type and where it lives, never its content (F8.4 hands content to Obsidian). */
export function instrumentLabel(instrumentType: 'qa' | 'cloze' | 'mcq'): string {
  switch (instrumentType) {
    case 'qa':
      return 'Q&A card';
    case 'cloze':
      return 'Cloze card';
    case 'mcq':
      return 'MCQ';
  }
}
