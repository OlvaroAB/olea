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
 *
 * **INV-1.** No `obsidian` import here — unit-tested under Vitest.
 */

import type { RegistryConceptEntry, RegistrySourceLocation, Vitality } from 'olea-core';

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

export const INSTRUMENTS_SECTION_HEADING = 'Instruments';
export const NO_INSTRUMENTS_LINE = 'No instruments yet for this concept.';

/** `[D-171]`'s section heading for a concept's or instrument's list of vault locations it was derived from — never a citation string, always a place to go. */
export const SOURCE_LOCATIONS_HEADING = 'Sources';

/** One instrument's per-location open affordance — "open", never a citation preposition, matching `EDIT_INSTRUMENT_ACTION`'s own plain-verb form. */
export const OPEN_SOURCE_LOCATION_ACTION = 'Open source';

/** The note's filename, without folders or extension — the same reading `instrumentLabel`'s own `noteTitle` field already gives a full `VaultInstrumentRecord`, derived here from a bare path since `RegistrySourceLocation` carries only `sourcePath`. */
function noteNameFromPath(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** One source-location button's label (`[D-171]`) — the note it can be opened at, plus the heading when one is known. Never a page number or citation punctuation: this is an affordance to click, not a rendered citation. */
export function sourceLocationLabel(location: RegistrySourceLocation): string {
  const name = noteNameFromPath(location.sourcePath);
  return location.heading ? `${name} (${location.heading})` : name;
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
