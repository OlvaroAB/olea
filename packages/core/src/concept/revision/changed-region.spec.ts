/**
 * `extractChangedRegions` — see `changed-region.ts`'s module doc for the
 * `[D-293]` requirement this implements and why the live judge call does
 * not consume it yet.
 *
 * INV-3: every string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { extractChangedRegions } from './changed-region.js';

function lines(...ls: readonly string[]): string {
  return ls.join('\n');
}

describe('extractChangedRegions', () => {
  it('returns no regions for identical text', () => {
    const text = lines('one', 'two', 'three');
    expect(extractChangedRegions({ previousText: text, currentText: text })).toEqual([]);
  });

  it('returns no regions for two empty texts', () => {
    expect(extractChangedRegions({ previousText: '', currentText: '' })).toEqual([]);
  });

  it('finds one region around a single changed line, padded with context', () => {
    const previous = lines('a', 'b', 'c', 'd', 'e', 'f', 'g');
    const current = lines('a', 'b', 'c', 'CHANGED', 'e', 'f', 'g');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1 },
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.previousText).toBe(lines('c', 'd', 'e'));
    expect(regions[0]?.currentText).toBe(lines('c', 'CHANGED', 'e'));
    expect(regions[0]?.previousStartLine).toBe(2);
    expect(regions[0]?.previousEndLine).toBe(5);
  });

  it('merges two changes separated by a short unchanged gap into one region', () => {
    const previous = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const current = lines('a', 'FIRST', 'c', 'd', 'e', 'SECOND', 'g', 'h', 'i');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1, mergeGapLines: 3 },
    });
    expect(regions).toHaveLength(1);
    // The whole span from just before "b" to just after "f", context included.
    expect(regions[0]?.previousText).toBe(lines('a', 'b', 'c', 'd', 'e', 'f', 'g'));
    expect(regions[0]?.currentText).toBe(lines('a', 'FIRST', 'c', 'd', 'e', 'SECOND', 'g'));
  });

  it('keeps two changes separated by a long unchanged gap as two regions', () => {
    const previous = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k');
    const current = lines('a', 'FIRST', 'c', 'd', 'e', 'f', 'g', 'h', 'SECOND', 'j', 'k');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1, mergeGapLines: 2 },
    });
    expect(regions).toHaveLength(2);
    expect(regions[0]?.currentText).toBe(lines('a', 'FIRST', 'c'));
    expect(regions[1]?.currentText).toBe(lines('h', 'SECOND', 'j'));
  });

  it('handles a pure insertion (no deleted lines) at the region boundary', () => {
    const previous = lines('a', 'b', 'c');
    const current = lines('a', 'INSERTED', 'b', 'c');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1 },
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.previousText).toBe(lines('a', 'b'));
    expect(regions[0]?.currentText).toBe(lines('a', 'INSERTED', 'b'));
  });

  it('handles a pure deletion (no inserted lines)', () => {
    const previous = lines('a', 'b', 'REMOVED', 'c', 'd');
    const current = lines('a', 'b', 'c', 'd');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1 },
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.previousText).toBe(lines('b', 'REMOVED', 'c'));
    expect(regions[0]?.currentText).toBe(lines('b', 'c'));
  });

  it('clamps context at the start and end of the text', () => {
    const previous = lines('CHANGED-START', 'b', 'c', 'd', 'CHANGED-END');
    const current = lines('NEW-START', 'b', 'c', 'd', 'NEW-END');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 2, mergeGapLines: 0 },
    });
    expect(regions).toHaveLength(2);
    expect(regions[0]?.previousStartLine).toBe(0);
    expect(regions[0]?.currentText).toBe(lines('NEW-START', 'b', 'c'));
    expect(regions[1]?.currentText).toBe(lines('c', 'd', 'NEW-END'));
    expect(regions[1]?.currentEndLine).toBe(5);
  });

  it('treats a change at the very start with no preceding equal run correctly', () => {
    const previous = lines('OLD', 'b', 'c');
    const current = lines('NEW', 'b', 'c');
    const regions = extractChangedRegions({
      previousText: previous,
      currentText: current,
      options: { contextLines: 1 },
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.previousStartLine).toBe(0);
    expect(regions[0]?.previousText).toBe(lines('OLD', 'b'));
  });

  it('covers the whole text as one region when nothing is shared', () => {
    const previous = lines('one', 'two', 'three');
    const current = lines('four', 'five', 'six', 'seven');
    const regions = extractChangedRegions({ previousText: previous, currentText: current });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.previousText).toBe(previous);
    expect(regions[0]?.currentText).toBe(current);
  });

  it('defaults contextLines to 2 and mergeGapLines to 2x contextLines', () => {
    const previous = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
    const current = lines('a', 'b', 'X', 'd', 'e', 'f', 'g', 'h', 'Y', 'j');
    const regions = extractChangedRegions({ previousText: previous, currentText: current });
    // gap between the two changes ('d','e','f','g','h' = 5 lines) exceeds
    // the default mergeGapLines (2 * 2 = 4), so they stay separate.
    expect(regions).toHaveLength(2);
  });
});
