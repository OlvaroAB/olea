/**
 * `ol-egov.141.89.6.49`: the vault-read implementation behind
 * `explain-back/modal.ts`'s `ExplainBackModalDeps.resolveIntroducingPassage`
 * port — that bead (`ol-egov.141.89.6.36`) built the port and the caller
 * (`resolveEdgeIntroducingPassages`) but left it unwired in `main.ts`
 * (outside its `owns`), so a live causes edge's own `introducingPassages`
 * (a `Provenance` per endpoint — a source path plus a `SourceLocation`,
 * never text, `olea-core`'s `extract/types.ts`) never resolved in
 * production.
 *
 * **A narrow vault type, not `VaultSource`.** This function needs exactly
 * one capability — read a note's current text — so it takes
 * `IntroducingPassageVaultReader` rather than the full `VaultSource`
 * (`list`/`read`/`readBinary`/`write`/…), the same "smallest port the read
 * needs" posture `main.ts`'s other explain-back deps take. `ObsidianSource`
 * (`../vault/obsidian-source.js`) satisfies this structurally — no adapter
 * needed at the call site — and this file imports neither `obsidian` nor
 * `ObsidianSource`, so it is directly testable under Vitest, unlike
 * `modal.ts` itself (see that file's sibling specs for why).
 *
 * **Markdown-grain only, honestly.** `ConceptRelation.introducingPassages`
 * is minted from a `ReadConcept`/`CorpusConcept` anchor
 * (`concept/reconcile.ts`, `concept/corpus-relations/verdict.ts`), which for
 * a markdown note is always `{ page: 1, charRange: { start: block.start,
 * end: block.end } }` — the EXACT `[start, end)` of one block `../block/parse.js`
 * produced when the anchor was minted (`concept/read.ts`'s `gatherPassages`).
 * A non-markdown source (an embedded PDF/PPTX/DOCX page) anchors the SAME
 * way in principle, but resolving it would mean re-running that format's
 * extractor over binary bytes, not a `vault.read`/`parseDocument` pass —
 * real subsystem work this port does not also stand up. Such a
 * `Provenance` (`sourcePath` not ending `.md`, or `location.page !== 1`)
 * resolves `null` here — an honest "cannot resolve this grain," never a
 * guess, the same posture `extract/types.ts`'s `SourceLocation.section` doc
 * comment states for its own absent fields.
 *
 * **"Stale" is a structural check, never a stored-text comparison.**
 * `Provenance` carries no text of its own (only `ExtractedUnit.text` does,
 * and nothing persists that) — so there is no cached string to diff
 * against. What CAN be checked, and is: whether `charRange` still fits
 * inside the note's current length, and whether it still names the exact
 * `[start, end)` of one whole block in a fresh parse. A note edited since
 * the anchor was minted — a line inserted before it, the block split,
 * merged, or deleted — moves or removes that exact span, so the lookup
 * misses and this resolves `null`. A charRange that still happens to land
 * on some OTHER block's exact bounds by coincidence would read as fresh
 * rather than stale; that is the same class of blind spot `resolveEdgeIntroducingPassages`'s
 * own doc already accepts for its `blockId`-based dedup (a scheme built for
 * "honestly degrade," never for cryptographic identity).
 */

import { type Provenance, parseDocument } from 'olea-core';
import type { ExplainBackSourceBlock } from './request.js';

/** The one vault capability this read needs — see this file's module doc for why not `VaultSource`. */
export interface IntroducingPassageVaultReader {
  readonly read: (path: string) => Promise<string>;
}

/**
 * Resolves one endpoint's introducing passage to a citable
 * `ExplainBackSourceBlock`, or `null` when the note is missing/unreadable,
 * the provenance's grain cannot be resolved by a vault read (non-markdown,
 * or no `charRange`), or the passage no longer reads as it did at fold time
 * (stale — see this file's module doc). Never throws.
 *
 * The returned block's id follows `request.ts`'s
 * `retrieveExplainBackSourceBlocks` scheme, `${path}#${blockIndex}#${index}`
 * — `index` is always `0` here, since this call resolves exactly one block
 * from exactly one provenance, never a batch.
 */
export async function resolveIntroducingPassageFromVault(
  vault: IntroducingPassageVaultReader,
  provenance: Provenance,
): Promise<ExplainBackSourceBlock | null> {
  if (!provenance.sourcePath.endsWith('.md')) return null;

  const charRange = provenance.location.charRange;
  if (charRange === undefined || provenance.location.page !== 1) return null;

  let content: string;
  try {
    content = await vault.read(provenance.sourcePath);
  } catch {
    return null;
  }

  if (charRange.start < 0 || charRange.start >= charRange.end || charRange.end > content.length) {
    return null;
  }

  const doc = parseDocument(content);
  const blockIndex = doc.blocks.findIndex(
    (block) => block.start === charRange.start && block.end === charRange.end,
  );
  if (blockIndex === -1) return null;

  const block = doc.blocks[blockIndex];
  if (block === undefined || block.kind === 'frontmatter' || block.kind === 'blank') return null;
  if (block.raw.trim() === '') return null;

  return {
    block: { blockId: `${provenance.sourcePath}#${blockIndex}#0`, text: block.raw },
    path: provenance.sourcePath,
    blockIndex,
  };
}
