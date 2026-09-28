/**
 * `ol-egov.141.89.2.14` — the citation-revision batch pass never touches a standing-rejected
 * instrument: no judge dispatch, no suspend write, no enqueue, no store write at all (C5.3 as
 * amended by `[D-396]`: "a rejection follows the item once it is fixed... only her own
 * deliberate restore returns it to circulation").
 *
 * ## The production writer this suite rejects through
 *
 * Same as `../../session-builder/rejected-instrument-readers.spec.ts`: the registry's "reject
 * it" on a withheld item, `registry/provider.ts`'s `rejectWithheldItem` (its
 * `appendVerdictRecord` call), reached from the registry view's reject button. The instrument
 * here is withheld the same way (an M5 structural check: an embedded asset that does not
 * resolve), rejected there, then fixed so its embed resolves again — under the SAME id, since
 * `enumerateVaultInstruments` derives an explicit-id MCQ's id identically whether the block is
 * M5-invalid or valid.
 *
 * ## Why this fixture also carries a citation sidecar
 *
 * `CitationRevisionTrigger` only ever acts on an instrument `isTrackedForRevision` reads as
 * tracked — `sourceProvenance` present (`[D-366]`/`[D-398]`), which a generation pipeline mints
 * via `.olea/citations/` (`citation-store.ts`). This fixture writes that sidecar directly (the
 * generation-pipeline write path is a different bead's `owns`), self-referential — the same
 * "self-referential citation keeps this MCQ tracked" shape `citation-revision-wiring.spec.ts`'s
 * own fixtures already use to test batch-pass mechanics, never the `[D-366]`/`[D-398]` exemption
 * itself.
 *
 * The third case proves the fix's own stated boundary: only the `'rejected'` `provenInvalid`
 * reason is read here — a `'defect'` suspension (the fold's other reason) keeps today's
 * behaviour, unaffected by this change.
 *
 * Every fixture string is invented (INV-3).
 */
import {
  appendSuspendRecord,
  citationStorePath,
  type RevisionJudgePort,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type {
  CitationAnchorRecord,
  CitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import type { ObsidianDataHost } from '../../../src/plan/settings-store.js';
import { createLocalRegistryProvider } from '../../../src/registry/provider.js';
import type { RegistryWithheldItem } from '../../../src/registry/view.js';
import { type MemoryVault, memoryVault } from '../../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-28T09:00:00-04:00');
const NOTE_PATH = 'Courses/GEO101/Weathering.md';
const MCQ_ID = 'q1';
const PARAGRAPH_A = 'Basalt weathers quickly in humid climates.';
const PARAGRAPH_B = 'Basalt weathers slowly in cold, dry climates instead.';

// Verbatim copy of `citation-revision-wiring.spec.ts`'s own `FakeCitationHashStore` — same file,
// same package, but that one lives in a describe-scoped module this suite does not import from
// (test isolation between the two files), so the fake is duplicated rather than shared, the same
// "different bead's owns"-shaped small-duplicate posture this codebase already documents
// elsewhere (e.g. `registry/provider.ts`'s `disputesFromFiles`).
class FakeCitationHashStore implements CitationHashStore {
  readonly byId = new Map<string, CitationAnchorRecord>();
  async loadAll(): Promise<ReadonlyMap<string, CitationAnchorRecord>> {
    return new Map(this.byId);
  }
  async save(instrumentId: string, record: CitationAnchorRecord): Promise<void> {
    this.byId.set(instrumentId, record);
  }
  async remove(instrumentId: string): Promise<void> {
    this.byId.delete(instrumentId);
  }
  async setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation:
        existingPending?.sinceContentHash === sourceContentHash
          ? existingPending
          : { sinceContentHash: sourceContentHash, since },
    });
  }
  async isPendingRevalidationCurrent(
    instrumentId: string,
    expectedSourceContentHash: string,
  ): Promise<boolean> {
    return (
      this.byId.get(instrumentId)?.pendingRevalidation?.sinceContentHash ===
      expectedSourceContentHash
    );
  }
  async recordDispatch(
    instrumentId: string,
    sourceContentHash: string,
    dispatchedAt: number,
    retry: boolean,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    const forSameDifference = existingPending?.sinceContentHash === sourceContentHash;
    const since = forSameDifference ? existingPending.since : dispatchedAt;
    const carriedRetriedAt = forSameDifference ? existingPending.retriedAt : undefined;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation: {
        sinceContentHash: sourceContentHash,
        since,
        dispatchedAt,
        ...(retry
          ? { retriedAt: dispatchedAt }
          : carriedRetriedAt !== undefined
            ? { retriedAt: carriedRetriedAt }
            : {}),
      },
    });
  }
}

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function fakeClock(now: number) {
  return { now: () => now };
}

