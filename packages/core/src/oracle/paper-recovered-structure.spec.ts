import { describe, expect, it } from 'vitest';
import type { DocumentStateView, StructureView } from '../outcome/scope-reading-project.js';
import type { ScopePaperStructure } from '../outcome/scope-reading-types.js';
import { extentSlotCountTarget } from './paper-blueprint.js';
import {
  type PastPaperStoredReading,
  paperRecoveredStructureFromReadings,
  paperStructureTemplateOf,
  pastPaperReadingCounts,
} from './paper-recovered-structure.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 pipeline — blueprint, generation, the
// vault object, the unlock rule [PAPER-3]", the `[D-548]` scenarios tagged
// `@auto:core/oracle/paper-recovered-structure.spec`. Synthetic readings only (INV-3).

const PROVENANCE = { task: 'outcomes.extract.v1', promptVersion: '1.1.0', modelId: 'model-a' };
const RECORDED: DocumentStateView = {
  status: 'known',
  state: { kind: 'recorded' },
  provenance: PROVENANCE,
  recordedAt: '2026-10-20T00:00:00.000Z',
};

/** A reading of one paper with one section per entry of `itemCounts`, every section's marks stated as its count unless `marks` says otherwise. */
function paperReading(
  itemCounts: readonly number[],
  marks: (index: number) => ScopePaperStructure['sections'][number]['marks'] = (index) => ({
    status: 'stated',
    value: itemCounts[index] ?? 0,
  }),
): ScopePaperStructure {
  return {
    sections: itemCounts.map((itemCount, index) => ({
      label: `Section ${index + 1}`,
      questionForm: 'short-answer',
      itemCount,
      marks: marks(index),
      anchor: { unitIndex: index },
    })),
    totalMarks: { status: 'unknown' },
    timeAllowance: { status: 'unknown' },
  };
}

function current(reading: ScopePaperStructure): StructureView {
  return { status: 'current', reading, provenance: PROVENANCE, structureId: 'structure-1' };
}

function stored(
  reading: ScopePaperStructure,
  state: DocumentStateView = RECORDED,
): PastPaperStoredReading {
  return { state, structure: current(reading) };
}

describe('a stored reading of her past papers sets the paper’s length [D-548]', () => {
  it('three fully read papers of 3, 4 and 7 questions plan the median, 4, at the standard extent, instead of the declared 6', () => {
    const structure = paperRecoveredStructureFromReadings([
      stored(paperReading([3])),
      stored(paperReading([2, 2])),
      stored(paperReading([5, 2])),
    ]);
    expect(structure).not.toBeNull();
    expect(structure?.sittingCount).toBe(3);
    expect(extentSlotCountTarget('standard', structure)).toBe(4);
    expect(extentSlotCountTarget('standard', null)).toBe(6);
  });

  it('a paper longer than the ceiling is clamped to 8, and a reading with no sections leaves the declared extent', () => {
    expect(
      extentSlotCountTarget(
        'standard',
        paperRecoveredStructureFromReadings([stored(paperReading([40]))]),
      ),
    ).toBe(8);
    const sectionless = paperRecoveredStructureFromReadings([stored(paperReading([]))]);
    expect(sectionless?.sittingCount).toBe(1);
    expect(extentSlotCountTarget('standard', sectionless)).toBe(6);
  });

  it('each reading counts once whatever its regime or seal: its regime reads unknown, never assumed current, and no demand or source pointer is carried', () => {
    const structure = paperRecoveredStructureFromReadings([
      stored(paperReading([3])),
      stored(paperReading([5])),
    ]);
    expect(structure).toMatchObject({ sittingCount: 2, currentCount: 0, historicalCount: 0 });
    for (const sitting of structure?.sittings ?? []) {
      expect(sitting.regime).toBe('unknown');
      expect(sitting).not.toHaveProperty('sourceRef');
      for (const section of sitting.sections) expect(section).not.toHaveProperty('demands');
    }
  });

  it('carries each section’s label, question form, item count and marks, in the caller’s order, and nothing of the anchors', () => {
    const structure = paperRecoveredStructureFromReadings([stored(paperReading([3, 1]))]);
    expect(structure?.sittings[0]?.sections).toEqual([
      {
        label: 'Section 1',
        questionForm: 'short-answer',
        itemCount: 3,
        marks: { status: 'stated', value: 3 },
      },
      {
        label: 'Section 2',
        questionForm: 'short-answer',
        itemCount: 1,
        marks: { status: 'stated', value: 1 },
      },
    ]);
  });
});

