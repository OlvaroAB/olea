/**
 * `produceTaughtSignals` — F8.2's step-two producer (`ol-egov.141.89.7.51`; F8.2 as amended by
 * `[D-247]` and `[D-465]`, C3.6): the course's slide decks and supplied lecture transcripts in her
 * vault, read for each declared concept's name, become `TaughtSignalEvidence.inWeekSlideDeck` and
 * `.inWeekTranscript` (`./coverage.ts`). Before this, nothing supplied either field, so step two
 * of the taught-signal chain never fired in production.
 *
 * ## No dates, no arrival order
 *
 * Course material shows up when it shows up, ahead of its lecture or after it (David,
 * 2026-10-05). So nothing here reads a date, a file time or the order files arrived in, and the
 * input carries none: the signal is that teaching material of the course naming the concept is in
 * her vault. "The week's deck" in F8.2's wording describes the deck; it is not a gate.
 *
 * ## The rules, each enforced by construction
 *
 *  - **A name counts only as a whole word**, case-insensitive, by the examiner side's own matcher
 *    (`../tier3-evidence/build.js#findMentionedTermsAfter`), so the taught side and the examiner
 *    side never disagree about what "names it" means. A name inside a longer word, a plural or an
 *    inflection misses, and a miss keeps today's behaviour; nothing opens on a near name. A unit's
 *    `matchFrom` carries tier 3's template-heading offset, so a name carried only by a slide
 *    template every deck repeats is furniture here exactly as it is there.
 *  - **A registered past paper or objectives document is never step-two material, whatever its
 *    extension.** Examiner attestation puts a concept in scope; it never evidences that it was
 *    taught (F8.2: "a past assessment never opens a concept"). Checked against every path the same
 *    bytes sit at, so a copy of a past paper filed elsewhere is still the past paper.
 *  - **Another course's file never counts**, and a file attributed to no course counts for none.
 *    Which courses a file belongs to is the caller's attribution, read the way the reader that
 *    extracted it already reads it; this function never guesses one.
 *  - **It adds no attestation and no scope basis.** The output is taught-signal evidence for
 *    concepts already handed in; `./grove.ts` reads it only for a concept already inside the
 *    declared scope, after the denominator is fixed. A transcript opens; it never scopes
 *    (`[D-465]`: a concept a transcript opens and no examiner attests stays `volunteer`).
 *  - **Steps three to five stay false.** This producer has no evidence for them, and false is
 *    exactly today's reading of an unwired step (`TaughtSignalEvidence`'s own doc).
 *
 * ## INV-1
 *
 * Pure. No `obsidian`, no vault I/O, no clock. The caller gathers the text
 * (`packages/plugin/src/grove/taught-signal-material.ts` for the grove).
 */

import type { Source, SourceRole } from '../source/types.js';
import { findMentionedTermsAfter } from '../tier3-evidence/build.js';
import type { VaultPath } from '../vault/types.js';
import type { TaughtSignalEvidence } from './coverage.js';

/** What a piece of step-two material is: the client's lecture-file rule decides it, never its name. */
export type StepTwoMaterialKind = 'deck' | 'transcript';

/** One unit of a deck's or transcript's text, as its reader produced it. */
export interface StepTwoTextUnit {
  readonly text: string;
  /**
   * The offset before which a name does not count — tier 3's template-heading end for a deck
   * page (`DerivedTextUnit.templateHeadEnd`). Absent or 0 reads the whole text.
   */
  readonly matchFrom?: number;
}

/** One deck or supplied transcript in her vault, with the courses it belongs to and its text. */
export interface StepTwoMaterial {
  readonly path: VaultPath;
  /** Other paths holding the same bytes (tier 3 reads one file content once, `ol-n0yc`). */
  readonly duplicatePaths?: readonly VaultPath[];
  /** The courses this file belongs to, as the reader that extracted it attributes it. Empty means none. */
  readonly courses: readonly string[];
  readonly kind: StepTwoMaterialKind;
  readonly units: readonly StepTwoTextUnit[];
}

export interface ProduceTaughtSignalsInput {
  readonly course: string;
  /** The course's concepts, by key and display name — the same records `./grove.js#buildGroveModel` receives. */
  readonly concepts: readonly { readonly key: string; readonly name: string }[];
  /** Every deck and supplied transcript the caller found, any course; filtered here to `course`. */
  readonly material: readonly StepTwoMaterial[];
  /** The registered sources, vault-wide: a path registered as a past paper or objectives document is never step-two material. */
  readonly sources: readonly Pick<Source, 'path' | 'role'>[];
}

/** The two examiner roles: F1.5's own document kinds, the ones that attest scope and never teach. */
const EXAMINER_ROLES: ReadonlySet<SourceRole> = new Set(['past-paper', 'objectives']);

/**
 * Per concept KEY, F8.2's step-two evidence for `input.course` — one entry for every concept
 * handed in, all five fields present, the three later steps always false. See the module doc for
 * the rules.
 */
export function produceTaughtSignals(
  input: ProduceTaughtSignalsInput,
): ReadonlyMap<string, TaughtSignalEvidence> {
  const examinerPaths = new Set(
    input.sources.filter((source) => EXAMINER_ROLES.has(source.role)).map((source) => source.path),
  );
  const names = [...new Set(input.concepts.map((concept) => concept.name))].filter(
    (name) => name !== '',
  );

  const namedInDeck = new Set<string>();
  const namedInTranscript = new Set<string>();
  for (const item of input.material) {
    if (!item.courses.includes(input.course)) continue;
    if ([item.path, ...(item.duplicatePaths ?? [])].some((path) => examinerPaths.has(path))) {
      continue;
    }
    const named = item.kind === 'deck' ? namedInDeck : namedInTranscript;
    let unread = names.filter((name) => !named.has(name));
    for (const unit of item.units) {
      if (unread.length === 0) break;
      for (const name of findMentionedTermsAfter(unit.text, unread, unit.matchFrom ?? 0)) {
        named.add(name);
      }
      unread = unread.filter((name) => !named.has(name));
    }
  }

  const signals = new Map<string, TaughtSignalEvidence>();
  for (const concept of input.concepts) {
    signals.set(concept.key, {
      inWeekSlideDeck: namedInDeck.has(concept.name),
      inWeekTranscript: namedInTranscript.has(concept.name),
      calendarSessionWithSlideSequence: false,
      outcomesDocumentOrder: false,
      manualGroveConfirmation: false,
    });
  }
  return signals;
}
