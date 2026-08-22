/**
 * Concept extraction, tiers 1–3 (C7.2, C7.3, F1.4, F4.1, P1-T05, P5-T02).
 *
 * Source hierarchy in precedence order (knowledge model §3):
 *
 *   1. A concept note of her own, where one exists — the canonical case. The
 *      record takes its identity from that note and binds to it.
 *   2. Her `topic` properties — curated, and reaching wider than the
 *      Zettelkasten does.
 *   3. Anything derived from her material — past-paper clusters, generated
 *      content, headings.
 *
 * `./extract.js` extracts tier 2 (`topic` properties) and layers tier 1
 * (concept-note binding) on top when a name matches a note in her
 * Zettelkasten exactly. Tier 3 (`ExtractConceptsOptions.includeTier3`) was a
 * flag scaffold only through P1-T05; P5-T02 turns it on for two of the
 * hierarchy's three tier-3 sources — past-paper clusters and generated
 * content, via `./evidence.js` — and mints a `ConceptRecord` for a concept
 * that has a Zettelkasten note but has never been used as anyone's `topic`
 * value, which is otherwise invisible to this module entirely. Heading-
 * derived tier-3 extraction (the hierarchy's third source) is not covered;
 * see `./evidence.js`'s module doc for why.
 */

import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultPath } from '../vault/types.js';

/** Which tier of the source hierarchy (knowledge model §3) produced this record. */
export type ConceptTier = 1 | 2 | 3;

/**
 * A concept extracted from her vault.
 *
 * **R1/R2 — student-scoped, verbatim display names.** `name` is copied
 * character-for-character from her `topic` property (or, for a tier-1
 * binding, her Zettelkasten note's filename — the two are identical by
 * construction, since binding requires an exact match). It is never
 * title-cased, trimmed into a canonical form, or fuzzy-deduplicated: two
 * topic strings differing only by case produce two distinct `ConceptRecord`s,
 * because nothing in the contract says otherwise for that case. See
 * `extract.spec.ts` for the case that proves this.
 */
