import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { serializeFrontmatter } from '../frontmatter/serialize.js';
import { appendEmptyEntry, OLEA_UID_KEY, stampUid } from './stamp.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
const NO_UID_WITH_FRONTMATTER = '03 Research/Norling 2019 - Turbidite Bedform Successions.md';
const NO_FRONTMATTER_AT_ALL = '01 Courses/GEOL204/WEEK 3/scratch-thoughts.md';
const CRLF_WITH_FRONTMATTER = '03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md';

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURE_ROOT, ...relPath.split('/')), 'utf8');
}

/**
 * Line-level diff, kept local to this spec file rather than imported from
 * `test/frontmatter/test-helpers.ts` (out of this lane's path discipline —
 * other agents own that directory). Same technique: each line keeps its own
 * trailing terminator, so a changed terminator counts as a changed line.
 */
function toLines(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, nl + 1));
    i = nl + 1;
  }
  return out;
}

function changedLineIndices(before: string, after: string): number[] {
  const a = toLines(before);
  const b = toLines(after);
  const max = Math.max(a.length, b.length);
  const changed: number[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed.push(i);
  }
  return changed;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let i = 0;
  while (true) {
    const found = text.indexOf(needle, i);
    if (found === -1) break;
    count += 1;
    i = found + needle.length;
  }
  return count;
}

describe('stampUid — a file that already has frontmatter (no olea-uid yet)', () => {
  const before = readFixture(NO_UID_WITH_FRONTMATTER);

  it('adds exactly one new line and nothing else changes', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-1' });
    expect(result.changed).toBe(true);
    expect(result.uid).toBe('fixed-uid-1');

    const beforeLines = toLines(before);
    const afterLines = toLines(result.content);
    expect(afterLines.length).toBe(beforeLines.length + 1);

    // Every original line survives, byte-identical, in order — the diff is
    // purely additive, nothing was rewritten around the insertion point.
    // The new line is the last line of the frontmatter block; everything
    // before it (the whole original frontmatter) and everything after it
    // (the closing delimiter and the entire body) is untouched.
    const newLineIndex = afterLines.findIndex((l) => l.startsWith(`${OLEA_UID_KEY}:`));
    expect(newLineIndex).toBeGreaterThan(-1);
    const spliced = [...afterLines];
    spliced.splice(newLineIndex, 1);
    expect(spliced.join('')).toBe(before);

    expect(afterLines[newLineIndex]).toBe('olea-uid: fixed-uid-1\n');
  });

  it('is idempotent: stamping the already-stamped output is a byte-identical no-op', () => {
    const first = stampUid(before, { generateId: () => 'fixed-uid-1' });
    const second = stampUid(first.content, { generateId: () => 'should-not-be-used' });

    expect(second.changed).toBe(false);
    expect(second.uid).toBe('fixed-uid-1');
    expect(second.content).toBe(first.content);
  });

  it('the frontmatter round-trips losslessly once re-parsed', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-1' });
    // Recover just the frontmatter inner text the same way the block parser
    // would, and confirm parse ∘ serialize is still exact identity — the
    // insertion did not leave the frontmatter block itself malformed.
    const innerStart = result.content.indexOf('\n') + 1;
    const closeIdx = result.content.indexOf('\n---', innerStart);
    const inner = result.content.slice(innerStart, closeIdx + 1);
    const fm = parseFrontmatter(inner);
    expect(serializeFrontmatter(fm)).toBe(inner);
  });
});

