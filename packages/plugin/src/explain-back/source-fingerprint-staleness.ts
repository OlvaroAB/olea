/**
 * `ol-egov.141.89.6.39`: the direct per-block staleness check behind
 * `main.ts`'s `buildExplainBackObservationContextFor` — replaces a
 * retrieval-based comparison that could misfire.
 *
 * ===========================================================================
 * WHY RE-RETRIEVAL WAS THE WRONG CHECK (`ol-egov.141.89.6.16`'s own follow-up)
 * ===========================================================================
 * `ol-gavc` gave `sourceRevisionStale` a live producer by re-running
 * retrieval with the frozen query (`main.ts`'s `composeExplainBackSourceBlocks`)
 * and comparing the returned block list against the graded one
 * (`explain-back/observation.ts`'s `hasExplainBackSourceRevisionChanged`).
 * That catches a real edit, but it also catches something that is NOT a
 * stale source: a fresh embedding-cache or keyword-index state that simply
 * ranks or selects a different top-K set than the one the prompt was graded
 * against, with none of the graded passages themselves having changed at
 * all. Nothing in her vault moved; the check still reads it as stale and the
 * accept step rejects a correct, uncorrupted answer.
 *
 * This file checks the only thing that should matter: did THIS prompt's own
 * graded blocks — the ones `params.sourceBlocks` already names by
 * `{path, blockIndex}` — change or disappear. No retrieval, no embedding
 * call, no query string involved, so a re-ranked but otherwise identical
 * index can never make {@link hasExplainBackSourceFingerprintChanged} return
 * `true`.
 *
 * **Direct read, mirroring `resolve-introducing-passage.ts`.** That file
 * resolves a `Provenance`'s `charRange` by reading the note and re-parsing
 * it (`../vault`'s `ObsidianSource` satisfies the same narrow one-method
 * reader both files declare). This does the same read for a retrieval
 * chunk's `blockIndex` instead of a `charRange` — `keyword-index/document.ts`
 * confirms `blockIndex` is "this block's index into the
 * `ParsedDocument.blocks` array," the exact array a fresh `parseDocument`
 * call produces, so `doc.blocks[blockIndex]` is a direct, non-searching
 * lookup rather than the char-range scan that file needs for a `Provenance`
 * (which carries no block index, only a char range).
 *
 * **Fingerprint, not a stored string.** Nothing here keeps a raw-text cache
 * to diff against beyond what `params.sourceBlocks` already carries
 * (`block.text`, frozen at retrieval time) — this hashes both sides with
 * `olea-core`'s `hashText` (the same SHA-256 content hash D-002's ingestion
 * idempotency already relies on: same bytes, same hash, every device) rather
 * than comparing raw strings directly, so the comparison reads the same
 * whether the text is short or long and never holds two full copies of a
 * long passage side by side just to `===` them.
 */

import { hashText, parseDocument } from 'olea-core';
import type { ExplainBackSourceBlock } from './request.js';
import type { IntroducingPassageVaultReader } from './resolve-introducing-passage.js';

/**
 * The block currently living at `(path, blockIndex)`'s content fingerprint,
 * or `null` when it cannot be resolved: the note is missing or unreadable,
 * `blockIndex` no longer names a real block in a fresh parse (the note grew
 * shorter, or the block was deleted, split or merged — any of which shifts
 * or removes that index), or the block resolved is frontmatter or blank
 * (never citable, same two kinds `resolve-introducing-passage.ts` excludes).
 * A `null` here always reads as "stale" one layer up — never as "unchanged."
 */
async function currentSourceBlockFingerprint(
  vault: IntroducingPassageVaultReader,
  path: string,
  blockIndex: number,
): Promise<string | null> {
  let content: string;
  try {
    content = await vault.read(path);
  } catch {
    return null;
  }

  const doc = parseDocument(content);
  const block = doc.blocks[blockIndex];
  if (block === undefined || block.kind === 'frontmatter' || block.kind === 'blank') return null;
  if (block.raw.trim() === '') return null;

  return hashText(block.raw);
}

/**
 * `true` when ANY block the prompt was graded against has changed or
 * disappeared since — its exact `{path, blockIndex}` no longer resolves to
 * text whose fingerprint matches what was frozen at grading time. `false`
 * (never stale) only when every graded block's current fingerprint still
 * matches, including the vacuous case of an empty `gradedAgainst` list — the
 * same "nothing to compare, nothing changed" reading
 * `hasExplainBackSourceRevisionChanged` gave that case.
 *
 * `main.ts`'s `buildExplainBackObservationContextFor` is the one production
 * caller, threading the result through as `sourceRevisionStale`. From there,
 * `grading/wiring.ts`'s accept step (`ol-0r92.89`; F5.5/F5.6's reject-on-
 * stale guard, C4.7's never-invent-a-citation posture) rejects outright on
 * `true` rather than recording anything against a citation that may no
 * longer say what it said — unchanged by this file, only how the verdict
 * feeding it is computed.
 */
export async function hasExplainBackSourceFingerprintChanged(
  vault: IntroducingPassageVaultReader,
  gradedAgainst: readonly ExplainBackSourceBlock[],
): Promise<boolean> {
  for (const entry of gradedAgainst) {
    const [frozenFingerprint, currentFingerprint] = await Promise.all([
      hashText(entry.block.text),
      currentSourceBlockFingerprint(vault, entry.path, entry.blockIndex),
    ]);
    if (currentFingerprint === null || currentFingerprint !== frozenFingerprint) return true;
  }
  return false;
}
