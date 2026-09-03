/**
 * `resolveBulkReviewKey`/`BULK_REVIEW_HINTS` tests (`[D-216]` / `ol-egov.105`,
 * Q6.5). Mirrors `test/review/keymap.spec.ts`'s own shape: proves every
 * action has a key binding, and — the converse, same discipline that file's
 * own doc calls out as the one that actually catches drift — that every
 * hint the on-screen row renders is a key `resolveBulkReviewKey` genuinely
 * accepts. The two cannot go out of sync because both read the same literal
 * keys.
 */
import { describe, expect, it } from 'vitest';
import {
  BULK_REVIEW_HINTS,
  type BulkReviewAction,
  resolveBulkReviewKey,
} from '../../src/generation/bulk-review-keymap.js';

describe('resolveBulkReviewKey', () => {
  it('ArrowDown moves focus to the next item', () => {
    expect(resolveBulkReviewKey({ key: 'ArrowDown' })).toEqual({ kind: 'focus-move-down' });
  });

  it.each(['k', 'K'])('%s keeps (accepts)', (key) => {
    expect(resolveBulkReviewKey({ key })).toEqual({ kind: 'keep' });
  });

  it.each(['f', 'F'])('%s fixes (edit before saving)', (key) => {
    expect(resolveBulkReviewKey({ key })).toEqual({ kind: 'fix' });
  });

  it.each(['b', 'B'])('%s bins (rejects)', (key) => {
    expect(resolveBulkReviewKey({ key })).toEqual({ kind: 'bin' });
  });

  it('an unrelated key resolves to nothing', () => {
    expect(resolveBulkReviewKey({ key: 'x' })).toBeNull();
    expect(resolveBulkReviewKey({ key: 'Escape' })).toBeNull();
    expect(resolveBulkReviewKey({ key: 'ArrowUp' })).toBeNull();
  });

  // `[D-216]`'s own ruling: the source peek (`REGISTRY_ENTRY_ACTION`) is not
  // a fifth binding here — it "stays click-only" deliberately. Nothing in
  // this resolver's key set may ever produce an action naming it, and no
  // letter this resolver already claims (k/f/b) may silently start meaning
  // something else.
  it('invents no fifth action for the source peek', () => {
    const seen = new Set<BulkReviewAction['kind']>();
    for (const key of ['ArrowDown', 'k', 'K', 'f', 'F', 'b', 'B']) {
      const action = resolveBulkReviewKey({ key });
      if (action !== null) seen.add(action.kind);
    }
    expect([...seen].sort()).toEqual(['bin', 'fix', 'focus-move-down', 'keep']);
  });
});

describe('BULK_REVIEW_HINTS', () => {
  it('every hinted key is one resolveBulkReviewKey actually accepts', () => {
    for (const hint of BULK_REVIEW_HINTS) {
      // The hint row shows a symbol/letter (`↓`, `K`, `F`, `B`); resolve the
      // real physical key each represents rather than the display glyph.
      const realKey = hint.key === '↓' ? 'ArrowDown' : hint.key.toLowerCase();
      expect(resolveBulkReviewKey({ key: realKey })).not.toBeNull();
    }
  });

  it('carries exactly the four actions the ruling names, no more', () => {
    expect(BULK_REVIEW_HINTS).toHaveLength(4);
  });
});
