/**
 * `term-dates-field-copy.ts` tests. Pure string constants — no obsidian
 * import, no DOM.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.2 — term dates ask-once-or-
 * dismissed ([D-147])" — @auto:plugin/settings/term-dates-field-copy.spec.
 */
import { describe, expect, it } from 'vitest';
import {
  TERM_DATES_FIELD_DESCRIPTION,
  TERM_DATES_SECTION_HEADING,
  TERM_DATES_SKIP_BUTTON_LABEL,
  TERM_DATES_SKIP_DESCRIPTION,
  TERM_END_FIELD_NAME,
  TERM_START_FIELD_NAME,
} from '../../src/settings/term-dates-field-copy.js';

describe('term dates field copy', () => {
  it('has non-empty names for every field', () => {
    for (const value of [
      TERM_DATES_SECTION_HEADING,
      TERM_START_FIELD_NAME,
      TERM_END_FIELD_NAME,
      TERM_DATES_SKIP_BUTTON_LABEL,
    ]) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('the description states what the fact is for, never a compliance verdict (F6.9 forbidden list)', () => {
    for (const forbidden of [/falling behind/i, /keep up/i, /monitor/i, /expected/i]) {
      expect(TERM_DATES_FIELD_DESCRIPTION).not.toMatch(forbidden);
    }
    // "not to track how you're doing" is the clause's own worked example — it
    // states the fact by denying the compliance reading, the one permitted
    // use of "track" in this copy.
    expect(TERM_DATES_FIELD_DESCRIPTION).toMatch(/not to track how you're doing/i);
  });

  it('the description names the rhythm reading as the sole consumer, and that dates are optional', () => {
    expect(TERM_DATES_FIELD_DESCRIPTION).toMatch(/yardstick/i);
    expect(TERM_DATES_FIELD_DESCRIPTION).toMatch(/leave blank/i);
  });

  it('the skip label never promises a future reminder — F7.2 is until-answered-or-dismissed, not a snooze', () => {
    expect(TERM_DATES_SKIP_BUTTON_LABEL).not.toMatch(/remind/i);
    expect(TERM_DATES_SKIP_DESCRIPTION).not.toMatch(/remind/i);
  });

  it('the skip description states what skipping stops, and that the fields stay editable', () => {
    expect(TERM_DATES_SKIP_DESCRIPTION).toMatch(/stops/i);
    expect(TERM_DATES_SKIP_DESCRIPTION).toMatch(/any time/i);
  });

  it('no default term length is suggested anywhere in this copy', () => {
    for (const copy of [TERM_DATES_FIELD_DESCRIPTION, TERM_DATES_SKIP_DESCRIPTION]) {
      expect(copy).not.toMatch(/\bsemester\b/i);
      expect(copy).not.toMatch(/\b\d+\s*(weeks?|months?)\b/i);
    }
  });
});
