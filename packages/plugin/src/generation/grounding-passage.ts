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
 * the request is built). The response — `quiz.generate.v1`'s `questions[]`, `cards.generate.v1`'s
 * `cards[]` — carries no field that refers back into those chunks: no chunk index, no quotation.
 * So of the two ways a passage could be named from data the client already holds, one does not
 * exist (a response that cites a chunk) and one does: the request supplied exactly ONE chunk, which
 * is then the only thing the item could have rested on.
 *
 * Every other draft has several chunks (retrieval hands up to eight to the model) and nothing
 * says which of them an item used. Picking one — the top-ranked, the one from the cited note, the
 * best word overlap — would be a guess, and a wrong digest is worse than none: it would settle a
 * changed passage as unchanged, where no digest leaves the instrument at whole-note grain, which
 * withholds it (`[D-446]`: "ambiguity remains unresolved"). Naming the passage for those drafts
 * needs the response to cite its chunk, a wire change that is filed as a bead and not made here.
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

import type { InstrumentCitation, VaultSource } from 'olea-core';
import { citePassage } from 'olea-core';

/**
 * The one chunk a draft rests on: the chunk when the request supplied exactly one, otherwise
 * `undefined`. Never the first of several. Takes the request's `sourceChunks` as they were sent.
 */
export function soleGroundingChunk(sourceChunks: readonly string[]): string | undefined {
  return sourceChunks.length === 1 ? sourceChunks[0] : undefined;
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * `citation` with `passageDigest` set to the digest of the passage `sourceChunks` grounded the
 * draft in, when that can be named: exactly one chunk was supplied, the citation names a markdown
 * note other than `destinationPath`, and the chunk stands as exactly one passage of that note.
 * Otherwise `citation` itself, unchanged. A citation that already carries a digest is returned as
 * it is. Never throws: a note it cannot read leaves the citation as it was.
 *
 * `destinationPath` is the note the drafted instrument will be written into.
 */
export async function withGroundingPassage(
  vault: VaultSource,
  citation: InstrumentCitation,
  destinationPath: string,
  sourceChunks: readonly string[],
): Promise<InstrumentCitation> {
  if (citation.passageDigest !== undefined) return citation;
  const chunk = soleGroundingChunk(sourceChunks);
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
