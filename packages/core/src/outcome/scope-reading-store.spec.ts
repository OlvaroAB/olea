import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { scopeReadingLogPath } from './scope-reading-log.js';
import {
  alignmentResultView,
  documentStateView,
  partDemandView,
  structureView,
} from './scope-reading-project.js';
import { createScopeReadingStore } from './scope-reading-store.js';
import type {
  AlignmentDigests,
  AlignmentResultPayload,
  ScopePaperStructure,
  ScopeReaderProvenance,
  ScopeSourceRef,
} from './scope-reading-types.js';
import { listOutcomeRecords } from './store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md, F8.1 / F4.1, filed as owed on the D-429
// build bead. Synthetic ids only.

const PAPER = (revisionDigest: string): ScopeSourceRef => ({
  sourcePath: 'doc-a',
  revisionDigest,
  documentKind: 'past-paper',
});
const OBJECTIVES = (revisionDigest: string): ScopeSourceRef => ({
  sourcePath: 'doc-o',
  revisionDigest,
  documentKind: 'objectives',
});
const READER: ScopeReaderProvenance = {
  task: 'outcomes.extract.v1',
  promptVersion: '1.1.0',
  modelId: 'm',
};
const ALIGNER: ScopeReaderProvenance = {
  task: 'outcomes.align.v1',
  promptVersion: '1.0.0',
  modelId: 'm',
};
const READING: ScopePaperStructure = {
  sections: [],
  totalMarks: { status: 'unknown' },
  timeAllowance: { status: 'unknown' },
};
const DIGESTS: AlignmentDigests = {
  closedList: 'L1',
  coverage: 'C1',
  batchPlan: 'B1',
  frozenConfiguration: 'F1',
};

let root: string;
let vault: FolderSource;
let tick = 0;
const now = () => `2026-09-29T00:00:${String(tick++).padStart(2, '0')}.000Z`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-scope-reading-store-'));
  vault = new FolderSource(root);
  tick = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const store = (deviceId = 'dev-a') => createScopeReadingStore(vault, { deviceId, now });
const alignmentPayload = (
  source: ScopeSourceRef,
  conceptKey: string,
  result: AlignmentResultPayload['result'],
  digests = DIGESTS,
): AlignmentResultPayload => ({
  source,
  courseId: 'course-1',
  conceptKey,
  result,
  digests,
  coverage: { unitsNotRead: [], pairsNotSent: [] },
  ...(result.kind === 'pending' ? {} : { provenance: ALIGNER }),
});

describe('the document state store', () => {
  it('persists a state and reads it back through the projection', async () => {
    await store().recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'pending', reason: 'unavailable' },
    });
    const projection = await store().load();
    expect(documentStateView(projection, PAPER('r1'))).toMatchObject({
      status: 'known',
      state: { kind: 'pending', reason: 'unavailable' },
    });
  });

  it('keeps pending, read-states-nothing and never-registered as three different answers', async () => {
    const s = store();
    await s.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'pending', reason: 'over-budget' },
    });
    await s.recordDocumentState({
      source: OBJECTIVES('r1'),
      state: { kind: 'read-states-nothing' },
      provenance: READER,
    });
    const p = await s.load();
    expect(documentStateView(p, PAPER('r1'))).toMatchObject({ state: { kind: 'pending' } });
    expect(documentStateView(p, OBJECTIVES('r1'))).toMatchObject({
      state: { kind: 'read-states-nothing' },
    });
    expect(documentStateView(p, PAPER('r9')).status).toBe('unknown');
  });

  it('appends nothing for an unchanged state, so re-reading an unchanged document writes nothing', async () => {
    const s = store();
    const first = await s.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'registered' },
    });
    const again = await s.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'registered' },
    });
    expect([first.appended, again.appended]).toEqual([true, false]);
    const text = await readFile(join(root, scopeReadingLogPath('document-state', 'dev-a')), 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('requires a model-produced state to carry its reader provenance, and refuses nonsense counts', async () => {
    const s = store();
    await expect(
      s.recordDocumentState({ source: PAPER('r1'), state: { kind: 'recorded' } }),
    ).rejects.toThrow(/provenance/);
    await expect(
      s.recordDocumentState({ source: PAPER('r1'), state: { kind: 'read-states-nothing' } }),
    ).rejects.toThrow(/provenance/);
    await expect(
      s.recordDocumentState({
        source: PAPER('r1'),
        state: { kind: 'partly-read', unitsRead: 5, unitsTotal: 3 },
      }),
    ).rejects.toThrow(/units/);
    await expect(
      s.recordDocumentState({
        source: { ...PAPER('r1'), revisionDigest: '' },
        state: { kind: 'registered' },
      }),
    ).rejects.toThrow(/not a valid/);
  });
});

