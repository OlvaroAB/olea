/**
 * Scenarios: `features/F4-oracle.md`, "F4.6 / F4.7 / F4.8 — the session
 * builder", the two concept-to-instrument-lookup scenarios —
 * @auto:core/study-session/instrument-index.spec
 */

import { describe, expect, it } from 'vitest';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

/** A minimal, real `QaInstrumentRecord` — the shape `enumerateVaultInstruments` returns, built by hand rather than by walking a vault. */
function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

describe('buildConceptInstrumentIndex', () => {
  it('files an instrument under every concept its note names (ol-t3sd)', () => {
    const record = qa('i1', ['Alpha', 'Beta']);
    const index = buildConceptInstrumentIndex([record]);

    expect(index.instrumentsFor('Alpha')).toEqual([record]);
    expect(index.instrumentsFor('Beta')).toEqual([record]);
    // Counted once: `recordCount` is instruments, not (concept, instrument) pairs.
    expect(index.recordCount).toBe(1);
    expect(index.concepts).toEqual(['Alpha', 'Beta']);
  });

  it('answers a concept it has never heard of with an empty list, never undefined and never a throw', () => {
    const index = buildConceptInstrumentIndex([qa('i1', ['Alpha'])]);
    // "She has no cards for this" is the ordinary F4.5 answer on this surface,
    // not an error condition.
    expect(index.instrumentsFor('Gamma')).toEqual([]);
    expect(index.instrumentsFor('Gamma')).not.toBeUndefined();
  });

  it('an index over no records at all is empty rather than absent', () => {
    const index = buildConceptInstrumentIndex([]);
    expect(index.concepts).toEqual([]);
    expect(index.recordCount).toBe(0);
    expect(index.instrumentsFor('Alpha')).toEqual([]);
  });

  it('preserves the enumeration order inside each bucket — the tiebreak a session inherits rather than reinvents', () => {
    const index = buildConceptInstrumentIndex([
      qa('i1', ['Alpha']),
      qa('i2', ['Alpha']),
      qa('i3', ['Alpha']),
    ]);
    expect(index.instrumentsFor('Alpha').map((r) => r.instrumentId)).toEqual(['i1', 'i2', 'i3']);
  });

  it('matches concept names verbatim — no case folding, for the same reason nothing else here fuzzy-matches (R1/R2)', () => {
    const index = buildConceptInstrumentIndex([qa('i1', ['Alpha'])]);
    expect(index.instrumentsFor('alpha')).toEqual([]);
    expect(index.instrumentsFor('Alpha')).toHaveLength(1);
  });

  it('does not double-file an instrument whose concept list repeats a name', () => {
    const index = buildConceptInstrumentIndex([qa('i1', ['Alpha', 'Alpha'])]);
    expect(index.instrumentsFor('Alpha')).toHaveLength(1);
  });
});
