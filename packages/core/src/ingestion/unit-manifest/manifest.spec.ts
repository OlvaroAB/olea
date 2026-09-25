import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../../vault/types.js';
import {
  absenceGroundingFor,
  hasPendingUnits,
  isFullyRead,
  markConceptExtractionComplete,
  newPendingEntry,
  stableUnitId,
  withEntry,
  withReadingState,
} from './manifest.js';
import type { UnitManifest, UnitManifestEntry, UnitReadingState } from './types.js';

const SOURCE = 'Slides/GEOL204 Week 2.pdf' as VaultPath; // coined fixture path (INV-3), never real vault content.

function manifestOf(entries: readonly UnitManifestEntry[]): UnitManifest {
  return { sourcePath: SOURCE, revisionDigest: 'digest-abc', entries };
}

describe('stableUnitId — [D-326]: a partly read region keeps a stable identity', () => {
  it('is a pure function of sourcePath and page alone', () => {
    expect(stableUnitId(SOURCE, 3)).toBe(stableUnitId(SOURCE, 3));
  });

  it('differs by page, so two pages of the same source never collide', () => {
    expect(stableUnitId(SOURCE, 1)).not.toBe(stableUnitId(SOURCE, 2));
  });

  it('differs by source path, so two sources never collide', () => {
    expect(stableUnitId(SOURCE, 1)).not.toBe(stableUnitId('Slides/Other.pdf' as VaultPath, 1));
  });

  it('a unit resumed on a later pass lands on the SAME id as its first pass', () => {
    const firstPass = newPendingEntry(SOURCE, 5);
    const resumedPass = newPendingEntry(SOURCE, 5);
    expect(resumedPass.unitId).toBe(firstPass.unitId);
  });
});

describe('newPendingEntry', () => {
  it('starts pending (queued) and with extraction not started', () => {
    const entry = newPendingEntry(SOURCE, 1);
    expect(entry.readingState).toEqual({ kind: 'pending', reason: 'queued' });
    expect(entry.conceptExtractionState).toBe('not-started');
  });
});

describe('[D-326] first condition: readingState and conceptExtractionState never derive one another', () => {
  it('withReadingState never touches conceptExtractionState — proof in the direction the ruling names: finishing the reading does not auto-complete extraction', () => {
    const pending = newPendingEntry(SOURCE, 1);
    const read = withReadingState(pending, { kind: 'read', method: 'text-layer' });
    expect(read.readingState.kind).toBe('read');
    expect(read.conceptExtractionState).toBe('not-started'); // NOT auto-completed
  });

  it('markConceptExtractionComplete never touches readingState — the other direction', () => {
    const read: UnitManifestEntry = withReadingState(newPendingEntry(SOURCE, 1), {
      kind: 'read',
      method: 'text-layer',
    });
    const completed = markConceptExtractionComplete(read);
    expect(completed.conceptExtractionState).toBe('complete');
    expect(completed.readingState).toEqual(read.readingState); // unchanged
  });

  it('a later readingState change does not reset an already-complete conceptExtractionState', () => {
    const read = withReadingState(newPendingEntry(SOURCE, 1), {
      kind: 'read',
      method: 'text-layer',
    });
    const completed = markConceptExtractionComplete(read);
    const rereadAsPartial = withReadingState(completed, {
      kind: 'partial',
      method: 'image',
      coverage: 'the top half of the page',
    });
    expect(rereadAsPartial.conceptExtractionState).toBe('complete');
  });

  it.each<UnitReadingState>([
    { kind: 'pending', reason: 'budget' },
    { kind: 'unavailable' },
    { kind: 'failed', reason: 'render-failed', retryable: false },
    { kind: 'unreadable', reason: 'blank-page' },
  ])('refuses to mark extraction complete over %o — nothing was read', (readingState) => {
    const entry = withReadingState(newPendingEntry(SOURCE, 1), readingState);
    expect(() => markConceptExtractionComplete(entry)).toThrow(/has no read material/);
  });

  it('allows marking extraction complete over a partial reading — its covered text is real material', () => {
    const partial = withReadingState(newPendingEntry(SOURCE, 1), {
      kind: 'partial',
      method: 'image',
      coverage: 'the first three paragraphs',
    });
    expect(() => markConceptExtractionComplete(partial)).not.toThrow();
  });
});

