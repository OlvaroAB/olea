import { describe, expect, it } from 'vitest';
import { buildPaperBlueprint, paperBlueprintCandidateSlotIds } from './paper-blueprint.js';
import {
  buildStructuredPaperShape,
  classifyPaperCompletion,
  comparePaperReuseFingerprints,
  countedPaperMarks,
  emptySlotGapKind,
  isRecordedPaperStructuredShape,
  type PaperEmptyOutcome,
  type PaperReuseInputs,
  paperBlueprintDigest,
  paperGroupsNeedingStimulus,
  paperIntendedDemandBasis,
  paperNoneHeldGroupIdsFromPlan,
  paperPartConceptSlotIds,
  paperPartsInDependencyOrder,
  paperReuseFingerprint,
  paperYieldAgainstStructure,
  planStructuredPaper,
  propagatePaperEmptiness,
  reconcilePaperStructureMarks,
  selectPaperTemplateParts,
  validatePaperStructure,
  withPaperHeldStimuli,
} from './paper-structure.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperBlueprint,
  type PaperEmptySlotReasonCode,
  type PaperMarks,
  type PaperPartDependency,
  type PaperStructuredGroup,
  type PaperStructuredPart,
  type PaperStructuredSection,
  type PaperStructuredShape,
  type PaperStructureTemplate,
  type PaperTemplatePart,
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
    // `[D-562]`: the lookup looked for g1's material and found none.
    const out = propagatePaperEmptiness(s, new Map(), new Set(['g1']));
    expect([...out.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(out.get('a')?.reasonCode).toBe('no-held-stimulus');
    expect(out.has('d')).toBe(false);
  });

  it('never names a needed group the lookup did not look for: not looking is not finding none ([D-562])', () => {
    const s = shape({
      groups: [
        group('g1', ['a', 'b'], { stimulusNeed: { status: 'needed', form: 'table' } }),
        group('g2', ['c', 'd'], { stimulusNeed: { status: 'needed', form: 'figure' } }),
      ],
    });
    expect(propagatePaperEmptiness(s, new Map()).size).toBe(0);
    const onlyG2 = propagatePaperEmptiness(s, new Map(), new Set(['g2']));
    expect([...onlyG2.keys()].sort()).toEqual(['c', 'd']);
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
    const out = propagatePaperEmptiness(s, own({ a: 'no-held-source' }), new Set(['g1']));
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
    const out = propagatePaperEmptiness(s, new Map(), new Set(['g1']));
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

// ol-egov.141.89.7.93 ([D-559], [D-562]): the paper written in its structured form from her
// stored reading. Scenarios: features/F4-oracle.md, "her stored reading's groups and parts shape
// her paper", "a part built on a part that could not be written is listed with its ruled reason",
// "a group needing a case or figure that none of her material supplies is listed with its ruled
// reason" and "a reading without groups or parts composes as today". Synthetic ids only.

type TemplateGroup = PaperStructureTemplate['groups'][number];

function tpart(
  id: string,
  groupId: string,
  overrides: Partial<PaperTemplatePart> = {},
): PaperTemplatePart {
  return {
    id,
    label: id,
    groupId,
    questionForm: 'short answer',
    marks: stated(2),
    dependsOn: { status: 'unknown' },
    ...overrides,
  };
}

function tgroup(
  id: string,
  kind: TemplateGroup['kind'],
  overrides: Partial<TemplateGroup> = {},
): TemplateGroup {
  return {
    id,
    kind,
    label: id,
    memberLabels: [],
    anchor: null,
    stimulus: { status: 'none' },
    ...overrides,
  };
}

function template(
  groups: readonly TemplateGroup[],
  parts: readonly PaperTemplatePart[],
  overrides: Partial<PaperStructureTemplate> = {},
): PaperStructureTemplate {
  return {
    groups,
    parts,
    totalMarks: UNKNOWN,
    timeAllowance: { status: 'unknown' },
    ...overrides,
  };
}

/** Question 1 (1a, 1b building on 1a), question 2 on a shared table (2a, 2b), and question 3 alone in section B. */
const COURSE_A = template(
  [
    tgroup('secA', 'section'),
    tgroup('q1', 'parent-question', { parentGroupId: 'secA' }),
    tgroup('q2', 'shared-stimulus', {
      parentGroupId: 'secA',
      stimulus: { status: 'identified', form: 'table', anchor: null },
    }),
    tgroup('secB', 'section'),
  ],
  [
    tpart('p1a', 'q1'),
    tpart('p1b', 'q1', { dependsOn: { status: 'stated', onPartIds: ['p1a'] } }),
    tpart('p2a', 'q2'),
    tpart('p2b', 'q2'),
    tpart('p3', 'secB', { marks: UNKNOWN }),
  ],
  { totalMarks: stated(8) },
);

/** A real blueprint over `count` synthetic concepts at `slotCount`; the concepts at `unheld` have no held source (they rank last). */
function blueprintOver(
  count: number,
  slotCount: number,
  unheld: readonly number[] = [],
): PaperBlueprint {
  return buildPaperBlueprint({
    course: 'COURSEA',
    asOf: '2026-10-21',
    concepts: Array.from({ length: count }, (_, index) => ({
      conceptKey: `k${index}`,
      conceptName: `Topic ${String.fromCharCode(65 + index)}`,
      taughtSignal: 'yes' as const,
      heldSources: unheld.includes(index)
        ? []
        : [{ kind: 'notes' as const, sourceId: `n${index}`, chunks: [`note ${index}`] }],
      masteryScore: null,
    })),
    assessments: [{ type: 'exam', due: '2026-10-30' }],
    structure: null,
    alpha: 0.5,
    slotCount,
    formatClassOf: () => 'written',
  });
}

function built(t: PaperStructureTemplate, partIds: readonly string[], slotIds: readonly string[]) {
  const result = buildStructuredPaperShape(t, partIds, slotIds);
  if (result.status !== 'built') throw new Error(`refused: ${JSON.stringify(result.problems)}`);
  return result.shape;
}

describe('which questions a structured paper takes [D-559]', () => {
  it('takes whole questions in printed order, as many as fit, skipping one that does not fit for a later one that does', () => {
    expect(selectPaperTemplateParts(COURSE_A, 5)).toEqual(['p1a', 'p1b', 'p2a', 'p2b', 'p3']);
    expect(selectPaperTemplateParts(COURSE_A, 4)).toEqual(['p1a', 'p1b', 'p2a', 'p2b']);
    expect(selectPaperTemplateParts(COURSE_A, 3)).toEqual(['p1a', 'p1b', 'p3']);
    expect(selectPaperTemplateParts(COURSE_A, 1)).toEqual(['p3']);
    expect(selectPaperTemplateParts(COURSE_A, 0)).toEqual([]);
  });

  it('never splits a question: a choice keeps every alternative, so a choice larger than the paper is skipped', () => {
    const choice = template(
      [
        tgroup('c', 'choice', { memberLabels: ['4', '5'], choose: 1 }),
        tgroup('q4', 'parent-question', { parentGroupId: 'c' }),
        tgroup('q5', 'parent-question', { parentGroupId: 'c' }),
        tgroup('q6', 'parent-question'),
      ],
      [tpart('p4a', 'q4'), tpart('p4b', 'q4'), tpart('p5a', 'q5'), tpart('p6', 'q6')],
    );
    expect(selectPaperTemplateParts(choice, 2)).toEqual(['p6']);
    expect(selectPaperTemplateParts(choice, 3)).toEqual(['p4a', 'p4b', 'p5a']);
    expect(selectPaperTemplateParts(choice, 4)).toEqual(['p4a', 'p4b', 'p5a', 'p6']);
  });

  it('skips a question that states a dependency on a part it does not take, on itself, on nothing, or on a later part', () => {
    const t = template(
      [
        tgroup('q1', 'parent-question'),
        tgroup('q2', 'parent-question'),
        tgroup('q3', 'parent-question'),
      ],
      [
        tpart('p1', 'q1', { dependsOn: { status: 'stated', onPartIds: ['nowhere'] } }),
        tpart('p2', 'q2', { dependsOn: { status: 'stated', onPartIds: [] } }),
        tpart('p3a', 'q3', { dependsOn: { status: 'stated', onPartIds: ['p3b'] } }),
        tpart('p3b', 'q3'),
      ],
    );
    expect(selectPaperTemplateParts(t, 8)).toEqual([]);
  });
});

describe('the structured shape of a paper over her stored reading [D-559]', () => {
  it('fills the parts that state no dependency, in printed order, with the candidates in ranking order, a part that states one with a candidate after them, and keeps every group, label, form, mark and dependency as the reading states them', () => {
    const blueprint = blueprintOver(5, 5);
    const slotIds = paperBlueprintCandidateSlotIds(blueprint);
    expect(slotIds).toEqual(['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4']);
    const shape = built(COURSE_A, selectPaperTemplateParts(COURSE_A, 5), slotIds);
    // [D-561] (Class B, ol-egov.141.89.7.93): 1(b) builds on 1(a), so it takes the candidate after
    // the four parts that state no dependency; its concept is 1(a)'s (planStructuredPaper).
    expect(shape.parts.map((p) => [p.slotId, p.label, p.groupId])).toEqual([
      ['slot-0', 'p1a', 'q1'],
      ['slot-4', 'p1b', 'q1'],
      ['slot-1', 'p2a', 'q2'],
      ['slot-2', 'p2b', 'q2'],
      ['slot-3', 'p3', 'secB'],
    ]);
    expect(shape.parts[1]?.dependsOn).toEqual({ status: 'stated', onSlotIds: ['slot-0'] });
    expect(shape.parts[0]?.dependsOn).toEqual({ status: 'unknown' });
    expect(shape.parts[4]?.marks).toEqual(UNKNOWN);
    for (const p of shape.parts) expect(p.demand).toEqual({ status: 'not-read' });
    expect(shape.groups.map((g) => [g.groupId, g.kind, g.parentGroupId, g.slotIds])).toEqual([
      ['secA', 'section', undefined, []],
      ['q1', 'parent-question', 'secA', ['slot-0', 'slot-4']],
      ['q2', 'shared-stimulus', 'secA', ['slot-1', 'slot-2']],
      ['secB', 'section', undefined, ['slot-3']],
    ]);
    expect(shape.groups.find((g) => g.groupId === 'q2')?.stimulusNeed).toEqual({
      status: 'needed',
      form: 'table',
    });
    expect(shape.groups.every((g) => g.heldStimulus === null && g.sectionId === null)).toBe(true);
    expect(shape.sections).toEqual([]);
    expect(shape.structureSlotCount).toBe(5);
    expect(validatePaperStructure(shape)).toEqual([]);
    expect(paperPartsInDependencyOrder(shape).map((p) => p.slotId)).toEqual([
      'slot-0',
      'slot-4',
      'slot-1',
      'slot-2',
      'slot-3',
    ]);
  });

  it('maps the three stimulus states apart: identified is needed with its form, none is not needed, not identified stays not identified', () => {
    const t = template(
      [
        tgroup('g1', 'shared-stimulus', {
          stimulus: { status: 'identified', form: 'extract', anchor: null },
        }),
        tgroup('g2', 'parent-question', { stimulus: { status: 'none' } }),
        tgroup('g3', 'parent-question', {
          stimulus: { status: 'not-identified', form: 'figure', reason: 'figure-not-in-text' },
        }),
      ],
      [tpart('a', 'g1'), tpart('b', 'g2'), tpart('c', 'g3')],
    );
    const shape = built(t, ['a', 'b', 'c'], ['slot-0', 'slot-1', 'slot-2']);
    expect(shape.groups.map((g) => g.stimulusNeed)).toEqual([
      { status: 'needed', form: 'extract' },
      { status: 'not-needed' },
      { status: 'not-identified' },
    ]);
  });

  it('a choice offers the alternatives the paper prints and answers k of them, or k unknown when unstated', () => {
    const t = (choose?: number) =>
      template(
        [
          tgroup('c', 'choice', {
            memberLabels: ['a', 'b'],
            ...(choose !== undefined ? { choose } : {}),
          }),
        ],
        [tpart('a', 'c'), tpart('b', 'c')],
      );
    expect(built(t(1), ['a', 'b'], ['slot-0', 'slot-1']).groups[0]?.choice).toEqual({
      alternatives: 2,
      choose: 1,
    });
    expect(built(t(), ['a', 'b'], ['slot-0', 'slot-1']).groups[0]?.choice).toEqual({
      alternatives: 2,
      choose: null,
    });
  });

  it('keeps the printed total and time only when every part is taken; a paper of some questions prints neither, and a total that disagrees with its parts reads unknown', () => {
    const slots = ['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4'];
    const all = template(
      COURSE_A.groups,
      COURSE_A.parts.map((p) => ({ ...p, marks: stated(2) })),
      {
        totalMarks: stated(10),
        timeAllowance: { status: 'stated', minutes: 90 },
      },
    );
    expect(built(all, selectPaperTemplateParts(all, 5), slots).totalMarks).toEqual(stated(10));
    expect(built(all, selectPaperTemplateParts(all, 5), slots).timeAllowance).toEqual({
      status: 'stated',
      minutes: 90,
    });
    const some = built(all, selectPaperTemplateParts(all, 4), slots);
    expect(some.totalMarks).toEqual(UNKNOWN);
    expect(some.timeAllowance).toEqual({ status: 'unknown' });
    const disagrees = template(all.groups, all.parts, { totalMarks: stated(11) });
    expect(built(disagrees, selectPaperTemplateParts(disagrees, 5), slots).totalMarks).toEqual(
      UNKNOWN,
    );
  });

  it('refuses, never throws, a template that does not hold together or a paper with too few candidates', () => {
    const refused = (t: PaperStructureTemplate, ids: readonly string[], slots: readonly string[]) =>
      buildStructuredPaperShape(t, ids, slots).status;
    const slots = ['slot-0', 'slot-1', 'slot-2'];
    expect(
      refused(template([tgroup('g', 'parent-question')], [tpart('a', 'gone')]), ['a'], slots),
    ).toBe('refused');
    expect(
      refused(
        template(
          [
            tgroup('g1', 'parent-question', { parentGroupId: 'g2' }),
            tgroup('g2', 'parent-question', { parentGroupId: 'g1' }),
          ],
          [tpart('a', 'g1')],
        ),
        ['a'],
        slots,
      ),
    ).toBe('refused');
    expect(refused(COURSE_A, ['p1a', 'p1b'], ['slot-0'])).toBe('refused');
    expect(refused(COURSE_A, [], slots)).toBe('refused');
    // A choice whose printed alternatives the reading's parts do not cover.
    const uncovered = template(
      [tgroup('c', 'choice', { memberLabels: ['a', 'b', 'x'], choose: 1 })],
      [tpart('a', 'c'), tpart('b', 'c')],
    );
    expect(refused(uncovered, ['a', 'b'], slots)).toBe('refused');
  });
});

describe('the plan of a structured paper, with the reasons decided before any call [D-559]', () => {
  it('writes the parts in dependency order, each with the slots it depends on', () => {
    const blueprint = blueprintOver(5, 5);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const planned = planStructuredPaper(blueprint, shape);
    // [D-561]: 1(b) is written on 1(a)'s concept; the parts that state no dependency keep ranking
    // order, and the lowest-ranked candidate, whose place 1(b) took, is named rank-excluded.
    expect(
      planned?.plan.map((slot) => [slot.slotId, slot.conceptName, slot.dependsOnSlotIds]),
    ).toEqual([
      ['slot-0', 'Topic A', []],
      ['slot-4', 'Topic A', ['slot-0']],
      ['slot-1', 'Topic B', []],
      ['slot-2', 'Topic C', []],
      ['slot-3', 'Topic D', []],
    ]);
    expect(planned?.planTimeEmptySlots.map((e) => [e.slotId, e.conceptName, e.reasonCode])).toEqual(
      [['excluded-4', 'Topic E', 'rank-excluded']],
    );
  });

  it('names the dependent of a source gap with the gap as its root, and lists the gap before it', () => {
    // slot-0 is Topic A (held), slot-1 Topic B (no held source): a concept with no held source
    // ranks last, so its part is printed first here by hand, with the other part building on it.
    const blueprint = blueprintOver(2, 2, [1]);
    const shape = shape_with([
      part('slot-1', 'q', { dependsOn: { status: 'unknown' } }),
      part('slot-0', 'q', { dependsOn: { status: 'stated', onSlotIds: ['slot-1'] } }),
    ]);
    const planned = planStructuredPaper(blueprint, shape);
    expect(planned?.plan).toEqual([]);
    expect(
      planned?.planTimeEmptySlots.map((e) => [e.slotId, e.reasonCode, e.causedBySlotId]),
    ).toEqual([
      ['slot-1', 'no-held-source', undefined],
      ['slot-0', 'depends-on-empty-part', 'slot-1'],
      ['excluded-0', 'rank-excluded', undefined],
    ]);
    // [D-561]: the dependent is about the concept of the part it builds on, so it is named by that
    // concept; the concept whose candidate place it took is named rank-excluded, never dropped.
    expect(planned?.planTimeEmptySlots.map((e) => e.conceptName)).toEqual([
      'Topic B',
      'Topic B',
      'Topic A',
    ]);
  });

  it('a group the lookup found nothing for ends no-held-stimulus, unless a part has an earlier reason; a group it did not look for is planned', () => {
    // Topics C, D and E have no held source: 2(b) (slot-2) and 3 (slot-3) are empty for that reason.
    const blueprint = blueprintOver(5, 5, [2, 3, 4]);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    expect(paperGroupsNeedingStimulus(shape)).toEqual([
      { groupId: 'q2', form: 'table', slotIds: ['slot-1', 'slot-2'] },
    ]);
    const notLooked = planStructuredPaper(blueprint, shape);
    expect(notLooked?.plan.map((slot) => slot.slotId)).toEqual(['slot-0', 'slot-4', 'slot-1']);
    const noneHeld = planStructuredPaper(blueprint, shape, new Set(['q2']));
    expect(noneHeld?.plan.map((slot) => slot.slotId)).toEqual(['slot-0', 'slot-4']);
    expect(noneHeld?.planTimeEmptySlots.map((e) => [e.slotId, e.reasonCode])).toEqual([
      ['slot-1', 'no-held-stimulus'],
      ['slot-2', 'no-held-source'],
      ['slot-3', 'no-held-source'],
      ['excluded-4', 'rank-excluded'],
    ]);
  });

  it('a held stimulus is recorded on its group by source and chunk, and the group is planned', () => {
    const blueprint = blueprintOver(5, 5);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const held = withPaperHeldStimuli(
      shape,
      new Map([['q2', { form: 'table' as const, sourceId: 'n2', chunkIndex: 0 }]]),
    );
    expect(held.groups.find((g) => g.groupId === 'q2')?.heldStimulus).toEqual({
      form: 'table',
      sourceId: 'n2',
      chunkIndex: 0,
    });
    expect(planStructuredPaper(blueprint, held, new Set(['q2']))?.plan).toHaveLength(5);
  });

  it('the blueprint’s rank-excluded slots follow the parts’ empty slots, and a shape over another blueprint is refused', () => {
    const blueprint = blueprintOver(7, 5);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    // The blueprint's two, then the candidate 1(b) took the place of ([D-561]).
    expect(
      planStructuredPaper(blueprint, shape)?.planTimeEmptySlots.map((e) => [
        e.slotId,
        e.reasonCode,
      ]),
    ).toEqual([
      ['excluded-5', 'rank-excluded'],
      ['excluded-6', 'rank-excluded'],
      ['excluded-4', 'rank-excluded'],
    ]);
    expect(planStructuredPaper(blueprintOver(7, 4), shape)).toBeNull();
  });
});

// ol-egov.141.89.7.93 ([D-561], Class B for David's review): a part that builds on an earlier part
// is about that part's concept. Synthetic ids only.
describe('a part that builds on an earlier part is written on that part’s concept [D-561]', () => {
  /** Question 1 (a; b on a; c on b), question 2 (d), question 3 (e; f on e and on a). */
  const CHAINED = template(
    [
      tgroup('q1', 'parent-question'),
      tgroup('q2', 'parent-question'),
      tgroup('q3', 'parent-question'),
    ],
    [
      tpart('a', 'q1'),
      tpart('b', 'q1', { dependsOn: { status: 'stated', onPartIds: ['a'] } }),
      tpart('c', 'q1', { dependsOn: { status: 'stated', onPartIds: ['b'] } }),
      tpart('d', 'q2'),
      tpart('e', 'q3'),
      tpart('f', 'q3', { dependsOn: { status: 'stated', onPartIds: ['e', 'a'] } }),
    ],
  );

  it('through a chain and on the first of several in printed order; the parts that state none keep ranking order; slot ids stay unique and the order stays the dependency order', () => {
    const blueprint = blueprintOver(6, 6);
    const shape = built(
      CHAINED,
      selectPaperTemplateParts(CHAINED, 6),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    expect(shape.parts.map((p) => [p.label, p.slotId])).toEqual([
      ['a', 'slot-0'],
      ['b', 'slot-3'],
      ['c', 'slot-4'],
      ['d', 'slot-1'],
      ['e', 'slot-2'],
      ['f', 'slot-5'],
    ]);
    expect(validatePaperStructure(shape)).toEqual([]);
    expect(new Set(shape.parts.map((p) => p.slotId)).size).toBe(6);
    expect([...paperPartConceptSlotIds(shape)]).toEqual([
      ['slot-0', 'slot-0'],
      ['slot-3', 'slot-0'],
      ['slot-4', 'slot-0'],
      ['slot-1', 'slot-1'],
      ['slot-2', 'slot-2'],
      ['slot-5', 'slot-0'],
    ]);

    const planned = planStructuredPaper(blueprint, shape);
    expect(
      planned?.plan.map((slot) => [slot.slotId, slot.conceptName, slot.dependsOnSlotIds]),
    ).toEqual([
      ['slot-0', 'Topic A', []],
      ['slot-3', 'Topic A', ['slot-0']],
      ['slot-4', 'Topic A', ['slot-3']],
      ['slot-1', 'Topic B', []],
      ['slot-2', 'Topic C', []],
      ['slot-5', 'Topic A', ['slot-2', 'slot-0']],
    ]);
    // The candidates whose places the three dependent parts took are named, never dropped.
    expect(planned?.planTimeEmptySlots.map((e) => [e.slotId, e.conceptName, e.reasonCode])).toEqual(
      [
        ['excluded-3', 'Topic D', 'rank-excluded'],
        ['excluded-4', 'Topic E', 'rank-excluded'],
        ['excluded-5', 'Topic F', 'rank-excluded'],
      ],
    );
    // The blueprint it writes from holds the earlier part's concept, source and chunks at each
    // dependent part's own slot id, and planning over it again gives the same plan.
    const written = planned?.blueprint;
    expect(
      written?.slots.map((s) => [s.slotId, s.conceptKey, s.heldSourceId, s.sourceChunks]),
    ).toEqual([
      ['slot-0', 'k0', 'n0', ['note 0']],
      ['slot-1', 'k1', 'n1', ['note 1']],
      ['slot-2', 'k2', 'n2', ['note 2']],
      ['slot-3', 'k0', 'n0', ['note 0']],
      ['slot-4', 'k0', 'n0', ['note 0']],
      ['slot-5', 'k0', 'n0', ['note 0']],
    ]);
    expect(written !== undefined && planStructuredPaper(written, shape)).toEqual(planned);
  });

  it('never takes the reason of the candidate whose place it took: a part on a held concept is written', () => {
    // Topic C has no held source and ranks last, so its candidate (slot-2) is the one 1(b) takes.
    const t = template(
      [tgroup('q1', 'parent-question'), tgroup('q2', 'parent-question')],
      [
        tpart('a', 'q1'),
        tpart('b', 'q1', { dependsOn: { status: 'stated', onPartIds: ['a'] } }),
        tpart('c', 'q2'),
      ],
    );
    const blueprint = blueprintOver(3, 3, [2]);
    const shape = built(
      t,
      selectPaperTemplateParts(t, 3),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const planned = planStructuredPaper(blueprint, shape);
    expect(planned?.plan.map((slot) => [slot.slotId, slot.conceptName])).toEqual([
      ['slot-0', 'Topic A'],
      ['slot-2', 'Topic A'],
      ['slot-1', 'Topic B'],
    ]);
    expect(planned?.planTimeEmptySlots.map((e) => [e.slotId, e.conceptName, e.reasonCode])).toEqual(
      [['excluded-2', 'Topic C', 'rank-excluded']],
    );
  });

  it('on resume, a dependent part in a group the lookup found nothing for is read back as that, whatever was left at its slot id', () => {
    const t = template(
      [
        tgroup('q1', 'parent-question'),
        tgroup('q2', 'shared-stimulus', {
          stimulus: { status: 'identified', form: 'table', anchor: null },
        }),
        tgroup('q3', 'parent-question'),
      ],
      [
        tpart('a', 'q1'),
        tpart('b', 'q2', { dependsOn: { status: 'stated', onPartIds: ['a'] } }),
        tpart('c', 'q3'),
      ],
    );
    // Topic C (slot-2, no held source) is the candidate the dependent part b takes the place of.
    const blueprint = blueprintOver(3, 3, [2]);
    const shape = built(
      t,
      selectPaperTemplateParts(t, 3),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const planned = planStructuredPaper(blueprint, shape, new Set(['q2']));
    expect(planned?.plan.map((slot) => slot.slotId)).toEqual(['slot-0', 'slot-1']);
    expect(planned?.planTimeEmptySlots.map((e) => [e.slotId, e.reasonCode])).toEqual([
      ['slot-2', 'no-held-stimulus'],
      ['excluded-2', 'rank-excluded'],
    ]);
    const own = new Set(blueprint.emptySlots.map((e) => e.slotId));
    const read = paperNoneHeldGroupIdsFromPlan(
      shape,
      new Set(planned?.plan.map((slot) => slot.slotId)),
      own,
    );
    expect([...read]).toEqual(['q2']);
    expect(planStructuredPaper(blueprint, shape, read)).toEqual(planned);
  });
});

function shape_with(parts: readonly PaperStructuredPart[]): PaperStructuredShape {
  return shape({
    sections: [],
    groups: [
      group(
        'q',
        parts.map((p) => p.slotId),
        { sectionId: null },
      ),
    ],
    parts,
    structureSlotCount: parts.length,
  });
}

describe('on resume, the groups the lookup found nothing for are read back from the recorded plan [D-560, D-562]', () => {
  it('reproduces the plan it was made with, whichever groups were found none for', () => {
    const blueprint = blueprintOver(5, 5);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const own = new Set(blueprint.emptySlots.map((e) => e.slotId));
    for (const noneHeld of [new Set<string>(), new Set(['q2'])]) {
      const planned = planStructuredPaper(blueprint, shape, noneHeld);
      const read = paperNoneHeldGroupIdsFromPlan(
        shape,
        new Set(planned?.plan.map((slot) => slot.slotId)),
        own,
      );
      expect([...read]).toEqual([...noneHeld]);
      expect(planStructuredPaper(blueprint, shape, read)).toEqual(planned);
    }
  });

  it('where the plan cannot tell, the group reads as not looked for, which never claims her material lacks something', () => {
    // Every part of the needed group is empty for a reason of its own (only Topic A is held).
    const blueprint = blueprintOver(5, 5, [1, 2, 3, 4]);
    const shape = built(
      COURSE_A,
      selectPaperTemplateParts(COURSE_A, 5),
      paperBlueprintCandidateSlotIds(blueprint),
    );
    const own = new Set(blueprint.emptySlots.map((e) => e.slotId));
    const planned = planStructuredPaper(blueprint, shape, new Set(['q2']));
    const read = paperNoneHeldGroupIdsFromPlan(
      shape,
      new Set(planned?.plan.map((slot) => slot.slotId)),
      own,
    );
    expect([...read]).toEqual([]);
    expect(planStructuredPaper(blueprint, shape, read)).toEqual(planned);
  });
});

describe('a recorded structure is read back only when it is the shape it claims [D-560]', () => {
  const blueprint = blueprintOver(5, 5);
  const good = built(
    COURSE_A,
    selectPaperTemplateParts(COURSE_A, 5),
    paperBlueprintCandidateSlotIds(blueprint),
  );

  it('accepts a shape the builder made, through JSON and back', () => {
    expect(isRecordedPaperStructuredShape(JSON.parse(JSON.stringify(good)))).toBe(true);
  });

  it('refuses a missing field, an unknown value, a malformed held stimulus, or a shape that is not well formed', () => {
    const variants: unknown[] = [
      null,
      { ...good, formatVersion: 'paper-structure-v0' },
      { ...good, structureBasis: 'regime-unknown' },
      { ...good, parts: [{ ...good.parts[0], demand: { status: 'read', demand: 'explain' } }] },
      { ...good, groups: good.groups.map((g) => ({ ...g, heldStimulus: { form: 'table' } })) },
      { ...good, parts: good.parts.map((p) => ({ ...p, marks: { status: 'stated', value: -2 } })) },
      { ...good, groups: good.groups.slice(1) },
      { ...good, timeAllowance: undefined },
    ];
    for (const value of variants) expect(isRecordedPaperStructuredShape(value)).toBe(false);
  });
});
