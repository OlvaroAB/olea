/**
 * F8.7's recognition claim copy (`RECOG-1`). The corpus-level assertion
 * mirrors `today/copy.spec.ts`'s own pattern: no string this module can
 * produce may read as a question, a confirm/merge/accept control, or a
 * declined/dismissed state — F8.7 in full, "recognition asks nothing of her."
 *
 * This is `features/F8-concepts-scope.md`'s F8.7 scenario "recognition asks
 * nothing of her — no confirm, no merge, no accept step, and declining is not
 * a state", retargeted from its original forward-declared id
 * (`plugin/scope/copy.spec`, a location this build never used) to this file —
 * see the `RECOG-1` report for the correction.
 */
import { describe, expect, it } from 'vitest';
import {
  allRecognitionClaimStrings,
  buildRecognitionClaimCopy,
  evidenceLine,
  lastCorrectClause,
  RECOGNITION_CLAIM_HEADING,
  reviewCountLabel,
  stageLabel,
  vitalityLabel,
} from '../../src/course-setup/copy.js';

const strings = allRecognitionClaimStrings();
const corpus = strings.join(' \n ').toLowerCase();

describe('no confirm, merge, accept or decline control anywhere in this module', () => {
  it('names no control that could be pressed, accepted, merged or declined', () => {
    const forbidden = [
      'confirm',
      'merge',
      'accept',
      'decline',
      'declined',
      'dismiss',
      'reject',
      'undo',
      'apply',
      'keep',
      'yes',
      'no,',
    ];
    for (const word of forbidden) {
      expect(corpus, `"${word}" reads as a control F8.7 forbids`).not.toContain(word);
    }
  });

  it('is not phrased as a question', () => {
    expect(corpus).not.toContain('?');
  });
});

describe('reviewCountLabel', () => {
  it('reads correctly at zero, one and many', () => {
    expect(reviewCountLabel(0)).toBe('0 reviews');
    expect(reviewCountLabel(1)).toBe('1 review');
    expect(reviewCountLabel(4)).toBe('4 reviews');
  });
});

describe('lastCorrectClause', () => {
  it('is null when there is no successful scored review', () => {
    expect(lastCorrectClause(null)).toBeNull();
  });

  it('states the date plainly', () => {
    expect(lastCorrectClause('2026-08-12T09:00:00+02:00')).toBe('last correct 12 Aug 2026');
  });
});

describe('evidenceLine', () => {
  it('joins every field F8.7 names, and drops only what is genuinely absent', () => {
    expect(
      evidenceLine({
        reviewCount: 3,
        explainedBack: true,
        lastCorrectAt: '2026-08-12T09:00:00+02:00',
      }),
    ).toBe('3 reviews · last correct 12 Aug 2026 · explained back at least once');
    expect(evidenceLine({ reviewCount: 0, explainedBack: true, lastCorrectAt: null })).toBe(
      '0 reviews · explained back at least once',
    );
    expect(evidenceLine({ reviewCount: 2, explainedBack: false, lastCorrectAt: null })).toBe(
      '2 reviews',
    );
  });
});

describe('stageLabel', () => {
  it('reads through MASTERY_DISPLAY — the one growth-stage vocabulary site, never a second copy', () => {
    expect(stageLabel('seed')).toMatch(/./);
    expect(stageLabel('tree')).not.toBe(stageLabel('seed'));
  });
});

describe('vitalityLabel', () => {
  it('is null exactly when no reading was supplied', () => {
    expect(vitalityLabel(null)).toBeNull();
  });

  it('renders the three words vitality.ts documents, verbatim', () => {
    expect(vitalityLabel('holding')).toBe('holding');
    expect(vitalityLabel('tending')).toBe('needs tending');
    expect(vitalityLabel('early')).toBe('too early to say');
  });
});

describe('buildRecognitionClaimCopy', () => {
  it('carries the concept id and earlier courses through untouched, for the view to render', () => {
    const claim = buildRecognitionClaimCopy({
      conceptId: 'c1',
      newCourse: 'NEW1',
      earlierCourses: ['OLD1', 'OLD2'],
      state: 'sprout',
      vitality: null,
      evidence: { reviewCount: 2, explainedBack: false, lastCorrectAt: null },
    });
    expect(claim.conceptId).toBe('c1');
    expect(claim.earlierCourses).toEqual(['OLD1', 'OLD2']);
    expect(claim.vitality).toBeNull();
  });

  it('reads the vitality reading value through vitalityLabel when one is supplied', () => {
    const claim = buildRecognitionClaimCopy({
      conceptId: 'c1',
      newCourse: 'NEW1',
      earlierCourses: ['OLD1'],
      state: 'sapling',
      vitality: { value: 'tending', weakest: null, instrumentsRead: 1 },
      evidence: { reviewCount: 2, explainedBack: false, lastCorrectAt: null },
    });
    expect(claim.vitality).toBe('needs tending');
  });
});

describe('RECOGNITION_CLAIM_HEADING', () => {
  it('states the fact and asks nothing', () => {
    expect(RECOGNITION_CLAIM_HEADING.toLowerCase()).not.toContain('?');
  });
});
