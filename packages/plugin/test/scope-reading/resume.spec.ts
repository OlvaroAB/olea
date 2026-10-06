/**
 * Resume pass tests (`ol-egov.141.89.7.73`). Scenarios: F4.1, "the resume pass reads only the parts with
 * no demand for the current structure", "a part refused twice is not retried", "a structure that has
 * been replaced owes its parts again", "the resume pass sends only the concepts whose alignment is owed",
 * "the concepts past the run cap are read first", "a pass that cannot shrink the remainder does not spend
 * again", "a concept new to the course is aligned on its own", "nothing owed sends nothing", "the resume
 * pass stays behind the drivers' off switch". Synthetic ids and wording only.
 */

import { alignmentResultsForDocument, partDemandView } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentReadingBasis } from '../../src/scope-reading/basis.js';
import type { ClosedListConcept } from '../../src/scope-reading/closed-list.js';
import { runDemandDriver } from '../../src/scope-reading/demand-driver.js';
import type { DocumentRef, ExtractionRecordInput } from '../../src/scope-reading/persistence.js';
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

const hoisted = vi.hoisted(() => ({ replace: undefined as unknown[] | undefined }));

vi.mock('../../src/scope-reading/closed-list.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/scope-reading/closed-list.js')>();
  return {
    ...actual,
    buildClosedList: async (...args: Parameters<typeof actual.buildClosedList>) =>
      hoisted.replace ?? (await actual.buildClosedList(...args)),
  };
});

const { runAlignmentDriver } = await import('../../src/scope-reading/alignment-driver.js');
const { resumeScopeReading, alignNewConcepts } = await import('../../src/scope-reading/resume.js');
const { inMemoryRefusalLedger } = await import('../../src/scope-reading/demand-driver.js');

const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const spy = console.error;
  console.error = () => undefined;
  try {
    return await f();
  } finally {
    console.error = spy;
  }
};

const keyed = (n: number): ClosedListConcept[] =>
  Array.from({ length: n }, (_, i) => ({
    conceptId: `concept-key1:k${String(i).padStart(3, '0')}`,
    key: `concept-key1:k${String(i).padStart(3, '0')}`,
    stableKey: true,
    name: `Idea ${i}`,
    attribution: { courseId: COURSE, courseName: COURSE },
    source: {},
  }));

// ---------------------------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------------------------

const PAPER_REF: DocumentRef = {
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
};

const paperUnits = [
  unit('Section heading text.', 1),
  unit('Shared stem text.', 1),
  unit('A table of invented numbers.', 1),
  unit('Find the first quantity.', 2),
  unit('Use that to find the second quantity.', 2),
  unit('Second group stem text.', 3),
  unit('Compare the two options.', 3),
];

const paper = (p1Marks = 4): ExtractionRecordInput => ({
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
  coverage: { unitsRead: 7, unitsTotal: 7 },
  declarationCount: 0,
  stamp: STAMP,
  paperStructure: {
    sections: [
      {
        label: 'One',
        questionForm: 'short answer',
        itemCount: 3,
        marks: 12,
        anchor: { blockIndex: 0 },
      },
    ],
    questionGroups: [
      {
        id: 'sec',
        kind: 'section',
        label: 'Section one',
        memberLabels: [],
        anchor: { blockIndex: 0 },
        stimulus: { status: 'none' },
      },
      {
        id: 'g1',
        kind: 'shared-stimulus',
        label: 'Q1',
        parentGroupId: 'sec',
        memberLabels: ['1a', '1b'],
        anchor: { blockIndex: 1 },
        stimulus: { status: 'identified', form: 'table', anchor: { blockIndex: 2 } },
      },
      {
        id: 'g2',
        kind: 'parent-question',
        label: 'Q2',
        parentGroupId: 'sec',
        memberLabels: ['2'],
        anchor: { blockIndex: 5 },
        stimulus: { status: 'none' },
      },
    ],
    questionParts: [
      {
        id: 'p1',
        label: '1a',
        groupId: 'g1',
        instructionAnchor: { blockIndex: 3 },
        questionForm: 'short answer',
        marks: p1Marks,
      },
      {
        id: 'p2',
        label: '1b',
        groupId: 'g1',
        instructionAnchor: { blockIndex: 4 },
        questionForm: 'short answer',
      },
      {
        id: 'p3',
        label: '2',
        groupId: 'g2',
        instructionAnchor: { blockIndex: 6 },
        questionForm: 'short answer',
        marks: 4,
      },
    ],
  },
});

