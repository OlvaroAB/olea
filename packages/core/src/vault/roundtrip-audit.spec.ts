/**
 * INV-2 round-trip audit — property-style cases run across every
 * note-mutating writer core owns, against four byte-shapes real notes can
 * carry that no single writer's own spec file exercises for every one of
 * them at once: CRLF, no trailing newline, a leading BOM, and an
 * NFD-composed (combining-character) heading elsewhere in the file.
 *
 * This file does not replace any writer's own spec — `uid/stamp.spec.ts`,
 * `instrument/mcq-format.spec.ts` and `instrument/card-format.spec.ts` each
 * already prove idempotence, field-insertion-only edits and (for `stamp.ts`)
 * a CRLF fixture. What is new here is running the *same four input classes*
 * against every stamping/inserting writer side by side, using one generic,
 * writer-agnostic proof of "every byte outside the intended span is
 * untouched" (`assertPureInsertion`, below) instead of each writer's own
 * bespoke span bookkeeping — so a gap in one writer's own tests (e.g. no BOM
 * case) does not silently mean the property was never checked for it.
 *
 * All content below is coined placeholder text, never real vault vocabulary
 * (INV-3) — same convention every writer's own spec file already follows.
 *
 * Content only, never bead text or fixture vocabulary is quoted here.
 */
import { describe, expect, it } from 'vitest';
import { removeSpans } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import type { EntryNode } from '../frontmatter/types.js';
import { createQaCard, parseCards, stampQaCardBlockId } from '../instrument/card-format.js';
import {
  insertMcqBlock,
  MCQ_FENCE_INFO,
  parseMcqBlocks,
  stampMcqId,
  stampMcqPredecessor,
} from '../instrument/mcq-format.js';
import { stampUid } from '../uid/stamp.js';

// ---- generic, writer-agnostic proof --------------------------------------

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  const max = Math.min(a.length, b.length, limit);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Asserts that `after` is reachable from `before` by inserting text at a
 * single point and nothing else — every byte of `before` survives, in
 * order, outside that one gap. Scanning in from both ends and requiring the
 * two matched runs to cover the whole of `before` is itself the proof: if
 * anything in the middle of `before` had been deleted or rewritten instead
 * of purely having text spliced in, `prefix + suffix` would fall short of
 * `before.length`. This is the same property each writer's own
 * `insertedSpan`/`removeSpans` check proves, stated once, generically enough
 * to also cover `stampUid` (whose `StampResult` carries no span at all) and
 * to compare `before`/`after` even when a test never held onto the span.
 *
 * A true no-op (`before === after`) satisfies this trivially: the whole
 * string is common prefix, nothing is left over.
 */
function assertPureInsertion(before: string, after: string): void {
  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, before.length - prefix);
  expect(prefix + suffix).toBe(before.length);
  expect(after.length).toBeGreaterThanOrEqual(before.length);
}

// ---- the four input classes ----------------------------------------------

function toCrlf(source: string): string {
  return source.replace(/\n/g, '\r\n');
}

function withoutTrailingNewline(source: string): string {
  return source.endsWith('\r\n')
    ? source.slice(0, -2)
    : source.endsWith('\n')
      ? source.slice(0, -1)
      : source;
}

function withLeadingBom(source: string): string {
  return `﻿${source}`;
}

/** "Café" spelled with a combining acute accent (U+0301) rather than the precomposed U+00E9 — an NFD heading a real editor can produce without her ever seeing a difference on screen. */
const NFD_WORD = `Café`;

function withNfdHeadingInBody(source: string): string {
  // Spliced in right after the frontmatter's closing line (or at the very
  // top when there is none) — never inside the block under test, so it
  // never changes which span a writer targets, only what else is in the
  // file around it.
  const closeIdx = source.indexOf('\n---\n');
  if (closeIdx === -1) return `# ${NFD_WORD} notes\n\n${source}`;
  const insertAt = closeIdx + '\n---\n'.length;
  return `${source.slice(0, insertAt)}\n# ${NFD_WORD} notes\n\n${source.slice(insertAt)}`;
}

interface Variant {
  readonly label: string;
  readonly build: (base: string) => string;
}

const VARIANTS: readonly Variant[] = [
  { label: 'CRLF', build: toCrlf },
  { label: 'no trailing newline', build: withoutTrailingNewline },
  { label: 'leading BOM', build: withLeadingBom },
  { label: 'NFD-composed heading elsewhere in the file', build: withNfdHeadingInBody },
];

// ---- fixtures (coined content only, INV-3) --------------------------------

const UID_BASE = ['---', 'course: coined-course', 'week: 3', '---', '', 'Coined prose.', ''].join(
  '\n',
);

const MCQ_BASE = [
  '---',
  'course: coined-course',
  '---',
  '',
  '# Practice',
  '',
  'Some coined prose before.',
  '',
  `\`\`\`${MCQ_FENCE_INFO}`,
  'stem: which coined item is correct?',
  'answer: coined answer',
  'distractor: coined distractor one',
  'distractor: coined distractor two',
  'distractor: coined distractor three',
  'distractor: coined distractor four',
  '```',
  '',
  'Some coined prose after.',
  '',
].join('\n');

