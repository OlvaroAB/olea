/**
 * `features/F1-sources.md`'s "detection proposes a course and never creates
 * one" scenario, from the plugin-side copy this bead (`ol-0r92.5`) adds: no
 * string this module renders may imply a course record already exists ahead
 * of her confirming it.
 */
import { describe, expect, it } from 'vitest';
import {
  allConfirmationStrings,
  CONFIRM_BUTTON_LABEL,
  COURSE_NAME_FIELD_LABEL,
  COURSE_PROPOSAL_HEADING,
} from '../../src/course-setup/confirmation-copy.js';

const strings = allConfirmationStrings();
const corpus = strings.join(' \n ').toLowerCase();

describe('nothing here implies a course record already exists', () => {
  it('never claims creation, saving or persistence ahead of her confirming', () => {
    const forbidden = ['created', 'added', 'saved', 'set up'];
    for (const word of forbidden) {
      expect(corpus, `"${word}" overstates what detection has done`).not.toContain(word);
    }
  });
});

describe('COURSE_PROPOSAL_HEADING', () => {
  it('states a reading, not a fact', () => {
    expect(COURSE_PROPOSAL_HEADING).toBe('This looks like a course');
  });
});

describe('field and button labels', () => {
  it('are non-empty, plain strings', () => {
    expect(COURSE_NAME_FIELD_LABEL.length).toBeGreaterThan(0);
    expect(CONFIRM_BUTTON_LABEL.length).toBeGreaterThan(0);
  });
});
