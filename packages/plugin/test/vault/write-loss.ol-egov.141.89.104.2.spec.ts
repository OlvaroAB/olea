/**
 * Local write loss inside one install, plugin side (`ol-egov.141.89.104.2`).
 *
 * T10d: every `data.json` writer runs its whole load-modify-save as one link of the settings
 * file's queue (`SerializingDataHost.readModifyWrite`). A writer that loads, then saves in a
 * second, separate call lets another writer's whole read-modify-write run in between, and its
 * save then discards that writer's key. `InterjectingDataFile` starts that other writer at the
 * exact load that precedes the save under test, so the overlap is deterministic.
 *
 * The rest: the plugin's own whole-file stores under `.olea/` (the drafts index, the
 * duplication-confirmation records, the composition journal) keep both of two overlapping
 * writes, because each read-modify-write runs on its path's queue. Every id, course and concept
 * here is invented.
 */

import type { VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ensureDeviceId, resetDeviceId } from '../../src/device/device-id.js';
import {
  createVaultDraftCacheStore,
  DRAFT_CACHE_FOLDER,
} from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { ObsidianHomeAvoidanceStore } from '../../src/home/avoidance.js';
import { ObsidianMisconceptionEmbeddingCacheStore } from '../../src/misconception-embedder.js';
import { ObsidianPlanPolicyCacheStore } from '../../src/plan/plan-policy-wiring.js';
import { ObsidianStudyPlanStore } from '../../src/plan/store.js';
import { purgeCache } from '../../src/privacy/cache-purge.js';
import { ObsidianGateStageStore } from '../../src/retrieval/gate-stage-store.js';
import { ObsidianJudgeCaseCaptureStore } from '../../src/retrieval/judge-case-capture.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import {
  DUPLICATION_CONFIRMATION_FOLDER,
  proposeRepairChoiceConfirmations,
  REPAIR_CHOICE_CONFIRMATION_REASON,
  type RepairChoiceConfirmationRecord,
  saveRepairChoiceAnswer,
} from '../../src/review/duplication-confirmation-store.js';
import {
  journalResolvedCompositionWrite,
  readUnresolvedCompositionWrites,
  unresolvedCompositionWritesPath,
} from '../../src/session/composition-write-reconciliation.js';
import { ObsidianExplainBackAuditGateStore } from '../../src/settings/explain-back-audit-gate.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';

/** A settings file whose `at`-th load starts another writer's read-modify-write on the same queue. */
class InterjectingDataFile extends FakeDataHost {
  private loads = 0;

  constructor(
    private readonly at: number,
    private readonly interject: () => void,
  ) {
    super();
  }

  override async loadData(): Promise<unknown> {
    this.loads += 1;
    if (this.loads === this.at) this.interject();
    return super.loadData();
  }
}

/**
 * Runs `write` against a queued settings host, starting another writer — which adds
 * `otherWriter` — at the load numbered `at`. Returns the settings file afterwards.
 */
async function raceAnotherWriter(
  at: number,
  write: (host: SerializingDataHost) => Promise<unknown>,
  seeded: Record<string, unknown> = { seeded: true },
): Promise<Record<string, unknown>> {
  let host: SerializingDataHost | undefined;
  let other: Promise<void> = Promise.resolve();
  const file = new InterjectingDataFile(at, () => {
    other = (host as SerializingDataHost).readModifyWrite((current) => ({
      ...(current as Record<string, unknown>),
      otherWriter: 'kept',
    }));
  });
  file.blob = seeded;
  host = new SerializingDataHost(file);
  await write(host);
  await other;
  return file.blob as Record<string, unknown>;
}

describe('T10d: a data.json writer overlapping another data.json write — both kept', () => {
  it('the device-id write (load, then save)', async () => {
    let minted = '';
    const blob = await raceAnotherWriter(1, async (host) => {
      minted = await ensureDeviceId(host, () => 0.5);
    });
    expect(blob.otherWriter).toBe('kept');
    expect(blob.deviceId).toBe(minted);
    expect(blob.seeded).toBe(true);
  });

  it("full delete's device-id reset", async () => {
    let fresh = '';
    const blob = await raceAnotherWriter(1, async (host) => {
      fresh = await resetDeviceId(host, () => 0.25);
    });
    expect(blob.otherWriter).toBe('kept');
    expect(blob.deviceId).toBe(fresh);
  });

  it('the home avoidance store, at the load that precedes its save', async () => {
    const blob = await raceAnotherWriter(2, (host) =>
      new ObsidianHomeAvoidanceStore(host).markAsked('COURSEA', '2026-10-01T00:00:00.000Z'),
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.homeCourseAvoidance).toEqual({
      version: 1,
      courses: { COURSEA: { askedAt: '2026-10-01T00:00:00.000Z' } },
    });
  });

  it('the study plan store', async () => {
    const blob = await raceAnotherWriter(1, (host) =>
      new ObsidianStudyPlanStore(host).save({ plan: 'p' } as never),
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.studyPlan).toEqual({ plan: 'p' });
  });

  it('the misconception embedding cache store', async () => {
    const blob = await raceAnotherWriter(1, (host) =>
      new ObsidianMisconceptionEmbeddingCacheStore(host).save({ cache: 'c' } as never),
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.misconceptionEmbeddingCache).toEqual({ cache: 'c' });
  });

  it('the plan policy cache store', async () => {
    const blob = await raceAnotherWriter(1, (host) =>
      new ObsidianPlanPolicyCacheStore(host).save({
        version: 1,
        fingerprint: 'f',
        result: {},
      } as never),
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.planPolicyCache).toEqual({ version: 1, fingerprint: 'f', result: {} });
  });

  it('the explain-back audit gate', async () => {
    const blob = await raceAnotherWriter(1, (host) =>
      new ObsidianExplainBackAuditGateStore(host).setSustainedFailure(true),
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.explainBackAuditGate).toEqual({ version: 1, sustainedFailure: true });
  });

  it("the cache purge's settings half", async () => {
    const blob = await raceAnotherWriter(
      1,
      (host) => purgeCache({ dataHost: host, vault: new MemoryVaultSource() }),
      { keywordIndex: { terms: 1 }, kept: true },
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob.kept).toBe(true);
    expect(blob).not.toHaveProperty('keywordIndex');
  });

  it("the gate-stage store's developer clear", async () => {
    const blob = await raceAnotherWriter(1, (host) => new ObsidianGateStageStore(host).clear(), {
      gateStagePeriod: { version: 1 },
    });
    expect(blob.otherWriter).toBe('kept');
    expect(blob).not.toHaveProperty('gateStagePeriod');
  });

  it("the judge-case capture's clear", async () => {
    const blob = await raceAnotherWriter(
      1,
      (host) => new ObsidianJudgeCaseCaptureStore(host).clear(),
      { jevJudgeCaseCapture: { cases: [] } },
    );
    expect(blob.otherWriter).toBe('kept');
    expect(blob).not.toHaveProperty('jevJudgeCaseCapture');
  });
});

