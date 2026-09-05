import { describe, expect, it } from 'vitest';
import { foldDocumentLedger, ledgerInstrumentId } from './document-ledger.js';
import {
  disputeAt,
  misconceptionAt,
  reviewAt,
  successionAt,
  suspendAt,
  verdictAt,
} from './fixtures.js';
import type { InstrumentLocations } from './types.js';

const NOTE = 'notes/synthetic-a.md';
const OTHER = 'notes/synthetic-b.md';

const locations: InstrumentLocations = new Map([
  ['i1', NOTE],
  ['i2', NOTE],
  ['i9', OTHER],
]);

describe('ledgerInstrumentId', () => {
  it('attributes a succession to the successor, never the predecessor', () => {
    expect(ledgerInstrumentId(successionAt('e', '2026-05-13T19:03:00Z', 'i-old', 'i-new'))).toBe(
      'i-new',
    );
  });

  it('reads the instrument off every kind that names one', () => {
    expect(ledgerInstrumentId(reviewAt('e1', '2026-05-13T19:03:00Z', 'i1'))).toBe('i1');
    expect(ledgerInstrumentId(verdictAt('e2', '2026-05-13T19:03:00Z', 'i1', 'accepted'))).toBe(
      'i1',
    );
    expect(ledgerInstrumentId(suspendAt('e3', '2026-05-13T19:03:00Z', 'i1'))).toBe('i1');
    expect(ledgerInstrumentId(disputeAt('e4', '2026-05-13T19:03:00Z', 'i1'))).toBe('i1');
    expect(ledgerInstrumentId(misconceptionAt('e5', '2026-05-13T19:03:00Z', 'i1', 'e1'))).toBe(
      'i1',
    );
  });
});

describe('foldDocumentLedger', () => {
  it('keeps only the entries whose instrument lives in this note, newest first', () => {
    const entries = [
      verdictAt('e1', '2026-05-13T19:02:00Z', 'i1', 'accepted'),
      reviewAt('e2', '2026-05-13T19:03:00Z', 'i1'),
      reviewAt('e3', '2026-05-14T21:12:00Z', 'i2'),
      reviewAt('e4', '2026-05-14T21:14:00Z', 'i9'),
    ];

    const ledger = foldDocumentLedger(entries, NOTE, locations);

    expect(ledger.rows.map((row) => row.eventId)).toEqual(['e3', 'e2', 'e1']);
    expect(ledger.instrumentIds).toEqual(['i1', 'i2']);
    expect(ledger.unlocated).toEqual([]);
  });

  it('reports an instrument the location index cannot place instead of dropping it silently', () => {
    const entries = [reviewAt('e1', '2026-05-13T19:03:00Z', 'i-renamed')];

    const ledger = foldDocumentLedger(entries, NOTE, locations);

    expect(ledger.rows).toEqual([]);
    expect(ledger.unlocated).toEqual(['i-renamed']);
  });

  it('tie-breaks a shared instant by descending eventId, so two devices agree', () => {
    const entries = [
      reviewAt('aaa', '2026-05-13T19:03:00Z', 'i1'),
      reviewAt('zzz', '2026-05-13T19:03:00Z', 'i2'),
    ];

    expect(foldDocumentLedger(entries, NOTE, locations).rows.map((r) => r.eventId)).toEqual([
      'zzz',
      'aaa',
    ]);
    expect(
      foldDocumentLedger([...entries].reverse(), NOTE, locations).rows.map((r) => r.eventId),
    ).toEqual(['zzz', 'aaa']);
  });

  it('yields an empty ledger for a document the log has nothing to say about', () => {
    const ledger = foldDocumentLedger([], 'notes/registered-untouched.pdf', locations);

    expect(ledger).toEqual({
      notePath: 'notes/registered-untouched.pdf',
      rows: [],
      instrumentIds: [],
      unlocated: [],
    });
  });

  it('attributes a retrospective record to its own assessmentPath, with no instrument', () => {
    const entries = [
      {
        schemaVersion: 5,
        kind: 'retrospective-offered',
        eventId: 'e1',
        timestamp: '2026-05-20T09:00:00Z',
        assessmentPath: 'assessments/synthetic.md',
      },
    ] as const;

    const ledger = foldDocumentLedger(entries, 'assessments/synthetic.md', locations);

    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.instrumentId).toBeNull();
    expect(ledger.instrumentIds).toEqual([]);
  });

  it('emits no ingestion or generation row, because the log carries none', () => {
    // The drawn shape names "registered under a course", "found N concepts" and
    // "drafted N items". Nothing in the review log records those, and this fold
    // must never invent them — the only generation-adjacent fact it can render
    // is the accept/edit/reject verdict on an instrument that already exists.
    const ledger = foldDocumentLedger(
      [verdictAt('e1', '2026-05-13T19:03:00Z', 'i1', 'rejected')],
      NOTE,
      locations,
    );

    expect(ledger.rows.map((row) => row.entry.kind)).toEqual(['verdict']);
  });
});
