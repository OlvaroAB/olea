/**
 * Indexes one document: reads it through `VaultSource`, parses it (P1-T01),
 * and derives an `IndexedDocument` (C2.1). This is the single place both a
 * full rebuild (`build.ts`) and an incremental update (`engine.ts`) turn a
 * path into index content, so the two paths can never quietly diverge in how
 * they read a document — the exact property C2.4's equivalence test relies
 * on being true by construction, not by two implementations staying in sync
 * by discipline.
 */

import { parseDocument } from '../block/parse.js';
import type { Block } from '../block/types.js';
import { readTranscriptText, resolveTranscriptFormat } from '../extract/transcript.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList } from '../frontmatter/read.js';
import { hashText } from '../ingestion/hash.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { evidenceRawOfBlock, type GeneratedSpan, generatedSpans } from './evidence-scope.js';
import type { IndexedBlock, IndexedDocument } from './types.js';

/**
 * The block kinds this index ever produces an entry for, and how each
 * contributes searchable text. Frontmatter, blank runs and thematic breaks
 * carry no prose and are deliberately excluded — see `types.ts`'s
 * `IndexedBlock` doc on why `blockIndex` is therefore non-contiguous.
 */
function extractBlockText(block: Block): string | null {
  switch (block.kind) {
    case 'heading':
      return block.text;
    case 'paragraph':
    case 'code':
    case 'callout':
      return block.raw;
    case 'list':
      return block.items.map((item) => item.text).join('\n');
    case 'frontmatter':
    case 'blank':
    case 'thematicBreak':
      return null;
  }
}

function indexBlocks(
  blocks: readonly Block[],
  source: string,
  generated: readonly GeneratedSpan[],
): readonly IndexedBlock[] {
  const indexed: IndexedBlock[] = [];
  blocks.forEach((block, blockIndex) => {
    let raw = extractBlockText(block);
    if (raw === null) return;
    // [D-491]: the index is course evidence only. A block Olea's own instruments or home-note
    // scaffolding reach is cut down to her text, or dropped when none of it is hers; every other
    // block is indexed exactly as before. `blockIndex` stays positional in the FULL parse.
    const kept = evidenceRawOfBlock(block, source, generated);
    if (kept === null) return;
    if (kept !== block.raw) raw = kept;
    const text = raw.trim();
    if (text === '') return;
    indexed.push({ blockIndex, kind: block.kind, text });
  });
  return indexed;
}

/**
 * Reads and indexes one document at `path`. Throws if the vault can't
 * produce the content (callers — `build.ts`, `engine.ts` — only call this
 * for paths they already know exist, from `list()` or a `create`/`modify`/
 * `rename` event whose target they've just confirmed with `exists`).
 */
export async function indexDocument(vault: VaultSource, path: VaultPath): Promise<IndexedDocument> {
  const content = await vault.read(path);
  const doc = parseDocument(content);
  const contentHashPromise = hashText(content);

  // D-465: a plain-text file, or Markdown declaring role transcript, is a lecture transcript. It is
  // indexed once, as its reader's parts (each carrying its part ordinal), never as authored-note blocks.
  const resolution = resolveTranscriptFormat(path, content);
  if (resolution.kind === 'transcript') {
    const read = readTranscriptText(content, resolution.format);
    if (read.ok) {
      const parts: IndexedBlock[] = [];
      for (const part of read.parts) {
        const text = part.text.trim();
        if (text === '') continue;
        parts.push({ blockIndex: part.ordinal - 1, kind: 'paragraph', text, part: part.ordinal });
      }
      const head = doc.blocks[0];
      const transcriptCourses =
        head?.kind === 'frontmatter'
          ? [...readList(parseFrontmatter(head.inner), 'course').items].sort()
          : [];
      return {
        path,
        courses: transcriptCourses,
        contentHash: await contentHashPromise,
        evidenceScope: 1,
        blocks: parts,
      };
    }
  }

  const first = doc.blocks[0];
  let courses: readonly string[] = [];
  if (first?.kind === 'frontmatter') {
    const fm = parseFrontmatter(first.inner);
    courses = [...readList(fm, 'course').items].sort();
  }

  const contentHash = await contentHashPromise;
  const blocks = indexBlocks(doc.blocks, content, generatedSpans(content, doc));

  return { path, courses, contentHash, evidenceScope: 1, blocks };
}