const partIds = (sent: readonly Sent[]) =>
  sent.map((s) => (s.payload.part as { partId: string }).partId);

const paperBasis: DocumentReadingBasis = {
  revisionDigest: 'r1',
  unitsRead: 7,
  unitsTotal: 7,
  pages: [1, 2, 3],
};

function resumeInputFor(
  s: ReturnType<typeof setup>,
  t: ReturnType<typeof transport>,
  over: Record<string, unknown> = {},
) {
  return {
    persistence: s.persistence,
    ref: PAPER_REF,
    basis: paperBasis,
    units: paperUnits,
    deliveryRevisionDigest: 'r1',
    courses: [] as string[],
    declarations: [],
    transport: t.transport,
    vault: s.vault,
    enabled: true,
    ...over,
  };
}

describe('the resume pass, part demands', () => {
  it('reads only the parts with no demand for the current structure', async () => {
    const s = setup();
    const recorded = await s.persistence.recordExtraction(paper());
    const first = transport((x) => demandAnswer(x));
    // Only the first part's units landed with the first delivery.
    await runDemandDriver({
      persistence: s.persistence,
      ref: PAPER_REF,
      recorded,
      units: paperUnits.slice(0, 4),
      transport: first.transport,
    });
    expect(partIds(first.sent)).toEqual(['p1']);

    const t = transport((x) => demandAnswer(x));
    const out = await resumeScopeReading(resumeInputFor(s, t));
    expect(out.outcome).toBe('ran');
    expect(partIds(t.sent)).toEqual(['p2', 'p3']);
    const projection = await s.persistence.load();
    for (const id of ['p1', 'p2', 'p3']) {
      expect(partDemandView(projection, PAPER_REF, id).status).toBe('current');
    }
  });

  it('does not retry a part the reader refused twice, and still reads the other owed parts', async () => {
    const s = setup();
    await s.persistence.recordExtraction(paper());
    const refusals = inMemoryRefusalLedger();
    const refuseP1 = (x: Sent) =>
      (x.payload.part as { partId: string }).partId === 'p1'
        ? {
            ok: true,
            stamp: STAMP,
            result: { verdict: { kind: 'demand', demand: 'not-a-demand' }, refs: ['u3'] },
          }
        : demandAnswer(x);

    // Pass one: p1 refused (1), p2 and p3 read. Pass two: p1 refused again (2).
    const one = transport(refuseP1);
    await quiet(() => resumeScopeReading(resumeInputFor(s, one, { refusals })));
    expect(partIds(one.sent)).toEqual(['p1', 'p2', 'p3']);
    const two = transport(refuseP1);
    await quiet(() => resumeScopeReading(resumeInputFor(s, two, { refusals })));
    expect(partIds(two.sent)).toEqual(['p1']);

    // Pass three: held back, nothing sent.
    const three = transport(refuseP1);
    const out = await resumeScopeReading(resumeInputFor(s, three, { refusals }));
    expect(three.sent).toHaveLength(0);
    expect(out.demand).toMatchObject({ sent: 0, heldBack: 1 });
    expect(partDemandView(await s.persistence.load(), PAPER_REF, 'p1').status).toBe('not-yet-read');
  });

  it('owes every part of a replaced structure again, whatever was refused against the old one', async () => {
    const s = setup();
    const refusals = inMemoryRefusalLedger();
    await s.persistence.recordExtraction(paper());
    const one = transport((x) => demandAnswer(x));
    await resumeScopeReading(resumeInputFor(s, one, { refusals }));
    expect(one.sent).toHaveLength(3);

    await s.persistence.recordExtraction(paper(9));
    const two = transport((x) => demandAnswer(x));
    await resumeScopeReading(resumeInputFor(s, two, { refusals }));
    expect(partIds(two.sent)).toEqual(['p1', 'p2', 'p3']);
  });

  it('sends nothing when every part is settled', async () => {
    const s = setup();
    await s.persistence.recordExtraction(paper());
    const one = transport((x) => demandAnswer(x));
    await resumeScopeReading(resumeInputFor(s, one));
    const size = (await s.persistence.load()).partDemands.size;
    const two = transport((x) => demandAnswer(x));
    await resumeScopeReading(resumeInputFor(s, two));
    expect(two.sent).toHaveLength(0);
    expect((await s.persistence.load()).partDemands.size).toBe(size);
  });
});

