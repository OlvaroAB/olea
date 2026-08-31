import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { GroveCourseModel } from '../scope/grove.js';
import type { VaultPath } from '../vault/types.js';
import type { DueInstrument } from './due.js';
import { buildTodayPanel, type TodayPanelInput } from './panel.js';

const TODAY = '2026-08-10';
const DUE_THROUGH = new Date('2026-08-11T03:59:59.999Z');

function review(day: string, eventId: string): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00-04:00`,
    instrumentId: 'qa:clast-imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['clast-imbrication'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

function input(overrides: Partial<TodayPanelInput> = {}): TodayPanelInput {
  return {
    entries: [],
    instruments: [],
    today: TODAY,
    dueThrough: DUE_THROUGH,
    windowDays: 30,
    ...overrides,
  };
}

const instruments: readonly DueInstrument[] = [
  { instrumentId: 'a', courseCode: 'BIOL204', courseName: 'Quartzose sandstone', due: null },
  {
    instrumentId: 'b',
    courseCode: 'BIOL204',
    courseName: 'Quartzose sandstone',
    due: '2026-08-09T08:00:00Z',
  },
  { instrumentId: 'c', courseCode: 'STAT110', courseName: 'Counterpoint', due: null },
];

describe('buildTodayPanel', () => {
  it('is the halves it has and nothing else', () => {
    // Was `['due', 'streak']` until F6.2/F6.5 (`ol-lohq`, `ol-p6t04`) added the
    // trends half, `rhythm` joined it at F6.9 (`ol-v7r5.6`), `courseFreshness`
    // joined it at `ol-ksw7` (migrated in from a plugin-local widening), and
    // `scope` joined it at `ol-4qvc` (F6.2's cross-course scope reading).
    // Kept as an exact field-set assertion rather than relaxed to
    // `toContain`: the point of it is that a field cannot appear here without
    // somebody deciding it should.
    const vm = buildTodayPanel(input());
    expect(Object.keys(vm).sort()).toEqual([
      'courseFreshness',
      'due',
      'insights',
      'mastery',
      'rhythm',
      'scope',
      'streak',
      'windowDays',
    ]);
  });

  it('leaves the trends half null when no concept set was supplied', () => {
    // Absent is not empty: a panel that was never handed concepts has not
    // measured a distribution of none, it has not been asked. Same distinction
    // as `instruments: null` vs `[]` — see the field's own doc.
    const vm = buildTodayPanel(input());
    expect(vm.mastery).toBeNull();
    expect(vm.insights).toBeNull();
  });

  it('an EMPTY concept set is a real answer, and produces a real (empty) overview', () => {
    const vm = buildTodayPanel(input({ concepts: [] }));
    expect(vm.mastery).toEqual({ courses: [], unassignedConceptCount: 0, conceptCount: 0 });
    // Both detectors decline rather than reporting a negative over nothing.
    expect(vm.insights?.spacing.status).toBe('not-enough-history');
    expect(vm.insights?.effort.status).toBe('not-enough-history');
  });

  it('groups the mastery overview by course, and a never-reviewed concept counts as seed', () => {
    const vm = buildTodayPanel(
      input({
        entries: [review(TODAY, 'r1')],
        concepts: [
          { conceptId: 'clast-imbrication', courses: ['BIOL204'] },
          { conceptId: 'never-opened', courses: ['BIOL204'] },
          { conceptId: 'counterpoint', courses: ['STAT110'] },
        ],
      }),
    );
    expect(vm.mastery?.courses.map((c) => c.course)).toEqual(['BIOL204', 'STAT110']);
    expect(vm.mastery?.courses[0]?.distribution.total).toBe(2);
    expect(vm.mastery?.courses[0]?.distribution.counts.seed).toBe(1);
  });

  it('echoes the window it was given, so the panel can state its own scope', () => {
    expect(buildTodayPanel(input({ windowDays: 120 })).windowDays).toBe(120);
  });

  it('counts what is due and folds the streak in one call', () => {
    const vm = buildTodayPanel(
      input({
        instruments,
        entries: [review('2026-08-09', 'r1'), review(TODAY, 'r2')],
      }),
    );
    expect(vm.due?.total).toBe(3);
    expect(vm.due?.courses.map((c) => c.courseCode)).toEqual(['BIOL204', 'STAT110']);
    expect(vm.streak.currentDays).toBe(2);
    expect(vm.streak.studiedToday).toBe(true);
  });

  it('passes suspension through to the count', () => {
    const vm = buildTodayPanel(input({ instruments, suspendedInstrumentIds: new Set(['a', 'b']) }));
    expect(vm.due?.total).toBe(1);
  });
});

describe('buildTodayPanel — F6.9 rhythm reading (ol-v7r5.6)', () => {
  it('leaves the rhythm half null when no arrival list was supplied — a third state, not a computed answer', () => {
    const vm = buildTodayPanel(input());
    expect(vm.rhythm).toBeNull();
  });

  it('an EMPTY arrival list is a real answer, and reaches detectRhythm as one', () => {
    const vm = buildTodayPanel(input({ courseMaterialArrivals: [] }));
    expect(vm.rhythm).toEqual({
      id: 'rhythm',
      status: 'not-enough-history',
      measured: null,
      reason: 'no courses were supplied',
    });
  });

  it('folds a real arrival list through detectRhythm, quiet course named', () => {
    const vm = buildTodayPanel(
      input({
        today: '2026-08-31',
        courseMaterialArrivals: [
          { course: 'GEO101', lastMaterialArrivalDay: '2026-08-01' }, // 30 days quiet
          { course: 'MUS101', lastMaterialArrivalDay: '2026-08-25' }, // 6 days, not quiet
        ],
      }),
    );
    expect(vm.rhythm?.status).toBe('observed');
    expect(vm.rhythm?.measured?.quietestCourse).toBe('GEO101');
    expect(vm.rhythm?.measured?.maxQuietDays).toBe(30);
  });

  it("threads a resolved term window through, reflected in the measured reading's hadTermWindow", () => {
    const vm = buildTodayPanel(
      input({
        today: '2026-08-31',
        courseMaterialArrivals: [{ course: 'GEO101', lastMaterialArrivalDay: '2026-08-25' }],
        termWindow: { start: '2026-08-01', end: '2026-12-15' },
      }),
    );
    expect(vm.rhythm?.measured?.hadTermWindow).toBe(true);
  });

  it('an absent term window still computes the reading — F6.9 never blocks on it', () => {
    const vm = buildTodayPanel(
      input({
        today: '2026-08-31',
        courseMaterialArrivals: [{ course: 'GEO101', lastMaterialArrivalDay: '2026-08-25' }],
      }),
    );
    expect(vm.rhythm?.measured?.hadTermWindow).toBe(false);
  });
});

describe('buildTodayPanel — RHY-3 calendar-schedule freshness pass-through (`ol-ksw7`)', () => {
  // Migrated in from a plugin-local widening (`TodayViewModelWithSchedule` in
  // `packages/plugin/src/today/data-source.ts`, `ol-at1a`) — this function
  // performs no computation on the field, only the same "undefined input
  // becomes null output" resolution every other optional field here takes.
  // INV-3: every course code below is coined for this test.

  it('is null when the field was never supplied — the same third state every other optional input takes', () => {
    const vm = buildTodayPanel(input());
    expect(vm.courseFreshness).toBeNull();
  });

  it('is null when the field was explicitly supplied as null — "the signal could not be computed"', () => {
    const vm = buildTodayPanel(input({ courseFreshness: null }));
    expect(vm.courseFreshness).toBeNull();
  });

  it('an EMPTY list is a real answer, distinct from null, and passes through unchanged', () => {
    const vm = buildTodayPanel(input({ courseFreshness: [] }));
    expect(vm.courseFreshness).toEqual([]);
  });

  it('a real reading list passes through verbatim, with no reshaping', () => {
    const readings = [
      {
        courseCode: 'FIXTURE101',
        status: 'not-arrived-with-yardstick' as const,
        expectedSessionDate: '2026-08-05',
        basis: 'observed' as const,
        reason: 'test fixture reading',
      },
    ];
    const vm = buildTodayPanel(input({ courseFreshness: readings }));
    expect(vm.courseFreshness).toBe(readings);
  });
});

/**
 * F6.2's cross-course scope reading (`ol-a83u` [SCP-1], `ol-4qvc`). These
 * three tests re-assert the guarantees `../gap/scope-overview.spec.ts`
 * already proves against `buildCrossCourseScopeOverview` directly — done
 * again here, at the wiring layer, so `features/F6-today.md`'s F6.2
 * cross-course scenarios ("courses beside one another", "each course's own
 * denominator source", "no denominator yet") can retag to this suite
 * instead of `core/today/mastery-overview.spec`, where the aggregator never
 * lived (`ol-4qvc`'s own close notes). INV-3: every course code and path
 * below is invented.
 */
function declaredModel(
  course: string,
  denominatorCount: number,
  builtCount: number,
  denominatorSourcePaths: readonly VaultPath[],
): GroveCourseModel {
  return {
    status: 'declared',
    course,
    cells: [],
    materialGaps: [],
    volunteers: [],
    summary: { builtCount, denominatorCount, denominatorSourcePaths },
  };
}

function noRegisteredSourceModel(course: string): GroveCourseModel {
  return { status: 'no-registered-source', course };
}

describe('buildTodayPanel — F6.2 cross-course scope reading (ol-4qvc)', () => {
  it('is null when the field was never supplied — the same third state courseFreshness takes', () => {
    const vm = buildTodayPanel(input());
    expect(vm.scope).toBeNull();
  });

  it('is null when the field was explicitly supplied as null — "the scope source could not compute"', () => {
    const vm = buildTodayPanel(input({ courseScopeModels: null }));
    expect(vm.scope).toBeNull();
  });

  it('an EMPTY list is a real answer, distinct from null', () => {
    const vm = buildTodayPanel(input({ courseScopeModels: [] }));
    expect(vm.scope).toEqual({ courses: [], asOf: TODAY });
  });

  it('echoes this panel\'s own "today" as the reading\'s asOf, never a per-source registration date', () => {
    const vm = buildTodayPanel(
      input({ courseScopeModels: [declaredModel('AAA111', 5, 1, ['Sources/a.pdf' as VaultPath])] }),
    );
    expect(vm.scope?.asOf).toBe(TODAY);
  });

  it('places two declared courses beside one another, never scored against one another (C5.7)', () => {
    const vm = buildTodayPanel(
      input({
        courseScopeModels: [
          declaredModel('AAA111', 10, 2, ['Sources/aaa-objectives.pdf' as VaultPath]),
          declaredModel('ZZZ999', 10, 9, ['Sources/zzz-objectives.pdf' as VaultPath]),
        ],
      }),
    );
    for (const course of vm.scope?.courses ?? []) {
      expect(Object.keys(course).sort()).toEqual([
        'builtCount',
        'course',
        'denominatorCount',
        'denominatorSourcePaths',
        'status',
      ]);
    }
    // Course-code order, not "how well each course is going" order.
    expect(vm.scope?.courses.map((c) => c.course)).toEqual(['AAA111', 'ZZZ999']);
  });

  it("each course's count names its own denominator source, never a shared or borrowed one", () => {
    const vm = buildTodayPanel(
      input({
        courseScopeModels: [
          declaredModel('AAA111', 12, 3, ['Sources/aaa-objectives.pdf' as VaultPath]),
          declaredModel('BBB222', 8, 8, [
            'Sources/bbb-past-paper-1.pdf' as VaultPath,
            'Sources/bbb-past-paper-2.pdf' as VaultPath,
          ]),
        ],
      }),
    );
    const aaa = vm.scope?.courses.find((c) => c.course === 'AAA111');
    const bbb = vm.scope?.courses.find((c) => c.course === 'BBB222');
    if (aaa?.status !== 'declared' || bbb?.status !== 'declared') {
      throw new Error('expected both courses declared');
    }
    expect(aaa.denominatorSourcePaths).toEqual(['Sources/aaa-objectives.pdf']);
    expect(bbb.denominatorSourcePaths).toEqual([
      'Sources/bbb-past-paper-1.pdf',
      'Sources/bbb-past-paper-2.pdf',
    ]);
  });

  it('a course with no registered source states it has no denominator yet, never a borrowed one', () => {
    const vm = buildTodayPanel(
      input({
        courseScopeModels: [
          declaredModel('AAA111', 10, 2, ['Sources/aaa-objectives.pdf' as VaultPath]),
          noRegisteredSourceModel('BBB222'),
        ],
      }),
    );
    expect(vm.scope?.courses.find((c) => c.course === 'BBB222')).toEqual({
      course: 'BBB222',
      status: 'no-denominator-yet',
    });
  });
});

describe('buildTodayPanel — a zero it cannot stand behind', () => {
  it('an unenumerable instrument set gives no due summary at all', () => {
    const vm = buildTodayPanel(input({ instruments: null }));
    expect(vm.due).toBeNull();
  });

  it('nothing due is a real zero, and is distinguishable from not knowing', () => {
    const vm = buildTodayPanel(input({ instruments: [] }));
    expect(vm.due).toEqual({ total: 0, newCount: 0, courses: [] });
    expect(vm.due).not.toBeNull();
  });

  it('the streak still reads even when the due set is unknown — the log is readable either way', () => {
    const vm = buildTodayPanel(input({ instruments: null, entries: [review(TODAY, 'r1')] }));
    expect(vm.due).toBeNull();
    expect(vm.streak.currentDays).toBe(1);
  });
});

describe('buildTodayPanel is pure', () => {
  it('reads no clock and writes nothing', () => {
    const entries = [review('2026-08-09', 'r1')];
    const snapshot = structuredClone(entries);
    const first = buildTodayPanel(input({ entries, instruments }));
    const second = buildTodayPanel(input({ entries, instruments }));
    expect(second).toEqual(first);
    expect(entries).toEqual(snapshot);
  });
});

describe('buildTodayPanel — the new count travels with the due summary or not at all', () => {
  it('carries both numbers when the set is enumerable', () => {
    const vm = buildTodayPanel(input({ instruments }));
    expect(vm.due?.total).toBe(3);
    expect(vm.due?.newCount).toBe(2);
  });

  it('an unenumerable set has no new count either, because it has no summary', () => {
    const vm = buildTodayPanel(input({ instruments: null }));
    // Not `newCount: 0` on some other object — there is nowhere for a zero to
    // be, which is the whole point of `due` being nullable.
    expect(vm.due).toBeNull();
  });

  it('suspension is applied before the new count, not after', () => {
    const vm = buildTodayPanel(input({ instruments, suspendedInstrumentIds: new Set(['a', 'c']) }));
    expect(vm.due?.total).toBe(1);
    expect(vm.due?.newCount).toBe(0);
  });
});
