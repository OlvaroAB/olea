import { describe, expect, it } from 'vitest';
import {
  describeManualAssessmentEntry,
  EMPTY_MANUAL_ASSESSMENT_FORM_FIELDS,
  type ManualAssessmentFormFields,
  validateManualAssessmentForm,
} from '../../src/settings/manual-assessment-entry-form.js';

function fields(overrides: Partial<ManualAssessmentFormFields>): ManualAssessmentFormFields {
  return { ...EMPTY_MANUAL_ASSESSMENT_FORM_FIELDS, ...overrides };
}

describe('validateManualAssessmentForm — F1.2 entry surface', () => {
  it('refuses a blank course', () => {
    const result = validateManualAssessmentForm(fields({ course: '  ', type: 'Quiz' }));
    expect(result.ok).toBe(false);
  });

  it('refuses a blank type', () => {
    const result = validateManualAssessmentForm(fields({ course: 'Course A', type: '   ' }));
    expect(result.ok).toBe(false);
  });

  it('accepts course and type alone, with every optional field omitted (never an empty string)', () => {
    const result = validateManualAssessmentForm(fields({ course: 'Course A', type: 'Quiz' }));
    expect(result).toEqual({ ok: true, input: { course: 'Course A', type: 'Quiz' } });
  });

  it('trims every field and carries the optional ones through when present', () => {
    const result = validateManualAssessmentForm(
      fields({
        course: '  Course A  ',
        type: ' Quiz ',
        weight: ' 20 ',
        due: ' 2026-10-01 ',
        status: ' not started ',
      }),
    );
    expect(result).toEqual({
      ok: true,
      input: {
        course: 'Course A',
        type: 'Quiz',
        weightRaw: '20',
        due: '2026-10-01',
        status: 'not started',
      },
    });
  });

  it('a whitespace-only optional field is treated as blank, not carried through as "   "', () => {
    const result = validateManualAssessmentForm(
      fields({ course: 'Course A', type: 'Quiz', weight: '   ' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect('weightRaw' in result.input).toBe(false);
  });
});

describe('describeManualAssessmentEntry', () => {
  it('joins course and type alone when neither due nor status is present', () => {
    expect(
      describeManualAssessmentEntry({
        schemaVersion: 1,
        id: 'manual-assessment1:x',
        course: 'Course A',
        type: 'Quiz',
        enteredAt: '2026-09-26',
      }),
    ).toBe('Course A — Quiz');
  });

  it('appends due and status when present', () => {
    expect(
      describeManualAssessmentEntry({
        schemaVersion: 1,
        id: 'manual-assessment1:x',
        course: 'Course A',
        type: 'Quiz',
        due: '2026-10-01',
        status: 'not started',
        enteredAt: '2026-09-26',
      }),
    ).toBe('Course A — Quiz — 2026-10-01 — not started');
  });
});