export interface ConceptRecord {
  /** Exactly as written in her vault — see the R1/R2 note above. */
  readonly name: string;
  /**
   * 1 when a `topic`-derived name also matches a Zettelkasten note exactly,
   * 2 when only `topic`-derived, 3 when minted purely from tier-3 material
   * (`includeTier3: true`, `./evidence.js`) with no `topic` occurrence
   * anywhere in the vault — even though such a record still carries
   * `boundNotePath`. See `./extract.js`'s module doc for why tier 3 is the
   * honest label there rather than 1.
   */
  readonly tier: ConceptTier;
  /**
   * Course codes this concept is associated with. **M:N** — a concept can
   * belong to several courses (one course has many concepts; nothing here
   * assumes the reverse holds).
   *
   * Sourced per contributing note, F1.3's way (`./course.js`, `ol-jbnu`): the
   * note's own `course` property when it has one — read via the meaning path,
   * so both a bare scalar (`course: GEOL204`) and a flow list
   * (`course: [GEOL204, MUSTH104]`) contribute correctly — and otherwise the
   * course **folder** it lives under. The property is an override, never the
   * only path: a vault that does not use that key still gets its courses, and
   * a note that names its own course is still believed over its location.
   * Empty when neither is available, which is a statement and not a failure —
   * nothing is guessed. Sorted for a deterministic result.
   */
  readonly courses: readonly string[];
  /**
   * Vault-relative paths of every note whose `topic` property named this
   * concept, for a tier-1/2 record. For a tier-3-only record (no `topic`
   * occurrence anywhere — see `tier`'s doc), this is `[boundNotePath]`
   * instead: her own concept note is the one path that authoritatively
   * names it. Richer tier-3 evidence (every past-paper question, every
   * generated-content citation) lives in `./evidence.js`'s
   * `ExtractTier3EvidenceResult`, not folded in here. Sorted for a
   * deterministic result.
   */
  readonly sourcePaths: readonly VaultPath[];
  /**
   * Tier-1 binding target: the Zettelkasten note whose filename matches
   * `name` exactly, when one exists. `undefined` for a tier-2-only concept.
   *
   * Binding is a path reference only — the knowledge model has a tier-1
   * record take both its name and its definition from her note, but
   * extracting the note's
   * definition text is out of scope for this bead (extraction, not
   * synthesis); a consumer that needs the definition reads `boundNotePath`
   * itself.
   */
  readonly boundNotePath?: VaultPath;
  /**
   * The several Zettelkasten notes whose filenames all match `name` exactly,
   * when more than one does — present only in that case, sorted, and always
   * alongside an **absent** `boundNotePath` and `tier: 2`.
   *
   * A duplicated title is a question only she can answer, so it is surfaced
   * rather than resolved: binding to one of them would make the target a
   * function of `vault.list` order (`ol-lzwe`), and choosing between them by
   * any rule of ours would assert an identity nothing in her vault states.
   * A consumer that wants to prompt her reads this; a consumer that wants a
   * binding reads `boundNotePath` and correctly finds none.
   */
  readonly ambiguousNotePaths?: readonly VaultPath[];
  // `ambiguousTopicPaths` was here, and is deliberately gone (`ol-t3sd`).
  //
  // It recorded, on each concept, the notes whose instruments had been
  // attributed to a *co-listed* name instead — D-031's diagnostic for a
  // narrowing that a one-`conceptId` review-log record forced. The ruling on
  // `ol-t3sd` removed the narrowing: an instrument is now evidence for every
  // concept its note names, and v3 of the record persists all of them. Nothing
  // is attributed away from anything, so the field's own sentence is false for
  // every note, and its documented complement — "`sourcePaths` minus these
  // paths is the set of notes whose instruments this concept actually
  // receives" — is now just `sourcePaths`.
  //
  // Retaining it as diagnostics was considered and rejected. A diagnostic here
  // exists to make an otherwise-invisible loss visible (that is exactly what
  // `ambiguousNotePaths` above still does for a duplicated Zettelkasten title,
  // an ambiguity only she can resolve). There is no loss left to see: the
  // co-listing it reported is now ordinary, correct, many-to-many membership,
  // and a field that flagged it would be flagging the normal case. A field
  // whose name asserts a problem that no longer exists is worse than no field,
  // because a later reader believes it.
}

export interface ExtractConceptsOptions {
  /** Restrict `topic` scanning to this subtree. Defaults to the whole vault. */
  readonly under?: VaultPath;
  /** Folder searched for tier-1 concept-note binding and, when `includeTier3` is on, tier-3 vocabulary. Defaults to `05 Zettelkasten`. */
  readonly zettelkastenFolder?: VaultPath;
  /** Folder whose immediate subdirectories are course codes (F1.3). Defaults to `01 Courses` (`./course.js`'s `DEFAULT_COURSES_FOLDER`). */
  readonly coursesFolder?: VaultPath;
  /**
   * Tier-3 extraction — past-paper clusters and generated content
   * (`./evidence.js`; heading-derived extraction is not covered, see that
   * module's doc). **Off by default.** When `true`, mints a `ConceptRecord`
   * for a Zettelkasten-bound concept that no note's `topic` property ever
   * named, discovered instead through a past paper, an objectives
   * document, or content extracted from an embedded PDF/PPTX/DOCX/image.
   * See `./extract.js`'s module doc for exactly how a record's `tier` is
   * decided once this is on.
   */
  readonly includeTier3?: boolean;
  /** Folder `registerSources` scans for past papers and objectives, when `includeTier3` is on. Defaults to `03 Research` (`../source/register.js`'s `DEFAULT_SOURCES_FOLDER`). */
  readonly sourcesFolder?: VaultPath;
  /**
   * Files registered explicitly, with no embedding note required (F3.1,
   * `ol-ep3.2`), when `includeTier3` is on. Passed straight through to
   * `../source/register.js`; see `RegisterSourcesOptions.registeredFiles` for
   * why this is an option rather than persisted state.
   */
  readonly registeredFiles?: readonly RegisteredFileSpec[];
}
