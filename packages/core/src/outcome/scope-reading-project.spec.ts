import { describe, expect, it } from 'vitest';
import type { ScopeReadingLogEntry } from './scope-reading-log.js';
import {
  alignmentFreshness,
  alignmentResultKey,
  alignmentResultsForDocument,
  alignmentResultView,
  documentStateKey,
  documentStateView,
  paperStructureKey,
  partDemandKey,
  partDemandView,
  projectScopeReadings,
  type ScopeReadingLogs,
  structureView,
} from './scope-reading-project.js';
import type {
  AlignmentDigests,
  AlignmentResultPayload,
  DocumentStatePayload,
  PaperStructurePayload,
  PartDemandPayload,
  ScopePaperStructure,
  ScopeReaderProvenance,
  ScopeSourceRef,
} from './scope-reading-types.js';

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
const READER_V2: ScopeReaderProvenance = { ...READER, promptVersion: '1.2.0' };

const READING: ScopePaperStructure = {
  sections: [
    {
      label: 'Section',
      questionForm: 'short answer',
      itemCount: 2,
      marks: { status: 'unknown' },
      anchor: { unitIndex: 0 },
    },
  ],
  totalMarks: { status: 'unknown' },
  timeAllowance: { status: 'unknown' },
};

let clock = 0;
function entry<T>(
  store: 'state' | 'structure' | 'demand' | 'alignment',
  key: string,
  payload: T,
  overrides: Partial<ScopeReadingLogEntry> = {},
): ScopeReadingLogEntry {
  clock += 1;
  const kind = {
    state: 'document-state',
    structure: 'structure',
    demand: 'part-demand',
    alignment: 'alignment-result',
  }[store];
  return {
    schemaVersion: 1,
    eventId: `e${clock}`,
    clock,
    recordedAt: `2026-09-29T00:00:${String(clock).padStart(2, '0')}.000Z`,
    kind,
    key,
    payload: payload as object,
    deviceId: 'dev-a',
    ...overrides,
  };
}

const state = (
  source: ScopeSourceRef,
  s: DocumentStatePayload['state'],
  provenance?: ScopeReaderProvenance,
) =>
  entry('state', documentStateKey(source), {
    source,
    state: s,
    ...(provenance ? { provenance } : {}),
  } satisfies DocumentStatePayload);
const structure = (source: ScopeSourceRef, provenance = READER) =>
  entry('structure', paperStructureKey(source), {
    source,
    provenance,
    reading: READING,
  } satisfies PaperStructurePayload);
const demand = (
  source: ScopeSourceRef,
  partId: string,
  structureId: string,
  d: PartDemandPayload['demand'],
) =>
  entry('demand', partDemandKey(source, partId), {
    source,
    partId,
    structureId,
    demand: d,
    provenance: READER,
  } satisfies PartDemandPayload);

const DIGESTS: AlignmentDigests = {
  closedList: 'L1',
  coverage: 'C1',
  batchPlan: 'B1',
  frozenConfiguration: 'F1',
};
const alignment = (
  source: ScopeSourceRef,
  conceptKey: string,
  result: AlignmentResultPayload['result'],
  digests: AlignmentDigests = DIGESTS,
) =>
  entry('alignment', alignmentResultKey('course-1', source, conceptKey), {
    source,
    courseId: 'course-1',
    conceptKey,
    result,
    digests,
    coverage: { unitsNotRead: [], pairsNotSent: [] },
    provenance: { task: 'outcomes.align.v1', promptVersion: '1.0.0', modelId: 'm' },
  } satisfies AlignmentResultPayload);

function logs(
  parts: Partial<Record<keyof ScopeReadingLogs, ScopeReadingLogEntry[]>>,
): ScopeReadingLogs {
  return { documentState: [], paperStructure: [], alignmentResult: [], ...parts };
}