/** A memory vault whose writes land one macrotask late, so two read-modify-writes overlap. */
class OverlapVault extends MemoryVaultSource {
  override async write(path: VaultPath, content: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await super.write(path, content);
  }
}

function draft(draftId: string, conceptName: string): DraftRecord {
  return {
    draftId,
    status: 'pending',
    courseCode: 'COURSEA',
    conceptName,
    conceptIds: [conceptName],
    sourcePath: '01 Courses/COURSEA/Week 1.md',
    createdAt: '2026-10-01T10:00:00+10:00',
    question: {
      stem: 'Which part turns the widget?',
      correctAnswer: 'The crank',
      distractors: ['The lid', 'The base', 'The spring'],
      feedback: 'See week one.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

describe("the plugin's own whole-file stores: overlapping writes on one file keep both", () => {
  it('drafts index (H6): two overlapping puts both reach the index', async () => {
    const vault = new OverlapVault();
    const cache = createVaultDraftCacheStore(vault);
    await Promise.all([cache.put(draft('a', 'Widget')), cache.put(draft('b', 'Gadget'))]);
    const index = JSON.parse(vault.raw(`${DRAFT_CACHE_FOLDER}/index.json`) ?? '{}') as {
      entries: { draftId: string }[];
    };
    expect(index.entries.map((entry) => entry.draftId).sort()).toEqual(['a', 'b']);
    expect((await cache.list()).map((record) => record.draftId).sort()).toEqual(['a', 'b']);
  });

  it('repair-choice record: a refresh overlapping her answer never writes the stale proposal back', async () => {
    const path = `${DUPLICATION_CONFIRMATION_FOLDER}/choice-1.json`;
    const proposed: RepairChoiceConfirmationRecord = {
      instrumentId: 'inst-1',
      candidates: [{ notePath: 'Notes/a.md', meetsCertaintyTest: true, digest: 'd-a' }],
      status: 'proposed',
      reason: REPAIR_CHOICE_CONFIRMATION_REASON,
      proposedAt: '2026-10-01T00:00:00.000Z',
      schemaVersion: 2,
    };
    const vault = new OverlapVault({ [path]: `${JSON.stringify(proposed, null, 2)}\n` });
    await Promise.all([
      saveRepairChoiceAnswer(vault, {
        instrumentId: 'inst-1',
        answer: { kind: 'none-of-these' },
        currentRecords: [],
        now: Date.parse('2026-10-02T00:00:00.000Z'),
      }),
      proposeRepairChoiceConfirmations(vault, [
        {
          instrumentId: 'inst-1',
          candidates: [
            { notePath: 'Notes/a.md', meetsCertaintyTest: true, digest: 'd-a' },
            { notePath: 'Notes/b.md', meetsCertaintyTest: false, digest: 'd-b' },
          ],
          proposedAt: Date.parse('2026-10-02T00:00:00.000Z'),
        },
      ]),
    ]);
    const stored = JSON.parse(vault.raw(path) ?? '{}') as RepairChoiceConfirmationRecord;
    expect(stored.status).toBe('declined');
    expect(stored.declinedAt).toBe('2026-10-02T00:00:00.000Z');
  });

  it('composition journal: two overlapping lines both land', async () => {
    const vault = new OverlapVault();
    const results = await Promise.all([
      journalResolvedCompositionWrite(vault, 'device-a', 'composition-key1:a'),
      journalResolvedCompositionWrite(vault, 'device-a', 'composition-key1:b'),
    ]);
    expect(results).toEqual([true, true]);
    const lines = (vault.raw(unresolvedCompositionWritesPath('device-a')) ?? '')
      .split('\n')
      .filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    expect((await readUnresolvedCompositionWrites(vault, 'device-a')).invalidLineCount).toBe(0);
  });
});
