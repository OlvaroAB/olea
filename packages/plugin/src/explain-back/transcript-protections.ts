/**
 * The transcript protections that have a meaning for a passage on the practice view
 * (`[D-633]`; functional scope C3.6, F5.2). Reuses the code drafting applies to transcript
 * material (`../source-origin.ts`'s `sourceChunkOriginOf`, which calls core's
 * `attributeTranscript`, `flagTranscriptPart` and `claimEligibility`) and writes no word the
 * student sees.
 *
 * APPLIED (a passage is a shown source she compares her explanation with, so what may not ground
 * is not shown as one):
 *  - **Uncertain evidence.** A claim that depends on an inaudible phrase, a visual the transcript
 *    does not carry or a disputed term is "not used for grounding" (C3.6). It is cut from the
 *    shown passage by the offsets `sourceChunkOriginOf` gives (`flaggedClaims`); the
 *    self-contained statements in the same passage stay, unchanged and in order, and nothing is
 *    reconstructed. A passage left with nothing is dropped.
 *  - **Speaker attribution.** A passage spoken by a student or an audience question is context,
 *    never an explanation of the material (`isAdmissibleExplanation`), so it is not shown as one.
 *    A transcript part carries no speaker label today, so every part reads as an unknown speaker
 *    and stays; the check is here so a labelled passage cannot be shown as an explanation.
 *
 * NOT APPLIED, each reported on the bead: the per-claim endorsement (asserted, quoted and
 * rejected, a question) is judged by a model and nothing on this route reads with a model; the
 * lecturer-correction hold is a pending-revalidation fact on an instrument's citation anchor
 * (`../ingestion/slide-correction.ts`), not a property of a passage; a source not fully read yet
 * is a census fact (registry section 30) whose words belong to the census, and every passage
 * shown was read.
 *
 * Pure and synchronous. A note that is not a supplied transcript is returned as it is.
 */

import { type SourceOriginFrontmatterHost, sourceChunkOriginOf } from '../source-origin.js';
import type { ExplainBackSourceBlock } from './request.js';

/** The passage as she may be shown it, or `null` when nothing of it may be shown. */
export function protectTranscriptPassage(
  passage: ExplainBackSourceBlock,
  host?: SourceOriginFrontmatterHost,
): ExplainBackSourceBlock | null {
  const text = passage.block.text;
  const origin = sourceChunkOriginOf(passage.path, text, host);
  if (origin === null) return passage;
  if (origin.speakerRole === 'other-speaker') return null;
  const claims = origin.flaggedClaims;
  if (claims === undefined || claims.length === 0) return passage;
  let kept = '';
  let from = 0;
  for (const claim of [...claims].sort((a, b) => a.start - b.start)) {
    kept += text.slice(from, claim.start);
    from = Math.max(from, claim.end);
  }
  kept += text.slice(from);
  const shown = kept.replace(/[ \t]{2,}/g, ' ').trim();
  if (shown === '') return null;
  return { ...passage, block: { ...passage.block, text: shown } };
}

/** {@link protectTranscriptPassage} over a list, dropping what may not be shown. */
export function protectTranscriptPassages(
  passages: readonly ExplainBackSourceBlock[],
  host?: SourceOriginFrontmatterHost,
): readonly ExplainBackSourceBlock[] {
  return passages.flatMap((passage) => {
    const protectedPassage = protectTranscriptPassage(passage, host);
    return protectedPassage === null ? [] : [protectedPassage];
  });
}