function citationSidecar(instrumentId: string, sourcePath: VaultPath): string {
  return `${JSON.stringify({ instrumentId, sourcePath, page: 1, schemaVersion: 1 }, null, 2)}\n`;
}

/** The note carrying the rejectable, tracked MCQ: a valid Q&A sibling (so the registry can derive an identity for the withheld MCQ) and an explicit-id MCQ embedding `asset`. */
function noteText(paragraph: string, asset: 'figure.png' | 'gone.png'): string {
  return [
    '---',
    'topic: [Weathering rates]',
    'course: GEO101',
    '---',
    '',
    'Front::Back',
    '',
    paragraph,
    '',
    '```olea-mcq',
    `id: ${MCQ_ID}`,
    `stem: Which mineral is most weathering-resistant? ![[${asset}]]`,
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
    '',
  ].join('\n');
}

function fixtureVault(paragraph: string, asset: 'figure.png' | 'gone.png'): MemoryVault {
  return memoryVault({
    [NOTE_PATH]: noteText(paragraph, asset),
    'figure.png': 'not really a picture',
    [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
  });
}

function registryProvider(vault: MemoryVault, now: () => Date = () => NOW) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now,
    editPort: {
      async edit() {
        /* no case here opens an editor */
      },
    },
  });
}

async function withheldMcq(vault: MemoryVault): Promise<RegistryWithheldItem> {
  const state = await registryProvider(vault).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const item = state.withheldInstruments.find(
    (candidate) => candidate.notePath === NOTE_PATH && candidate.kind === 'mcq',
  );
  if (item === undefined || item.identity === undefined) {
    throw new Error('expected the withheld MCQ with a safely derived identity');
  }
  return item;
}

/** She rejects the withheld MCQ from the registry: the production writer. Returns its id. */
async function rejectThroughRegistry(vault: MemoryVault): Promise<string> {
  const item = await withheldMcq(vault);
  await registryProvider(vault).rejectWithheldItem(item);
  const identity = item.identity;
  if (identity === undefined) throw new Error('unreachable: checked above');
  return identity.instrumentId;
}

/** Rejects, then restores through the registry's own restore (her deliberate restore) — both while the item is still structurally withheld, exactly as `rejected-instrument-readers.spec.ts` drives it. */
async function rejectThenRestoreThroughRegistry(vault: MemoryVault): Promise<string> {
  const instrumentId = await rejectThroughRegistry(vault);
  // Two clicks never share a millisecond; the restore is a later event than the rejection.
  const later = new Date(NOW.getTime() + 60_000);
  const state = await registryProvider(vault, () => later).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const item = state.withheldInstruments.find(
    (candidate) => candidate.notePath === NOTE_PATH && candidate.kind === 'mcq',
  );
  if (item?.rejectedAs === undefined) throw new Error('expected a standing rejection to restore');
  await registryProvider(vault, () => later).restoreWithheldItem(item);
  return instrumentId;
}

