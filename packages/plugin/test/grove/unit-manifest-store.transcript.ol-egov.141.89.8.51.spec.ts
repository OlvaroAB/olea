/**
 * The unit manifest store over lecture transcripts (`ol-egov.141.89.8.51`; D-448, D-466): a
 * transcript's parts are enumerated waiting, a capped read leaves the rest waiting, and a plain note
 * is never taken for a transcript. Every string is invented (INV-3).
 */
import { hasPendingUnits, isFullyRead, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import { eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-10-02T10:00:00Z');
const TRANSCRIPT = 'Courses/SYNTH101/Lecture 3 transcript.txt' as VaultPath;
const DECLARED = 'Courses/SYNTH101/Lecture 4 transcript.md' as VaultPath;
const NOTE = 'Courses/SYNTH101/My note.md' as VaultPath;

const body = (n: number) =>
  Array.from({ length: n }, (_, i) => `Topic ${i + 1} ${'word '.repeat(179)}`.trim()).join('\n\n');

function make() {
  const vault = eventedTestVault({
    [TRANSCRIPT]: body(12),
    [DECLARED]: `---\nrole: transcript\n---\n${body(3)}`,
    [NOTE]: `---\nrole: note\n---\n${body(2)}`,
  });
  const store = createVaultUnitManifestStore({
    vault,
    deviceId: 'olea-devicea0001',
    now: () => NOW,
  });
  return { vault, store };
}

describe('transcripts in the unit manifest (ol-egov.141.89.8.51)', () => {
  it('enumerates every part waiting, never read and never absent', async () => {
    const { store } = make();
    await store.load();
    const manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest?.entries).toHaveLength(12);
    expect(manifest?.entries.map((e) => e.readingState.kind)).toEqual(Array(12).fill('pending'));
    expect(manifest && hasPendingUnits(manifest)).toBe(true);
    expect(manifest && isFullyRead(manifest)).toBe(false);
  });

  it('a declared Markdown transcript is enumerated; an undeclared note is left out', async () => {
    const { store } = make();
    await store.load();
    const got = await store.manifestsFor([DECLARED, NOTE]);
    expect(got.get(DECLARED)?.entries).toHaveLength(3);
    expect(got.has(NOTE)).toBe(false);
  });

  it('a read cut short after five parts leaves seven waiting, and a later read resumes', async () => {
    const { store } = make();
    await store.load();
    await store.manifestsFor([TRANSCRIPT]);
    await store.recordTranscriptReading(TRANSCRIPT, [1, 2, 3, 4, 5]);
    let manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest?.entries.filter((e) => e.readingState.kind === 'read')).toHaveLength(5);
    expect(manifest?.entries.filter((e) => e.readingState.kind === 'pending')).toHaveLength(7);
    expect(manifest && isFullyRead(manifest)).toBe(false);

    // The next read, in full: every part reads, and extraction is marked for them all.
    await store.recordConceptExtraction([TRANSCRIPT]);
    manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest && isFullyRead(manifest)).toBe(true);
    expect(manifest?.entries.every((e) => e.conceptExtractionState === 'complete')).toBe(true);
  });

  it('a transcript consumed in full by one pass is read part by part, not by the file', async () => {
    const { store } = make();
    await store.load();
    await store.recordConceptExtraction([DECLARED]);
    const manifest = (await store.manifestsFor([DECLARED])).get(DECLARED);
    expect(manifest?.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read', 'read']);
  });

  it('the record survives a reload from disk', async () => {
    const { vault, store } = make();
    await store.load();
    await store.manifestsFor([TRANSCRIPT]);
    await store.recordTranscriptReading(TRANSCRIPT, [1, 2]);
    const again = createVaultUnitManifestStore({
      vault,
      deviceId: 'olea-devicea0001',
      now: () => NOW,
    });
    await again.load();
    const manifest = (await again.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest?.entries.filter((e) => e.readingState.kind === 'read')).toHaveLength(2);
  });
});
