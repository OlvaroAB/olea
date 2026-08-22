// PERMANENT SUITE — INV-2, P1-T02. Companion to golden.spec.ts: where that
// suite proves an *unedited* round-trip is byte-identical, this suite
// proves a *targeted* edit via `setEntryValue` touches only the one entry
// it names and leaves every other byte — other keys' quoting, spacing,
// comments, blank lines, line endings — untouched. Never pruned, only
// extended, per the same INV-2 rule as golden.spec.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/block/parse.js';
import type { FrontmatterBlock } from '../../src/block/types.js';
import { parseFrontmatter } from '../../src/frontmatter/parse.js';
import { serializeFrontmatter, setEntryValue } from '../../src/frontmatter/serialize.js';
import { isFrontmatterLossless } from '../../src/frontmatter/types.js';
import { changedLineIndices, isContiguous, toLines } from './test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vaultRoot = join(__dirname, '..', '..', 'fixtures', 'vault');

function readInner(relPath: string): string {
  const source = readFileSync(join(vaultRoot, relPath), 'utf8');
  const block = parseDocument(source).blocks[0] as FrontmatterBlock | undefined;
  if (block?.kind !== 'frontmatter') {
    throw new Error(`fixture has no frontmatter block: ${relPath}`);
  }
  return block.inner;
}

/**
 * The untouched-lines property, asserted directly rather than eyeballed:
 * diff `before`/`after` line by line, assert the changed lines form exactly
 * one contiguous run, and assert every line outside that run is
 * byte-identical (implied by `changedLineIndices` finding nothing there,
 * but spelled out explicitly here too so a failure is legible on its own).
 */
function assertOnlyOneContiguousRunChanged(before: string, after: string): number[] {
  const changed = changedLineIndices(before, after);
  expect(changed.length).toBeGreaterThan(0);
  expect(isContiguous(changed)).toBe(true);

  const beforeLines = toLines(before);
  const afterLines = toLines(after);
  const changedSet = new Set(changed);
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    if (changedSet.has(i)) continue;
    expect(afterLines[i]).toBe(beforeLines[i]);
  }
  return changed;
}

describe('setEntryValue — targeted edit touches only its own entry', () => {
  it('editing the first entry (citekey) touches only that line (Norling)', () => {
    const inner = readInner('03 Research/Norling 2019 - Turbidite Bedform Successions.md');
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'citekey', 'norling2019newkey\n');
    const after = serializeFrontmatter(edited);

    expect(isFrontmatterLossless(edited)).toBe(true);
    const changed = assertOnlyOneContiguousRunChanged(inner, after);
    expect(changed).toEqual([0]); // `citekey:` is the file's first line.
    expect(toLines(after)[0]).toBe('citekey: norling2019newkey\n');
  });

  it('editing the last entry (related) touches only that line (Norling)', () => {
    const inner = readInner('03 Research/Norling 2019 - Turbidite Bedform Successions.md');
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'related', '[[New Concept]]\n');
    const after = serializeFrontmatter(edited);

    expect(isFrontmatterLossless(edited)).toBe(true);
    const beforeLines = toLines(inner);
    const lastIndex = beforeLines.length - 1;
    const changed = assertOnlyOneContiguousRunChanged(inner, after);
    expect(changed).toEqual([lastIndex]);
    expect(toLines(after)[lastIndex]).toBe('related: [[New Concept]]\n');
  });

  it('editing a middle entry (year) leaves the quoted wikilink entry after it untouched (Petrov)', () => {
    const inner = readInner(
      '03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md',
    );
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'year', '"2022"\n');
    const after = serializeFrontmatter(edited);

    expect(isFrontmatterLossless(edited)).toBe(true);
    assertOnlyOneContiguousRunChanged(inner, after);
    // Explicitly spelled out: the mixed-quoting entries around `year` keep
    // their exact original quoting style byte-for-byte.
    expect(after).toContain("authors: ['A. Petrov', 'K. Adeyemi']\n");
    expect(after).toContain('related: "[[Deceptive cadence]]"\n');
    expect(after).toContain('citekey: petrov2021chromatic\n');
  });

  it("editing a key inside a CRLF frontmatter block preserves every other line's CRLF ending (Reyes, real fixture)", () => {
    const inner = readInner('03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md');
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'year', '2025\r\n');
    const after = serializeFrontmatter(edited);

    expect(isFrontmatterLossless(edited)).toBe(true);
    const changed = assertOnlyOneContiguousRunChanged(inner, after);
    expect(changed).toEqual([2]); // `year:` is the third line.
    // The edited line itself ends `\r\n`, not a bare LF.
    expect(toLines(after)[2]).toBe('year: 2025\r\n');
    expect(toLines(after)[2]?.endsWith('\r\n')).toBe(true);
    // Every untouched line still ends in CRLF, not bare LF.
    for (const [i, line] of toLines(after).entries()) {
      if (i === 2) continue;
      expect(line.endsWith('\r\n')).toBe(true);
    }
    // The file's total \r\n count is unchanged by the edit — a targeted
    // edit inside CRLF frontmatter must not add, drop, or convert any line
    // ending anywhere else in the block.
    const crlfCount = (text: string) => (text.match(/\r\n/g) ?? []).length;
    expect(crlfCount(after)).toBe(crlfCount(inner));
  });

  it('replacing a block-list value with a shorter inline value changes only that contiguous run (Halloran)', () => {
    const inner = readInner(
      '03 Research/Halloran 2018 - Chorale Doubling in Keyboard Realisation.md',
    );
    const fm = parseFrontmatter(inner);
    // Was `related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n`
    // (3 lines) — collapse to a single inline value (1 line). Line count
    // changes, so this exercises the prefix/suffix property rather than a
    // fixed-index line diff.
    // The original key line was `related:` with no separator space at all
    // (its value opened on a continuation line), so the replacement value
    // must supply its own leading space to read naturally on one line —
    // setEntryValue splices exactly what it's given, no magic.
    const edited = setEntryValue(fm, 'related', ' [[Appoggiatura]]\n');
    const after = serializeFrontmatter(edited);

    expect(isFrontmatterLossless(edited)).toBe(true);

    const beforeIdx = inner.indexOf('related:');
    const prefix = inner.slice(0, beforeIdx);
    const oldEntryEnd =
      beforeIdx + 'related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n'.length;
    const suffix = inner.slice(oldEntryEnd);

    expect(after.startsWith(prefix)).toBe(true);
    expect(after.endsWith(suffix)).toBe(true);
    expect(after).toBe(`${prefix}related: [[Appoggiatura]]\n${suffix}`);
  });

  it('throws rather than silently no-op-ing when the key does not exist', () => {
    const fm = parseFrontmatter('citekey: x\n');
    expect(() => setEntryValue(fm, 'nonexistent', 'y\n')).toThrow();
  });
});

