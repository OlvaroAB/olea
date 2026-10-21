/**
 * `buildPracticePaperProvider` hands the past-paper reader to the provider it builds
 * (`ol-egov.141.89.7.87`, `[D-548]`, F4.11): the seam `main.ts` fills with
 * `pastPaperStructureReaderForVault`, so the paper's length can follow her stored reading.
 * The provider's own use of the reader (median item count, a throwing read) is
 * `provider.spec.ts`'s; this file pins only that the wiring passes it through.
 */

import type { PaperRecoveredStructure, VaultSource } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateLocalPracticePaperProviderDeps } from '../../src/paper/provider.js';

const captured: CreateLocalPracticePaperProviderDeps[] = [];

vi.mock('../../src/paper/provider.js', () => ({
  createLocalPracticePaperProvider: (deps: CreateLocalPracticePaperProviderDeps) => {
    captured.push(deps);
    return { load: async () => ({}), requestPaper: async () => ({}) };
  },
}));

const { buildPracticePaperProvider } = await import('../../src/paper/wiring.js');

const base = {
  vault: {} as VaultSource,
  dataHost: {} as never,
  createTransport: (() => ({})) as never,
  settingsStore: { load: async () => ({ version: 1 as const, assignmentsBasePath: '' }) },
};

describe('buildPracticePaperProvider — the past-paper reader', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('passes the reader to the provider, and the provider can call it', async () => {
    const structure: PaperRecoveredStructure = {
      sittingCount: 0,
      currentCount: 0,
      historicalCount: 0,
      sittings: [],
    };
    const calls: string[] = [];
    const readPastPaperStructure = async (course: string) => {
      calls.push(course);
      return structure;
    };
    buildPracticePaperProvider({ ...base, readPastPaperStructure });
    const deps = captured[0];
    expect(deps?.readPastPaperStructure).toBe(readPastPaperStructure);
    expect(await deps?.readPastPaperStructure?.('COURSEA')).toBe(structure);
    expect(calls).toEqual(['COURSEA']);
  });

  it('leaves the reader out when none is supplied, so the declared extent stands', () => {
    buildPracticePaperProvider(base);
    expect(captured[0] !== undefined && 'readPastPaperStructure' in captured[0]).toBe(false);
  });
});

// ol-egov.141.89.7.93 ([D-562]): the shared-passage lookup is composed from the vault alone, so
// `main.ts`'s existing call needs nothing new.
describe('buildPracticePaperProvider — the papers a shared passage is never taken from', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('always hands the provider the registered past papers, read from her review log by default', async () => {
    const { memoryVault } = await import('../review/memory-vault.js');
    buildPracticePaperProvider({ ...base, vault: memoryVault() });
    const read = captured[0]?.readRegisteredPastPaperPaths;
    expect(typeof read).toBe('function');
    // A vault with no review log registers nothing.
    expect(await read?.()).toEqual([]);
  });

  it('passes a supplied reader through unchanged', () => {
    const readRegisteredPastPaperPaths = async () => ['03 Research/COURSEA Paper 1.pdf'];
    buildPracticePaperProvider({ ...base, readRegisteredPastPaperPaths });
    expect(captured[0]?.readRegisteredPastPaperPaths).toBe(readRegisteredPastPaperPaths);
  });
});