const QA_BASE = [
  '---',
  'course: coined-course',
  '---',
  '',
  'Some coined prose before.',
  '',
  'coined question::coined answer',
  '',
  'Some coined prose after.',
  '',
].join('\n');

// ---- stampUid (uid/stamp.ts) ----------------------------------------------

describe('stampUid (uid/stamp.ts) — round-trip audit', () => {
  for (const { label, build } of VARIANTS) {
    const before = build(UID_BASE);

    it(`stamps a uid and touches nothing outside the inserted line — ${label}`, () => {
      const result = stampUid(before, { generateId: () => 'audit-uid-1' });
      expect(result.changed).toBe(true);
      assertPureInsertion(before, result.content);
    });

    it(`is idempotent on the already-stamped result — ${label}`, () => {
      const first = stampUid(before, { generateId: () => 'audit-uid-1' });
      const second = stampUid(first.content, { generateId: () => 'should-not-be-used' });
      expect(second.changed).toBe(false);
      expect(second.content).toBe(first.content);
    });
  }

  // --- FIXED: leading BOM no longer defeats frontmatter recognition -------
  //
  // `block/parse.ts`'s frontmatter detection used to match line 0 against
  // the literal string '---' (parse.ts:178). A leading BOM survives as the
  // first character of that same line (folder-source.ts's own doc: reading
  // and writing never strip or add one), so `first.content` was '﻿---',
  // which never equalled '---'. `stampUid` (stamp.ts:185) then fell through
  // to `stampNoFrontmatter` and prepended a BRAND NEW frontmatter block
  // ahead of the BOM, rather than stamping the note's real one, burying the
  // original `course:`/`week:` frontmatter as body text after a second,
  // spurious frontmatter block. Fixed (`ol-2zfj.51`) by stripping a leading
  // BOM only for the '---' comparison, never from the recorded span — see
  // `block/parse.ts`'s frontmatter-detection comment.
  it('stamps the uid into the note’s existing frontmatter block even when the file opens with a BOM (ol-2zfj.51)', () => {
    const before = withLeadingBom(UID_BASE);
    const result = stampUid(before, { generateId: () => 'audit-uid-1' });

    // The BOM is still the very first byte of the result (INV-2) — never
    // stripped, never pushed down behind a second frontmatter block.
    expect(result.content.charCodeAt(0)).toBe(0xfeff);

    const doc = parseDocument(result.content);
    const fmBlock = doc.blocks[0];
    if (fmBlock?.kind !== 'frontmatter') {
      throw new Error('expected the first block of the result to be recognised frontmatter');
    }
    // Exactly one frontmatter block — no spurious second one prepended.
    expect(doc.blocks.filter((b) => b.kind === 'frontmatter')).toHaveLength(1);

    const fm = parseFrontmatter(fmBlock.inner);
    const course = fm.nodes.find((n): n is EntryNode => n.kind === 'entry' && n.key === 'course');
    // `course` was in the ORIGINAL frontmatter, and is recoverable from the
    // one block a fresh parse calls "frontmatter" — the stamp landed inside
    // it rather than ahead of it.
    expect(course).toBeDefined();
    assertPureInsertion(before, result.content);
  });
});

// ---- stampMcqId / stampMcqPredecessor (instrument/mcq-format.ts) ---------

describe('stampMcqId (instrument/mcq-format.ts) — round-trip audit', () => {
  for (const { label, build } of VARIANTS) {
    const before = build(MCQ_BASE);

    it(`stamps an id and touches nothing outside it — ${label}`, () => {
      const target = parseMcqBlocks(before).instruments[0];
      if (!target) throw new Error(`fixture (${label}) has no MCQ instrument to stamp`);

      const result = stampMcqId(before, target.span, { generateId: () => 'mcq-audit-1' });
      expect(result.changed).toBe(true);
      assertPureInsertion(before, result.content);
      if (result.insertedSpan) {
        expect(removeSpans(result.content, [result.insertedSpan])).toBe(before);
      }
    });

    it(`is idempotent on the already-stamped block — ${label}`, () => {
      const target = parseMcqBlocks(before).instruments[0];
      if (!target) throw new Error(`fixture (${label}) has no MCQ instrument to stamp`);
      const first = stampMcqId(before, target.span, { generateId: () => 'mcq-audit-1' });

      const restamped = parseMcqBlocks(first.content).instruments[0];
      if (!restamped) throw new Error('stamped MCQ block did not re-parse');
      const second = stampMcqId(first.content, restamped.span, {
        generateId: () => 'should-not-be-used',
      });
      expect(second.changed).toBe(false);
      expect(second.content).toBe(first.content);
    });
  }
});

