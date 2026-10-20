/**
 * The three Worker adapters behind the spend ledger (`ol-egov.141.89.7.76`, `[D-540]`). Scenarios:
 * F4.1, "each call is sent with its hold as the remaining allowance", "at 100 percent any call whose
 * hold would pass the limit is refused before sending", "a ledger that cannot be read allows no
 * call" (the adapter half) and "a call settles at its reported cost only when the response proves
 * one billable call, and otherwise keeps its whole hold". Synthetic wording only.
 */

import type { WorkerTaskRequest } from 'olea-core';
import { holdUsdFor } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DemandClassifyReaderUnavailableError,
  type DemandClassifyReadRequest,
  WorkerDemandClassifyReader,
} from '../../src/ingestion/demand-classify-adapter.js';
import {
  OutcomesAlignReaderUnavailableError,
  type OutcomesAlignReadRequest,
  WorkerOutcomesAlignReader,
} from '../../src/ingestion/outcomes-align-adapter.js';
import {
  OutcomesExtractReaderUnavailableError,
  WorkerOutcomesExtractReader,
} from '../../src/ingestion/outcomes-extract-adapter.js';
import { sendWithinAllowance } from '../../src/spend/allowance.js';
import { WorkerHttpTransport } from '../../src/worker/transport.js';
import { successEnvelope } from '../oracle/worker-envelope-fixtures.js';
import { memoryVault } from '../review/memory-vault.js';
import {
  ALIGN_HOLD,
  EXTRACT_HOLD,
  failing,
  ledgerOver,
  ownEntries,
  vaultSpentTo,
} from './spend-kit.js';

class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

const refused = () => ({ ok: false, code: 'upstream-error', message: 'synthetic failure' });

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

const demandRequest: DemandClassifyReadRequest = {
  part: {
    partId: 'p1',
    label: '1(a)',
    instruction: { ref: 'u1', unitIndex: 1, text: 'Find the first quantity.' },
    questionForm: 'short answer',
  },
  group: { stimulus: { status: 'none' } },
};

const alignRequest: OutcomesAlignReadRequest = {
  documentKind: 'objectives',
  batchId: 'b1',
  courseContext: { courseId: 'TESTC1', courseName: 'TESTC1' },
  coverage: { digest: 'digest-1', units: [{ ref: 'u1', unitIndex: 1, state: 'sent' }] },
  records: [
    {
      recordId: 'r1',
      kind: 'declaration',
      anchorRef: 'u1',
      passages: [{ ref: 'u1', unitIndex: 1, text: 'Explain the first idea.', role: 'record' }],
    },
  ],
  concepts: [
    {
      handle: 'c001',
      name: 'First idea',
      descriptionNone: 'no-source-recorded',
      attribution: { courseId: 'TESTC1', courseName: 'TESTC1' },
    },
  ],
} as unknown as OutcomesAlignReadRequest;

const extractRequest = {
  documentKind: 'objectives' as const,
  passages: [{ text: 'Students will explain the first idea.', anchor: { blockIndex: 0 } }],
};

/** Runs one read through each adapter, swallowing the read's own outcome: these specs look at the wire and the ledger. */
const readers = {
  'demand.classify.v1': (t: RecordingTransport, spend?: ReturnType<typeof ledgerOver>) =>
    new WorkerDemandClassifyReader({ transport: t, ...(spend ? { spend } : {}) }).read(
      demandRequest,
    ),
  'outcomes.align.v1': (t: RecordingTransport, spend?: ReturnType<typeof ledgerOver>) =>
    new WorkerOutcomesAlignReader({ transport: t, ...(spend ? { spend } : {}) }).read(alignRequest),
  'outcomes.extract.v1': (t: RecordingTransport, spend?: ReturnType<typeof ledgerOver>) =>
    new WorkerOutcomesExtractReader({ transport: t, ...(spend ? { spend } : {}) }).read(
      extractRequest,
    ),
} as const;
const TASKS = Object.keys(readers) as (keyof typeof readers)[];

