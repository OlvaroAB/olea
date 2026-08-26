/**
 * Shapes shared by `./build.ts`'s tier-3 evidence pass and its two real
 * consumers, `../gap/` and `../evidence-edge/` ([EXT-8], `ol-ac7g`).
 *
 * **Why this file exists, and why it is not in `../concept/`.** This module
 * used to be `packages/core/src/concept/evidence.ts`, filed there because it
 * was written to feed concept-identity minting (`[D-068]`'s tier-3 path,
 * `../concept/extract.ts`'s `includeTier3` block). That minting path is
 * already off in production (`[EXT-2]` / `ol-468f`) and superseded by
 * `../concept/read.ts` (`ol-2zfj.1`) — but `extractTier3Evidence` turned out
 * to serve two OTHER, unrelated consumers that have nothing to do with
 * concept identity: `../gap/build.ts` and `../gap/coverage.ts` consume
 * {@link SourceCoverage}, and `../evidence-edge/build.ts` calls
 * `extractTier3Evidence` directly to build the concept↔assessment evidence
 * edge (knowledge model §5, F4.2). Those two survive the extraction-method
 * change; only the minting consumer dies. See `./build.ts`'s module doc for
 * what this pass actually does.
 *
 * **A compatibility shim remains at `../concept/evidence.ts`.** It re-exports
 * everything from here (and from `./build.ts`) unchanged, solely because
 * `../concept/extract.ts` and `../concept/read.ts` are owned by a different
 * lane this round and still import from that path. Once that lane repoints
 * (or deletes) those imports — see `ol-ac7g`'s close notes for the exact
 * one-liner — the shim can be deleted outright.
 */

import type { ExtractionOutcome, Provenance, SourceFormat } from '../extract/types.js';
import type {
  RegisterSourcesOptions,
  SourceKind,
  SourceRegistrationReport,
  SourceRole,
} from '../source/types.js';
import type { VaultPath } from '../vault/types.js';

/** Which material this citation was found in. */
export type ConceptCitationKind = 'past-paper' | 'objectives' | 'generated-content';

/**
 * One verbatim mention of a vocabulary name in tier-3 material. This is the
 * atomic unit of evidence — `PastPaperCluster` groups the `'past-paper'`
 * subset of these by concept; a future concept↔assessment edge (P5-T03)
 * consumes this shape directly for its own `evidence` payload (knowledge
 * model §5).
 */
export interface ConceptCitation {
  /** Exactly the vocabulary entry that matched — never the derived text's own casing (R2). */
  readonly conceptName: string;
  readonly kind: ConceptCitationKind;
  readonly sourcePath: VaultPath;
  /** The citing source's course, when known — `undefined`, never guessed, matching `Source.course`'s convention. */
  readonly course: string | undefined;
  readonly provenance: Provenance;
  /**
   * Other vault paths holding **byte-identical** content to `sourcePath` —
   * present only when there are any, sorted (`ol-n0yc`).
   *
   * A file filed in two places is cited **once**, from the first path in
   * code-unit order, and the other paths are recorded here. Both halves of
   * that matter. Counting it twice inflates every "N sources agree" claim
   * built on citation counts, since the two copies are not two agreeing
   * sources but one source counted twice; hiding the second copy would be
   * just as wrong, because filing a deck in two places may well be
   * deliberate and is hers to decide. So the copy is not made to disappear —
   * it stops being counted, and it is named right here.
   *
   * Identity is the **content hash**, never the filename or title: the two
   * paths differ by construction (that is what makes them two paths), so the
   * bytes are the only thing that is actually equal.
   */
  readonly duplicateSourcePaths?: readonly VaultPath[];
  /** Present only for `kind === 'past-paper'` — which question or sub-part (`segment-past-paper.js`'s `QuestionBlock.label`) this citation came from. */
  readonly questionLabel?: string;
  /** Present only for `kind === 'past-paper'` — that question/sub-part's own verbatim text, carried through so `buildPastPaperClusters` can show it, not just count it. */
  readonly questionText?: string;
}

/** One past-paper question or sub-part that named a concept, kept inspectable rather than folded into a bare count. */
export interface PastPaperClusterQuestion {
  readonly sourcePath: VaultPath;
  readonly label: string;
  readonly text: string;
  readonly provenance: Provenance;
}

/**
 * Every past-paper question that named one concept, across every
 * `role: past-paper` `Source` this pass scanned — the design direction's
 * "a cluster that cannot show its member questions and their provenance is
 * not evidence, it is an assertion." `questions` is that proof, not a
 * summary of it.
 */
export interface PastPaperCluster {
  readonly conceptName: string;
  /** The single course every member question shares, or `undefined` when the cluster spans more than one — never guessed to the wrong one. */
  readonly course: string | undefined;
  readonly questions: readonly PastPaperClusterQuestion[];
}

