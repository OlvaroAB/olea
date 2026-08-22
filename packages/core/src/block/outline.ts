/**
 * Builds a heading-rooted outline over a parsed document's block list
 * (F1.4 / P1-T05 walks this for concepts; F3.2 cites into it). An
 * `OutlineNode` holds no text of its own — every field points back into
 * `ParsedDocument.blocks` by index, per ./types.ts.
 */

import type { HeadingBlock, OutlineNode, ParsedDocument } from './types.js';

/** The mutable form of `OutlineNode` used while the stack is still open. */
interface OpenNode {
  readonly level: number;
  readonly heading: HeadingBlock;
  readonly index: number;
  readonly contentIndices: number[];
  readonly children: OutlineNode[];
}

// `OpenNode` and the `OutlineNode` built from it share the same
// `contentIndices`/`children` array objects, so pushing to an `OpenNode`
// still on the stack is visible through the `OutlineNode` already attached
// to its parent (or to `roots`) — no re-linking pass is needed once a node
// closes.
function toOutlineNode(open: OpenNode): OutlineNode {
  return {
    heading: open.heading,
    index: open.index,
    contentIndices: open.contentIndices,
    children: open.children,
  };
}

/**
 * A heading's own `contentIndices` are the blocks between it and its first
 * child heading (or, with no children, up to the next heading of equal or
 * higher level). Reaching a heading of level <= some open node's level
 * closes that node and everything nested deeper than it.
 */
export function buildOutline(doc: ParsedDocument): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OpenNode[] = [];

  doc.blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top && top.level >= block.level) {
          stack.pop();
        } else {
          break;
        }
      }
      const open: OpenNode = {
        level: block.level,
        heading: block,
        index,
        contentIndices: [],
        children: [],
      };
      const node = toOutlineNode(open);
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
      stack.push(open);
      return;
    }

    const current = stack[stack.length - 1];
    if (current) current.contentIndices.push(index);
  });

  return roots;
}
