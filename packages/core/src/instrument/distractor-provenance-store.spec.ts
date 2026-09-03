import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  DISTRACTOR_PROVENANCE_STORE_FOLDER,
  distractorProvenanceStorePath,
  isDistractorProvenanceRecord,
  readDistractorProvenance,
  writeDistractorProvenance,
} from './distractor-provenance-store.js';

// Scenarios: olea-service/features/F3-learn-from-anything.md — "Feature: F3.3 / [D-220]" —
// "Distractor provenance sidecar: mint once at accept time, read back for the
// misconception-observed event ([D-220 / DIST-3], ol-0r92.52)", tagged
// `@auto:core/instrument/distractor-provenance-store.spec`.

describe('distractor-provenance-store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-distractor-provenance-store-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lives under the D-220 folder, beside the citation sidecar', () => {
    expect(DISTRACTOR_PROVENANCE_STORE_FOLDER).toBe('.olea/distractor-provenance');
  });

  it('writes a provenance record and reads it back exactly (round trip)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeDistractorProvenance(vault, 'mcq-1', {
      entries: [
        { text: 'Option B', believes: 'Believes X', source_says: 'Source says Y' },
        { text: 'Option C', believes: 'Believes Z', source_says: 'Source says W' },
      ],
    });

    const found = await readDistractorProvenance(vault, 'mcq-1');
    expect(found).toEqual({
      entries: [
        { text: 'Option B', believes: 'Believes X', source_says: 'Source says Y' },
        { text: 'Option C', believes: 'Believes Z', source_says: 'Source says W' },
      ],
    });
  });

  it('round-trips a partially-grounded set (some distractors have no entry) without fabricating one', async () => {
    const vault = new FolderSource(tempRoot);
    await writeDistractorProvenance(vault, 'partial', {
      entries: [{ text: 'Only grounded one', believes: 'B', source_says: 'S' }],
    });
    const found = await readDistractorProvenance(vault, 'partial');
    expect(found).toEqual({
      entries: [{ text: 'Only grounded one', believes: 'B', source_says: 'S' }],
    });
  });

  it('reading a missing sidecar returns undefined', async () => {
    const vault = new FolderSource(tempRoot);
    expect(await readDistractorProvenance(vault, 'never-written')).toBeUndefined();
  });

  it('reading a corrupt or malformed sidecar returns undefined, never throws', async () => {
    const vault = new FolderSource(tempRoot);
    await vault.write(distractorProvenanceStorePath('corrupt'), 'not json{{{');
    expect(await readDistractorProvenance(vault, 'corrupt')).toBeUndefined();

    await vault.write(
      distractorProvenanceStorePath('malformed'),
      JSON.stringify({ entries: [{ text: '', believes: 'B', source_says: 'S' }] }),
    );
    expect(await readDistractorProvenance(vault, 'malformed')).toBeUndefined();
  });

  it('reading a sidecar whose stored instrumentId does not match the id asked for returns undefined', async () => {
    const vault = new FolderSource(tempRoot);
    await vault.write(
      distractorProvenanceStorePath('mismatch'),
      JSON.stringify({
        instrumentId: 'someone-else',
        entries: [{ text: 'X', believes: 'B', source_says: 'S' }],
        schemaVersion: 1,
      }),
    );
    expect(await readDistractorProvenance(vault, 'mismatch')).toBeUndefined();
  });

  it('never overwrites an existing record (immutable, write-once)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeDistractorProvenance(vault, 'dup', {
      entries: [{ text: 'A', believes: 'B1', source_says: 'S1' }],
    });

    await expect(
      writeDistractorProvenance(vault, 'dup', {
        entries: [{ text: 'A', believes: 'B2', source_says: 'S2' }],
      }),
    ).rejects.toThrow(/refusing to overwrite an immutable record/);

    const result = await readDistractorProvenance(vault, 'dup');
    expect(result).toEqual({ entries: [{ text: 'A', believes: 'B1', source_says: 'S1' }] });
  });

  it('encodes the instrument id into the file name, injectively', () => {
    expect(distractorProvenanceStorePath('mcq/with slashes')).toBe(
      '.olea/distractor-provenance/mcq%2Fwith%20slashes.json',
    );
    expect(distractorProvenanceStorePath('a')).not.toBe(distractorProvenanceStorePath('b'));
  });

  it('isDistractorProvenanceRecord rejects a record with a non-string or empty entry field', () => {
    expect(
      isDistractorProvenanceRecord({
        instrumentId: 'x',
        entries: [{ text: 'A', believes: 'B', source_says: 'S' }],
        schemaVersion: 1,
      }),
    ).toBe(true);
    expect(
      isDistractorProvenanceRecord({
        instrumentId: 'x',
        entries: [{ text: '', believes: 'B', source_says: 'S' }],
        schemaVersion: 1,
      }),
    ).toBe(false);
    expect(
      isDistractorProvenanceRecord({
        instrumentId: 'x',
        entries: [{ text: 'A', believes: 4, source_says: 'S' }],
        schemaVersion: 1,
      }),
    ).toBe(false);
    expect(isDistractorProvenanceRecord({ instrumentId: 'x', entries: [], schemaVersion: 1 })).toBe(
      true,
    );
    expect(isDistractorProvenanceRecord(null)).toBe(false);
    expect(isDistractorProvenanceRecord('nope')).toBe(false);
  });
});