export interface ExtractTier3EvidenceOptions extends RegisterSourcesOptions {
  readonly zettelkastenFolder?: VaultPath;
  /** Folder whose immediate subdirectories are course codes (F1.3). Defaults to `01 Courses` (`../concept/course.js`'s `DEFAULT_COURSES_FOLDER`). */
  readonly coursesFolder?: VaultPath;
  /**
   * Candidate concept names to match derived material against. Defaults to
   * every Zettelkasten note title (`zettelkastenFolder`) — the module doc's
   * "identity without inventing it." `../concept/extract.ts` passes a richer
   * vocabulary (zettel titles plus every tier-1/2 name already found) so
   * material that mentions an already-curated concept feeds it too.
   */
  readonly vocabulary?: readonly string[];
}

/**
 * A named thing this pass could NOT do for one source, so a reader is never
 * left inferring it from a citation count (`ol-cvsc`).
 *
 * `'questions-not-segmented'` — the source is a past paper in a binary format
 * whose extracted text `../source/segment-past-paper-plaintext.js`'s
 * `segmentPlainTextPastPaper` could not confidently split into questions
 * (`ol-3ux7.10`, landing `ol-pdfpastpaper`'s segmenter). `segmentPastPaper`
 * (the markdown segmenter) works on the block parser, and extracted PDF text
 * has no block kinds and no headings to build an outline from, so BOTH of
 * that segmenter's documented safety arguments are void for this input —
 * reusing it here would inherit its interface and none of its reasoning,
 * which is exactly why the plain-text sibling exists instead. When it DOES
 * segment confidently, this limitation is absent and the source contributes
 * `kind: 'past-paper'` citations the same way a markdown past paper does —
 * see `./build.js`'s `collectDerivedSources`.  Claiming segmentation that did
 * not happen is the silent-wrong-number failure, which is worse than a miss,
 * so a source whose text extracts but does not segment still carries this
 * row.
 *
 * `'no-tier3-reader-for-role'` — a MARKDOWN source registered as
 * `'course-material'`. This pass has readers for the two assessment roles and
 * a derived-text reader for binaries; general markdown is not any of those,
 * because it is already covered upstream by `../concept/extract.ts`'s
 * tier-1/2 pass over her `topic` properties. So this row genuinely
 * contributes nothing HERE, and says so, rather than showing a bare zero that
 * reads like a failed extraction.
 */
export type SourceLimitation = 'questions-not-segmented' | 'no-tier3-reader-for-role';

/**
 * What this pass actually read, one row per distinct source — `ol-cvsc`'s
 * scope-statement rule ([P3-T07h]) applied to the read path.
 *
 * **Every source gets a row, including the ones that yielded nothing.** That
 * is the whole point: a surface renders identically whether it found no gaps
 * or read nothing at all, so a source that extracted empty has to be visible
 * rather than silently absent from the denominator. `pages: 0, citations: 0`
 * is a measurement; an omitted row is a false reassurance.
 *
 * Rows are keyed by content, not by path, matching `ol-n0yc`: one file filed
 * at two paths is one row with the second path on `duplicateSourcePaths`.
 */
export interface SourceCoverage {
  /** The path that cites — the first of a duplicate set in code-unit order. */
  readonly sourcePath: VaultPath;
  /**
   * How this source entered, distinct and sorted. Normally one value; a file
   * that is BOTH embedded in a note and explicitly registered carries both,
   * because it genuinely came in both ways and picking one would be a guess.
   */
  readonly kinds: readonly SourceKind[];
  /** The registered role, or `undefined` for a source reached only as an embed — an embed carries no role and none is invented for it. */
  readonly role: SourceRole | undefined;
  /** `null` for markdown, which the block parser reads rather than an extractor. */
  readonly format: SourceFormat | null;
  readonly duplicateSourcePaths: readonly VaultPath[];
  /** Courses attributed to this source; a single `undefined` entry means "no course, not guessed". */
  readonly courses: readonly (string | undefined)[];
  /** The extractor's own verdict, or `null` for markdown. Distinguishes "read and empty" from "unreadable". */
  readonly outcome: ExtractionOutcome | null;
  readonly pages: number;
  readonly units: number;
  readonly citations: number;
  /** Named gaps in what this pass could do for this source — see `SourceLimitation`. Empty is the normal case. */
  readonly limitations: readonly SourceLimitation[];
}

export interface ExtractTier3EvidenceResult {
  /** The vocabulary actually matched against — echoed back so a caller (or a test) never has to recompute it to interpret `citations`. */
  readonly vocabulary: readonly string[];
  readonly citations: readonly ConceptCitation[];
  readonly pastPaperClusters: readonly PastPaperCluster[];
  /** `registerSources`'s own report, passed through unchanged — this pass adds no new "silent empty" failure mode beyond the ones that module already reports honestly. */
  readonly sourcesReport: SourceRegistrationReport;
  /** What was actually read, one row per distinct source, zero-yield rows included. See `SourceCoverage`. */
  readonly sourceCoverage: readonly SourceCoverage[];
}
