/**
 * `withoutCourseCrossReferences` — the `'session-no-cards-yet'` state's own
 * read-only vault overlay (`ol-p5t06b` [P5-T06b], `session-scenarios.ts`).
 *
 * That state's whole subject, per `session-scenarios.ts`'s own module doc, is
 * a finding: in the fixture vault, the four Zettelkasten concepts her past
 * papers cite (Imbrication, Hummocky stratification, Bioturbation,
 * Paraconformity) each have notes and no cards, while every card she has
 * lives in a lecture note bound to a `topic:` no past paper cites. The state
 * renders that finding UNBORROWED and asserts every left-out row reads
 * `coverage-gap` — the honest "notes but no cards" sentence, never
 * `mastery-gap` or `material-gap`.
 *
 * **Course attribution widened (`ol-2zfj.33`, F1.3) broke that premise
 * without making it false in spirit.** `extractConcepts` now also reads a
 * course-folder note's BODY for a wikilink into a concept's bound
 * Zettelkasten note, and `ConceptRecord.sourcePaths` — which
 * `session/enumerate.ts` binds an instrument's `conceptIds` from — grows the
 * same way for that path as it always has for `topic:`. The fixture vault's
 * WEEK 1–3 GEOL204 lecture notes cross-link all four of these concepts in
 * passing prose ("Compare against [[Hummocky stratification]]", "the
 * stalled clast tips … ([[Imbrication]])"), which is exactly the realistic
 * authoring style F1.3 was widened to read — and reading it correctly now
 * hands all four concepts real cards from notes that were never about them,
 * which is a true fact about the corpus and not the state this test exists
 * to keep visible.
 *
 * Rather than loosen the assertion to accept a session that now has
 * something to practise, or revert F1.3 (correct, and `docs/Olea_
 * component_register.md`-adjacent findings measured its real-vault value),
 * this overlay restores the STATE's premise the same way
 * `oracle/fixture-oracle-vault.ts` restores its own: by removing exactly the
 * bytes that create the collateral attribution, read-only, discarded on
 * reload. Unlike that file — which keeps Imbrication's cross-reference
 * because ITS demonstration wants a ranked concept with real material — this
 * one strips all four, because this state's finding is precisely that NONE
 * of them has one.
 *
 * Applied unconditionally to every session state (`session-scenarios.ts`
 * wraps the vault once in `composeWorld`), not only `'session-no-cards-yet'`:
 * every other state runs with `instruments: 'borrowed'`, which re-binds
 * `conceptIds`/`courses`/`notePath` wholesale (`borrowedInstruments`) and so
 * never reads what this overlay changes — the underlying instrument bytes
 * (the card text, the MCQ block) are untouched, only which concept the RAW
 * extraction would have bound them to.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { requireReplace } from './require-replace.js';

const GRAIN_PROVENANCE_PATH =
  '01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md' as VaultPath;
const INTRO_TO_CLASTIC_PATH =
  '01 Courses/GEOL204/WEEK 1/Lecture - Introduction to Clastic Sediment.md' as VaultPath;
const DEPOSITION_PATH =
  '01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md' as VaultPath;
const CEMENTATION_PATH =
  '01 Courses/GEOL204/WEEK 3/Lecture - Cementation and Burial Diagenesis.md' as VaultPath;

/** Strips this note's cross-references to Hummocky stratification, Paraconformity (x2) and Imbrication. */
function withoutGrainProvenanceCrossReferences(original: string): string {
  const withoutHummockyRef = requireReplace(
    original,
    'Compare against [[Hummocky stratification]].',
    'Compare against Hummocky stratification.',
    GRAIN_PROVENANCE_PATH,
  );
  const withoutImbricationRef = requireReplace(
    withoutHummockyRef,
    'The stalled clast tips until its long axis leans downstream ([[Imbrication]])',
    'The stalled clast tips until its long axis leans downstream (Imbrication)',
    GRAIN_PROVENANCE_PATH,
  );
  const withoutFirstParaconformityRef = requireReplace(
    withoutImbricationRef,
    '5. The [[Paraconformity]] above may then remove all record of what came next',
    '5. The Paraconformity above may then remove all record of what came next',
    GRAIN_PROVENANCE_PATH,
  );
  return requireReplace(
    withoutFirstParaconformityRef,
    '- The [[Paraconformity]] marks a pause long enough for the fabric to be cemented in place',
    '- The Paraconformity marks a pause long enough for the fabric to be cemented in place',
    GRAIN_PROVENANCE_PATH,
  );
}

/** Strips this note's cross-references to Hummocky stratification, Bioturbation and Imbrication. */
function withoutIntroCrossReferences(original: string): string {
  const withoutHummockyAndBioturbationRefs = requireReplace(
    original,
    'See [[Hummocky stratification]] and [[Bioturbation]].',
    'See Hummocky stratification and Bioturbation.',
    INTRO_TO_CLASTIC_PATH,
  );
  return requireReplace(
    withoutHummockyAndBioturbationRefs,
    'only then can [[Imbrication]] be read from a cut face',
    'only then can Imbrication be read from a cut face',
    INTRO_TO_CLASTIC_PATH,
  );
}

/** Strips this note's cross-reference to Bioturbation. */
function withoutDepositionCrossReference(original: string): string {
  return requireReplace(original, 'see [[Bioturbation]].', 'see Bioturbation.', DEPOSITION_PATH);
}

/** Strips this note's (pipe-aliased) cross-reference to Bioturbation. */
function withoutCementationCrossReference(original: string): string {
  return requireReplace(
    original,
    'never reaches [[Bioturbation|the burrowed interval]] as a compaction surface',
    'never reaches the burrowed interval as a compaction surface',
    CEMENTATION_PATH,
  );
}

const OVERRIDDEN_FILES: ReadonlyMap<VaultPath, (original: string) => string> = new Map([
  [GRAIN_PROVENANCE_PATH, withoutGrainProvenanceCrossReferences],
  [INTRO_TO_CLASTIC_PATH, withoutIntroCrossReferences],
  [DEPOSITION_PATH, withoutDepositionCrossReference],
  [CEMENTATION_PATH, withoutCementationCrossReference],
]);

/**
 * A read-only overlay over `base`: the four notes in `OVERRIDDEN_FILES` have
 * their passing cross-reference wikilinks turned into plain, unlinked prose
 * on read; everything else is `base`, byte for byte. `write`/`delete` throw —
 * this overlay, like the pipeline it feeds, never mutates the vault it reads.
 */
class SessionNoCardsVaultOverlay implements VaultSource {
  constructor(private readonly base: VaultSource) {}

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return this.base.list(options);
  }

  async read(path: VaultPath): Promise<string> {
    const override = OVERRIDDEN_FILES.get(path);
    if (override !== undefined) return override(await this.base.read(path));
    return this.base.read(path);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const override = OVERRIDDEN_FILES.get(path);
    if (override !== undefined) {
      return new TextEncoder().encode(override(await this.base.read(path)));
    }
    return this.base.readBinary(path);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.base.exists(path);
  }

  write(): Promise<void> {
    throw new Error('SessionNoCardsVaultOverlay: read-only, never written to');
  }

  delete(): Promise<void> {
    throw new Error('SessionNoCardsVaultOverlay: read-only, never written to');
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.base.watch(handler);
  }
}

/** Wraps `base` with the overlay documented above. Called once, at the top of `composeWorld`. */
export function withoutCourseCrossReferences(base: VaultSource): VaultSource {
  return new SessionNoCardsVaultOverlay(base);
}
