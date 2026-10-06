/**
 * The composition the switch-on change makes (`ol-egov.141.89.7.76`, `[D-540]`), built here exactly
 * as the scratchpad patch `l540-composition.patch` builds it in `main.ts` and `ingestion/wiring.ts`
 * (neither file is this lane's): `main.ts` resolves the device id once with `ensureDeviceId(this)` and
 * passes `spend: createVaultSpendLedger({ vault, deviceId: async () => deviceId })` in the
 * `outcomes` deps, over the same sealed vault every store writes through; `wiring.ts` hands that
 * ledger to `WorkerOutcomesExtractReader` and to `runScopeReadingDrivers`. Scenario: F4.1, "the
 * composition the switch-on change makes holds and refuses as above". Synthetic only.
 */

import { spendLedgerPath, type WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ensureDeviceId } from '../../src/device/device-id.js';
import { WorkerOutcomesExtractReader } from '../../src/ingestion/outcomes-extract-adapter.js';
import { OleaLayerWriteSeal } from '../../src/privacy/olea-layer-write-seal.js';
import { runScopeReadingDrivers } from '../../src/scope-reading/drivers.js';
import { createScopeReadingPersistence } from '../../src/scope-reading/persistence.js';
import { createVaultSpendLedger } from '../../src/spend/vault-spend-ledger.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';
import { demandAnswer, STAMP, transport, unit } from '../scope-reading/drivers-kit.js';

const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [error, info] = [console.error, console.info];
  console.error = () => undefined;
  console.info = () => undefined;
  try {
    return await f();
  } finally {
    console.error = error;
    console.info = info;
  }
};

/** `main.ts`'s half of the patch: one device id, one ledger over the sealed vault. */
async function composeLikeMain(dataHost: FakeDataHost, disk: MemoryVaultSource) {
  const vault = new OleaLayerWriteSeal(disk);
  const deviceId = await ensureDeviceId(dataHost);
  const spend = createVaultSpendLedger({ vault, deviceId: async () => deviceId });
  return { vault, deviceId, spend };
}

const extractRequest = {
  documentKind: 'past-paper' as const,
  passages: [{ text: 'Question 1(a). Find the first quantity.', anchor: { blockIndex: 0 } }],
};

const paperUnits = [
  unit('Shared stem text.', 1),
  unit('Find the first quantity.', 1),
  unit('Find the second quantity.', 1),
];

async function recordedPaper(vault: OleaLayerWriteSeal, deviceId: string) {
  const persistence = createScopeReadingPersistence({ vault, deviceId });
  const recorded = await persistence.recordExtraction({
    sourcePath: 'doc-paper',
    documentKind: 'past-paper',
    revisionDigest: 'r1',
    coverage: { unitsRead: 3, unitsTotal: 3 },
    declarationCount: 0,
    stamp: STAMP,
    paperStructure: {
      sections: [
        { label: 'One', questionForm: 'short answer', itemCount: 2, anchor: { blockIndex: 0 } },
      ],
      questionGroups: [
        {
          id: 'g1',
          kind: 'parent-question',
          label: 'Q1',
          memberLabels: ['1a', '1b'],
          anchor: { blockIndex: 0 },
          stimulus: { status: 'none' },
        },
      ],
      questionParts: [
        {
          id: 'p1',
          label: '1a',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 1 },
          questionForm: 'short answer',
        },
        {
          id: 'p2',
          label: '1b',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 2 },
          questionForm: 'short answer',
        },
      ],
    },
  });
  return { persistence, recorded };
}

describe('the switch-on composition', () => {
  it('holds every extraction and driver call in a file named by the stored device id, and sends each hold', async () => {
    const dataHost = new FakeDataHost();
    const disk = new MemoryVaultSource();
    const { vault, deviceId, spend } = await composeLikeMain(dataHost, disk);

    const sent: WorkerTaskRequest[] = [];
    const extractTransport = {
      send: async (request: WorkerTaskRequest) => {
        sent.push(request);
        return { ok: false, code: 'upstream-error', message: 'synthetic' };
      },
    };
    // wiring.ts: `new WorkerOutcomesExtractReader({ transport: capturingTransport, spend })`.
    await new WorkerOutcomesExtractReader({ transport: extractTransport, spend })
      .read(extractRequest)
      .catch(() => undefined);

    // wiring.ts: `runScopeReadingDrivers({ ..., spend })`.
    const { persistence, recorded } = await recordedPaper(vault, deviceId);
    const t = transport((x) => demandAnswer(x));
    await runScopeReadingDrivers({
      persistence,
      ref: { sourcePath: 'doc-paper', documentKind: 'past-paper', revisionDigest: 'r1' },
      basis: { revisionDigest: 'r1', unitsRead: 3, unitsTotal: 3, pages: [1] },
      recorded,
      units: paperUnits,
      deliveryRevisionDigest: 'r1',
      courses: [],
      declarations: [],
      transport: {
        send: async (request) => {
          sent.push(request);
          return t.transport.send(request);
        },
      },
      vault,
      spend,
    });

    expect(sent.map((r) => r.taskId)).toEqual([
      'outcomes.extract.v1',
      'demand.classify.v1',
      'demand.classify.v1',
    ]);
    for (const request of sent) expect(request.remainingAllowanceUsd).toBeGreaterThan(0);
    const ledgerFile = spendLedgerPath(deviceId);
    expect(disk.paths().filter((p) => p.startsWith('.olea/spend-ledger/'))).toEqual([ledgerFile]);
    const holds = (disk.raw(ledgerFile) ?? '').trim().split('\n');
    expect(holds).toHaveLength(3);
    expect(holds.map((line) => (JSON.parse(line) as { holdUsd: number }).holdUsd)).toEqual(
      sent.map((r) => r.remainingAllowanceUsd),
    );
  });

  it('after a restart, the same device id and the same spend', async () => {
    const dataHost = new FakeDataHost();
    const disk = new MemoryVaultSource();
    const first = await composeLikeMain(dataHost, disk);
    expect((await first.spend.reserve('outcomes.extract.v1', 100)).granted).toBe(true);
    const before = await first.spend.summary();

    const second = await composeLikeMain(dataHost, disk);
    expect(second.deviceId).toBe(first.deviceId);
    expect((await second.spend.summary()).spentMicroUsd).toBe(before.spentMicroUsd);
  });

  it('while a full delete has the layer sealed, no call is sent', async () => {
    const dataHost = new FakeDataHost();
    const disk = new MemoryVaultSource();
    const { vault, spend } = await composeLikeMain(dataHost, disk);
    await vault.seal();
    const sent: WorkerTaskRequest[] = [];
    const error = await quiet(() =>
      new WorkerOutcomesExtractReader({
        transport: {
          send: async (request) => {
            sent.push(request);
            return { ok: false, code: 'upstream-error', message: 'synthetic' };
          },
        },
        spend,
      })
        .read(extractRequest)
        .then(
          () => undefined,
          (e: unknown) => e,
        ),
    );
    expect((error as { reason?: string }).reason).toBe('budget-exhausted');
    expect(sent).toHaveLength(0);
  });
});
