/**
 * The Source model (F1.5, F7.9, P5-T01; knowledge model §4).
 *
 * The knowledge model names `Source` as an existing entity — "A note, PDF,
 * slide deck, past paper, or objectives document" — and settles, in the same
 * sentence, how objectives fit in: **"Learning objectives are sources with a
 * role, not their own entity."** That is the model this bead conforms to,
 * not a new one: past papers and objectives are registered as `Source`
 * records carrying a `role`, exactly as that line requires, rather than as
 * separate entity types. (The concept↔source edge's own `role` — "defined
 * here / discussed / examined", knowledge model §5 — is a different axis:
 * it describes how a *concept* relates to a source it appears in, not what
 * *kind* of document the source is. `SourceRole` below is the latter.)
 *
 * `SourceRole` is deliberately narrow — `'past-paper' | 'objectives'` —
 * because F1.5's acceptance criteria is exactly these two ("Register past
 * papers and learning objectives as first-class course sources"). General
 * course material (lecture notes, embedded slide decks) already flows
 * through `../extract/` and `../concept/extract.js` without needing a role
 * tag; this bead does not invent one for them.
 */

import type { SourceFormat } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * What kind of course document a registered `Source` is — see the module doc.
 *
 * `'course-material'` was added by F3.1 (`ol-ep3.2`) for the manual
 * registration path, and it is the honest name for what that path mostly
 * carries: a lecture PDF, a coursebook, a slide deck she wants ingested. It is
 * deliberately NOT a fourth kind of assessment document. The two original
 * values stay exactly what F1.5 named them; this one exists because a
 * registered file has to say *something* about what it is, and calling a
 * coursebook a past paper to reuse an enum value would put a wrong answer into
 * every downstream surface that reads `role`.
 *
 * Non-persisted vocabulary choice (Class B). See the class note on `ol-ep3.2`:
 * the `Source` shape is in-memory only, so this is reversible. It becomes
 * Class C the day a registration record is written to disk.
 */
export type SourceRole = 'past-paper' | 'objectives' | 'course-material';

/**
 * How a file became a `Source` — R15's reserved discriminator (`ol-ep3.2`).
 *
 * Two values are live and genuinely discriminate:
 *  - `'embedded-file'` — reached through `../extract/embeds.js`, because some
 *    note wrote `![[...]]`. This is the route that was, until F3.1, the *only*
 *    route.
 *  - `'registered-file'` — reached through `./register.js`, with no embedding
 *    note required. Both the sources-folder scan and an explicit
 *    `registeredFiles` entry are this: they differ in how the file was
 *    *named*, not in how it entered.
 *
 * `'registered-url'` is **RESERVED, NOT IMPLEMENTED**. Nothing produces it,
 * nothing branches on it, no fetch exists, and no code path treats its absence
 * as a defect. Its only job is to keep a URL source from requiring a schema
 * change later. Building it is `ol-fn7l`, deliberately out of v0.9 scope — a
 * URL source changes what the product claims about where its material came
 * from ("generated from your notes" stops being true as stated), which is a
 * product decision about trust posture and David's alone to make.
 */
export type SourceKind = 'embedded-file' | 'registered-file' | 'registered-url';

/**
 * One registered course document — a past paper, an objectives document, or
 * (F3.1) any supported file registered explicitly rather than by being
 * embedded in a note.
 */
export interface Source {
  readonly path: VaultPath;
  readonly role: SourceRole;
  /**
   * Verbatim from the note's `course` frontmatter property, matching
   * `../concept/extract.js`'s convention for general notes — `undefined`,
   * never guessed, when the property is absent (F1.5's "course sources" is
   * an association this reader reports honestly, not one it invents from a
   * folder name; her `03 Research` folder is flat, not per-course).
   *
   * For an explicitly registered file this is whatever the caller supplied,
   * and `undefined` when it supplied nothing — the *derivation* from folder
   * structure (F1.3) happens in `../concept/evidence.js`, next to the
   * identical derivation embedded sources already use, rather than being
   * done twice and differently.
   */
  readonly course: string | undefined;
  /** How this file entered — see `SourceKind`. */
  readonly kind: SourceKind;
  /**
   * The extractor format this file's extension names
   * (`../extract/registry.js#formatFromExtension`), or `null` for markdown,
   * which is read by the block parser rather than by an extractor.
   *
   * This is what lets a consumer route a source without re-deriving the
   * question "is this a binary?" from the path — and, more importantly, what
   * lets it tell a *markdown* past paper (segmentable) from a *PDF* past
   * paper (extractable, not yet segmentable — `ol-pdfpastpaper`) without
   * guessing.
   */
  readonly format: SourceFormat | null;
}