// ---------------------------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------------------------

const OBJ_REF: DocumentRef = {
  sourcePath: 'doc-o',
  documentKind: 'objectives',
  revisionDigest: 'r1',
};

async function objectives(nUnits: number, nDecl: number) {
  const s = setup(conceptNotes(['Alpha idea']));
  const recorded = await s.persistence.recordExtraction({
    sourcePath: 'doc-o',
    documentKind: 'objectives',
    revisionDigest: 'r1',
    coverage: { unitsRead: nUnits, unitsTotal: nUnits },
    declarationCount: nDecl,
    paperStructure: { sections: [] },
    stamp: STAMP,
  });
  const units = unitsOf(nUnits);
  const declarations = Array.from({ length: nDecl }, (_, i) =>
    outcome(`outcome-key1:d${String(i).padStart(4, '0')}`, i),
  );
  const basis: DocumentReadingBasis = {
    revisionDigest: 'r1',
    unitsRead: nUnits,
    unitsTotal: nUnits,
    pages: Array.from({ length: nUnits }, (_, i) => i + 1),
  };
  const base = {
    persistence: s.persistence,
    ref: OBJ_REF,
    basis,
    units,
    deliveryRevisionDigest: 'r1',
    courses: [COURSE],
    declarations,
    vault: s.vault,
  };
  return {
    s,
    first: (t: ReturnType<typeof transport>) =>
      runAlignmentDriver({ ...base, recorded, transport: t.transport }),
    resume: (t: ReturnType<typeof transport>, over: Record<string, unknown> = {}) =>
      resumeScopeReading({ ...base, transport: t.transport, enabled: true, ...over }),
    newOnes: (t: ReturnType<typeof transport>, over: Record<string, unknown> = {}) =>
      alignNewConcepts({ ...base, transport: t.transport, enabled: true, ...over }),
    views: async () => alignmentResultsForDocument(await s.persistence.load(), COURSE, OBJ_REF, {}),
  };
}

const handlesOf = (sent: readonly Sent[]) =>
  sent.map((x) => (x.payload.concepts as { handle: string }[]).map((c) => c.handle));

