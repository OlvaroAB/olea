import { describe, expect, it } from 'vitest';
import {
  classifyPaperCompletion,
  comparePaperReuseFingerprints,
  countedPaperMarks,
  emptySlotGapKind,
  type PaperEmptyOutcome,
  type PaperReuseInputs,
  paperBlueprintDigest,
  paperIntendedDemandBasis,
  paperPartsInDependencyOrder,
  paperReuseFingerprint,
  paperYieldAgainstStructure,
  propagatePaperEmptiness,
  reconcilePaperStructureMarks,
  validatePaperStructure,
} from './paper-structure.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperEmptySlotReasonCode,
  type PaperMarks,
  type PaperPartDependency,
  type PaperStructuredGroup,
  type PaperStructuredPart,
  type PaperStructuredSection,
  type PaperStructuredShape,
} from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.11 (`[D-430]`), filed as owed on the D-430
// build bead (the features file is outside this lane's paths). Synthetic ids only.

const stated = (value: number): PaperMarks => ({ status: 'stated', value });
const UNKNOWN: PaperMarks = { status: 'unknown' };
const UNKNOWN_DEPENDENCY: PaperPartDependency = { status: 'unknown' };

function part(
  slotId: string,
  groupId: string,
  overrides: Partial<PaperStructuredPart> = {},
): PaperStructuredPart {
  return {
    slotId,
    groupId,
    label: slotId,
    questionForm: 'short answer',
    marks: stated(2),
    dependsOn: UNKNOWN_DEPENDENCY,
    demand: { status: 'read', demand: 'recall-a-fact' },
    ...overrides,
  };
}

function group(
  groupId: string,
  slotIds: readonly string[],
  overrides: Partial<PaperStructuredGroup> = {},
): PaperStructuredGroup {
  return {
    groupId,
    kind: 'parent-question',
    sectionId: 's1',
    label: groupId,
    slotIds,
    stimulusNeed: { status: 'not-needed' },
    heldStimulus: null,
    ...overrides,
  };
}

function section(
  sectionId: string,
  groupIds: readonly string[],
  marks: PaperMarks = UNKNOWN,
): PaperStructuredSection {
  return { sectionId, label: sectionId, marks, groupIds };
}

function shape(overrides: Partial<PaperStructuredShape> = {}): PaperStructuredShape {
  return {
    formatVersion: PAPER_STRUCTURE_FORMAT_VERSION,
    structureBasis: 'current-or-transitional',
    structureSlotCount: 4,
    sections: [section('s1', ['g1', 'g2'])],
    groups: [group('g1', ['a', 'b']), group('g2', ['c', 'd'])],
    parts: [part('a', 'g1'), part('b', 'g1'), part('c', 'g2'), part('d', 'g2')],
    totalMarks: UNKNOWN,
    timeAllowance: { status: 'unknown' },
    ...overrides,
  };
}

const codes = (s: PaperStructuredShape): string[] => validatePaperStructure(s).map((p) => p.code);

