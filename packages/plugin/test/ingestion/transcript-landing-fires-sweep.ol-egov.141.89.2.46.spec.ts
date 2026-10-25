// `ol-egov.141.89.2.46` ([D-465]): a landed lecture transcript reaches the same landed-units hook
// (`main.ts` `onUnitsLanded`, which runs the drafting sweep) that a landed deck does. This pins the
// production construction (`buildIngestionRunner`), so a later change that routes transcript parts
// around the hook turns it red. Scenario testID: `transcript-landing-fires-sweep`. Every string is invented (INV-3).

import type { ExtractedUnit, PersistedQueue, QueueStore } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const TRANSCRIPT = '01 Courses/CRS-A/Lectures/week 1 transcript.txt';
const OTHER = '01 Courses/CRS-A/Lectures/week 2 transcript.txt';
const SPOKEN = 'Today we cover the idea of a river delta and how sediment settles.\n\nNext, tides.';

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

async function drainAll(paths: readonly string[]) {
  const landings: { units: readonly ExtractedUnit[]; revisions?: ReadonlyMap<string, string> }[] =
    [];
  const files: Record<string, string> = {};
  for (const path of paths) files[path] = SPOKEN;
  const { engine } = await buildIngestionRunner({
    vault: memoryVault(files),
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    onUnitsLanded: (units, revisions) => {
      landings.push({ units, ...(revisions !== undefined ? { revisions } : {}) });
    },
  });
  for (const path of paths) {
    await engine.enqueue({
      contentHash: `hash-${path}`,
      label: path,
      payload: { kind: 'transcript', sourcePath: path, transcriptFormat: 'plain-text' },
    });
  }
  for (let i = 0; i < paths.length; i += 1) await engine.tick();
  return landings;
}

describe('[D-465] a landed lecture transcript fires the landed-units hook the drafting sweep rides on', () => {
  it('one drained transcript job calls the hook once, with its parts marked as transcript parts and its version', async () => {
    const landings = await drainAll([TRANSCRIPT]);
    expect(landings).toHaveLength(1);
    const [landing] = landings;
    expect(landing?.units.length).toBeGreaterThan(0);
    for (const unit of landing?.units ?? []) {
      expect(unit.provenance.sourcePath).toBe(TRANSCRIPT);
      expect(unit.provenance.location.transcriptPart).toBeDefined();
    }
    expect(landing?.revisions?.get(TRANSCRIPT)).toBeTruthy();
  });

  it('two transcripts draining on separate jobs fire the hook once each, never twice for one', async () => {
    const landings = await drainAll([TRANSCRIPT, OTHER]);
    expect(landings).toHaveLength(2);
    const sources = landings.map((l) => new Set(l.units.map((u) => u.provenance.sourcePath)));
    expect(sources.map((s) => [...s])).toEqual([[TRANSCRIPT], [OTHER]]);
  });
});
