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
import { VITALITY_DISPLAY } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  allRecognitionClaimStrings,
  buildRecognitionClaimCopy,
  cutoffDayLabel,
  evidenceLine,
  HISTORICAL_LINE_WORDING_IS_PLACEHOLDER,
  historicalLineText,
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
      historical: [],
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
      historical: [],
    });
    expect(claim.vitality).toBe('needs tending');
  });
});

describe('RECOGNITION_CLAIM_HEADING', () => {
  it('states the fact and asks nothing', () => {
    expect(RECOGNITION_CLAIM_HEADING.toLowerCase()).not.toContain('?');
  });
});

/**
 * `[D-387]` / `[D-411]` (`ol-v7r5.66`): the dated line. Its wording is a
 * placeholder for the copy pass; what is asserted here is what any wording
 * must hold: attainment only (knowledge model R3), a provisional cutoff says
 * so and never claims the course was finished or left, and the line is its
 * own line, never folded into the current one.
 */
describe('[D-387] the dated line', () => {
  const stages = ['seed', 'sprout', 'sapling', 'tree'] as const;

  it('is marked as placeholder wording awaiting the copy pass', () => {
    expect(HISTORICAL_LINE_WORDING_IS_PLACEHOLDER).toBe(true);
  });

  it('shows attainment, never a vitality word (R3: a vitality value is never dated)', () => {
    const vitalityWords = Object.values(VITALITY_DISPLAY).map((d) => d.label.toLowerCase());
    for (const state of stages) {
      for (const provisional of [true, false]) {
        const text = historicalLineText({ cutoffDay: '2026-06-12', provisional, state }) ?? '';
        expect(text).toContain(stageLabel(state));
        for (const word of [...vitalityWords, 'holding', 'tending', 'fading', 'faded']) {
          expect(text.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it('a provisional cutoff says provisional and never claims the course was finished, completed or left', () => {
    for (const state of stages) {
      const text = (
        historicalLineText({ cutoffDay: '2026-06-12', provisional: true, state }) ?? ''
      ).toLowerCase();
      expect(text).toContain('provisional');
      for (const word of ['left', 'leav', 'finish', 'complet', 'ended', 'done', 'archiv']) {
        expect(text).not.toContain(word);
      }
    }
    const gesture = historicalLineText({
      cutoffDay: '2026-06-12',
      provisional: false,
      state: 'sprout',
    });
    expect(gesture?.toLowerCase()).not.toContain('provisional');
  });

  it('dates the line by the recorded calendar day wherever she is, and draws no line for an unreadable day', () => {
    expect(cutoffDayLabel('2026-06-12')).toBe('12 Jun 2026');
    expect(historicalLineText({ cutoffDay: 'soon', provisional: true, state: 'seed' })).toBeNull();
  });

  it('keeps each dated line apart from the current stage and vitality, with its course kept out of the text', () => {
    const claim = buildRecognitionClaimCopy({
      conceptId: 'c1',
      newCourse: 'NEW1',
      earlierCourses: ['OLD1', 'OLD2'],
      state: 'sapling',
      vitality: { value: 'tending', weakest: null, instrumentsRead: 1 },
      evidence: { reviewCount: 4, explainedBack: false, lastCorrectAt: null },
      historical: [
        {
          course: 'OLD1',
          cutoffDay: '2026-06-12',
          source: 'provisional-last-passed-assessment',
          provisional: true,
          state: 'sprout',
          arithmeticVersion:
            'att-fold-1;sapling=any-scored-success;withheld=count;scheduler=unknown',
          historicalAwardRuleVersion: 'cutoff-asof-1',
        },
      ],
    });
    expect(claim.stage).toBe(stageLabel('sapling'));
    expect(claim.vitality).toBe('needs tending');
    expect(claim.historical).toEqual([
      {
        course: 'OLD1',
        text: historicalLineText({ cutoffDay: '2026-06-12', provisional: true, state: 'sprout' }),
        provisional: true,
      },
    ]);
    expect(claim.historical[0]?.text).not.toContain('OLD1');
    expect(claim.stage).not.toContain(stageLabel('sprout'));
  });

  it('with no preserved cutoff, no dated line', () => {
    const claim = buildRecognitionClaimCopy({
      conceptId: 'c1',
      newCourse: 'NEW1',
      earlierCourses: ['OLD1'],
      state: 'sapling',
      vitality: null,
      evidence: { reviewCount: 4, explainedBack: false, lastCorrectAt: null },
      historical: [],
    });
    expect(claim.historical).toEqual([]);
  });
});
