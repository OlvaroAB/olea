/**
 * The refusal limit on every path (`ol-egov.141.89.7.84`). Scenarios: F4.1, "a part refused twice is
 * held back on the first delivery path too", "the drivers and the resume pass share one session count",
 * "an alignment batch refused twice is not sent again", "an unreachable service does not count as a
 * refusal", "a replaced plan owes its batches again". Synthetic ids and wording only.
 */

import { describe, expect, it } from 'vitest';
import { runAlignmentDriver } from '../../src/scope-reading/alignment-driver.js';
import type { DocumentReadingBasis } from '../../src/scope-reading/basis.js';
import { inMemoryRefusalLedger } from '../../src/scope-reading/demand-driver.js';
import { runScopeReadingDrivers } from '../../src/scope-reading/drivers.js';
import type { DocumentRef, ExtractionRecordInput } from '../../src/scope-reading/persistence.js';
import { resumeScopeReading } from '../../src/scope-reading/resume.js';
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
  const spy = console.error;
  console.error = () => undefined;
  try {
    return await f();
  } finally {
    console.error = spy;
  }
};

// --- demand --------------------------------------------------------------------------------

// The session ledger lasts the whole file, so each test reads its own document.
const paperRef = (path: string): DocumentRef => ({
  sourcePath: path,
  documentKind: 'past-paper',
  revisionDigest: 'r1',
});
const paperUnits = [
  unit('Shared stem text.', 1),
  unit('Find the first quantity.', 1),
  unit('Find the second quantity.', 2),
];
const paper = (path: string): ExtractionRecordInput => ({
  sourcePath: path,
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
});
const paperBasis: DocumentReadingBasis = {
  revisionDigest: 'r1',
  unitsRead: 3,
  unitsTotal: 3,
  pages: [1, 2],
};
const partIds = (sent: readonly Sent[]) =>
  sent.map((s) => (s.payload.part as { partId: string }).partId);
const refuseP1 = (x: Sent) =>
  (x.payload.part as { partId: string }).partId === 'p1'
    ? {
        ok: true,
        stamp: STAMP,
        result: { verdict: { kind: 'demand', demand: 'not-a-demand' }, refs: ['u1'] },
      }
    : demandAnswer(x);

async function paperDriverInput(
  s: ReturnType<typeof setup>,
  t: ReturnType<typeof transport>,
  path: string,
) {
  const recorded = await s.persistence.recordExtraction(paper(path));
  return {
    persistence: s.persistence,
    ref: paperRef(path),
    basis: paperBasis,
    recorded,
    units: paperUnits,
    deliveryRevisionDigest: 'r1',
    courses: [] as string[],
    declarations: [],
    transport: t.transport,
    vault: s.vault,
  };
}

describe('the demand refusal limit on the first-delivery path', () => {
  it('holds back a part refused twice, with no ledger passed in, and still reads the others', async () => {
    const s = setup();
    const first = transport(refuseP1);
    const input = await paperDriverInput(s, first, 'doc-a');
    await quiet(() => runScopeReadingDrivers(input));
    expect(partIds(first.sent)).toEqual(['p1', 'p2']);
    const second = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers({ ...input, transport: second.transport }));
    expect(partIds(second.sent)).toEqual(['p1']);
    const third = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers({ ...input, transport: third.transport }));
    expect(third.sent).toHaveLength(0);
  });

  it('counts the first delivery and the resume pass together', async () => {
    const s = setup();
    const t1 = transport(refuseP1);
    const input = await paperDriverInput(s, t1, 'doc-b');
    await quiet(() => runScopeReadingDrivers(input));
    const t2 = transport(refuseP1);
    await quiet(() => resumeScopeReading({ ...input, transport: t2.transport, enabled: true }));
    expect(partIds(t2.sent)).toEqual(['p1']);
    const t3 = transport(refuseP1);
    await quiet(() => resumeScopeReading({ ...input, transport: t3.transport, enabled: true }));
    expect(t3.sent).toHaveLength(0);
    const t4 = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers({ ...input, transport: t4.transport }));
    expect(t4.sent).toHaveLength(0);
  });

  it('uses a ledger the caller passes instead of the session one', async () => {
    const s = setup();
    const refusals = inMemoryRefusalLedger();
    const t1 = transport(refuseP1);
    const input = await paperDriverInput(s, t1, 'doc-c');
    await quiet(() => runScopeReadingDrivers({ ...input, refusals }));
    await quiet(() => runScopeReadingDrivers({ ...input, refusals }));
    const t3 = transport(refuseP1);
    await quiet(() => runScopeReadingDrivers({ ...input, refusals, transport: t3.transport }));
    expect(t3.sent).toHaveLength(0);
  });
});

