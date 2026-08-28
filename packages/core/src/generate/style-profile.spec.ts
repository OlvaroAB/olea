import { describe, expect, it } from 'vitest';
import {
  type ClassifiedCard,
  computeStyleProfile,
  DEFAULT_STYLE_PROFILE,
  MIN_SAMPLE_FOR_PROFILE,
} from './style-profile.js';

function hersCard(front: string, back: string): ClassifiedCard {
  return { front, back, authorship: 'hers' };
}

function card(overrides: Partial<ClassifiedCard>): ClassifiedCard {
  return { front: 'front text', back: 'back text', authorship: 'unknown', ...overrides };
}

/** `MIN_SAMPLE_FOR_PROFILE` confident-hers cards with a fixed, known shape, so the measured numbers are exact rather than approximate. */
function sufficientHersCorpus(): ClassifiedCard[] {
  return Array.from({ length: MIN_SAMPLE_FOR_PROFILE }, (_, i) =>
    hersCard('What is X', i % 5 === 0 ? 'A, B, and C' : 'A short answer'),
  );
}

describe('computeStyleProfile — F3.9 / [D-101] (features/F3-learn-from-anything.md)', () => {
  it('non-hers and unknown prose never enters the profile — the recorded sample size reflects the exclusion', () => {
    const cards: ClassifiedCard[] = [
      ...sufficientHersCorpus(),
      card({ authorship: 'not-hers', front: 'pasted front', back: 'pasted back' }),
      card({ authorship: 'unknown', front: 'unknown front', back: 'unknown back' }),
    ];

    const profile = computeStyleProfile(cards);

    expect(profile.thin).toBe(false);
    expect(profile.sampleSize).toBe(MIN_SAMPLE_FOR_PROFILE);
  });

  it('a vault with too little confident-hers material degrades honestly — reports itself thin rather than widening its inputs', () => {
    const cards: ClassifiedCard[] = [
      hersCard('What is X', 'A short answer'),
      card({ authorship: 'unknown', front: 'padding front', back: 'padding back' }),
      card({ authorship: 'not-hers', front: 'padding front 2', back: 'padding back 2' }),
    ];

    const profile = computeStyleProfile(cards);

    expect(profile.thin).toBe(true);
    // Sample size counts only the one confident-hers card — never widened by
    // including the unknown/not-hers padding above.
    expect(profile.sampleSize).toBe(1);
  });

  it('an empty corpus degrades to the declared default, thin', () => {
    expect(computeStyleProfile([])).toEqual({
      ...DEFAULT_STYLE_PROFILE,
      thin: true,
      sampleSize: 0,
    });
  });

  it('measures median front/back word counts from confident-hers cards only', () => {
    const cards: ClassifiedCard[] = [
      ...Array.from({ length: MIN_SAMPLE_FOR_PROFILE - 1 }, () =>
        hersCard('one two three', 'one two'),
      ),
      hersCard('one two three four five six seven eight nine', 'one two three four five six'),
    ];

    const profile = computeStyleProfile(cards);

    expect(profile.thin).toBe(false);
    expect(profile.medianFrontWords).toBe(3);
    expect(profile.medianBackWords).toBe(2);
  });

  it('collects distinct opening stems, sorted, from What/Which/How/Why/In only', () => {
    const cards: ClassifiedCard[] = [
      ...Array.from({ length: MIN_SAMPLE_FOR_PROFILE - 4 }, () =>
        hersCard('What is X', 'A short answer'),
      ),
      hersCard('Which option is correct', 'A short answer'),
      hersCard('How does X work', 'A short answer'),
      hersCard('Why does X happen', 'A short answer'),
      hersCard('The definition of X is Y', 'A short answer'), // no recognised stem
    ];

    const profile = computeStyleProfile(cards);

    expect(profile.openingStems).toEqual(['How', 'What', 'Which', 'Why']);
  });

  it('computes the list-enumeration ratio from confident-hers backs only', () => {
    const cards: ClassifiedCard[] = [
      ...Array.from({ length: MIN_SAMPLE_FOR_PROFILE - 2 }, () =>
        hersCard('What is X', 'A short answer'),
      ),
      hersCard('What is Y', '- item one\n- item two'),
      hersCard('What is Z', 'first, second, and third'),
    ];

    const profile = computeStyleProfile(cards);

    expect(profile.listEnumerationRatio).toBeCloseTo(2 / MIN_SAMPLE_FOR_PROFILE);
  });
});
