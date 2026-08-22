/**
 * Bases assignments reader (F1.1, P1-T06). See ./read.ts for the reader and
 * ./base-file.ts for the narrow `.base` file scan it builds on.
 */

import type { VaultPath } from '../vault/types.js';

/** The semantic fields an Assessment record carries (knowledge model §4). */
export type AssessmentField = 'course' | 'type' | 'weight' | 'due' | 'status';

/** All fields this reader needs to produce a usable record. */
export const REQUIRED_ASSESSMENT_FIELDS: readonly AssessmentField[] = [
  'course',
  'type',
  'weight',
  'due',
  'status',
];

/**
 * One assessment note read from the folder(s) a `.base` file's filters name.
 *
 * **`type` is preserved verbatim** (F4.8 keys on its exact value later) —
 * this reader never normalises it. `course`, `due`, and `status` are also
 * verbatim (the meaning path's `readScalar`, which trims and unquotes but
 * does not reinterpret). Only `weight` is coerced to a number, because
 * summing weights (the Base's own `summaries: note.weight: Sum`) requires
 * one; `weightRaw` keeps the untouched source text alongside it so a caller
 * can tell "weight was 0" from "weight didn't parse".
 *
 * Any field this reader could not resolve a column for is `undefined` here
 * — never a fabricated default — and the field's name appears in the
 * report's `unresolvedFields` so that is never mistaken for "she has no
 * assignments due".
 */
export interface AssessmentRecord {
  readonly path: VaultPath;
  readonly course: string | undefined;
  readonly type: string | undefined;
  readonly weight: number | undefined;
  readonly weightRaw: string | undefined;
  readonly due: string | undefined;
  readonly status: string | undefined;
}

/** How a semantic field was resolved to an actual frontmatter key found in the scanned notes. */
export interface ColumnMapping {
  readonly field: AssessmentField;
  /** The frontmatter key, as written in her notes, that matched `field` (case-insensitive, alias-tolerant match — see ./read.ts). */
  readonly matchedKey: string;
}

/**
 * The full result of reading a Bases assignments table — records plus an
 * **honest report** of how the read went. `records` is not the whole story
 * by design: an empty `records` array must always be self-explanatory from
 * the rest of this shape (a genuinely empty folder vs. a schema the reader
 * could not understand), never a silent "zero assignments" that looks the
 * same as "she has none due" (P1-T06 accept criteria — this is the failure
 * mode the whole report shape exists to rule out).
 */
export interface AssessmentReadReport {
  readonly records: readonly AssessmentRecord[];
  /** Folder(s) the `.base` file's `file.inFolder(...)` filters named. Empty when none could be found. */
  readonly sourceFolders: readonly VaultPath[];
  /** Every note path actually scanned, sorted. */
  readonly notesScanned: readonly VaultPath[];
  /** Notes scanned that had no frontmatter block at all, so contributed nothing. */
  readonly notesWithoutFrontmatter: readonly VaultPath[];
  /** Fields successfully resolved to a real frontmatter key, and which key. */
  readonly columns: readonly ColumnMapping[];
  /** Required fields (`REQUIRED_ASSESSMENT_FIELDS`) that no scanned note's frontmatter could resolve. */
  readonly unresolvedFields: readonly AssessmentField[];
  /**
   * Property keys the `.base` file declares (its `properties` block, minus
   * `formula.*` computed columns) that this reader could not map to any
   * known `AssessmentField` — e.g. a column she added that the reader
   * doesn't understand yet. Reported, never silently dropped.
   */
  readonly unrecognizedColumns: readonly string[];
  /**
   * Non-empty when the reader could not determine anything at all — most
   * often because no `file.inFolder(...)` filter was found, so there is no
   * folder to scan. Explains an empty `records`/`notesScanned` in place of
   * letting it read as "no assignments".
   */
  readonly configErrors: readonly string[];
}
