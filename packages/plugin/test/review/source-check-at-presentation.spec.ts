/**
 * `sourceCheckAtPresentation` (`open-session.ts`, `ol-egov.141.89.5.45`): the production reader
 * behind the session's could-not-check outcome. `[D-293]`/`[D-400]` stay with the store: this
 * reads the persisted pending fact and writes nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { sourceCheckAtPresentation } from '../../src/review/open-session.js';

function storeWith(
  pending: Record<string, { sinceContentHash: string; since: number; retriedAt?: number }>,
  current: (id: string, hash: string) => boolean,
): CitationHashStore {
  return {
    loadAll: async () =>
      new Map(
        Object.entries(pending).map(([id, p]) => [
          id,
          { sourcePath: 'Notes/one.md', text: 'x', conceptIds: [], pendingRevalidation: p },
        ]),
      ),
    save: vi.fn(),
    remove: vi.fn(),
    setPendingRevalidation: vi.fn(),
    isPendingRevalidationCurrent: async (id: string, hash: string) => current(id, hash),
    recordDispatch: vi.fn(),
  } as unknown as CitationHashStore;
}

describe('sourceCheckAtPresentation', () => {
  it('no pending fact: clear', async () => {
    const check = sourceCheckAtPresentation(storeWith({}, () => false));
    expect(await check('inst-a')).toBe('clear');
  });

  it('a pending fact still current (unanswered, or its one retry spent): check-failed, nothing written', async () => {
    const store = storeWith(
      { 'inst-a': { sinceContentHash: 'h1', since: 1, retriedAt: 5 } },
      () => true,
    );
    expect(await sourceCheckAtPresentation(store)('inst-a')).toBe('check-failed');
    expect(store.save).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.setPendingRevalidation).not.toHaveBeenCalled();
    expect(store.recordDispatch).not.toHaveBeenCalled();
  });

  it('an answer about a passage that has since changed again is ignored: a pending fact no longer current reads clear', async () => {
    const store = storeWith({ 'inst-a': { sinceContentHash: 'old', since: 1 } }, () => false);
    expect(await sourceCheckAtPresentation(store)('inst-a')).toBe('clear');
  });

  it('a suspended instrument (the revised path leaves no pending fact) reads suspended; an unreadable suspension state throws', async () => {
    const store = storeWith({}, () => false);
    const suspended = sourceCheckAtPresentation(store, async () => new Set(['inst-a']));
    expect(await suspended('inst-a')).toBe('suspended');
    expect(await suspended('inst-b')).toBe('clear');
    const unreadable = sourceCheckAtPresentation(store, async () => {
      throw new Error('log unreadable');
    });
    await expect(unreadable('inst-a')).rejects.toThrow();
  });
});
