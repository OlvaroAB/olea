import { describe, expect, it } from 'vitest';
import { buildMisconceptionDigest } from './digest.js';
import type { MisconceptionRecord } from './types.js';

const CITATION = { path: 'Courses/Sample/notes.md', blockIndex: 1 };

function record(overrides: Partial<MisconceptionRecord> = {}): MisconceptionRecord {
  return {
    id: 'm-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: CITATION,
    firstSeen: '2026-08-16T09:00:00-04:00',
    lastSeen: '2026-08-16T09:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-alpha:1',
    ...overrides,
  };
}

describe('buildMisconceptionDigest — M4 transient context (D-008)', () => {
  it('includes only records for the requested concepts', () => {
    const records = [
      record({ id: 'm-1', conceptId: 'concept-alpha' }),
      record({ id: 'm-2', conceptId: 'concept-beta' }),
    ];
    const digest = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    expect(digest.map((d) => d.id)).toEqual(['m-1']);
  });

  it('excludes resolved records — nothing left for the grader to route around', () => {
    const records = [
      record({ id: 'm-1', status: 'active' }),
      record({ id: 'm-2', status: 'resolved' }),
    ];
    const digest = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    expect(digest.map((d) => d.id)).toEqual(['m-1']);
  });

  it('includes fading records — still open, still relevant to the grader', () => {
    const records = [record({ id: 'm-1', status: 'fading' })];
    const digest = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    expect(digest).toHaveLength(1);
  });

  it('caps the entry count, keeping the highest occurrenceCount entries first', () => {
    const records = [
      record({ id: 'm-low', occurrenceCount: 1 }),
      record({ id: 'm-high', occurrenceCount: 9 }),
      record({ id: 'm-mid', occurrenceCount: 4 }),
    ];
    const digest = buildMisconceptionDigest(records, {
      conceptIds: ['concept-alpha'],
      maxEntries: 2,
    });
    expect(digest.map((d) => d.id)).toEqual(['m-high', 'm-mid']);
  });

  it('never carries the full record shape — no firstSeen, lastSeen, originInstrumentId, or citation', () => {
    const records = [record({ id: 'm-1' })];
    const [entry] = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    expect(entry && Object.keys(entry).sort()).toEqual(
      ['conceptId', 'id', 'occurrenceCount', 'status', 'statement'].sort(),
    );
  });

  it('stays within a few kilobytes even for a large candidate set (D-008 size bound)', () => {
    const records = Array.from({ length: 500 }, (_, i) =>
      record({ id: `m-${i}`, conceptId: 'concept-alpha', occurrenceCount: i }),
    );
    const digest = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    const bytes = new TextEncoder().encode(JSON.stringify(digest)).length;
    expect(bytes).toBeLessThan(4096);
  });

  it('returns an empty digest for an empty projection, without throwing', () => {
    expect(buildMisconceptionDigest([], { conceptIds: ['concept-alpha'] })).toEqual([]);
  });
});