describe('stampMcqPredecessor (instrument/mcq-format.ts) — round-trip audit', () => {
  for (const { label, build } of VARIANTS) {
    const before = build(MCQ_BASE);

    it(`writes the predecessor field and touches nothing outside it — ${label}`, () => {
      const target = parseMcqBlocks(before).instruments[0];
      if (!target) throw new Error(`fixture (${label}) has no MCQ instrument to stamp`);

      const result = stampMcqPredecessor(before, target.span, 'coined-predecessor-id');
      expect(result.changed).toBe(true);
      assertPureInsertion(before, result.content);
      if (result.insertedSpan) {
        expect(removeSpans(result.content, [result.insertedSpan])).toBe(before);
      }
    });

    it(`is idempotent once a predecessor is already present — ${label}`, () => {
      const target = parseMcqBlocks(before).instruments[0];
      if (!target) throw new Error(`fixture (${label}) has no MCQ instrument to stamp`);
      const first = stampMcqPredecessor(before, target.span, 'coined-predecessor-id');

      const restamped = parseMcqBlocks(first.content).instruments[0];
      if (!restamped) throw new Error('stamped MCQ block did not re-parse');
      const second = stampMcqPredecessor(first.content, restamped.span, 'a-different-predecessor');
      expect(second.changed).toBe(false);
      expect(second.content).toBe(first.content);
    });
  }
});

// ---- insertMcqBlock (instrument/mcq-format.ts) — the insert-side sibling -

describe('insertMcqBlock (instrument/mcq-format.ts) — round-trip audit', () => {
  const fields = {
    stem: 'a freshly generated coined stem?',
    answer: 'coined answer',
    distractors: [
      'coined distractor one',
      'coined distractor two',
      'coined distractor three',
      'coined distractor four',
    ],
  };

  for (const { label, build } of VARIANTS) {
    const before = build(MCQ_BASE);

    it(`inserts a new block and touches nothing outside it — ${label}`, () => {
      const doc = parseDocument(before);
      const anchorIndex = doc.blocks.findIndex((b) => b.kind === 'blank') - 1;
      const result = insertMcqBlock({
        source: before,
        afterBlockIndex: anchorIndex >= 0 ? anchorIndex : 0,
        fields,
      });
      assertPureInsertion(before, result.content);
      expect(removeSpans(result.content, [result.insertedSpan])).toBe(before);
    });
  }
});

// ---- stampQaCardBlockId (instrument/card-format.ts) -----------------------

describe('stampQaCardBlockId (instrument/card-format.ts) — round-trip audit', () => {
  for (const { label, build } of VARIANTS) {
    const before = build(QA_BASE);

    it(`stamps a block id and touches nothing outside it — ${label}`, () => {
      const cards = parseCards(before);
      const target = cards.find((c) => c.type === 'qa');
      if (!target) throw new Error(`fixture (${label}) has no Q&A card to stamp`);

      const result = stampQaCardBlockId(before, target.span, {
        generateBlockId: () => 'qa-audit-1',
      });
      expect(result.changed).toBe(true);
      assertPureInsertion(before, result.content);
      if (result.insertedSpan) {
        expect(removeSpans(result.content, [result.insertedSpan])).toBe(before);
      }
    });

    it(`is idempotent on the already-stamped card — ${label}`, () => {
      const cards = parseCards(before);
      const target = cards.find((c) => c.type === 'qa');
      if (!target) throw new Error(`fixture (${label}) has no Q&A card to stamp`);
      const first = stampQaCardBlockId(before, target.span, {
        generateBlockId: () => 'qa-audit-1',
      });

      const restamped = parseCards(first.content).find((c) => c.type === 'qa');
      if (!restamped) throw new Error('stamped card did not re-parse');
      const second = stampQaCardBlockId(first.content, restamped.span, {
        generateBlockId: () => 'should-not-be-used',
      });
      expect(second.changed).toBe(false);
      expect(second.content).toBe(first.content);
    });
  }
});

// ---- createQaCard (instrument/card-format.ts) — the insert-side sibling --

describe('createQaCard (instrument/card-format.ts) — round-trip audit', () => {
  for (const { label, build } of VARIANTS) {
    const before = build(QA_BASE);

    it(`creates a new card and touches nothing outside the insertion and its own anchor edit — ${label}`, () => {
      const doc = parseDocument(before);
      const anchorIndex = doc.blocks.findIndex((b) => b.kind === 'paragraph');
      if (anchorIndex === -1) throw new Error(`fixture (${label}) has no paragraph to anchor on`);

      const result = createQaCard({
        source: before,
        anchorBlockIndex: anchorIndex,
        front: 'a freshly authored coined front',
        back: 'a freshly authored coined back',
        generateBlockId: () => 'anchor-audit-1',
      });

      // `createQaCard` can make up to two separate edits (the anchor
      // line's own block id, plus the inserted card) — `removeSpans` is
      // span-aware and subtracts both correctly. `assertPureInsertion`'s
      // single-gap scan deliberately isn't used here: two genuinely
      // separate insertion points collapse its prefix/suffix scan onto
      // whichever span sits last, which would misreport a correct two-span
      // edit as a violation.
      const spans = result.blockIdSpan
        ? [result.insertedSpan, result.blockIdSpan]
        : [result.insertedSpan];
      expect(removeSpans(result.content, spans)).toBe(before);
    });
  }
});