describe("a document revision's processing state: pending, empty and unknown are three things", () => {
  it('reads unknown, never states-nothing, when no record exists for the revision', () => {
    const view = documentStateView(projectScopeReadings(logs({})), PAPER('r1'));
    expect(view).toEqual({ status: 'unknown', otherRevisionsRecorded: false });
  });

  it('keeps pending (extraction owed), read-states-nothing (an empty result) and unknown apart', () => {
    const p = projectScopeReadings(
      logs({
        documentState: [
          state(PAPER('r1'), { kind: 'pending', reason: 'unavailable' }),
          state(OBJECTIVES('r1'), { kind: 'read-states-nothing' }, READER),
        ],
      }),
    );
    expect(documentStateView(p, PAPER('r1'))).toMatchObject({
      status: 'known',
      state: { kind: 'pending', reason: 'unavailable' },
    });
    expect(documentStateView(p, OBJECTIVES('r1'))).toMatchObject({
      status: 'known',
      state: { kind: 'read-states-nothing' },
    });
    expect(documentStateView(p, PAPER('never-seen')).status).toBe('unknown');
  });

  it('never lets an older revision speak for the current one, but says an older one was recorded', () => {
    const p = projectScopeReadings(
      logs({ documentState: [state(PAPER('r1'), { kind: 'recorded' }, READER)] }),
    );
    expect(documentStateView(p, PAPER('r2'))).toEqual({
      status: 'unknown',
      otherRevisionsRecorded: true,
    });
  });

  it('lets a newer state supersede an older one for the same revision, keeping history in the log', () => {
    const p = projectScopeReadings(
      logs({
        documentState: [
          state(PAPER('r1'), { kind: 'registered' }),
          state(PAPER('r1'), { kind: 'pending', reason: 'over-budget' }),
          state(PAPER('r1'), { kind: 'recorded' }, READER),
        ],
      }),
    );
    expect(documentStateView(p, PAPER('r1'))).toMatchObject({
      state: { kind: 'recorded' },
      provenance: READER,
    });
  });

  it('a role change is a different document: the same path and revision as objectives does not read as the paper', () => {
    const asPaper = PAPER('r1');
    const asObjectives = { ...asPaper, documentKind: 'objectives' as const };
    const p = projectScopeReadings(
      logs({ documentState: [state(asPaper, { kind: 'recorded' }, READER)] }),
    );
    expect(documentStateView(p, asObjectives).status).toBe('unknown');
  });

  it('is the same whatever order the log entries arrive in', () => {
    const entries = [
      state(PAPER('r1'), { kind: 'registered' }),
      state(PAPER('r1'), { kind: 'pending', reason: 'failed' }),
    ];
    const a = documentStateView(
      projectScopeReadings(logs({ documentState: entries })),
      PAPER('r1'),
    );
    const b = documentStateView(
      projectScopeReadings(logs({ documentState: [...entries].reverse() })),
      PAPER('r1'),
    );
    expect(a).toEqual(b);
  });

  it('two devices writing the same key at the same clock fold to one deterministic winner', () => {
    const a = state(PAPER('r1'), { kind: 'pending', reason: 'failed' });
    const b = state(PAPER('r1'), { kind: 'recorded' }, READER);
    const same = [
      { ...a, clock: 9, deviceId: 'dev-a' },
      { ...b, clock: 9, deviceId: 'dev-b' },
    ];
    const one = documentStateView(projectScopeReadings(logs({ documentState: same })), PAPER('r1'));
    const two = documentStateView(
      projectScopeReadings(logs({ documentState: [...same].reverse() })),
      PAPER('r1'),
    );
    expect(one).toEqual(two);
    expect(one).toMatchObject({ state: { kind: 'recorded' } });
  });

  it('skips a stored payload that is not the shape it claims, rather than reading it as a state', () => {
    const bad = entry('state', documentStateKey(PAPER('r1')), { nope: true });
    expect(
      documentStateView(projectScopeReadings(logs({ documentState: [bad] })), PAPER('r1')).status,
    ).toBe('unknown');
  });
});