describe('the resume pass, alignment', () => {
  it('sends only the concepts whose alignment is owed, and leaves settled results as stored', async () => {
    hoisted.replace = keyed(40);
    try {
      const o = await objectives(4, 2);
      const t1 = transport((x, n) => {
        if (n === 1) return alignAll(x);
        throw new Error('offline');
      });
      await quiet(() => o.first(t1));
      const before = await o.views();
      const settledBefore = before.filter((v) => v.result.kind === 'aligned');
      expect(settledBefore).toHaveLength(34);
      expect(before.filter((v) => v.result.kind === 'pending')).toHaveLength(6);

      const t2 = transport((x) => alignAll(x));
      await o.resume(t2);
      expect(t2.sent).toHaveLength(1);
      expect(handlesOf(t2.sent)[0]).toEqual(['c035', 'c036', 'c037', 'c038', 'c039', 'c040']);

      const after = await o.views();
      expect(after.every((v) => v.result.kind === 'aligned')).toBe(true);
      // Settled results are byte-for-byte what they were.
      expect(after.filter((v) => settledBefore.some((b) => b.conceptKey === v.conceptKey))).toEqual(
        settledBefore,
      );
      // The resumed results carry the same plan digests as the settled ones: one coherent result set.
      const settledDigests = settledBefore[0]?.digests;
      for (const v of after.filter(
        (x) => !settledBefore.some((b) => b.conceptKey === x.conceptKey),
      )) {
        expect(v.digests.closedList).toBe(settledDigests?.closedList);
        expect(v.digests.batchPlan).toBe(settledDigests?.batchPlan);
        expect(v.digests.coverage).toBe(settledDigests?.coverage);
      }
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('reads the concepts past the run cap, and only them', async () => {
    hoisted.replace = keyed(34 * 9);
    try {
      const o = await objectives(4, 2);
      const t1 = transport((x) => alignAll(x));
      await o.first(t1);
      expect(t1.sent).toHaveLength(8);
      expect((await o.views()).filter((v) => v.result.kind === 'pending')).toHaveLength(34);

      const t2 = transport((x) => alignAll(x));
      await o.resume(t2);
      expect(t2.sent).toHaveLength(1);
      expect(handlesOf(t2.sent)[0]).toHaveLength(34);
      expect((await o.views()).every((v) => v.result.kind === 'aligned')).toBe(true);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('does not spend again on a remainder past the run cap that a pass cannot shrink', async () => {
    hoisted.replace = keyed(1);
    try {
      // 617 records of one passage each need nine record batches; the cap makes eight calls.
      const o = await objectives(617, 617);
      const t1 = transport((x) => alignAll(x));
      await o.first(t1);
      expect(t1.sent).toHaveLength(8);
      const [view] = await o.views();
      expect(view?.result.kind).toBe('aligned');
      expect(view?.coverage.pairsNotSent).toEqual([{ reason: 'run-cap', count: 1 }]);

      const t2 = transport((x) => alignAll(x));
      await o.resume(t2);
      expect(t2.sent).toHaveLength(0);
      expect(await o.views()).toEqual([view]);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('sends nothing when every concept is settled', async () => {
    hoisted.replace = keyed(3);
    try {
      const o = await objectives(4, 2);
      await o.first(transport((x) => alignAll(x)));
      const before = await o.views();
      const t = transport((x) => alignAll(x));
      await o.resume(t);
      await o.newOnes(t);
      expect(t.sent).toHaveLength(0);
      expect(await o.views()).toEqual(before);
    } finally {
      hoisted.replace = undefined;
    }
  });
});

describe('the new-concept pass', () => {
  it('aligns a concept new to the course on its own and leaves earlier results exactly as stored', async () => {
    hoisted.replace = keyed(3);
    try {
      const o = await objectives(4, 2);
      await o.first(transport((x) => alignAll(x)));
      const before = await o.views();
      expect(before).toHaveLength(3);

      hoisted.replace = keyed(4);
      const t = transport((x) => alignAll(x));
      await o.newOnes(t);
      expect(t.sent).toHaveLength(1);
      const concepts = t.sent[0]?.payload.concepts as { handle: string }[];
      expect(concepts).toHaveLength(1);

      const after = await o.views();
      expect(after).toHaveLength(4);
      expect(after.filter((v) => before.some((b) => b.conceptKey === v.conceptKey))).toEqual(
        before,
      );
      const added = after.find((v) => !before.some((b) => b.conceptKey === v.conceptKey));
      expect(added?.result.kind).toBe('aligned');
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('leaves a pending concept alone: only a concept with no result at all is new', async () => {
    hoisted.replace = keyed(2);
    try {
      const o = await objectives(4, 2);
      await quiet(() =>
        o.first(
          transport(() => {
            throw new Error('offline');
          }),
        ),
      );
      const t = transport((x) => alignAll(x));
      await o.newOnes(t);
      expect(t.sent).toHaveLength(0);
    } finally {
      hoisted.replace = undefined;
    }
  });
});

describe('the off switch', () => {
  it('sends and writes nothing while the shipped default is off, and runs with the switch on', async () => {
    hoisted.replace = keyed(2);
    try {
      const o = await objectives(4, 2);
      const off = transport((x) => alignAll(x));
      const a = await o.resume(off, { enabled: undefined });
      const b = await o.newOnes(off, { enabled: undefined });
      expect(a.outcome).toBe('disabled');
      expect(b.outcome).toBe('disabled');
      expect(off.sent).toHaveLength(0);
      expect((await o.s.persistence.load()).alignments.size).toBe(0);

      const on = transport((x) => alignAll(x));
      await o.s.persistence.recordExtraction({
        sourcePath: 'doc-o',
        documentKind: 'objectives',
        revisionDigest: 'r1',
        coverage: { unitsRead: 4, unitsTotal: 4 },
        declarationCount: 2,
        paperStructure: { sections: [] },
        stamp: STAMP,
      });
      await o.resume(on);
      expect(on.sent).toHaveLength(1);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('never throws, whatever the store does', async () => {
    const s = setup();
    const t = transport(() => {
      throw new Error('offline');
    });
    const broken = {
      ...s.persistence,
      load: async () => {
        throw new Error('store down');
      },
      readDocument: async () => {
        throw new Error('store down');
      },
    };
    await quiet(async () => {
      await expect(
        resumeScopeReading({ ...resumeInputFor(s, t), persistence: broken }),
      ).resolves.toBeDefined();
      await expect(
        alignNewConcepts({ ...resumeInputFor(s, t), persistence: broken }),
      ).resolves.toBeDefined();
    });
  });
});