/**
 * One file the caller wants registered explicitly, with no embedding note
 * required (F3.1's "drop a file" gesture, expressed as data).
 */
export interface RegisteredFileSpec {
  readonly path: VaultPath;
  /** Defaults to `'course-material'` — a binary file carries no frontmatter to classify from. */
  readonly role?: SourceRole;
  /** The caller's own course attribution; omitted means "derive it from the path" (F1.3). */
  readonly course?: string;
}

/** Why a `registeredFiles` entry could not become a `Source`. */
export type UnregisterableReason = 'not-found' | 'unsupported-format';

/** One `registeredFiles` entry that did not register, and why — reported, never silently dropped. */
export interface UnregisterableFile {
  readonly path: VaultPath;
  readonly reason: UnregisterableReason;
}

export interface RegisterSourcesOptions {
  /** Overrides `DEFAULT_SOURCES_FOLDER` (F7.9's configurable location). */
  readonly sourcesFolder?: VaultPath;
  /**
   * Files to register explicitly, by path, regardless of where they sit and
   * regardless of whether any note embeds them (F3.1, `ol-ep3.2`).
   *
   * **Why this is an option rather than persisted state.** A "drop a file"
   * gesture plausibly wants to survive a restart, and the moment the
   * registration record is written to disk, `SourceKind` becomes a persisted
   * enum and therefore a Class C decision (D-017 is the worked example — a
   * one-word change to a persisted enum is Class C regardless of how small it
   * looks). So persistence is deliberately NOT decided here: this carries the
   * registration in memory, from whatever the caller already knows, and the
   * durable-record question is left open for David rather than answered by
   * implication.
   */
  readonly registeredFiles?: readonly RegisteredFileSpec[];
}

/**
 * The full result of a `registerSources` scan — sources plus an **honest
 * report** of how the scan went, following the same rule `AssessmentReadReport`
 * (`../assessment/types.js`, P1-T06) establishes: an empty `sources` array
 * must always be explained by the rest of this shape (an empty folder vs. a
 * folder full of notes this reader could not classify), never a silent "no
 * past papers" that reads the same as "she has none."
 */
export interface SourceRegistrationReport {
  readonly sources: readonly Source[];
  /** The folder actually scanned — `options.sourcesFolder` or `DEFAULT_SOURCES_FOLDER`. */
  readonly sourcesFolder: VaultPath;
  /** Every markdown note under `sourcesFolder`, scanned for a `role`, sorted. */
  readonly notesScanned: readonly VaultPath[];
  readonly notesWithoutFrontmatter: readonly VaultPath[];
  /**
   * Markdown notes scanned whose frontmatter had no `role` value this reader
   * recognised as `'past-paper'` or `'objectives'` — e.g. the fixture
   * vault's citation-workflow research notes, which carry a `source-type`
   * property (`journal-article`, `book-chapter`) for a different purpose
   * entirely (bibliographic type, not course-document role). Reported, never
   * silently dropped.
   */
  readonly unclassified: readonly VaultPath[];
  /**
   * Non-markdown files found under `sourcesFolder` by the FOLDER SCAN (a PDF
   * past paper, say). The scan classifies role from frontmatter, which a
   * binary file has none of, so it still declines to guess what these are.
   *
   * **This is no longer a dead end (F3.1).** A file listed here can be
   * registered by naming it in `RegisterSourcesOptions.registeredFiles` with
   * the role the caller knows it to have — that is exactly the gesture the
   * manual path exists for. What has not changed is that this reader will not
   * *infer* the role from a folder listing, because a wrong role is worse than
   * an unregistered file: it propagates into every surface that reads `role`.
   */
  readonly skippedNonMarkdown: readonly VaultPath[];
  /**
   * `registeredFiles` entries that could not become a `Source` — the path is
   * not in the vault, or no extractor claims its extension (F3.1).
   *
   * Reported for the same reason `unclassified` is: a registration that
   * quietly did nothing is indistinguishable from one that worked, and the
   * consequence lands much later, as a source that is simply absent from a
   * coverage denominator.
   */
  readonly unregisterable: readonly UnregisterableFile[];
  /** Non-empty when the scan found nothing at all under `sourcesFolder` — a config problem, not "no past papers." */
  readonly configErrors: readonly string[];
}
