import { describe, expect, it } from 'vitest';
import type { DocumentStateView, StructureView } from '../outcome/scope-reading-project.js';
import type { ScopePaperStructure } from '../outcome/scope-reading-types.js';
import { extentSlotCountTarget } from './paper-blueprint.js';
import {
  type PastPaperStoredReading,
  paperRecoveredStructureFromReadings,
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