describe('with no stored reading, the declared standard extent stands [D-548]', () => {
  it('no readings at all is null, never an empty structure', () => {
    expect(paperRecoveredStructureFromReadings([])).toBeNull();
  });

  it('a reading of a stale revision, a stale reader, or nothing recorded for the revision does not count', () => {
    const stale: readonly PastPaperStoredReading[] = [
      { state: RECORDED, structure: { status: 'stale-revision' } },
      {
        state: RECORDED,
        structure: {
          status: 'stale-reader',
          reading: paperReading([3]),
          provenance: PROVENANCE,
          structureId: 'structure-2',
        },
      },
      { state: RECORDED, structure: { status: 'absent' } },
    ];
    for (const reading of stale) expect(pastPaperReadingCounts(reading)).toBe(false);
    expect(paperRecoveredStructureFromReadings(stale)).toBeNull();
  });

  it('a paper read only in part, or whose state is not yet written or is owed, does not count: its count is not the paper’s count', () => {
    const notInFull: readonly PastPaperStoredReading[] = [
      stored(paperReading([2]), {
        status: 'known',
        state: { kind: 'partly-read', unitsRead: 1, unitsTotal: 3 },
        recordedAt: '2026-10-20T00:00:00.000Z',
      }),
      stored(paperReading([2]), { status: 'unknown', otherRevisionsRecorded: false }),
      stored(paperReading([2]), {
        status: 'known',
        state: { kind: 'pending', reason: 'unavailable' },
        recordedAt: '2026-10-20T00:00:00.000Z',
      }),
    ];
    expect(paperRecoveredStructureFromReadings(notInFull)).toBeNull();
    expect(
      paperRecoveredStructureFromReadings([...notInFull, stored(paperReading([7]))])?.sittingCount,
    ).toBe(1);
  });
});

describe('section marks a past paper does not state stay unknown [D-431]', () => {
  it('an unknown mark is carried as unknown, never zero, beside a stated one', () => {
    const structure = paperRecoveredStructureFromReadings([
      stored(
        paperReading([3, 2], (index) =>
          index === 0 ? { status: 'unknown' } : { status: 'stated', value: 10 },
        ),
      ),
    ]);
    expect(structure?.sittings[0]?.sections.map((section) => section.marks)).toEqual([
      { status: 'unknown' },
      { status: 'stated', value: 10 },
    ]);
  });
});

// ol-egov.141.89.7.93 ([D-559]): "her stored reading's groups and parts shape her paper", tagged
// `@auto:core/oracle/paper-recovered-structure.spec`. Course A is synthetic: one parent question
// with two parts, the second building on the first, and a shared-table group of one part.
function structuredReading(overrides: Partial<ScopePaperStructure> = {}): ScopePaperStructure {
  return {
    ...paperReading([3]),
    groups: [
      {
        id: 'q1',
        kind: 'parent-question',
        label: 'Question 1',
        memberLabels: ['1(a)', '1(b)'],
        anchor: { unitIndex: 1 },
        stimulus: { status: 'none' },
      },
      {
        id: 'q2',
        kind: 'shared-stimulus',
        label: 'Use the table',
        memberLabels: ['2'],
        anchor: { unitIndex: 4 },
        stimulus: { status: 'identified', form: 'table', anchor: { unitIndex: 4 } },
      },
    ],
    parts: [
      {
        id: 'p1a',
        label: '1(a)',
        groupId: 'q1',
        instructionAnchor: { unitIndex: 2 },
        questionForm: 'short answer',
        marks: { status: 'stated', value: 2 },
        dependsOn: { status: 'unknown' },
      },
      {
        id: 'p1b',
        label: '1(b)',
        groupId: 'q1',
        instructionAnchor: { unitIndex: 3 },
        questionForm: 'short answer',
        marks: { status: 'unknown' },
        dependsOn: { status: 'stated', onPartIds: ['p1a'] },
      },
      {
        id: 'p2',
        label: '2',
        groupId: 'q2',
        instructionAnchor: { unitIndex: 5 },
        questionForm: 'calculation',
        marks: { status: 'stated', value: 4 },
        dependsOn: { status: 'unknown' },
      },
    ],
    totalMarks: { status: 'stated', value: 9 },
    ...overrides,
  };
}

