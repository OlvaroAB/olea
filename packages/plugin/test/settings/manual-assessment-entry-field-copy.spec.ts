/**
 * `manual-assessment-entry-field-copy.ts` tests. Pure string constants — no obsidian import, no
 * DOM.
 *
 * Scenario: `features/F1-sources.md` (F1.2 — the manual entry surface) —
 * @auto:plugin/settings/manual-assessment-entry-field-copy.spec.
 */
import { describe, expect, it } from 'vitest';
import {
  MANUAL_ASSESSMENT_ADD_BUTTON_LABEL,
  MANUAL_ASSESSMENT_COURSE_FIELD_NAME,
  MANUAL_ASSESSMENT_DUE_FIELD_NAME,
  MANUAL_ASSESSMENT_EMPTY_LIST_TEXT,
  MANUAL_ASSESSMENT_REMOVE_BUTTON_LABEL,
  MANUAL_ASSESSMENT_REQUIRED_FIELDS_NOTICE,
  MANUAL_ASSESSMENT_SECTION_DESCRIPTION,
  MANUAL_ASSESSMENT_SECTION_HEADING,
  MANUAL_ASSESSMENT_STATUS_FIELD_NAME,
  MANUAL_ASSESSMENT_TYPE_FIELD_NAME,
  MANUAL_ASSESSMENT_WEIGHT_FIELD_NAME,
} from '../../src/settings/manual-assessment-entry-field-copy.js';

describe('manual assessment entry copy — F1.2', () => {
  it('every field name is a non-empty plain label', () => {
    for (const name of [
      MANUAL_ASSESSMENT_COURSE_FIELD_NAME,
      MANUAL_ASSESSMENT_TYPE_FIELD_NAME,
      MANUAL_ASSESSMENT_WEIGHT_FIELD_NAME,
      MANUAL_ASSESSMENT_DUE_FIELD_NAME,
      MANUAL_ASSESSMENT_STATUS_FIELD_NAME,
    ]) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('the section description names the fallback, never reading as the default path (F1.2)', () => {
    expect(MANUAL_ASSESSMENT_SECTION_DESCRIPTION).toMatch(/fallback/i);
    expect(MANUAL_ASSESSMENT_SECTION_DESCRIPTION).not.toMatch(/default/i);
  });

  it('the section heading and button/notice copy are all non-empty', () => {
    for (const text of [
      MANUAL_ASSESSMENT_SECTION_HEADING,
      MANUAL_ASSESSMENT_EMPTY_LIST_TEXT,
      MANUAL_ASSESSMENT_ADD_BUTTON_LABEL,
      MANUAL_ASSESSMENT_REMOVE_BUTTON_LABEL,
      MANUAL_ASSESSMENT_REQUIRED_FIELDS_NOTICE,
    ]) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