describe('each call is sent with its hold as the remaining allowance', () => {
  for (const taskId of TASKS) {
    it(`${taskId}: the request carries the hold written for it, and nothing else changes`, async () => {
      const vault = memoryVault();
      const spend = ledgerOver(vault);
      const t = new RecordingTransport(refused);
      await readers[taskId](t, spend).catch(() => undefined);
      expect(t.sent).toHaveLength(1);
      const [request] = t.sent as [WorkerTaskRequest];
      expect(request.taskId).toBe(taskId);
      const holds = (await ownEntries(vault)).flatMap((e) =>
        'entry' in e && e.entry.kind === 'hold' ? [e.entry] : [],
      );
      expect(holds).toHaveLength(1);
      expect(holds[0]?.taskId).toBe(taskId);
      expect(request.remainingAllowanceUsd).toBe(holds[0]?.holdUsd);
      expect(request.remainingAllowanceUsd).toBe(
        holdUsdFor(taskId, JSON.stringify(request.payload).length),
      );
      expect(request.remainingAllowanceUsd).toBeGreaterThanOrEqual(holdUsdFor(taskId));
    });

    it(`${taskId}: with no ledger the wire is unchanged (no allowance key)`, async () => {
      const t = new RecordingTransport(refused);
      await readers[taskId](t).catch(() => undefined);
      expect(t.sent).toHaveLength(1);
      expect(Object.keys(t.sent[0] as object)).not.toContain('remainingAllowanceUsd');
    });
  }
});

describe('at 100 percent any call whose hold would pass the limit is refused before sending', () => {
  it('outcome extraction past USD 12: over budget, the transport never called, no hold written', async () => {
    const vault = vaultSpentTo(12 - EXTRACT_HOLD + 0.000001);
    const t = new RecordingTransport(refused);
    const error = await quiet(() =>
      readers['outcomes.extract.v1'](t, ledgerOver(vault)).then(
        () => undefined,
        (e: unknown) => e,
      ),
    );
    expect(error).toBeInstanceOf(OutcomesExtractReaderUnavailableError);
    expect((error as OutcomesExtractReaderUnavailableError).reason).toBe('budget-exhausted');
    expect(t.sent).toHaveLength(0);
    expect(await ownEntries(vault)).toEqual([]);
  });

  it('outcome extraction still runs past 80 percent', async () => {
    const vault = vaultSpentTo(10);
    const t = new RecordingTransport(refused);
    await readers['outcomes.extract.v1'](t, ledgerOver(vault)).catch(() => undefined);
    expect(t.sent).toHaveLength(1);
  });

  it('the scope reads past 80 percent: over budget, nothing sent', async () => {
    const expected = {
      'demand.classify.v1': DemandClassifyReaderUnavailableError,
      'outcomes.align.v1': OutcomesAlignReaderUnavailableError,
    } as const;
    for (const taskId of ['demand.classify.v1', 'outcomes.align.v1'] as const) {
      const vault = vaultSpentTo(9.59);
      const t = new RecordingTransport(refused);
      const error = await quiet(() =>
        readers[taskId](t, ledgerOver(vault)).then(
          () => undefined,
          (e: unknown) => e,
        ),
      );
      expect(error, taskId).toBeInstanceOf(expected[taskId]);
      expect((error as { reason: string }).reason).toBe('budget-exhausted');
      expect(t.sent).toHaveLength(0);
    }
  });
});

describe('a ledger that cannot be read allows no call, through every adapter', () => {
  for (const taskId of TASKS) {
    it(`${taskId}: over budget, nothing sent`, async () => {
      const spend = ledgerOver(failing(memoryVault(), { list: true }));
      const t = new RecordingTransport(refused);
      const error = await quiet(() =>
        readers[taskId](t, spend).then(
          () => undefined,
          (e: unknown) => e,
        ),
      );
      expect((error as { reason?: string }).reason).toBe('budget-exhausted');
      expect(t.sent).toHaveLength(0);
    });
  }
});