describe('validatePaperStructure', () => {
  it('accepts a well-formed shape', () => {
    expect(validatePaperStructure(shape())).toEqual([]);
  });

  it('names a duplicate slot id and a duplicate group id', () => {
    expect(
      codes(shape({ parts: [part('a', 'g1'), part('a', 'g1'), part('c', 'g2'), part('d', 'g2')] })),
    ).toContain('duplicate-slot-id');
    expect(codes(shape({ groups: [group('g1', ['a', 'b']), group('g1', ['c', 'd'])] }))).toContain(
      'duplicate-group-id',
    );
  });

  it('refuses a part outside every group, and a group listing a part that sits in another group', () => {
    expect(
      codes(
        shape({ parts: [part('a', 'nope'), part('b', 'g1'), part('c', 'g2'), part('d', 'g2')] }),
      ),
    ).toContain('part-group-unknown');
    expect(
      codes(shape({ groups: [group('g1', ['a', 'b', 'c']), group('g2', ['c', 'd'])] })),
    ).toContain('group-member-mismatch');
    expect(codes(shape({ groups: [group('g1', ['a']), group('g2', ['c', 'd'])] }))).toContain(
      'part-not-in-group',
    );
  });

  it('refuses an unknown parent group and a parent cycle', () => {
    expect(
      codes(
        shape({
          groups: [group('g1', ['a', 'b'], { parentGroupId: 'nope' }), group('g2', ['c', 'd'])],
        }),
      ),
    ).toContain('group-parent-unknown');
    expect(
      codes(
        shape({
          groups: [
            group('g1', ['a', 'b'], { parentGroupId: 'g2' }),
            group('g2', ['c', 'd'], { parentGroupId: 'g1' }),
          ],
        }),
      ),
    ).toContain('group-cycle');
  });

  it('refuses a dependency on an unknown, the same or a later part', () => {
    const dep = (onSlotIds: string[]): PaperPartDependency => ({ status: 'stated', onSlotIds });
    const withDep = (slotId: string, onSlotIds: string[]): PaperStructuredShape =>
      shape({
        parts: shape().parts.map((p) =>
          p.slotId === slotId ? { ...p, dependsOn: dep(onSlotIds) } : p,
        ),
      });
    expect(codes(withDep('b', ['nope']))).toContain('dependency-unknown');
    expect(codes(withDep('b', ['b']))).toContain('self-dependency');
    expect(codes(withDep('b', ['c']))).toContain('forward-dependency');
    expect(codes(withDep('b', []))).toContain('empty-dependency');
    expect(codes(withDep('b', ['a']))).toEqual([]);
  });

  it('holds a choice to its own arithmetic: k within n, n equal to what the group holds, only on a choice group', () => {
    const choiceGroup = (choose: number | null, alternatives: number): PaperStructuredShape =>
      shape({
        groups: [
          group('g1', ['a', 'b'], { kind: 'choice', choice: { alternatives, choose } }),
          group('g2', ['c', 'd']),
        ],
      });
    expect(codes(choiceGroup(1, 2))).toEqual([]);
    expect(codes(choiceGroup(null, 2))).toEqual([]);
    expect(codes(choiceGroup(3, 2))).toContain('choice-out-of-range');
    expect(codes(choiceGroup(0, 2))).toContain('choice-out-of-range');
    expect(codes(choiceGroup(1, 3))).toContain('choice-alternatives-mismatch');
    expect(
      codes(
        shape({
          groups: [
            group('g1', ['a', 'b'], { choice: { alternatives: 2, choose: 1 } }),
            group('g2', ['c', 'd']),
          ],
        }),
      ),
    ).toContain('choice-on-non-choice-group');
  });

  it('refuses marks that are not a non-negative finite number', () => {
    expect(
      codes(
        shape({
          parts: shape().parts.map((p) => (p.slotId === 'a' ? { ...p, marks: stated(-1) } : p)),
        }),
      ),
    ).toContain('marks-invalid');
    expect(codes(shape({ totalMarks: stated(Number.NaN) }))).toContain('marks-invalid');
  });

  it('refuses a group naming an unknown section and a section naming an unknown group', () => {
    expect(
      codes(
        shape({
          groups: [group('g1', ['a', 'b'], { sectionId: 'nope' }), group('g2', ['c', 'd'])],
        }),
      ),
    ).toContain('group-section-unknown');
    expect(codes(shape({ sections: [section('s1', ['g1', 'g2', 'nope'])] }))).toContain(
      'section-group-unknown',
    );
  });
});