// Regression guard for a defect found in orchestrator review, not by the
// original suite: `EntryNode.valueRaw` includes the entry's trailing line
// ending, so an earlier `setEntryValue` spliced a caller's bare value in and
// silently deleted that terminator — welding the edited line onto the next one.
// A "targeted" edit that corrupts two lines instead of changing one is exactly
// the INV-2 failure this bead exists to prevent, and it is invisible unless a
// test passes a value WITHOUT a terminator. Every case below does.
describe('setEntryValue tolerates a value with no trailing terminator (INV-2 regression)', () => {
  it('reuses the original LF terminator instead of merging two lines', () => {
    const inner = 'citekey: vance2020\nyear: 2020\nrelated: [[[A]], [[B]]]\n';
    const after = serializeFrontmatter(setEntryValue(parseFrontmatter(inner), 'citekey', 'edited'));

    expect(after).toBe('citekey: edited\nyear: 2020\nrelated: [[[A]], [[B]]]\n');
    const changed = changedLineIndices(inner, after);
    expect(changed).toEqual([0]);
  });

  it('reuses the original CRLF terminator, not a bare LF (Reyes, real fixture)', () => {
    const inner = readInner('03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md');
    const after = serializeFrontmatter(setEntryValue(parseFrontmatter(inner), 'citekey', 'edited'));

    expect(after).toContain('citekey: edited\r\n');
    expect(after).not.toContain('citekey: edited\n');
    expect(after.split('\r\n').length).toBe(inner.split('\r\n').length);
  });

  it('appends nothing when the original entry had no trailing newline', () => {
    const after = serializeFrontmatter(
      setEntryValue(parseFrontmatter('a: 1\nb: 2'), 'b', 'edited'),
    );

    expect(after).toBe('a: 1\nb: edited');
  });

  it('still respects a terminator the caller does supply', () => {
    const after = serializeFrontmatter(
      setEntryValue(parseFrontmatter('a: 1\nb: 2\n'), 'a', 'multi\n  - continued\n'),
    );

    expect(after).toBe('a: multi\n  - continued\nb: 2\n');
  });

  it('leaves the flow-list wikilink shape byte-identical when editing another key', () => {
    const inner = readInner('03 Research/Vance 2020 - Grainsize Fining Models.md');
    const serialized = serializeFrontmatter(
      setEntryValue(parseFrontmatter(inner), 'citekey', 'edited'),
    );
    const before = toLines(inner);
    const after = toLines(serialized);

    const changed = changedLineIndices(inner, serialized);
    expect(changed).toEqual([0]);
    expect(isContiguous(changed)).toBe(true);
    const wikilinkLine = before.findIndex((line) => line.includes('[[['));
    expect(wikilinkLine).toBeGreaterThan(-1);
    expect(after[wikilinkLine]).toBe(before[wikilinkLine]);
  });
});
