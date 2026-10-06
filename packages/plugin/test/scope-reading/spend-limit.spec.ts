/**
 * The scope-reading drivers behind the spend ledger (`ol-egov.141.89.7.76`, `[D-540]`). Scenarios:
 * F4.1, "at 80 percent of the limit the scope reads pause and what is left stays owed", "a refusal
 * count survives a restart", "the scope-reading drivers send nothing without a spend ledger", and the
 * driver half of "a ledger that cannot be read allows no call". Synthetic ids and wording only.
 */

import {
  alignmentResultsForDocument,
  partDemandView,
  spendLedgerPath,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { WorkerOutcomesExtractReader } from '../../src/ingestion/outcomes-extract-adapter.js';
import type { DocumentReadingBasis } from '../../src/scope-reading/basis.js';
import { runScopeReadingDrivers } from '../../src/scope-reading/drivers.js';
import type { DocumentRef, ExtractionRecordInput } from '../../src/scope-reading/persistence.js';
import { alignNewConcepts, resumeScopeReading } from '../../src/scope-reading/resume.js';
import type { SpendLedger } from '../../src/spend/vault-spend-ledger.js';
import { failing, ledgerOver, otherDeviceFile, THIS_DEVICE } from '../spend/spend-kit.js';
import {
  alignAll,
  COURSE,
  conceptNotes,
  demandAnswer,
  outcome,
  type Sent,
  STAMP,
  setup,
  transport,
  unit,
  unitsOf,
} from './drivers-kit.js';

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

// --- a past paper with two parts, registered to one course ---------------------------------------

const PAPER_REF: DocumentRef = {
  sourcePath: 'doc-paper',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
};
const paperUnits = [
  unit('Shared stem text.', 1),
  unit('Find the first quantity.', 1),
  unit('Find the second quantity.', 2),
];
const paper: ExtractionRecordInput = {
  sourcePath: 'doc-paper',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
  coverage: { unitsRead: 3, unitsTotal: 3 },
  declarationCount: 0,
  stamp: STAMP,
  paperStructure: {
    sections: [
      {
        label: 'One',
        questionForm: 'short answer',
        itemCount: 2,
        marks: 8,
        anchor: { blockIndex: 0 },
      },
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
};
const paperBasis: DocumentReadingBasis = {
  revisionDigest: 'r1',
  unitsRead: 3,
  unitsTotal: 3,
  pages: [1, 2],
};
const partIds = (sent: readonly Sent[]) =>
  sent
    .filter((s) => s.taskId === 'demand.classify.v1')
    .map((s) => (s.payload.part as { partId: string }).partId);
const refuseP1 = (x: Sent) =>
  x.taskId === 'demand.classify.v1' && (x.payload.part as { partId: string }).partId === 'p1'
    ? {
        ok: true,
        stamp: STAMP,
        result: { verdict: { kind: 'demand', demand: 'not-a-demand' }, refs: ['u1'] },
      }
    : x.taskId === 'demand.classify.v1'
      ? demandAnswer(x)
      : alignAll(x);

async function paperInput(
  files: Record<string, string>,
  spend?: (s: ReturnType<typeof setup>) => SpendLedger,
) {
  const s = setup({ ...conceptNotes(['Alpha idea']), ...files });
  const recorded = await s.persistence.recordExtraction(paper);
  const ledger = spend === undefined ? ledgerOver(s.vault) : spend(s);
  return {
    s,
    ledger,
    input: (t: ReturnType<typeof transport>, over: Record<string, unknown> = {}) => ({
      persistence: s.persistence,
      ref: PAPER_REF,
      basis: paperBasis,
      recorded,
      units: paperUnits,
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault: s.vault,
      spend: ledger,
      ...over,
    }),
  };
}

describe('at 80 percent of the limit the scope reads pause and what is left stays owed', () => {
  it('sends no demand or alignment request, writes no part demand, and leaves alignment pending', async () => {
    const { s, input } = await paperInput(otherDeviceFile(9.59));
    const t = transport((x) => (x.taskId === 'outcomes.align.v1' ? alignAll(x) : demandAnswer(x)));
    await quiet(() => runScopeReadingDrivers(input(t)));
    expect(t.sent).toEqual([]);
    const projection = await s.persistence.load();
    expect(partDemandView(projection, PAPER_REF, 'p1').status).toBe('not-yet-read');
    expect(partDemandView(projection, PAPER_REF, 'p2').status).toBe('not-yet-read');
    const views = alignmentResultsForDocument(projection, COURSE, PAPER_REF, {});
    expect(views.length).toBeGreaterThan(0);
    for (const view of views)
      expect(view.result).toEqual({ kind: 'pending', reason: 'unavailable' });
  });

  it('outcome extraction at the same spend is still sent', async () => {
    const { ledger } = await paperInput(otherDeviceFile(9.59));
    const sent: string[] = [];
    await new WorkerOutcomesExtractReader({
      transport: {
        send: async (request) => {
          sent.push(request.taskId);
          return { ok: false, code: 'upstream-error', message: 'synthetic' };
        },
      },
      spend: ledger,
    })
      .read({
        documentKind: 'past-paper',
        passages: [{ text: 'Find the first quantity.', anchor: { blockIndex: 0 } }],
      })
      .catch(() => undefined);
    expect(sent).toEqual(['outcomes.extract.v1']);
  });

  it('below the pause both drivers send, each request carrying its hold', async () => {
    const { input } = await paperInput(otherDeviceFile(1));
    const sent: WorkerTaskRequest[] = [];
    const t = transport((x) => (x.taskId === 'outcomes.align.v1' ? alignAll(x) : demandAnswer(x)));
    const watching: WorkerTaskTransport = {
      send: async (request) => {
        sent.push(request);
        return t.transport.send(request);
      },
    };
    await quiet(() => runScopeReadingDrivers(input(t, { transport: watching })));
    expect(sent.map((x) => x.taskId)).toEqual([
      'demand.classify.v1',
      'demand.classify.v1',
      'outcomes.align.v1',
    ]);
    for (const x of sent) expect(x.remainingAllowanceUsd).toBeGreaterThan(0);
  });
});

describe('a refusal count survives a restart', () => {
  it('a part refused twice is not sent after a restart, and the other part is still read', async () => {
    const { s, input } = await paperInput({});
    const one = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers(input(one)));
    const two = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers(input(two)));
    expect(partIds(two.sent)).toEqual(['p1']);

    // A restart: a fresh ledger reader over the same vault, nothing carried in memory.
    const restarted = ledgerOver(s.vault);
    const three = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers(input(three, { spend: restarted })));
    expect(partIds(three.sent)).toEqual([]);
    const four = transport(refuseP1);
    await quiet(() =>
      resumeScopeReading({ ...input(four, { spend: ledgerOver(s.vault) }), enabled: true }),
    );
    expect(partIds(four.sent)).toEqual([]);
    const projection = await s.persistence.load();
    expect(partDemandView(projection, PAPER_REF, 'p2').status).toBe('current');
  });

  it('an alignment batch answered unusably twice is not sent after a restart', async () => {
    const files = conceptNotes(['Alpha idea', 'Beta idea']);
    const s = setup(files);
    const recorded = await s.persistence.recordExtraction({
      sourcePath: 'doc-o',
      documentKind: 'objectives',
      revisionDigest: 'r1',
      coverage: { unitsRead: 4, unitsTotal: 4 },
      declarationCount: 2,
      paperStructure: { sections: [] },
      stamp: STAMP,
    });
    const unusable = {
      ok: true,
      stamp: STAMP,
      result: { batchId: 'wrong', coverageDigest: 'wrong', decisions: [] },
    };
    const base = (t: ReturnType<typeof transport>, spend: SpendLedger) => ({
      persistence: s.persistence,
      ref: { sourcePath: 'doc-o', documentKind: 'objectives', revisionDigest: 'r1' } as DocumentRef,
      basis: { revisionDigest: 'r1', unitsRead: 4, unitsTotal: 4, pages: [1, 2, 3, 4] },
      recorded,
      units: unitsOf(4),
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [outcome('outcome-key1:b', 2), outcome('outcome-key1:a', 1)],
      transport: t.transport,
      vault: s.vault,
      spend,
      enabled: true,
    });
    const ledger = ledgerOver(s.vault);
    const one = transport(() => unusable);
    await quiet(() => runScopeReadingDrivers(base(one, ledger)));
    const two = transport(() => unusable);
    await quiet(() => resumeScopeReading(base(two, ledger)));
    expect(two.sent.length).toBeGreaterThan(0);

    const three = transport(() => unusable);
    const out = await quiet(() => resumeScopeReading(base(three, ledgerOver(s.vault))));
    expect(three.sent).toEqual([]);
    expect(out.alignment?.heldBack).toBeGreaterThan(0);
  });

  it('the ledger holds the count as opaque keys only', async () => {
    const { s, input } = await paperInput({});
    await quiet(() => runScopeReadingDrivers(input(transport(refuseP1))));
    const bytes = await s.vault.read(spendLedgerPath(THIS_DEVICE));
    const refusals = bytes
      .split('\n')
      .filter((line) => line.includes('"refusal"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.refusalKey).toMatch(/^[0-9a-f]{64}$/);
    expect(refusals[0]?.taskId).toBe('demand.classify.v1');
    expect(bytes).not.toContain('p1');
    expect(bytes).not.toContain(COURSE);
  });
});

describe('the scope-reading drivers send nothing without a spend ledger', () => {
  it('the first-delivery path, the resume pass and the new-concept pass', async () => {
    const { s, input } = await paperInput({});
    const t = transport((x) => (x.taskId === 'outcomes.align.v1' ? alignAll(x) : demandAnswer(x)));
    await quiet(() => runScopeReadingDrivers(input(t, { spend: undefined })));
    expect(
      await quiet(() => resumeScopeReading({ ...input(t, { spend: undefined }), enabled: true })),
    ).toEqual({ outcome: 'no-spend-ledger' });
    expect(
      await quiet(() => alignNewConcepts({ ...input(t, { spend: undefined }), enabled: true })),
    ).toEqual({ outcome: 'no-spend-ledger' });
    expect(t.sent).toEqual([]);
    const projection = await s.persistence.load();
    expect(projection.partDemands.size).toBe(0);
    expect(projection.alignments.size).toBe(0);
  });

  it('a ledger that cannot be read: nothing sent, nothing given a verdict', async () => {
    const { s, input } = await paperInput({}, (x) => ledgerOver(failing(x.vault, { list: true })));
    const t = transport((x) => (x.taskId === 'outcomes.align.v1' ? alignAll(x) : demandAnswer(x)));
    await quiet(() => runScopeReadingDrivers(input(t)));
    expect(t.sent).toEqual([]);
    const projection = await s.persistence.load();
    expect(projection.partDemands.size).toBe(0);
  });
});
