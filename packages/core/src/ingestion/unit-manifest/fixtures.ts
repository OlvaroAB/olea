/**
 * Synthetic record factories for the unit manifest store's specs (`[D-445]`, `ol-egov.141.89.8.43`),
 * shared by core's and the plugin's suites. Every value is invented (INV-3); nothing imports this
 * from production code.
 */

import { stableUnitId } from './manifest.js';
import {
  type RevisionEnumeratedRecord,
  type RevisionRetiredRecord,
  UNIT_MANIFEST_RECORD_VERSION,
  type UnitStateRecord,
} from './records.js';

export const SYNTH_SOURCE_PATH = '03 Research/SYNTH101 Deck.pdf';

/** One unit state record: page 1 of the synthetic deck, read by its text layer, extraction not started. */
export function unitRecord(overrides: Partial<UnitStateRecord> = {}): UnitStateRecord {
  const page = overrides.page ?? 1;
  const sourcePath = overrides.sourcePath ?? SYNTH_SOURCE_PATH;
  return {
    v: UNIT_MANIFEST_RECORD_VERSION,
    kind: 'unit',
    deviceId: 'device-a',
    clock: 1,
    at: '2026-09-29T10:00:00+10:00',
    sourcePath,
    revisionDigest: 'rev-1',
    unitId: stableUnitId(sourcePath, page),
    page,
    readingState: { kind: 'read', method: 'text-layer' },
    conceptExtractionState: 'not-started',
    ...overrides,
  };
}

/** An enumeration of pages 1 and 2 of the synthetic deck at revision `rev-1`. */
export function enumeratedRecord(
  overrides: Partial<RevisionEnumeratedRecord> = {},
): RevisionEnumeratedRecord {
  return {
    v: UNIT_MANIFEST_RECORD_VERSION,
    kind: 'enumerated',
    deviceId: 'device-a',
    clock: 1,
    at: '2026-09-29T10:00:00+10:00',
    sourcePath: SYNTH_SOURCE_PATH,
    revisionDigest: 'rev-1',
    pages: [1, 2],
    ...overrides,
  };
}

/** The retirement of revision `rev-1` of the synthetic deck. */
export function retiredRecord(
  overrides: Partial<RevisionRetiredRecord> = {},
): RevisionRetiredRecord {
  return {
    v: UNIT_MANIFEST_RECORD_VERSION,
    kind: 'retired',
    deviceId: 'device-a',
    clock: 1,
    at: '2026-09-29T10:00:00+10:00',
    sourcePath: SYNTH_SOURCE_PATH,
    revisionDigest: 'rev-1',
    reason: 'superseded',
    ...overrides,
  };
}
