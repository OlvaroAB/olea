/**
 * `basis.ts` tests: what the ingestion trigger tells the scope-reading store about the document it
 * just read (`[D-429]`, `ol-egov.141.89.7.5`). The revision digest is the manifest's, and the
 * coverage is only ever as complete as the manifest can prove. Synthetic ids only.
 */

import type { UnitManifest, UnitManifestEntry, UnitReadingState } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { documentReadingBasisFromManifest } from '../../src/scope-reading/basis.js';

function entry(page: number, readingState: UnitReadingState): UnitManifestEntry {
  return {
    unitId: `unit-${page}`,
    sourcePath: 'doc-a',
    page,
    readingState,
    conceptExtractionState: 'not-started',
  };
}

const READ: UnitReadingState = { kind: 'read', method: 'text-layer' };

function manifest(entries: readonly UnitManifestEntry[], digest = 'rev-1'): UnitManifest {
  return { sourcePath: 'doc-a', revisionDigest: digest, entries };
}

describe('the reading basis a manifest gives the scope-reading store', () => {
  it('carries the manifest revision digest, so a reading is keyed by the document revision itself', () => {
    expect(documentReadingBasisFromManifest(manifest([entry(1, READ)], 'rev-9'))).toEqual({
      revisionDigest: 'rev-9',
      unitsRead: 1,
      unitsTotal: 1,
    });
  });

  it('a fully read document has every unit read', () => {
    const basis = documentReadingBasisFromManifest(
      manifest([entry(1, READ), entry(2, READ), entry(3, READ)]),
    );
    expect(basis).toMatchObject({ unitsRead: 3, unitsTotal: 3 });
  });

  it('a unit still owed is not read: pending, unavailable and failed all keep the document partly read', () => {
    const basis = documentReadingBasisFromManifest(
      manifest([
        entry(1, READ),
        entry(2, { kind: 'pending', reason: 'queued' }),
        entry(3, { kind: 'unavailable' }),
        entry(4, { kind: 'failed', reason: 'render-failed', retryable: true }),
      ]),
    );
    expect(basis).toMatchObject({ unitsRead: 1, unitsTotal: 4 });
  });

  it('a partial or unreadable unit is not a fully read one: never counted as read', () => {
    const basis = documentReadingBasisFromManifest(
      manifest([
        entry(1, READ),
        entry(2, { kind: 'partial', method: 'image', coverage: 'the top half' }),
        entry(3, { kind: 'unreadable', reason: 'blank-page' }),
      ]),
    );
    expect(basis).toMatchObject({ unitsRead: 1, unitsTotal: 3 });
  });

  it('the unknown manifest (one pending unit) reads as nothing read, never as complete', () => {
    const basis = documentReadingBasisFromManifest(
      manifest([entry(1, { kind: 'pending', reason: 'queued' })]),
    );
    expect(basis).toMatchObject({ unitsRead: 0, unitsTotal: 1 });
  });

  it('a manifest naming no unit gives no basis: a document with nothing enumerated is not "fully read"', () => {
    expect(documentReadingBasisFromManifest(manifest([]))).toBeNull();
  });

  it('holds counts and a digest only: no path, text or reading reason travels', () => {
    const basis = documentReadingBasisFromManifest(manifest([entry(1, READ)]));
    expect(Object.keys(basis ?? {}).sort()).toEqual(['revisionDigest', 'unitsRead', 'unitsTotal']);
  });
});