describe('stampUid — a file with no frontmatter at all', () => {
  const before = readFixture(NO_FRONTMATTER_AT_ALL);

  it('creates a minimal frontmatter block and appends the original body byte-for-byte', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-2' });
    expect(result.changed).toBe(true);
    expect(result.uid).toBe('fixed-uid-2');

    // Documented decision (see stamp.ts's stampNoFrontmatter doc): exactly
    // `---\nolea-uid: <id>\n---\n`, then the original content immediately —
    // no blank separator line invented.
    const expectedBlock = '---\nolea-uid: fixed-uid-2\n---\n';
    expect(result.content.startsWith(expectedBlock)).toBe(true);

    // The body is untouched byte-for-byte: everything after the created
    // block is `===` to the *entire original file*, not just "looks similar".
    const body = result.content.slice(expectedBlock.length);
    expect(body).toBe(before);
    expect(body.length).toBe(before.length);
  });

  it('total added length is exactly the created block, nothing more', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-2' });
    const expectedBlock = '---\nolea-uid: fixed-uid-2\n---\n';
    expect(result.content.length).toBe(before.length + expectedBlock.length);
  });

  it('is idempotent once frontmatter exists: stamping the created output again is a no-op', () => {
    const first = stampUid(before, { generateId: () => 'fixed-uid-2' });
    const second = stampUid(first.content, { generateId: () => 'should-not-be-used' });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.uid).toBe('fixed-uid-2');
  });

  it('uses LF for the created block when the original file is LF (matches the body)', () => {
    expect(before.includes('\r\n')).toBe(false);
    const result = stampUid(before, { generateId: () => 'x' });
    expect(result.content.startsWith('---\nolea-uid: x\n---\n')).toBe(true);
  });
});

describe('stampUid — CRLF file that also carries frontmatter (Reyes fixture)', () => {
  const before = readFixture(CRLF_WITH_FRONTMATTER);

  it('the fixture really is CRLF throughout, including its frontmatter (sanity check)', () => {
    expect(before.includes('\r\n')).toBe(true);
    // Every '\n' is part of a '\r\n' pair.
    expect(countOccurrences(before, '\n')).toBe(countOccurrences(before, '\r\n'));
  });

  it("the added uid line ends \\r\\n, and the file's total \\r\\n count increases by exactly one", () => {
    const beforeCrlfCount = countOccurrences(before, '\r\n');
    const result = stampUid(before, { generateId: () => 'fixed-uid-3' });

    expect(result.changed).toBe(true);
    const afterCrlfCount = countOccurrences(result.content, '\r\n');
    expect(afterCrlfCount).toBe(beforeCrlfCount + 1);

    // Every '\n' in the result is still part of a '\r\n' pair — no bare LF
    // introduced anywhere, not just at the insertion point.
    expect(countOccurrences(result.content, '\n')).toBe(afterCrlfCount);

    const afterLines = toLines(result.content);
    const newLine = afterLines.find((l) => l.startsWith(`${OLEA_UID_KEY}:`));
    expect(newLine).toBe('olea-uid: fixed-uid-3\r\n');
  });

  it('diff against the original is exactly one added line — every other line is byte-identical', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-3' });
    const beforeLines = toLines(before);
    const afterLines = toLines(result.content);
    expect(afterLines.length).toBe(beforeLines.length + 1);

    const newLineIndex = afterLines.findIndex((l) => l.startsWith(`${OLEA_UID_KEY}:`));
    const spliced = [...afterLines];
    spliced.splice(newLineIndex, 1);
    expect(spliced.join('')).toBe(before);
  });

  it('is idempotent on the CRLF fixture too', () => {
    const first = stampUid(before, { generateId: () => 'fixed-uid-3' });
    const second = stampUid(first.content, { generateId: () => 'should-not-be-used' });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });
});

describe('stampUid — a leading UTF-8 BOM file that also carries frontmatter (ol-2zfj.51)', () => {
  // Coined content (INV-3) — no fixture in the vault carries a BOM, so this
  // is constructed directly, mirroring the CRLF describe block above.
  const before = '﻿---\ncourse: coined-course\nweek: 3\n---\n\nCoined prose.\n';

  it('the fixture really opens with a BOM (sanity check)', () => {
    expect(before.charCodeAt(0)).toBe(0xfeff);
  });

  it('stamps into the note’s existing frontmatter rather than prepending a second, spurious block', () => {
    const result = stampUid(before, { generateId: () => 'fixed-uid-bom' });
    expect(result.changed).toBe(true);

    // Exactly one new line, everything else byte-identical, same proof
    // shape as every other describe block in this file.
    const beforeLines = toLines(before);
    const afterLines = toLines(result.content);
    expect(afterLines.length).toBe(beforeLines.length + 1);
    const newLineIndex = afterLines.findIndex((l) => l.startsWith(`${OLEA_UID_KEY}:`));
    expect(newLineIndex).toBeGreaterThan(-1);
    const spliced = [...afterLines];
    spliced.splice(newLineIndex, 1);
    expect(spliced.join('')).toBe(before);

    // The BOM is still the very first character of the result (INV-2) —
    // never stripped, never pushed down behind a second frontmatter block.
    expect(result.content.charCodeAt(0)).toBe(0xfeff);
    expect(result.content.startsWith('﻿---\n')).toBe(true);

    // The ORIGINAL frontmatter's own fields are still readable as
    // frontmatter, not buried as body text after a spurious second block.
    const innerStart = result.content.indexOf('\n') + 1;
    const closeIdx = result.content.indexOf('\n---', innerStart);
    const inner = result.content.slice(innerStart, closeIdx + 1);
    const fm = parseFrontmatter(inner);
    const course = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'course');
    expect(course).toBeDefined();
  });

  it('is idempotent on the BOM fixture too', () => {
    const first = stampUid(before, { generateId: () => 'fixed-uid-bom' });
    const second = stampUid(first.content, { generateId: () => 'should-not-be-used' });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });
});