function actions(overrides: Partial<Parameters<CitationRevisionTrigger['tick']>[1]> = {}) {
  return {
    enqueue: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ol-egov.141.89.2.14 — CitationRevisionTrigger skips a standing-rejected instrument', () => {
  it('a rejected, since-fixed and since-edited instrument gets no judge call, no suspend, no enqueue, no store write', async () => {
    const vault = fixtureVault(PARAGRAPH_A, 'figure.png');
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    // Tick 1: the instrument is valid and tracked, so it is baselined.
    const first = await trigger.tick(vault, actions());
    expect(first.newlyBaselined).toBe(1);
    const baselined = (await store.loadAll()).get(MCQ_ID);
    expect(baselined).toBeDefined();

    // The embed breaks; she rejects it from the registry (the production writer).
    await vault.write(NOTE_PATH, noteText(PARAGRAPH_A, 'gone.png'));
    const rejectedId = await rejectThroughRegistry(vault);
    expect(rejectedId).toBe(MCQ_ID);

    // She fixes the embed AND edits the cited material — a real, unresolved difference against
    // the tick-1 baseline, exactly the shape the bead's finding names ("a later edit to its
    // source still drafted a successor").
    await vault.write(NOTE_PATH, noteText(PARAGRAPH_B, 'figure.png'));

    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    expect(report.revised).toBe(0);
    expect(report.refreshed).toBe(0);
    expect(report.judgeUnavailable).toBe(0);
    expect(report.newlyBaselined).toBe(0);

    // No store write at all while rejected: the baseline is byte-identical to tick 1's.
    const stillStored = (await store.loadAll()).get(MCQ_ID);
    expect(stillStored).toStrictEqual(baselined);
    expect(stillStored?.text).not.toContain('cold, dry climates');
  });

  it('a rejected instrument never seen before this pass gets no first baseline either', async () => {
    const vault = fixtureVault(PARAGRAPH_A, 'gone.png');
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    // Withheld and rejected before this MCQ was ever tracked by a tick — the sidecar exists
    // (`fixtureVault` always writes it), but no baseline has ever been recorded.
    const rejectedId = await rejectThroughRegistry(vault);
    expect(rejectedId).toBe(MCQ_ID);
    await vault.write(NOTE_PATH, noteText(PARAGRAPH_A, 'figure.png'));

    const report = await trigger.tick(vault, actions());

    expect(report.newlyBaselined).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
    expect((await store.loadAll()).has(MCQ_ID)).toBe(false);
  });

  it('control: after her deliberate restore, the same edit is judged, suspended and enqueued normally', async () => {
    const vault = fixtureVault(PARAGRAPH_A, 'figure.png');
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, noteText(PARAGRAPH_A, 'gone.png'));
    const rejectedId = await rejectThenRestoreThroughRegistry(vault);
    expect(rejectedId).toBe(MCQ_ID);

    await vault.write(NOTE_PATH, noteText(PARAGRAPH_B, 'figure.png'));

    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
    expect(act.enqueue).toHaveBeenCalledTimes(1);
    expect(report.revised).toBe(1);
  });

  it("a defect suspension (not a rejection) keeps today's behaviour: the judge still runs", async () => {
    const vault = fixtureVault(PARAGRAPH_A, 'figure.png');
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

    const first = await trigger.tick(vault, actions());
    const conceptId = (await store.loadAll()).get(MCQ_ID)?.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected the baseline to carry a concept id');
    expect(first.newlyBaselined).toBe(1);

    // A defect suspension — `projectInstrumentValidity`'s OTHER `provenInvalid` reason — written
    // directly (never through the registry reject path, which only ever writes `reason:
    // 'rejected'` verdicts): this fix reads only the `'rejected'` reason, so a defect-suspended
    // instrument's citation-revision handling is unchanged by it.
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: NOW.toISOString(),
        instrumentId: MCQ_ID,
        conceptIds: [conceptId],
        reason: 'defect',
      },
      { deviceId: DEVICE },
    );

    await vault.write(NOTE_PATH, noteText(PARAGRAPH_B, 'figure.png'));

    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
    expect(act.enqueue).toHaveBeenCalledTimes(1);
    expect(report.revised).toBe(1);
  });
});