describe('the paper-structure store', () => {
  it('persists a reading with its provenance and hands back the id demand records are read against', async () => {
    const s = store();
    const written = await s.recordPaperStructure({
      source: PAPER('r1'),
      provenance: READER,
      reading: READING,
    });
    const view = structureView(await s.load(), PAPER('r1'));
    expect(view).toMatchObject({
      status: 'current',
      provenance: READER,
      structureId: written.structureId,
    });
  });

  it('holds only a past paper: an objectives document has declarations, not a paper structure', async () => {
    await expect(
      store().recordPaperStructure({
        source: OBJECTIVES('r1'),
        provenance: READER,
        reading: READING,
      }),
    ).rejects.toThrow(/past paper/);
  });

  it('keeps a part demand against the structure it was read from, and invalidates it when the structure is replaced', async () => {
    const s = store();
    const first = await s.recordPaperStructure({
      source: PAPER('r1'),
      provenance: READER,
      reading: READING,
    });
    await s.recordPartDemand({
      source: PAPER('r1'),
      partId: 'p1',
      structureId: first.structureId,
      demand: { status: 'unsupported', commandWord: 'discuss', refs: [2] },
      provenance: { task: 'demand.classify.v1', promptVersion: '1.0.0', modelId: 'm' },
    });
    expect(partDemandView(await s.load(), PAPER('r1'), 'p1')).toMatchObject({
      status: 'current',
      demand: { status: 'unsupported', commandWord: 'discuss' },
    });

    await s.recordPaperStructure({
      source: PAPER('r1'),
      provenance: { ...READER, promptVersion: '1.2.0' },
      reading: { ...READING, totalMarks: { status: 'stated', value: 50 } },
    });
    expect(partDemandView(await s.load(), PAPER('r1'), 'p1')).toEqual({ status: 'stale' });
  });

  it('invalidates a reading when the document changes: the new revision finds nothing current', async () => {
    const s = store();
    await s.recordPaperStructure({ source: PAPER('r1'), provenance: READER, reading: READING });
    expect(structureView(await s.load(), PAPER('r2'))).toEqual({ status: 'stale-revision' });
  });
});