describe('stampUid — a frontmatter entry that already exists but is empty (template-style placeholder)', () => {
  it('fills the empty value in place rather than inserting a second entry', () => {
    const before = '---\nolea-uid: \ncourse: GEOL204\n---\n\n# Title\n';
    const result = stampUid(before, { generateId: () => 'fixed-uid-4' });
    expect(result.changed).toBe(true);
    expect(result.content).toBe('---\nolea-uid: fixed-uid-4\ncourse: GEOL204\n---\n\n# Title\n');
    // Exactly one line changed, no line added or removed.
    expect(toLines(result.content).length).toBe(toLines(before).length);
    const changed = changedLineIndices(before, result.content);
    expect(changed).toEqual([1]);
  });
});

describe('appendEmptyEntry — a frontmatter whose last entry has no trailing newline', () => {
  // A real file's frontmatter can never reach the block parser in this
  // shape (the closing `---` line requires the entry before it to already
  // be newline-terminated — see appendEmptyEntry's own doc), so this
  // constructs the case directly via `parseFrontmatter`, the same technique
  // the frontmatter module's own permanent suite uses for this exact edge
  // (a bare `parseFrontmatter('a: 1\\nb: 2')` with no trailing newline).
  it('terminates the previous entry before appending the new one, rather than welding them together', () => {
    const fm = parseFrontmatter('citekey: old');
    expect(fm.nodes).toHaveLength(1);
    expect(fm.nodes[0]?.raw.endsWith('\n')).toBe(false); // sanity: the setup really has no trailing newline

    const withEntry = appendEmptyEntry(fm, 'olea-uid', '\n');
    const serialized = serializeFrontmatter(withEntry);

    expect(serialized).toBe('citekey: old\nolea-uid: \n');
    // The original entry's own text is untouched apart from gaining exactly
    // the one terminator byte it was missing — not rewritten, not merged.
    expect(withEntry.nodes[0]?.raw).toBe('citekey: old\n');
  });

  it('does not double-terminate when the last entry already ends in a newline', () => {
    const fm = parseFrontmatter('citekey: old\n');
    const withEntry = appendEmptyEntry(fm, 'olea-uid', '\n');
    expect(serializeFrontmatter(withEntry)).toBe('citekey: old\nolea-uid: \n');
  });

  it('uses a CRLF terminator when asked, matching a CRLF file', () => {
    const fm = parseFrontmatter('citekey: old\r\n');
    const withEntry = appendEmptyEntry(fm, 'olea-uid', '\r\n');
    expect(serializeFrontmatter(withEntry)).toBe('citekey: old\r\nolea-uid: \r\n');
  });
});

describe('stampUid — custom key and injectable id generator', () => {
  it('honours a custom frontmatter key', () => {
    const before = '---\ncourse: GEOL204\n---\n\n# Title\n';
    const result = stampUid(before, { key: 'my-uid', generateId: () => 'x' });
    expect(result.content).toBe('---\ncourse: GEOL204\nmy-uid: x\n---\n\n# Title\n');
  });

  it('uses the default generator (crypto.randomUUID) when none is supplied, producing a well-formed uuid', () => {
    const before = '---\ncourse: GEOL204\n---\n\n# Title\n';
    const result = stampUid(before);
    expect(result.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
