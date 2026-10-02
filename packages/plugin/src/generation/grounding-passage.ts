/**
 * Which passage a drafted item rests on — named at draft time, only where it can be named without
 * guessing (`[D-446]` option (a), decision-sheet row 42; `ol-egov.141.89.2.5`, the authoring half
 * of `ol-egov.141.89.5.32`).
 *
 * ===========================================================================
 * WHAT THE CLIENT KNOWS, AND WHAT IT DOES NOT
 * ===========================================================================
 * The drafting request carries the grounded chunks as plain strings
 * (`DraftQuizCardsResult.request.sourceChunks`; the chunk's path and block index are dropped when
 * the request is built). Two ways name the chunk an item rests on without guessing:
 *
 *  1. **The request supplied exactly ONE chunk**, which is then the only thing the item could have
 *     rested on (`soleGroundingChunk`). Always on.
 *  2. **The response cites it** (`ol-egov.141.89.2.29`): `quiz.generate.v1` (2.5.0) and
 *     `cards.generate.v1` (1.9.0) return, per item, `groundedIn` — positions in the request's
 *     `sourceChunks` (`olea-contracts`' `authoring-citation.ts`). A citation names a chunk only when
 *     its positions name exactly ONE distinct chunk (`citedGroundingChunk`); two or more is
 *     ambiguous and names nothing (`[D-446]`: "ambiguity remains unresolved"). **Held off**
 *     (`CITED_CHUNK_DIGEST_ENABLED`): the citation is the model's own claim, checked by the Worker
 *     only against a weak word-overlap floor, so it names a passage only once its wrong-citation
 *     rate is measured.
 *
 * Anything else — several chunks and no usable citation — names nothing. Picking one (the
 * top-ranked, the one from the cited note, the best word overlap) would be a guess, and a wrong
 * digest is worse than none: it would settle a changed passage as unchanged, where no digest leaves
 * the instrument at whole-note grain, which withholds it.
 *
 * ===========================================================================
 * WHAT IS RECORDED, AND WHY IT CAN BE TRUSTED
 * ===========================================================================
 * The sole chunk is looked up in the CITED source note by the shared rule
 * (`olea-core`'s `citePassage`): a digest comes back only when that text stands as exactly one
 * passage of the note. A chunk that stands twice (ambiguous), or is not a passage of that note at
 * all (it came from a different note, or the retrieval text is not a segment — a list chunk drops
 * its markers), names nothing. The digest is therefore always one the note resolves today, and
 * `sealCitationPassage` (`olea-core`), which runs again when the draft is accepted, re-checks it
 * against the note as it stands then and drops it if it no longer resolves to exactly one passage.
 *
 * Only a separate markdown note takes part, the same boundary the seal draws: a PDF or slide page
 * is cited by page, and a citation naming the note the instrument is written into is the
 * self-referential fallback, whose text carries the instrument block itself. A digest supplied
 * for that citation would be kept unchecked by the seal, so none is supplied.
 */

import { readAuthoringGroundedIn } from 'olea-contracts';
import type { InstrumentCitation, VaultSource } from 'olea-core';
import { citePassage } from 'olea-core';

/**
 * Whether a drafting response's citation (`groundedIn`) may name the passage a draft rests on.
 * **`false` until the wrong-citation rate is measured** (`ol-egov.141.89.2.29`, acceptance
 * criterion 4: per item, chunks carried, chunks cited, and whether the cited chunk is the one a
 * stated label source says grounds it, reported with an interval on the development and held-out
 * sets). The harmful error is a wrong digest, which settles a changed passage as unchanged; a
 * missing one only leaves the instrument at whole-note grain. Flipping this is a measured-baseline
 * decision, not a code change made in passing. The sole-chunk rule does not depend on it.
 *
 * @provenance declared
 */
export const CITED_CHUNK_DIGEST_ENABLED = false;

/**
 * The one chunk a draft rests on: the chunk when the request supplied exactly one, otherwise
 * `undefined`. Never the first of several. Takes the request's `sourceChunks` as they were sent.
 */
export function soleGroundingChunk(sourceChunks: readonly string[]): string | undefined {
  return sourceChunks.length === 1 ? sourceChunks[0] : undefined;
}

/**
 * The one chunk an item's citation names: the chunk text at `groundedIn`'s positions when they
 * name exactly one distinct chunk (two positions holding the same text are one chunk, since a
 * digest is taken of the text). `undefined` when there is no citation, when it names two or more
 * distinct chunks, or when any position is not one the request carried (re-checked here, so a
 * caller can never index past what it sent). Never the first of several.
 */
export function citedGroundingChunk(
  sourceChunks: readonly string[],
  groundedIn: readonly number[] | undefined,
): string | undefined {
  const positions = readAuthoringGroundedIn(groundedIn, sourceChunks.length);
  if (positions === undefined) return undefined;
  const texts = new Set(positions.map((position) => sourceChunks[position]));
  if (texts.size !== 1) return undefined;
  const [text] = texts;
  return text;
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * `citation` with `passageDigest` set to the digest of the passage `sourceChunks` grounded the
 * draft in, when that can be named: exactly one chunk was supplied, or (when the caller passes
 * one) the item's `groundedIn` names exactly one chunk; the citation names a markdown note other
 * than `destinationPath`; and the chunk stands as exactly one passage of that note. Otherwise
 * `citation` itself, unchanged. A citation that already carries a digest is returned as it is.
 * Never throws: a note it cannot read leaves the citation as it was.
 *
 * `destinationPath` is the note the drafted instrument will be written into. `groundedIn` is the
 * item's citation as `extractDraftedGroundedIn` read it; a caller passes it only while
 * `CITED_CHUNK_DIGEST_ENABLED` (or its own explicit opt-in) holds. With one chunk supplied, that
 * chunk is used whatever the citation says.
 */
export async function withGroundingPassage(
  vault: VaultSource,
  citation: InstrumentCitation,
  destinationPath: string,
  sourceChunks: readonly string[],
  groundedIn?: readonly number[],
): Promise<InstrumentCitation> {
  if (citation.passageDigest !== undefined) return citation;
  const chunk = soleGroundingChunk(sourceChunks) ?? citedGroundingChunk(sourceChunks, groundedIn);
  if (chunk === undefined) return citation;
  const source = citation.sourcePath;
  if (!isMarkdownPath(source) || source === destinationPath) return citation;

  let text: string;
  try {
    if (!(await vault.exists(source))) return citation;
    text = await vault.read(source);
  } catch {
    return citation;
  }

  const cited = await citePassage(text, chunk);
  return cited.status === 'cited' ? { ...citation, passageDigest: cited.digest } : citation;
}