describe('what a call keeps', () => {
  it('a transport failure keeps the whole hold and reads as offline', async () => {
    const vault = memoryVault();
    const spend = ledgerOver(vault);
    const t = new RecordingTransport(() => {
      throw new Error('network down');
    });
    const error = await readers['outcomes.align.v1'](t, spend).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as OutcomesAlignReaderUnavailableError).reason).toBe('offline');
    expect((await spend.summary()).spentMicroUsd).toBe(Math.round(ALIGN_HOLD * 1e6));
  });

  it('a success whose attempt count the client cannot see keeps the whole hold', async () => {
    // A transport that records no attempt count (a test double) leaves it unknown.
    const vault = memoryVault();
    const spend = ledgerOver(vault);
    const t = new RecordingTransport(() => successEnvelope({ outcomes: [], sections: [] }));
    const result = await sendWithinAllowance(spend, t, {
      contractVersion: 1,
      taskId: 'outcomes.extract.v1',
      payload: { sourceChunks: ['One synthetic sentence.'], documentKind: 'objectives' },
    });
    expect(result.kind).toBe('sent');
    expect((await spend.summary()).spentMicroUsd).toBe(Math.round(EXTRACT_HOLD * 1e6));
  });

  it('a success that proves one call settles at its reported cost', async () => {
    const vault = memoryVault();
    const spend = ledgerOver(vault);
    const t = new RecordingTransport(() => successEnvelope({ outcomes: [], sections: [] }));
    const result = await sendWithinAllowance(
      spend,
      t,
      {
        contractVersion: 1,
        taskId: 'outcomes.extract.v1',
        payload: { sourceChunks: ['One synthetic sentence.'], documentKind: 'objectives' },
      },
      { attemptsOf: () => 1 },
    );
    expect(result.kind).toBe('sent');
    expect((await spend.summary()).spentMicroUsd).toBe(1_000);
  });

  describe('through the real transport, from the x-olea-attempts header', () => {
    const request: WorkerTaskRequest = {
      contractVersion: 1,
      taskId: 'outcomes.extract.v1',
      payload: { sourceChunks: ['One synthetic sentence.'], documentKind: 'objectives' },
    };
    const over = (headers?: Record<string, string>) =>
      new WorkerHttpTransport(
        async () => ({
          status: 200,
          text: JSON.stringify(successEnvelope({ outcomes: [], sections: [] })),
          ...(headers ? { headers } : {}),
        }),
        { baseUrl: 'https://example.invalid', token: 'T' },
      );

    it('a 1-attempt response settles at its reported cost, with no attemptsOf passed', async () => {
      const spend = ledgerOver(memoryVault());
      await sendWithinAllowance(spend, over({ 'x-olea-attempts': '1' }), request);
      expect((await spend.summary()).spentMicroUsd).toBe(1_000);
    });

    it('a 2-attempt response keeps the whole hold', async () => {
      const spend = ledgerOver(memoryVault());
      await sendWithinAllowance(spend, over({ 'x-olea-attempts': '2' }), request);
      expect((await spend.summary()).spentMicroUsd).toBe(Math.round(EXTRACT_HOLD * 1e6));
    });

    it('an absent count keeps the whole hold, as today', async () => {
      const spend = ledgerOver(memoryVault());
      await sendWithinAllowance(spend, over(), request);
      expect((await spend.summary()).spentMicroUsd).toBe(Math.round(EXTRACT_HOLD * 1e6));
    });
  });

  it('the caller’s payload is sent as given', async () => {
    const spend = ledgerOver(memoryVault());
    const t = new RecordingTransport(refused);
    const payload = { sourceChunks: ['A.'], documentKind: 'objectives' };
    await sendWithinAllowance(spend, t, {
      contractVersion: 1,
      taskId: 'outcomes.extract.v1',
      payload,
    });
    expect(t.sent[0]?.payload).toEqual(payload);
    expect(t.sent[0]?.contractVersion).toBe(1);
  });
});