describe('the alignment result store', () => {
  it('persists a batch in one write and reads each result back against its digests', async () => {
    const s = store();
    const out = await s.recordAlignmentResults([
      alignmentPayload(OBJECTIVES('r1'), 'k1', { kind: 'aligned', recordIds: ['d1'], refs: [2] }),
      alignmentPayload(OBJECTIVES('r1'), 'k2', { kind: 'not-aligned', reason: 'searched' }),
      alignmentPayload(OBJECTIVES('r1'), 'k3', { kind: 'pending', reason: 'run-cap' }),
    ]);
    expect(out).toEqual({ appended: 3, unchanged: 0 });
    const p = await s.load();
    const query = (conceptKey: string) => ({
      courseId: 'course-1',
      source: OBJECTIVES('r1'),
      conceptKey,
    });
    expect(alignmentResultView(p, query('k1'), DIGESTS)).toMatchObject({
      status: 'current',
      result: { kind: 'aligned' },
    });
    expect(alignmentResultView(p, query('k3'), DIGESTS)).toMatchObject({
      result: { kind: 'pending', reason: 'run-cap' },
    });
    const text = await readFile(
      join(root, scopeReadingLogPath('alignment-result', 'dev-a')),
      'utf8',
    );
    expect(text.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('reruns write nothing for unchanged results, and a changed closed list leaves the old result unverified until superseded', async () => {
    const s = store();
    const aligned = alignmentPayload(OBJECTIVES('r1'), 'k1', {
      kind: 'aligned',
      recordIds: ['d1'],
      refs: [2],
    });
    await s.recordAlignmentResults([aligned]);
    expect(await s.recordAlignmentResults([aligned])).toEqual({ appended: 0, unchanged: 1 });

    const p = await s.load();
    const q = { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k1' };
    expect(alignmentResultView(p, q, { ...DIGESTS, closedList: 'L2' })).toMatchObject({
      status: 'unverified',
      stale: ['closedList'],
    });

    await s.recordAlignmentResults([
      alignmentPayload(
        OBJECTIVES('r1'),
        'k1',
        { kind: 'not-aligned', reason: 'searched' },
        { ...DIGESTS, closedList: 'L2' },
      ),
    ]);
    expect(alignmentResultView(await s.load(), q, { ...DIGESTS, closedList: 'L2' })).toMatchObject({
      status: 'current',
      result: { kind: 'not-aligned' },
    });
  });

  it('refuses an aligned result that cites nothing, and a model verdict with no provenance', async () => {
    const s = store();
    await expect(
      s.recordAlignmentResults([
        alignmentPayload(OBJECTIVES('r1'), 'k1', { kind: 'aligned', recordIds: [], refs: [] }),
      ]),
    ).rejects.toThrow(/cite/);
    const noProvenance = alignmentPayload(OBJECTIVES('r1'), 'k1', {
      kind: 'not-aligned',
      reason: 'searched',
    });
    const { provenance: _dropped, ...withoutProvenance } = noProvenance;
    await expect(s.recordAlignmentResults([withoutProvenance])).rejects.toThrow(/provenance/);
  });

  it('refuses a past-paper result with no structure id, and needs none on an objectives result ([D-534])', async () => {
    const s = store();
    const result = { kind: 'not-aligned', reason: 'searched' } as const;
    await expect(
      s.recordAlignmentResults([
        alignmentPayload(OBJECTIVES('r1'), 'k0', result),
        alignmentPayload(PAPER('r1'), 'k1', result),
      ]),
    ).rejects.toThrow(/structure/);
    const view = alignmentResultView(
      await s.load(),
      { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k0' },
      DIGESTS,
    );
    expect(view.status).toBe('none');
    expect(
      await s.recordAlignmentResults([
        { ...alignmentPayload(PAPER('r1'), 'k1', result), structureId: 'e9' },
      ]),
    ).toEqual({ appended: 1, unchanged: 0 });
    expect(
      await s.recordAlignmentResults([alignmentPayload(OBJECTIVES('r1'), 'k0', result)]),
    ).toEqual({ appended: 1, unchanged: 0 });
  });

  it('writes nothing at all when one payload in the batch is invalid', async () => {
    const s = store();
    await expect(
      s.recordAlignmentResults([
        alignmentPayload(OBJECTIVES('r1'), 'k1', { kind: 'not-aligned', reason: 'searched' }),
        alignmentPayload(OBJECTIVES('r1'), 'k2', { kind: 'aligned', recordIds: [], refs: [] }),
      ]),
    ).rejects.toThrow();
    const view = alignmentResultView(
      await s.load(),
      { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k1' },
      DIGESTS,
    );
    expect(view.status).toBe('none');
  });
});

describe('two devices, one vault (the multi-device property)', () => {
  it('fold to the same projection from either device, whichever file is read first', async () => {
    const a = store('dev-a');
    const b = store('dev-b');
    await a.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'pending', reason: 'unavailable' },
    });
    await b.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'recorded' },
      provenance: READER,
    });
    await a.recordDocumentState({ source: OBJECTIVES('r1'), state: { kind: 'registered' } });

    const fromA = await a.load();
    const fromB = await b.load();
    for (const source of [PAPER('r1'), OBJECTIVES('r1')]) {
      expect(documentStateView(fromA, source)).toEqual(documentStateView(fromB, source));
    }
    // dev-b wrote after reading dev-a's pending state, so its clock is higher and its state wins.
    expect(documentStateView(fromA, PAPER('r1'))).toMatchObject({ state: { kind: 'recorded' } });
  });

  it('a device that read the other write sorts after it even when its own wall clock runs behind', async () => {
    const a = createScopeReadingStore(vault, {
      deviceId: 'dev-a',
      now: () => '2026-09-29T12:00:00.000Z',
    });
    const behind = createScopeReadingStore(vault, {
      deviceId: 'dev-b',
      now: () => '2020-01-01T00:00:00.000Z',
    });
    await a.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'pending', reason: 'unavailable' },
    });
    await behind.recordDocumentState({
      source: PAPER('r1'),
      state: { kind: 'recorded' },
      provenance: READER,
    });
    expect(documentStateView(await a.load(), PAPER('r1'))).toMatchObject({
      state: { kind: 'recorded' },
    });
  });
});

describe('the files are Olea layer records, nothing else', () => {
  it('are never read as Outcome records', async () => {
    await store().recordDocumentState({ source: PAPER('r1'), state: { kind: 'registered' } });
    expect(await listOutcomeRecords(vault)).toEqual([]);
  });

  it('reads an empty vault as nothing known, not as an error', async () => {
    const p = await store().load();
    expect(documentStateView(p, PAPER('r1'))).toEqual({
      status: 'unknown',
      otherRevisionsRecorded: false,
    });
    expect(structureView(p, PAPER('r1'))).toEqual({ status: 'absent' });
  });
});