describe('her stored reading’s groups and parts are the template a structured paper is shaped on [D-559]', () => {
  it('carries the groups and parts with their dependencies as the reading states them, unknown marks and dependencies unknown, and none of the anchors of the parts', () => {
    const structure = paperRecoveredStructureFromReadings([stored(structuredReading())]);
    const template = structure?.template;
    expect(template?.groups.map((g) => [g.id, g.kind])).toEqual([
      ['q1', 'parent-question'],
      ['q2', 'shared-stimulus'],
    ]);
    expect(template?.parts).toEqual([
      {
        id: 'p1a',
        label: '1(a)',
        groupId: 'q1',
        questionForm: 'short answer',
        marks: { status: 'stated', value: 2 },
        dependsOn: { status: 'unknown' },
      },
      {
        id: 'p1b',
        label: '1(b)',
        groupId: 'q1',
        questionForm: 'short answer',
        marks: { status: 'unknown' },
        dependsOn: { status: 'stated', onPartIds: ['p1a'] },
      },
      {
        id: 'p2',
        label: '2',
        groupId: 'q2',
        questionForm: 'calculation',
        marks: { status: 'stated', value: 4 },
        dependsOn: { status: 'unknown' },
      },
    ]);
    expect(template?.totalMarks).toEqual({ status: 'stated', value: 9 });
    // The length is still the sections' own: the template does not change it.
    expect(extentSlotCountTarget('standard', structure)).toBe(3);
  });

  it('takes the first counted reading, in the caller’s order, that carries both groups and parts', () => {
    const second = structuredReading({ totalMarks: { status: 'stated', value: 50 } });
    const structure = paperRecoveredStructureFromReadings([
      stored(paperReading([2])),
      stored(structuredReading(), { status: 'unknown', otherRevisionsRecorded: false }),
      stored(second),
      stored(structuredReading()),
    ]);
    expect(structure?.sittingCount).toBe(3);
    expect(structure?.template?.totalMarks).toEqual({ status: 'stated', value: 50 });
  });

  it('a reading with sections only, groups without parts, or parts without groups gives no template, and the structure is the length alone, as before', () => {
    const { groups, parts, ...sectionsOnly } = structuredReading();
    for (const reading of [
      sectionsOnly,
      { ...sectionsOnly, groups },
      { ...sectionsOnly, parts },
      { ...sectionsOnly, groups: [], parts },
    ] as ScopePaperStructure[]) {
      const structure = paperRecoveredStructureFromReadings([stored(reading)]);
      expect(structure?.sittingCount).toBe(1);
      expect(structure).not.toHaveProperty('template');
    }
  });

  it('a template whose groups or parts are not well formed is not handed out, never repaired', () => {
    const base = structuredReading();
    const broken: ScopePaperStructure[] = [
      {
        ...base,
        parts: [{ ...(base.parts?.[0] as object), id: '' }],
      } as unknown as ScopePaperStructure,
      {
        ...base,
        parts: [{ ...(base.parts?.[0] as object), marks: { status: 'stated', value: -1 } }],
      } as unknown as ScopePaperStructure,
      {
        ...base,
        groups: [{ ...(base.groups?.[0] as object), kind: 'appendix' }],
      } as unknown as ScopePaperStructure,
      {
        ...base,
        groups: [{ ...(base.groups?.[1] as object), stimulus: { status: 'maybe' } }],
      } as unknown as ScopePaperStructure,
      { ...base, parts: [base.parts?.[0], base.parts?.[0]] } as ScopePaperStructure,
      {
        ...base,
        parts: [{ ...(base.parts?.[1] as object), dependsOn: { status: 'stated' } }],
      } as unknown as ScopePaperStructure,
    ];
    for (const reading of broken) expect(paperStructureTemplateOf(reading)).toBeNull();
    expect(paperStructureTemplateOf(base)).not.toBeNull();
  });
});