describe('paperPartsInDependencyOrder', () => {
  it('keeps printed order when nothing depends on anything', () => {
    expect(paperPartsInDependencyOrder(shape()).map((p) => p.slotId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never puts a dependent before the part it depends on, and otherwise keeps printed order', () => {
    const s = shape({
      parts: [
        part('a', 'g1', { dependsOn: { status: 'stated', onSlotIds: ['d'] } }),
        part('b', 'g1'),
        part('c', 'g2'),
        part('d', 'g2'),
      ],
    });
    const order = paperPartsInDependencyOrder(s).map((p) => p.slotId);
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('a'));
    expect(order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('adds no edge for an unknown dependency: unknown is not independent, and not ordered either', () => {
    const s = shape({ parts: shape().parts.map((p) => ({ ...p, dependsOn: UNKNOWN_DEPENDENCY })) });
    expect(paperPartsInDependencyOrder(s).map((p) => p.slotId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not lose a part on a cyclic input: cycle members follow, in printed order', () => {
    const s = shape({
      parts: [
        part('a', 'g1', { dependsOn: { status: 'stated', onSlotIds: ['b'] } }),
        part('b', 'g1', { dependsOn: { status: 'stated', onSlotIds: ['a'] } }),
        part('c', 'g2'),
        part('d', 'g2'),
      ],
    });
    const order = paperPartsInDependencyOrder(s).map((p) => p.slotId);
    expect(order).toHaveLength(4);
    expect(new Set(order)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

describe('propagatePaperEmptiness', () => {
  const own = (entries: Record<string, PaperEmptySlotReasonCode>): Map<string, PaperEmptyOutcome> =>
    new Map(
      Object.entries(entries).map(([id, reasonCode]) => [id, { reasonCode, reason: reasonCode }]),
    );

  it('names every part of a group that needs a stimulus and holds none, nested groups included', () => {
    const s = shape({
      groups: [
        group('g1', ['a', 'b'], { stimulusNeed: { status: 'needed', form: 'table' } }),
        group('g2', ['c'], { parentGroupId: 'g1' }),
        group('g3', ['d']),
      ],
      parts: [part('a', 'g1'), part('b', 'g1'), part('c', 'g2'), part('d', 'g3')],
      sections: [section('s1', ['g1', 'g3'])],
    });
    const out = propagatePaperEmptiness(s, new Map());
    expect([...out.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(out.get('a')?.reasonCode).toBe('no-held-stimulus');
    expect(out.has('d')).toBe(false);
  });

  it('does not name a group whose need is met, not needed, or not identified', () => {
    const held = { form: 'table' as const, sourceId: 'src', chunkIndex: 0 };
    const s = shape({
      groups: [
        group('g1', ['a', 'b'], {
          stimulusNeed: { status: 'needed', form: 'table' },
          heldStimulus: held,
        }),
        group('g2', ['c', 'd'], { stimulusNeed: { status: 'not-identified' } }),
      ],
    });
    expect(propagatePaperEmptiness(s, new Map()).size).toBe(0);
  });

  it('keeps a part own earlier reason: rank, demand and source come before stimulus', () => {
    const s = shape({
      groups: [
        group('g1', ['a', 'b'], { stimulusNeed: { status: 'needed', form: null } }),
        group('g2', ['c', 'd']),
      ],
    });
    const out = propagatePaperEmptiness(s, own({ a: 'no-held-source' }));
    expect(out.get('a')?.reasonCode).toBe('no-held-source');
    expect(out.get('b')?.reasonCode).toBe('no-held-stimulus');
  });

  it('ends a stated dependent of an empty part empty, never filled standalone, with the root named', () => {
    const s = shape({
      parts: [
        part('a', 'g1'),
        part('b', 'g1', { dependsOn: { status: 'stated', onSlotIds: ['a'] } }),
        part('c', 'g2', { dependsOn: { status: 'stated', onSlotIds: ['b'] } }),
        part('d', 'g2'),
      ],
    });
    const out = propagatePaperEmptiness(s, own({ a: 'demand-unsupported' }));
    expect(out.get('b')).toMatchObject({
      reasonCode: 'depends-on-empty-part',
      causedBySlotId: 'a',
    });
    expect(out.get('c')).toMatchObject({
      reasonCode: 'depends-on-empty-part',
      causedBySlotId: 'a',
    });
    expect(out.has('d')).toBe(false);
  });

  it('propagates through a stimulus-empty part too, and through any one empty dependency of several', () => {
    const s = shape({
      groups: [
        group('g1', ['a'], { stimulusNeed: { status: 'needed', form: 'figure' } }),
        group('g2', ['b', 'c', 'd']),
      ],
      sections: [section('s1', ['g1', 'g2'])],
      parts: [
        part('a', 'g1'),
        part('b', 'g2'),
        part('c', 'g2'),
        part('d', 'g2', { dependsOn: { status: 'stated', onSlotIds: ['b', 'a'] } }),
      ],
    });
    const out = propagatePaperEmptiness(s, new Map());
    expect(out.get('d')).toMatchObject({
      reasonCode: 'depends-on-empty-part',
      causedBySlotId: 'a',
    });
  });

  it('does not propagate through an unknown dependency', () => {
    const out = propagatePaperEmptiness(shape(), own({ a: 'no-held-source' }));
    expect([...out.keys()]).toEqual(['a']);
  });
});

describe('marks: counted, reconciled, never corrected', () => {
  it('sums parts under groups under sections, and the paper', () => {
    const counted = countedPaperMarks(shape());
    expect(counted.total).toEqual(stated(8));
    expect(counted.sections.get('s1')).toEqual(stated(8));
  });

  it('reads unknown when any part inside is unknown', () => {
    const s = shape({
      parts: shape().parts.map((p) => (p.slotId === 'c' ? { ...p, marks: UNKNOWN } : p)),
    });
    expect(countedPaperMarks(s).total).toEqual(UNKNOWN);
  });

  it('counts k alternatives of an answer-k-of-n group, not all n', () => {
    const s = shape({
      groups: [
        group('g1', ['a', 'b'], { kind: 'choice', choice: { alternatives: 2, choose: 1 } }),
        group('g2', ['c', 'd']),
      ],
    });
    expect(countedPaperMarks(s).total).toEqual(stated(6));
  });

  it('reads unknown for a choice whose k is not stated, or whose alternatives differ in marks', () => {
    const unstated = shape({
      groups: [
        group('g1', ['a', 'b'], { kind: 'choice', choice: { alternatives: 2, choose: null } }),
        group('g2', ['c', 'd']),
      ],
    });
    expect(countedPaperMarks(unstated).total).toEqual(UNKNOWN);
    const uneven = shape({
      groups: [
        group('g1', ['a', 'b'], { kind: 'choice', choice: { alternatives: 2, choose: 1 } }),
        group('g2', ['c', 'd']),
      ],
      parts: shape().parts.map((p) => (p.slotId === 'a' ? { ...p, marks: stated(5) } : p)),
    });
    expect(countedPaperMarks(uneven).total).toEqual(UNKNOWN);
  });

  it('turns a stated total that disagrees with its parts into unknown, and reports it, never correcting it', () => {
    const { shape: out, disagreements } = reconcilePaperStructureMarks(
      shape({ totalMarks: stated(10), sections: [section('s1', ['g1', 'g2'], stated(8))] }),
    );
    expect(out.totalMarks).toEqual(UNKNOWN);
    expect(out.sections[0]?.marks).toEqual(stated(8));
    expect(disagreements).toEqual({ sectionIds: [], total: true });
  });

  it('keeps a stated total that agrees, and one it cannot check', () => {
    const agree = reconcilePaperStructureMarks(shape({ totalMarks: stated(8) }));
    expect(agree.shape.totalMarks).toEqual(stated(8));
    const cannotCheck = reconcilePaperStructureMarks(
      shape({
        totalMarks: stated(100),
        parts: shape().parts.map((p) => (p.slotId === 'c' ? { ...p, marks: UNKNOWN } : p)),
      }),
    );
    expect(cannotCheck.shape.totalMarks).toEqual(stated(100));
    expect(cannotCheck.disagreements.total).toBe(false);
  });

  it('never fills an unknown total from its parts', () => {
    expect(reconcilePaperStructureMarks(shape()).shape.totalMarks).toEqual(UNKNOWN);
  });
});

describe('completion: a qualified partial is not an outage', () => {
  const empty = (
    slotId: string,
    reasonCode: PaperEmptySlotReasonCode | 'source-support-refused',
    causedBySlotId?: string,
  ) => ({ slotId, reasonCode, ...(causedBySlotId !== undefined ? { causedBySlotId } : {}) });

  it('is complete with no named gap, and rank exclusion is extent, not a gap', () => {
    expect(classifyPaperCompletion([])).toEqual({ status: 'complete' });
    expect(classifyPaperCompletion([empty('x', 'rank-excluded')])).toEqual({ status: 'complete' });
  });

  it('names a source gap and a capability gap apart', () => {
    for (const code of [
      'no-held-source',
      'no-held-stimulus',
      'generator-refused',
      'source-support-refused',
    ] as const) {
      expect(classifyPaperCompletion([empty('x', code)])).toEqual({
        status: 'qualified-partial',
        gaps: ['source'],
      });
    }
    expect(classifyPaperCompletion([empty('x', 'demand-unsupported')])).toEqual({
      status: 'qualified-partial',
      gaps: ['capability'],
    });
    expect(
      classifyPaperCompletion([empty('x', 'demand-unsupported'), empty('y', 'no-held-source')]),
    ).toEqual({ status: 'qualified-partial', gaps: ['capability', 'source'] });
  });

  it('lets a dependent inherit the kind of its root, and never counts it as a gap of its own', () => {
    expect(
      classifyPaperCompletion([
        empty('a', 'demand-unsupported'),
        empty('b', 'depends-on-empty-part', 'a'),
      ]),
    ).toEqual({ status: 'qualified-partial', gaps: ['capability'] });
    expect(
      classifyPaperCompletion([
        empty('a', 'rank-excluded'),
        empty('b', 'depends-on-empty-part', 'a'),
      ]),
    ).toEqual({ status: 'complete' });
  });

  it('classifies every reason code, so a new one cannot be silently ignored', () => {
    const all: PaperEmptySlotReasonCode[] = [
      'no-held-source',
      'generator-refused',
      'rank-excluded',
      'demand-unsupported',
      'no-held-stimulus',
      'depends-on-empty-part',
    ];
    for (const code of all)
      expect(['source', 'capability', 'extent', 'inherited']).toContain(emptySlotGapKind(code));
  });
});

describe('yield against the original structure', () => {
  it('reports one filled slot of eight as one eighth, whatever else was excluded', () => {
    expect(paperYieldAgainstStructure(8, 1)).toEqual({
      structureSlots: 8,
      filled: 1,
      yield: 0.125,
    });
  });

  it('is null, never a good figure, when the structure named no slots', () => {
    expect(paperYieldAgainstStructure(0, 0).yield).toBeNull();
  });
});

describe('a part keeps its original demand reading', () => {
  it('reads basis read for a decided demand and an unsupported operation, not-read for the rest', () => {
    expect(paperIntendedDemandBasis({ status: 'read', demand: 'calculate' })).toBe('read');
    expect(paperIntendedDemandBasis({ status: 'unsupported', commandWord: 'discuss' })).toBe(
      'read',
    );
    expect(paperIntendedDemandBasis({ status: 'cannot-tell' })).toBe('not-read');
    expect(paperIntendedDemandBasis({ status: 'not-read' })).toBe('not-read');
  });
});

describe('reuse fingerprint: four things, each named', () => {
  const inputs = (): PaperReuseInputs => ({
    sourceVersions: [
      { sourceId: 's2', revisionDigest: 'r2' },
      { sourceId: 's1', revisionDigest: 'r1' },
    ],
    scope: {
      eligibleConceptKeys: ['k2', 'k1'],
      outcomes: [{ outcomeId: 'o1', conceptKeys: ['k2', 'k1'] }],
    },
    structure: {
      shape: shape(),
      slotPlan: [
        { slotId: 'a', conceptKey: 'k1', taskId: 'quiz.generate.v1' },
        { slotId: 'b', conceptKey: 'k2', taskId: 'quiz.generate.v1' },
      ],
    },
    authoringSpec: {
      purpose: 'assessment-simulation',
      extent: 'standard',
      emphasis: null,
      alpha: 0.5,
      formatClass: 'recall-style',
      generatorTasks: ['quiz.generate.v1'],
    },
  });

  it('is the same for the same inputs however the lists were ordered', async () => {
    const a = await paperReuseFingerprint(inputs());
    const reordered = inputs();
    const b = await paperReuseFingerprint({
      ...reordered,
      sourceVersions: [...reordered.sourceVersions].reverse(),
      scope: {
        eligibleConceptKeys: ['k1', 'k2'],
        outcomes: [{ outcomeId: 'o1', conceptKeys: ['k1', 'k2'] }],
      },
    });
    expect(b).toEqual(a);
    expect(comparePaperReuseFingerprints(a, b)).toEqual({ compatible: true });
    expect(await paperBlueprintDigest(a)).toBe(await paperBlueprintDigest(b));
  });

  it('names exactly the component that changed, for each of the four', async () => {
    const base = await paperReuseFingerprint(inputs());
    const changed = async (mutate: (i: PaperReuseInputs) => PaperReuseInputs) =>
      comparePaperReuseFingerprints(base, await paperReuseFingerprint(mutate(inputs())));

    expect(
      await changed((i) => ({
        ...i,
        sourceVersions: [
          { sourceId: 's1', revisionDigest: 'r1b' },
          ...i.sourceVersions.slice(0, 1),
        ],
      })),
    ).toEqual({ compatible: false, changed: ['sourceVersions'] });
    expect(
      await changed((i) => ({ ...i, scope: { ...i.scope, eligibleConceptKeys: ['k1'] } })),
    ).toEqual({ compatible: false, changed: ['scope'] });
    expect(
      await changed((i) => ({
        ...i,
        structure: { ...i.structure, shape: shape({ structureSlotCount: 5 }) },
      })),
    ).toEqual({ compatible: false, changed: ['structure'] });
    expect(
      await changed((i) => ({ ...i, authoringSpec: { ...i.authoringSpec, extent: 'longer' } })),
    ).toEqual({ compatible: false, changed: ['authoringSpec'] });
  });

  it('treats a moved slot plan as a structure change (order is meaning)', async () => {
    const base = await paperReuseFingerprint(inputs());
    const swapped = inputs();
    const next = await paperReuseFingerprint({
      ...swapped,
      structure: { ...swapped.structure, slotPlan: [...swapped.structure.slotPlan].reverse() },
    });
    expect(comparePaperReuseFingerprints(base, next)).toEqual({
      compatible: false,
      changed: ['structure'],
    });
  });

  it('is not satisfied by unchanged course settings alone: nothing here reads a setting', async () => {
    // The fingerprint has exactly four inputs; a caller cannot pass "settings unchanged" in place
    // of any of them. A changed source with everything else equal is still incompatible.
    const base = await paperReuseFingerprint(inputs());
    const moved = await paperReuseFingerprint({
      ...inputs(),
      sourceVersions: [{ sourceId: 's1', revisionDigest: 'other' }],
    });
    expect(comparePaperReuseFingerprints(base, moved).compatible).toBe(false);
  });
});