describe('absenceGroundingFor — [D-326] third condition: unread or partial reads unknown, never absent', () => {
  it('a fully read unit is groundable', () => {
    const entry = withReadingState(newPendingEntry(SOURCE, 1), {
      kind: 'read',
      method: 'text-layer',
    });
    expect(absenceGroundingFor(entry)).toBe('groundable');
  });

  it.each<[string, UnitReadingState]>([
    ['partial', { kind: 'partial', method: 'image', coverage: 'the top half' }],
    ['unreadable', { kind: 'unreadable', reason: 'no-text-on-page' }],
    ['pending', { kind: 'pending', reason: 'budget' }],
    ['unavailable', { kind: 'unavailable' }],
    ['failed', { kind: 'failed', reason: 'render-failed', retryable: false }],
  ])('a %s unit reads unknown — never a claim that a concept is absent', (_label, readingState) => {
    const entry = withReadingState(newPendingEntry(SOURCE, 1), readingState);
    expect(absenceGroundingFor(entry)).toBe('unknown');
    expect(absenceGroundingFor(entry)).not.toBe('absent' as never);
  });
});

describe('isFullyRead / hasPendingUnits — the coverage predicate this manifest exposes', () => {
  it('a manifest with every unit read is fully read', () => {
    const m = manifestOf([
      withReadingState(newPendingEntry(SOURCE, 1), { kind: 'read', method: 'text-layer' }),
      withReadingState(newPendingEntry(SOURCE, 2), { kind: 'read', method: 'image' }),
    ]);
    expect(isFullyRead(m)).toBe(true);
    expect(hasPendingUnits(m)).toBe(false);
  });

  it('a manifest with any pending unit is never fully read', () => {
    const m = manifestOf([
      withReadingState(newPendingEntry(SOURCE, 1), { kind: 'read', method: 'text-layer' }),
      newPendingEntry(SOURCE, 2),
    ]);
    expect(isFullyRead(m)).toBe(false);
    expect(hasPendingUnits(m)).toBe(true);
  });

  it('partial and unreadable units count as settled, not fully-read-blocking', () => {
    const m = manifestOf([
      withReadingState(newPendingEntry(SOURCE, 1), {
        kind: 'partial',
        method: 'image',
        coverage: 'half the page',
      }),
      withReadingState(newPendingEntry(SOURCE, 2), { kind: 'unreadable', reason: 'blank-page' }),
    ]);
    expect(isFullyRead(m)).toBe(true);
    expect(hasPendingUnits(m)).toBe(false);
  });

  it('an unavailable unit blocks isFullyRead and counts as pending — it is still being retried', () => {
    const m = manifestOf([withReadingState(newPendingEntry(SOURCE, 1), { kind: 'unavailable' })]);
    expect(isFullyRead(m)).toBe(false);
    expect(hasPendingUnits(m)).toBe(true);
  });
});

describe('withEntry', () => {
  it('appends a unit not already present', () => {
    const m = manifestOf([]);
    const entry = newPendingEntry(SOURCE, 1);
    const updated = withEntry(m, entry);
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]).toEqual(entry);
  });

  it('replaces an existing unit by unitId — the resumed-partial-reading path', () => {
    const pending = newPendingEntry(SOURCE, 1);
    const m = manifestOf([pending]);
    const read = withReadingState(pending, { kind: 'read', method: 'text-layer' });
    const updated = withEntry(m, read);
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]?.readingState.kind).toBe('read');
  });
});
