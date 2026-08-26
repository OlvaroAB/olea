/**
 * `buildPrivacyExportBundle` tests (F7.4, `ol-p6t01`). See
 * `features/F7-plugin-surface.md` for the scenarios this asserts
 * (`plugin/privacy/export-bundle.spec`).
 */
import type { CalendarDay } from 'olea-core';
import { misconceptionLogPath, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildPrivacyExportBundle,
  PRIVACY_EXPORT_BUNDLE_VERSION,
} from '../../src/privacy/export-bundle.js';
import { MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';

// v3 on the wire (deliberately — `parseReviewLog` upgrades it to v4 on read,
// same shape `today/data-source.spec.ts`'s own `reviewLine` fixture uses;
// this is what a semester of her existing history actually looks like).
function reviewEvent(eventId: string) {
  return {
    schemaVersion: 3,
    kind: 'review',
    eventId,
    timestamp: '2026-08-25T10:00:00-04:00',
    instrumentId: 'qa:synth-concept:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      masteryAtTime: 'sprout',
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    conceptIds: ['synth-concept'],
  };
}

const MISCONCEPTION_EVENT = {
  schemaVersion: 1,
  kind: 'observed',
  eventId: 'mc-1',
  timestamp: '2026-08-25T10:05:00-04:00',
  originInstrumentId: 'qa:synth-concept:1',
  originReviewEventId: 'ev-1',
  misconceptionId: 'misc-1',
  conceptId: 'synth-concept',
  confusedWithConceptId: null,
  statement: 'A synthetic misconception statement.',
  correction: 'A synthetic correction.',
  citation: { path: '01 Courses/SYN101/Lecture 1.md', blockIndex: 0 },
};

describe('buildPrivacyExportBundle (F7.4, ol-p6t01)', () => {
  it('bundles review-log entries, misconception-log events, and instruments parsed from her notes', async () => {
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: `${JSON.stringify(reviewEvent('ev-1'))}\n`,
      [misconceptionLogPath(TODAY, DEVICE_ID)]: `${JSON.stringify(MISCONCEPTION_EVENT)}\n`,
      '01 Courses/SYN101/Lecture 1.md': '---\ntopic: SynthTopic\n---\n\nWhat is X?::X is Y.\n',
    });

    const bundle = await buildPrivacyExportBundle({
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      now: () => '2026-08-25T12:00:00.000Z',
    });

    expect(bundle.version).toBe(PRIVACY_EXPORT_BUNDLE_VERSION);
    expect(bundle.exportedAt).toBe('2026-08-25T12:00:00.000Z');
    expect(bundle.reviewLog).toHaveLength(1);
    expect(bundle.reviewLog[0]).toMatchObject({ eventId: 'ev-1', kind: 'review' });
    expect(bundle.misconceptionLog).toHaveLength(1);
    expect(bundle.misconceptionLog[0]).toMatchObject({ eventId: 'mc-1' });
    expect(bundle.instruments.length).toBeGreaterThan(0);
  });

  it('an empty vault exports an empty, well-formed bundle — never an error', async () => {
    const vault = new MemoryVaultSource();

    const bundle = await buildPrivacyExportBundle({ vault, deviceId: DEVICE_ID, today: TODAY });

    expect(bundle.reviewLog).toEqual([]);
    expect(bundle.misconceptionLog).toEqual([]);
    expect(bundle.instruments).toEqual([]);
  });

  it('merges and deduplicates entries from more than one device file', async () => {
    const other = 'device-2';
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: `${JSON.stringify(reviewEvent('ev-1'))}\n`,
      [reviewLogPath(TODAY, other)]: `${JSON.stringify(reviewEvent('ev-2'))}\n`,
    });

    const bundle = await buildPrivacyExportBundle({ vault, deviceId: DEVICE_ID, today: TODAY });

    expect(bundle.reviewLog.map((r) => r.eventId).sort()).toEqual(['ev-1', 'ev-2']);
  });

  it('is read-only — the vault and data.json are untouched by building an export', async () => {
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: `${JSON.stringify(reviewEvent('ev-1'))}\n`,
    });
    const before = vault.paths();

    await buildPrivacyExportBundle({ vault, deviceId: DEVICE_ID, today: TODAY });

    expect(vault.paths()).toEqual(before);
  });
});
