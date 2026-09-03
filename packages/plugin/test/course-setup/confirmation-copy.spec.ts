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
  FIRST_READ_STATE_LABELS,
  FIRST_READ_STATE_ORDER,
  formatFirstReadCountsLine,
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

// F1.4/`[D-213]`, `ol-0r92.47`: the first-read readout's state labels are
// copied verbatim from the amended F1.4 clause, and the clause's own
// vocabulary answer is "deferred must not read as failed" — asserted here
// rather than trusted by eye.
describe('FIRST_READ_STATE_LABELS', () => {
  it("matches the amended F1.4 clause wording exactly, in the clause's own order", () => {
    expect(FIRST_READ_STATE_ORDER).toEqual(['queued', 'in-flight', 'done', 'deferred', 'failed']);
    expect(FIRST_READ_STATE_LABELS).toEqual({
      queued: 'files waiting',
      'in-flight': 'in flight',
      done: 'done',
      deferred: 'deferred',
      failed: 'failed',
    });
  });

  it('deferred does not read as failed — no shared "fail"/"error"/"stuck" wording', () => {
    const deferredLabel = FIRST_READ_STATE_LABELS.deferred.toLowerCase();
    for (const word of ['fail', 'error', 'stuck', 'broken']) {
      expect(deferredLabel, `deferred's label should not contain "${word}"`).not.toContain(word);
    }
    expect(FIRST_READ_STATE_LABELS.deferred).not.toBe(FIRST_READ_STATE_LABELS.failed);
  });

  it('every one of the five labels is distinct', () => {
    const labels = FIRST_READ_STATE_ORDER.map((status) => FIRST_READ_STATE_LABELS[status]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('formatFirstReadCountsLine', () => {
  it('renders all five states as plain counts, in order, with no derived percentage or bar', () => {
    const line = formatFirstReadCountsLine({
      queued: 12,
      'in-flight': 3,
      done: 5,
      deferred: 1,
      failed: 0,
    });
    expect(line).toBe('12 files waiting · 3 in flight · 5 done · 1 deferred · 0 failed');
    expect(line).not.toContain('%');
  });

  it('reports a zero-count state rather than omitting it — a folder with nothing failed still says so', () => {
    const line = formatFirstReadCountsLine({
      queued: 0,
      'in-flight': 0,
      done: 0,
      deferred: 0,
      failed: 0,
    });
    expect(line).toBe('0 files waiting · 0 in flight · 0 done · 0 deferred · 0 failed');
  });
});
