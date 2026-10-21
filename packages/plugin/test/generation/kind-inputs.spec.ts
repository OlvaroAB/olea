/**
 * Scenarios: features/F3-learn-from-anything.md, the `[D-550]` / `[D-551]` block —
 * @auto:plugin/generation/kind-inputs.spec
 *
 * The first-kind inputs (`ol-egov.141.89.105.7`): F4.8 as amended by `[D-550]` (recall-style asks
 * for multiple choice; written and practical for a question-and-answer card), per course from the
 * course's nearest assessment not yet passed (`[D-551]` (a), provisional), then her recorded
 * preference, then the multiple-choice floor (`primaryKindFor`). Every fixture string is invented.
 */
import type { ReviewLogEntry } from 'olea-contracts';
import {
  type AssessmentRecord,
  appendReviewLogRecord,
  type CalendarDay,
  DEFAULT_PRIMARY_KIND_FLOOR,
  primaryKindFor,
  type SchedulableInstrumentType,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildKindInputs,
  deriveKindInputs,
  FIRST_KIND_BY_FORMAT_CLASS,
  firstKindForFormatClass,
} from '../../src/generation/kind-inputs.js';
import { MemoryVaultSource } from './fakes.js';

const A = 'TESTA101';
const B = 'TESTB202';
const C = 'TESTC303';
const D = 'TESTD404';

function assessment(course: string, type: string | undefined, due: string | undefined, n = 1) {
  return {
    path: `02 Assignments/${course} ${n}.md`,
    course,
    type,
    weight: 10,
    weightRaw: '10',
    due,
    status: 'upcoming',
  } satisfies AssessmentRecord;
}

function review(instrumentType: SchedulableInstrumentType, n: number): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `event-${instrumentType}-${n}`,
    timestamp: '2026-01-05T09:00:00+00:00',
    instrumentId: `instrument-${instrumentType}-${n}`,
    instrumentType,
    conceptIds: ['concept-key-1'],
    rating: 'good',
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
  } as unknown as ReviewLogEntry;
}

const TODAY = '2026-01-10' as CalendarDay;

describe('the ruled mapping: format class to first kind ([D-550])', () => {
  it('recall-style asks for multiple choice; written and practical for a question-and-answer card', () => {
    expect(FIRST_KIND_BY_FORMAT_CLASS).toEqual({
      'recall-style': 'mcq',
      written: 'qa',
      practical: 'qa',
    });
    expect(firstKindForFormatClass('recall-style')).toBe('mcq');
    expect(firstKindForFormatClass('written')).toBe('qa');
    expect(firstKindForFormatClass('practical')).toBe('qa');
    expect(Object.isFrozen(FIRST_KIND_BY_FORMAT_CLASS)).toBe(true);
  });

  it('courses A (written), B (practical) and C (recall-style) ask for their kinds as known formats', () => {
    const inputs = deriveKindInputs({
      assessments: [
        assessment(A, 'Essay', '2026-02-01'),
        assessment(B, 'Lab', '2026-02-01'),
        assessment(C, 'Quiz', '2026-02-01'),
      ],
      reviewLog: [],
      today: TODAY,
    });
    expect(inputs.kindInputsFor(A)).toEqual({ formatMatch: 'qa', recordedPreference: [] });
    expect(inputs.kindInputsFor(B)).toEqual({ formatMatch: 'qa', recordedPreference: [] });
    expect(inputs.kindInputsFor(C)).toEqual({ formatMatch: 'mcq', recordedPreference: [] });
    expect(primaryKindFor(inputs.kindInputsFor(A))).toBe('qa');
    expect(primaryKindFor(inputs.kindInputsFor(C))).toBe('mcq');
  });

  it("a word the table does not name, or no word at all, asks as a written one does ([D-246]'s table, read once)", () => {
    const inputs = deriveKindInputs({
      assessments: [
        assessment(A, 'Viva voce', '2026-02-01'),
        assessment(B, undefined, '2026-02-01'),
      ],
      reviewLog: [],
      today: TODAY,
    });
    expect(inputs.kindInputsFor(A).formatMatch).toBe('qa');
    expect(inputs.kindInputsFor(B).formatMatch).toBe('qa');
  });

  it('matching is case-insensitive on her own word, which is never rewritten', () => {
    const records = [assessment(C, '  QUIZ ', '2026-02-01')];
    const inputs = deriveKindInputs({ assessments: records, reviewLog: [], today: TODAY });
    expect(inputs.kindInputsFor(C).formatMatch).toBe('mcq');
    expect(records[0]?.type).toBe('  QUIZ ');
  });
});

