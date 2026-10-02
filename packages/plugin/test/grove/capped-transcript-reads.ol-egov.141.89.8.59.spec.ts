/**
 * `ol-egov.141.89.8.59` (D-448): a read cut short by the per-read limit marks exactly the transcript
 * parts it consumed. Goes through the real concept read (`readConcepts` over a vault, a real budget)
 * and the real unit manifest store, via the helper `main.ts` calls. Every string is invented (INV-3).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ConceptReaderPort, isFullyRead, readConcepts, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { recordCappedTranscriptReads } from '../../src/grove/capped-transcript-reads.js';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import { eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-10-02T10:00:00Z');
const TRANSCRIPT = 'Courses/SYNTH101/Lecture 3 transcript.txt' as VaultPath;
const body = (n: number) =>
  Array.from({ length: n }, (_, i) => `Topic ${i + 1} ${'word '.repeat(179)}`.trim()).join('\n\n');

const reader: ConceptReaderPort = { read: async () => ({ concepts: [] }) };

async function setup(maxPassages: number) {
  const vault = eventedTestVault({ [TRANSCRIPT]: body(12) });
  const store = createVaultUnitManifestStore({
    vault,
    deviceId: 'olea-devicea0001',
    now: () => NOW,
  });
  await store.load();
  await store.manifestsFor([TRANSCRIPT]);
  const result = await readConcepts(vault, reader, { budget: { maxPassages } });
  return { store, result };
}

describe('a capped transcript read marks only its consumed parts (ol-egov.141.89.8.59)', () => {
  it('the read reports the part ordinals it reached, and only for a transcript', async () => {
    const { result } = await setup(5);
    const row = result.coverage.find((r) => r.sourcePath === TRANSCRIPT);
    expect(row?.truncatedByBudget).toBe(true);
    expect(row?.partsRead).toEqual([1, 2, 3, 4, 5]);
  });

  it('five parts read, seven still waiting; a later full read resumes', async () => {
    const { store, result } = await setup(5);
    await recordCappedTranscriptReads(store, result.coverage);
    let manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    const kinds = manifest?.entries.map((e) => e.readingState.kind);
    expect(kinds?.filter((k) => k === 'read')).toHaveLength(5);
    expect(kinds?.slice(0, 5)).toEqual(Array(5).fill('read'));
    expect(kinds?.filter((k) => k === 'pending')).toHaveLength(7);
    expect(manifest && isFullyRead(manifest)).toBe(false);

    await store.recordConceptExtraction([TRANSCRIPT]);
    manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest && isFullyRead(manifest)).toBe(true);
  });

  it('a read that carries no ordinals marks nothing: every part stays waiting', async () => {
    const { store, result } = await setup(5);
    await recordCappedTranscriptReads(
      store,
      result.coverage.map(({ partsRead: _p, ...row }) => row),
    );
    const manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest?.entries.every((e) => e.readingState.kind === 'pending')).toBe(true);
  });

  it('a read that reached every part leaves marking to the extraction record, not this one', async () => {
    const { store, result } = await setup(50);
    expect(result.coverage[0]?.truncatedByBudget).toBe(false);
    await recordCappedTranscriptReads(store, result.coverage);
    const manifest = (await store.manifestsFor([TRANSCRIPT])).get(TRANSCRIPT);
    expect(manifest?.entries.every((e) => e.readingState.kind === 'pending')).toBe(true);
  });

  it('main.ts calls it with the pass coverage, and strips partsRead before storing the rows', () => {
    const main = readFileSync(
      fileURLToPath(new URL('../../src/main.ts', import.meta.url)),
      'utf8',
    ).replace(/\/\/.*$/gm, '');
    expect(main).toMatch(
      /recordCappedTranscriptReads\(\s*this\.unitManifests,\s*pass\.read\.coverage\s*\)/,
    );
    expect(main).toMatch(/const \{ partsRead: _partsRead, \.\.\.stored \} = row/);
  });
});
