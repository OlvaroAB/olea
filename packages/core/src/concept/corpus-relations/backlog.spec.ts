/**
 * `./backlog.ts` — rel.md §2's fair backlog and `[D-297]`: a capped-out pair waits, oldest first,
 * ahead of fresh nominations rather than being dropped for good.
 *
 * INV-3: every item here is a coined string. No course code, note title or wording comes from any
 * real vault.
 */

import { describe, expect, it } from 'vitest';
import { type BacklogEntry, mergeWithBacklog } from './backlog.js';

const keyOf = (item: string): string => item;

describe('mergeWithBacklog', () => {
  it('serves an empty backlog by simply capping fresh candidates', () => {
    const result = mergeWithBacklog([], ['a', 'b', 'c'], keyOf, 2);
    expect(result.ordered).toEqual(['a', 'b']);
    expect(result.cappedOut).toEqual([{ item: 'c', age: 1 }]);
  });

  it('serves the oldest backlog entries before any fresh candidate', () => {
    const backlog: readonly BacklogEntry<string>[] = [
      { item: 'old-1', age: 3 },
      { item: 'old-2', age: 1 },
    ];
    const result = mergeWithBacklog(backlog, ['fresh-1', 'fresh-2'], keyOf, 3);
    expect(result.ordered).toEqual(['old-1', 'old-2', 'fresh-1']);
    expect(result.cappedOut).toEqual([{ item: 'fresh-2', age: 1 }]);
  });

  it('ages every cut item forward by exactly one, oldest growing older still', () => {
    const backlog: readonly BacklogEntry<string>[] = [{ item: 'old', age: 5 }];
    const result = mergeWithBacklog(backlog, ['fresh'], keyOf, 0);
    expect(result.ordered).toEqual([]);
    expect(result.cappedOut).toEqual([
      { item: 'old', age: 6 },
      { item: 'fresh', age: 1 },
    ]);
  });

  it("a fresh candidate that duplicates a backlogged item is not judged twice, and keeps the backlog's own age", () => {
    const backlog: readonly BacklogEntry<string>[] = [{ item: 'dup', age: 2 }];
    const result = mergeWithBacklog(backlog, ['dup', 'new'], keyOf, 5);
    expect(result.ordered).toEqual(['dup', 'new']);
    expect(result.cappedOut).toHaveLength(0);
  });

  it('the same pair does not always win: an older backlog entry outranks a fresh one under a tight cap, run after run', () => {
    let backlog: readonly BacklogEntry<string>[] = [];
    const fresh = ['top-signal-pair'];
    // Run 1: top-signal-pair is fresh and wins under a cap of 1.
    const run1 = mergeWithBacklog(backlog, fresh, keyOf, 1);
    expect(run1.ordered).toEqual(['top-signal-pair']);
    // Run 2: a different pair the same strong signal nominates every run, plus a backlogged one
    // from a prior cut — the backlogged pair goes first even though it is not the "top" nomination.
    backlog = [{ item: 'once-cut-pair', age: 4 }];
    const run2 = mergeWithBacklog(backlog, ['top-signal-pair'], keyOf, 1);
    expect(run2.ordered).toEqual(['once-cut-pair']);
    expect(run2.cappedOut).toEqual([{ item: 'top-signal-pair', age: 1 }]);
  });
});