describe('the paper-structure reading and its staleness', () => {
  it('is absent until a reading is recorded for the current revision', () => {
    expect(structureView(projectScopeReadings(logs({})), PAPER('r1'))).toEqual({
      status: 'absent',
    });
  });

  it('serves a current reading with its provenance and the id a demand is read against', () => {
    const s = structure(PAPER('r1'));
    const view = structureView(projectScopeReadings(logs({ paperStructure: [s] })), PAPER('r1'));
    expect(view).toMatchObject({ status: 'current', provenance: READER, structureId: s.eventId });
    expect(view.status === 'current' && view.reading).toEqual(READING);
  });

  it('invalidates a reading made from an older revision: stale, and the reading is not handed out', () => {
    const p = projectScopeReadings(logs({ paperStructure: [structure(PAPER('r1'))] }));
    const view = structureView(p, PAPER('r2'));
    expect(view).toEqual({ status: 'stale-revision' });
    expect('reading' in view).toBe(false);
  });

  it('invalidates a reading by a reader version the caller no longer accepts, keeping it visible as stale', () => {
    const p = projectScopeReadings(logs({ paperStructure: [structure(PAPER('r1'), READER)] }));
    expect(structureView(p, PAPER('r1'), { acceptedReaderVersions: ['1.2.0'] }).status).toBe(
      'stale-reader',
    );
    expect(
      structureView(p, PAPER('r1'), { acceptedReaderVersions: ['1.1.0', '1.2.0'] }).status,
    ).toBe('current');
    expect(structureView(p, PAPER('r1')).status).toBe('current');
  });

  it('a newer reading of the same revision supersedes the older', () => {
    const older = structure(PAPER('r1'), READER);
    const newer = structure(PAPER('r1'), READER_V2);
    const view = structureView(
      projectScopeReadings(logs({ paperStructure: [older, newer] })),
      PAPER('r1'),
    );
    expect(view).toMatchObject({ status: 'current', provenance: READER_V2 });
  });
});

describe('demand per part, read against a structure', () => {
  const decided = { status: 'decided', demand: 'calculate', refs: [3] } as const;

  it('is not yet read when no record exists: absence, never a verdict', () => {
    const p = projectScopeReadings(logs({ paperStructure: [structure(PAPER('r1'))] }));
    expect(partDemandView(p, PAPER('r1'), 'p1')).toEqual({ status: 'not-yet-read' });
  });

  it('serves a demand read against the current structure, and keeps an unsupported operation with its command word', () => {
    const s = structure(PAPER('r1'));
    const p = projectScopeReadings(
      logs({
        paperStructure: [
          s,
          demand(PAPER('r1'), 'p1', s.eventId, decided),
          demand(PAPER('r1'), 'p2', s.eventId, {
            status: 'unsupported',
            commandWord: 'discuss',
            refs: [4],
          }),
        ],
      }),
    );
    expect(partDemandView(p, PAPER('r1'), 'p1')).toMatchObject({
      status: 'current',
      demand: decided,
    });
    expect(partDemandView(p, PAPER('r1'), 'p2')).toMatchObject({
      status: 'current',
      demand: { status: 'unsupported', commandWord: 'discuss' },
    });
  });

  it('invalidates a demand read against a structure that has since been replaced', () => {
    const old = structure(PAPER('r1'), READER);
    const replaced = structure(PAPER('r1'), READER_V2);
    const p = projectScopeReadings(
      logs({ paperStructure: [old, demand(PAPER('r1'), 'p1', old.eventId, decided), replaced] }),
    );
    expect(partDemandView(p, PAPER('r1'), 'p1')).toEqual({ status: 'stale' });
  });

  it('a demand for a revision with no current structure is stale, never current', () => {
    const s = structure(PAPER('r1'));
    const p = projectScopeReadings(
      logs({ paperStructure: [s, demand(PAPER('r1'), 'p1', s.eventId, decided)] }),
    );
    expect(partDemandView(p, PAPER('r2'), 'p1')).toEqual({ status: 'not-yet-read' });
  });
});

