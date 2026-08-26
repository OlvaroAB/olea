import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
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
    // trends half. Kept as an exact field-set assertion rather than relaxed to
    // `toContain`: the point of it is that a field cannot appear here without
    // somebody deciding it should.
    const vm = buildTodayPanel(input());
    expect(Object.keys(vm).sort()).toEqual(['due', 'insights', 'mastery', 'streak', 'windowDays']);
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