// --- alignment -----------------------------------------------------------------------------

const OBJ_REF: DocumentRef = {
  sourcePath: 'doc-o',
  documentKind: 'objectives',
  revisionDigest: 'r1',
};
const unusable = {
  ok: true,
  stamp: STAMP,
  result: { batchId: 'wrong', coverageDigest: 'wrong', decisions: [] },
};

async function objectivesInput(
  t: ReturnType<typeof transport>,
  files = conceptNotes(['Alpha idea', 'Beta idea']),
) {
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
  return {
    persistence: s.persistence,
    ref: OBJ_REF,
    basis: { revisionDigest: 'r1', unitsRead: 4, unitsTotal: 4, pages: [1, 2, 3, 4] },
    recorded,
    units: unitsOf(4),
    deliveryRevisionDigest: 'r1',
    courses: [COURSE],
    declarations: [outcome('outcome-key1:b', 2), outcome('outcome-key1:a', 1)],
    transport: t.transport,
    vault: s.vault,
    enabled: true,
  };
}

describe('the alignment refusal limit', () => {
  it('does not send a batch again once it was answered unusably twice, on the resume pass or the first path', async () => {
    const refused = transport(() => unusable);
    const input = await objectivesInput(refused);
    await quiet(() => runScopeReadingDrivers(input)); // refusal 1
    expect(refused.sent).toHaveLength(1);
    const two = transport(() => unusable);
    await quiet(() => resumeScopeReading({ ...input, transport: two.transport })); // refusal 2
    expect(two.sent).toHaveLength(1);
    const three = transport((x) => alignAll(x));
    const out = await quiet(() => resumeScopeReading({ ...input, transport: three.transport }));
    expect(three.sent).toHaveLength(0);
    expect(out.alignment).toMatchObject({ calls: 0, heldBack: 1 });
    const four = transport((x) => alignAll(x));
    await quiet(() => runScopeReadingDrivers({ ...input, transport: four.transport }));
    expect(four.sent).toHaveLength(0);
  });

  it('keeps the held-back concepts pending as failed-alignment, never decided', async () => {
    const refusals = inMemoryRefusalLedger();
    const t = transport(() => unusable);
    const input = await objectivesInput(t);
    await quiet(() => runAlignmentDriver({ ...input, refusals }));
    await quiet(() => runAlignmentDriver({ ...input, refusals }));
    await quiet(() => runAlignmentDriver({ ...input, refusals }));
    const load = await input.persistence.load();
    const results = [...load.alignments.values()];
    expect(results.length).toBeGreaterThan(0);
    expect(JSON.stringify(results)).toContain('failed-alignment');
    expect(JSON.stringify(results)).not.toContain('"aligned"');
  });

  it('does not count an unreachable service as a refusal', async () => {
    const refusals = inMemoryRefusalLedger();
    const down = () => {
      throw new Error('offline');
    };
    const t = transport(down);
    const input = await objectivesInput(t);
    for (let i = 0; i < 3; i++) await quiet(() => runAlignmentDriver({ ...input, refusals }));
    expect(t.sent).toHaveLength(3);
  });

  it('sends the batch again when the plan changed', async () => {
    const refusals = inMemoryRefusalLedger();
    const t = transport(() => unusable);
    const input = await objectivesInput(t);
    await quiet(() => runAlignmentDriver({ ...input, refusals }));
    await quiet(() => runAlignmentDriver({ ...input, refusals }));
    expect(t.sent).toHaveLength(2);
    // A changed closed list changes the batch plan, so the earlier refusals no longer apply.
    const t2 = transport(() => unusable);
    const input2 = await objectivesInput(
      t2,
      conceptNotes(['Alpha idea', 'Beta idea', 'Gamma idea']),
    );
    await quiet(() => runAlignmentDriver({ ...input2, refusals }));
    expect(t2.sent).toHaveLength(1);
  });
});