describe('the ruled grain: per course, from its nearest assessment not yet passed ([D-551] (a))', () => {
  const records = [assessment(A, 'Essay', '2026-01-20', 1), assessment(A, 'Exam', '2026-03-01', 2)];

  it('before the written assessment the course asks for a card; after it, for multiple choice', () => {
    const before = deriveKindInputs({ assessments: records, reviewLog: [], today: TODAY });
    const onTheDay = deriveKindInputs({
      assessments: records,
      reviewLog: [],
      today: '2026-01-20' as CalendarDay,
    });
    const after = deriveKindInputs({
      assessments: records,
      reviewLog: [],
      today: '2026-01-21' as CalendarDay,
    });
    expect(before.kindInputsFor(A).formatMatch).toBe('qa');
    // Due today is not yet passed (the register's reading, `nearestUpcomingAssessment`).
    expect(onTheDay.kindInputsFor(A).formatMatch).toBe('qa');
    expect(after.kindInputsFor(A).formatMatch).toBe('mcq');
  });

  it('one answer per course: the concept never enters the reading', () => {
    const inputs = deriveKindInputs({ assessments: records, reviewLog: [], today: TODAY });
    expect(inputs.kindInputsFor.length).toBe(1);
    expect(inputs.kindInputsFor(A)).toEqual(inputs.kindInputsFor(A));
  });

  it('a passed assessment, or one with no readable date, never decides a kind', () => {
    const inputs = deriveKindInputs({
      assessments: [
        assessment(A, 'Exam', '2026-01-01', 1),
        assessment(A, 'Essay', undefined, 2),
        assessment(A, 'Essay', 'next Tuesday', 3),
      ],
      reviewLog: [],
      today: TODAY,
    });
    expect(inputs.kindInputsFor(A).formatMatch).toBeNull();
    expect(inputs.formatMatchFor(A)).toBeUndefined();
  });

  it('two assessments due the same day: the lexically smaller path decides, never read order', () => {
    const sameDay = [
      { ...assessment(A, 'Quiz', '2026-02-01'), path: '02 Assignments/b.md' },
      { ...assessment(A, 'Essay', '2026-02-01'), path: '02 Assignments/a.md' },
    ];
    for (const order of [sameDay, [...sameDay].reverse()]) {
      const inputs = deriveKindInputs({ assessments: order, reviewLog: [], today: TODAY });
      expect(inputs.kindInputsFor(A).formatMatch).toBe('qa');
    }
  });

  it("another course's assessments never decide this course's kind", () => {
    const inputs = deriveKindInputs({
      assessments: [assessment(A, 'Essay', '2026-02-01'), assessment(C, 'Quiz', '2026-01-15')],
      reviewLog: [],
      today: TODAY,
    });
    expect(inputs.kindInputsFor(A).formatMatch).toBe('qa');
    expect(inputs.kindInputsFor(C).formatMatch).toBe('mcq');
    expect(inputs.kindInputsFor(D).formatMatch).toBeNull();
  });
});