describe('alignment results are current only against the digests they were made under', () => {
  const aligned = { kind: 'aligned', recordIds: ['r1'], refs: [2] } as const;

  it('reads none when no result exists, which is not the same as a pending result', () => {
    const p = projectScopeReadings(
      logs({
        alignmentResult: [
          alignment(OBJECTIVES('r1'), 'k-pending', { kind: 'pending', reason: 'unavailable' }),
        ],
      }),
    );
    const q = (conceptKey: string) => ({
      courseId: 'course-1',
      source: OBJECTIVES('r1'),
      conceptKey,
    });
    expect(alignmentResultView(p, q('k-none'), DIGESTS)).toEqual({
      status: 'none',
      olderRevisionOnly: false,
    });
    expect(alignmentResultView(p, q('k-pending'), DIGESTS)).toMatchObject({
      status: 'current',
      result: { kind: 'pending', reason: 'unavailable' },
    });
  });

  it('reads current when every digest matches, and unverified, naming which, when one moved', () => {
    const p = projectScopeReadings(
      logs({ alignmentResult: [alignment(OBJECTIVES('r1'), 'k1', aligned)] }),
    );
    const q = { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k1' };
    expect(alignmentResultView(p, q, DIGESTS).status).toBe('current');
    expect(alignmentResultView(p, q, { ...DIGESTS, closedList: 'L2' })).toMatchObject({
      status: 'unverified',
      stale: ['closedList'],
    });
    expect(
      alignmentResultView(p, q, { ...DIGESTS, coverage: 'C2', frozenConfiguration: 'F2' }),
    ).toMatchObject({
      status: 'unverified',
      stale: ['coverage', 'frozenConfiguration'],
    });
  });

  it('checks only the digests the caller supplies (the batch plan need not match to stay current)', () => {
    const p = projectScopeReadings(
      logs({ alignmentResult: [alignment(OBJECTIVES('r1'), 'k1', aligned)] }),
    );
    const q = { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k1' };
    const { batchPlan: _omitted, ...withoutPlan } = DIGESTS;
    expect(alignmentResultView(p, q, withoutPlan).status).toBe('current');
  });

  it('says a result exists only for an older revision, and never serves it for the current one', () => {
    const p = projectScopeReadings(
      logs({ alignmentResult: [alignment(OBJECTIVES('r1'), 'k1', aligned)] }),
    );
    const view = alignmentResultView(
      p,
      { courseId: 'course-1', source: OBJECTIVES('r2'), conceptKey: 'k1' },
      DIGESTS,
    );
    expect(view).toEqual({ status: 'none', olderRevisionOnly: true });
  });

  it('a newer run supersedes an older result for the same concept, and courses do not mix', () => {
    const p = projectScopeReadings(
      logs({
        alignmentResult: [
          alignment(OBJECTIVES('r1'), 'k1', { kind: 'pending', reason: 'run-cap' }),
          alignment(OBJECTIVES('r1'), 'k1', aligned),
        ],
      }),
    );
    expect(
      alignmentResultView(
        p,
        { courseId: 'course-1', source: OBJECTIVES('r1'), conceptKey: 'k1' },
        DIGESTS,
      ),
    ).toMatchObject({
      result: { kind: 'aligned' },
    });
    expect(
      alignmentResultView(
        p,
        { courseId: 'course-2', source: OBJECTIVES('r1'), conceptKey: 'k1' },
        DIGESTS,
      ).status,
    ).toBe('none');
  });

  it('lists every result for a document revision with its standing, in concept order', () => {
    const p = projectScopeReadings(
      logs({
        alignmentResult: [
          alignment(OBJECTIVES('r1'), 'k2', aligned),
          alignment(
            OBJECTIVES('r1'),
            'k1',
            { kind: 'not-aligned', reason: 'searched' },
            { ...DIGESTS, closedList: 'old' },
          ),
          alignment(OBJECTIVES('r0'), 'k9', aligned),
        ],
      }),
    );
    const results = alignmentResultsForDocument(p, 'course-1', OBJECTIVES('r1'), DIGESTS);
    expect(results.map((r) => [r.conceptKey, r.status])).toEqual([
      ['k1', 'unverified'],
      ['k2', 'current'],
    ]);
  });
});

describe('a past-paper alignment result is current only against the structure it names ([D-534])', () => {
  const aligned = { kind: 'aligned', recordIds: ['part-1'], refs: [1] } as const;
  const q = { courseId: 'course-1', source: PAPER('r1'), conceptKey: 'k1' };
  const withStructure = (e: ScopeReadingLogEntry, structureId?: string): ScopeReadingLogEntry => ({
    ...e,
    payload: {
      ...(e.payload as Record<string, unknown>),
      ...(structureId !== undefined ? { structureId } : {}),
    },
  });

  it('reads current when the named structure is the current one, unverified otherwise', () => {
    const s1 = structure(PAPER('r1'));
    const current = projectScopeReadings(
      logs({
        paperStructure: [s1],
        alignmentResult: [withStructure(alignment(PAPER('r1'), 'k1', aligned), s1.eventId)],
      }),
    );
    expect(alignmentResultView(current, q, DIGESTS)).toMatchObject({
      status: 'current',
      structureId: s1.eventId,
    });

    const replaced = projectScopeReadings(
      logs({
        paperStructure: [s1, structure(PAPER('r1'), READER_V2)],
        alignmentResult: [withStructure(alignment(PAPER('r1'), 'k1', aligned), s1.eventId)],
      }),
    );
    expect(alignmentResultView(replaced, q, DIGESTS)).toMatchObject({
      status: 'unverified',
      stale: ['structure'],
    });
  });

  it('reads unverified with no structure at all, and for a result that names none', () => {
    const s1 = structure(PAPER('r1'));
    const none = projectScopeReadings(
      logs({ alignmentResult: [withStructure(alignment(PAPER('r1'), 'k1', aligned), 'e-gone')] }),
    );
    expect(alignmentResultView(none, q, DIGESTS)).toMatchObject({ status: 'unverified' });
    const unnamed = projectScopeReadings(
      logs({ paperStructure: [s1], alignmentResult: [alignment(PAPER('r1'), 'k1', aligned)] }),
    );
    expect(alignmentResultsForDocument(unnamed, 'course-1', PAPER('r1'), DIGESTS)[0]).toMatchObject(
      {
        status: 'unverified',
        stale: ['structure'],
      },
    );
  });

  it('never applies to an objectives result', () => {
    const p = projectScopeReadings(
      logs({ alignmentResult: [alignment(OBJECTIVES('r1'), 'k1', aligned)] }),
    );
    expect(alignmentResultView(p, { ...q, source: OBJECTIVES('r1') }, DIGESTS).status).toBe(
      'current',
    );
  });
});

describe('alignmentFreshness', () => {
  const payload = (digests: AlignmentDigests): AlignmentResultPayload => ({
    source: OBJECTIVES('r1'),
    courseId: 'course-1',
    conceptKey: 'k1',
    result: { kind: 'aligned', recordIds: [], refs: [] },
    digests,
    coverage: { unitsNotRead: [], pairsNotSent: [] },
  });

  it('names the revision when it moved, as well as any digest', () => {
    expect(alignmentFreshness(payload(DIGESTS), { revisionDigest: 'r2', ...DIGESTS })).toEqual({
      status: 'unverified',
      stale: ['revision'],
    });
    expect(alignmentFreshness(payload(DIGESTS), { revisionDigest: 'r1', ...DIGESTS })).toEqual({
      status: 'current',
    });
  });
});