describe('no format known: her recorded preference, then the floor (F3.3, primaryKindFor)', () => {
  it('a course with nothing ahead asks for the kind she has rated most often', () => {
    const inputs = deriveKindInputs({
      assessments: [assessment(D, 'Exam', '2026-01-01')],
      reviewLog: [review('qa', 1), review('qa', 2), review('mcq', 3)],
      today: TODAY,
    });
    expect(inputs.kindInputsFor(D)).toEqual({
      formatMatch: null,
      recordedPreference: ['qa', 'mcq'],
    });
    expect(primaryKindFor(inputs.kindInputsFor(D))).toBe('qa');
  });

  it('with nothing rated, the floor: multiple choice', () => {
    const inputs = deriveKindInputs({ assessments: [], reviewLog: [], today: TODAY });
    expect(inputs.kindInputsFor(D)).toEqual({ formatMatch: null, recordedPreference: [] });
    expect(primaryKindFor(inputs.kindInputsFor(D))).toBe(DEFAULT_PRIMARY_KIND_FLOOR);
    expect(DEFAULT_PRIMARY_KIND_FLOOR).toBe('mcq');
  });

  it('a course with a known format asks for its format kind whatever she has rated', () => {
    const inputs = deriveKindInputs({
      assessments: [assessment(C, 'Quiz', '2026-02-01')],
      reviewLog: [review('qa', 1), review('qa', 2)],
      today: TODAY,
    });
    expect(primaryKindFor(inputs.kindInputsFor(C))).toBe('mcq');
  });

  it('a cloze preference is passed through as she rated it; the sweep records what it drafted instead', () => {
    const inputs = deriveKindInputs({
      assessments: [],
      reviewLog: [review('cloze', 1), review('cloze', 2), review('qa', 3)],
      today: TODAY,
    });
    expect(primaryKindFor(inputs.kindInputsFor(D))).toBe('cloze');
  });

  it('the preference is vault-wide today: every course is handed the same order', () => {
    const inputs = deriveKindInputs({
      assessments: [],
      reviewLog: [review('qa', 1)],
      today: TODAY,
    });
    expect(inputs.recordedPreferenceFor(A)).toEqual(['qa']);
    expect(inputs.recordedPreferenceFor(D)).toEqual(['qa']);
  });
});

describe('one mapping for the first call and the format-ask trigger', () => {
  it('formatMatchFor names the kind the first call asks for where a format is known, and nothing where none is', () => {
    const inputs = deriveKindInputs({
      assessments: [
        assessment(A, 'Essay', '2026-02-01'),
        assessment(B, 'Practical', '2026-02-01'),
        assessment(C, 'Midterm', '2026-02-01'),
        assessment(D, 'Exam', '2026-01-01'),
      ],
      reviewLog: [review('qa', 1)],
      today: TODAY,
    });
    for (const course of [A, B, C]) {
      expect(inputs.formatMatchFor(course)).toBe(primaryKindFor(inputs.kindInputsFor(course)));
    }
    expect(inputs.formatMatchFor(D)).toBeUndefined();
    // The trigger's "asks for" never manufactures a kind from the floor.
    expect(inputs.formatMatchFor('TESTZ999')).toBeUndefined();
  });
});

describe('buildKindInputs: her review log, read once, and the assessments the caller holds', () => {
  it('reads her rated reviews from the vault and today from the injected clock', async () => {
    const vault = new MemoryVaultSource({});
    for (const n of [1, 2]) {
      await appendReviewLogRecord(
        vault,
        {
          timestamp: `2026-01-0${n}T09:00:00+00:00`,
          instrumentId: `instrument-qa-${n}`,
          instrumentType: 'qa',
          conceptIds: ['concept-key-1'],
          rating: 'good',
          wasUnsure: false,
          durationMs: null,
          selectionContext: {
            dueState: 'new',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
        },
        { deviceId: 'device-a', generateEventId: () => `event-${n}` },
      );
    }
    const records = [assessment(A, 'Essay', '2026-01-20'), assessment(D, 'Exam', '2026-01-01')];
    const early = await buildKindInputs({
      vault,
      assessments: records,
      now: () => new Date('2026-01-10T12:00:00'),
    });
    expect(early.kindInputsFor(A)).toEqual({ formatMatch: 'qa', recordedPreference: ['qa'] });
    expect(early.kindInputsFor(D)).toEqual({ formatMatch: null, recordedPreference: ['qa'] });
    const late = await buildKindInputs({
      vault,
      assessments: records,
      now: () => new Date('2026-01-21T12:00:00'),
    });
    expect(late.kindInputsFor(A).formatMatch).toBeNull();
  });

  it('a review log that cannot be read leaves her preference empty, never a thrown sweep', async () => {
    const broken = new MemoryVaultSource({});
    broken.list = async () => {
      throw new Error('unreadable');
    };
    const inputs = await buildKindInputs({
      vault: broken,
      assessments: [assessment(A, 'Essay', '2099-01-01')],
    });
    expect(inputs.kindInputsFor(A)).toEqual({ formatMatch: 'qa', recordedPreference: [] });
    expect(inputs.kindInputsFor(D)).toEqual({ formatMatch: null, recordedPreference: [] });
  });
});
