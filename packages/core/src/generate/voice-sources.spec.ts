import { describe, expect, it } from 'vitest';
import { assembleVoiceExemplars, type ClassifiedPassage } from './voice-sources.js';

function passage(overrides: Partial<ClassifiedPassage> = {}): ClassifiedPassage {
  return {
    text: 'default passage text',
    authorship: 'unknown',
    curationAuthority: 'unknown',
    ...overrides,
  };
}

describe('assembleVoiceExemplars — F3.8 / [D-101] voice fidelity (features/F3-learn-from-anything.md)', () => {
  it('hers exemplifies phrasing, instructor supplies terminology — standardised wording never substituted for either', () => {
    const passages: ClassifiedPassage[] = [
      passage({ text: 'her own phrasing', authorship: 'hers', curationAuthority: 'unknown' }),
      passage({
        text: 'the lecturer term',
        authorship: 'unknown',
        curationAuthority: 'instructor',
      }),
      passage({
        text: 'ungrounded unknown prose',
        authorship: 'unknown',
        curationAuthority: 'unknown',
      }),
    ];

    const exemplars = assembleVoiceExemplars(passages);

    expect(exemplars.phrasing).toEqual(['her own phrasing']);
    expect(exemplars.terminology).toEqual(['the lecturer term']);
  });

  it('an unknown passage grounds content and never exemplifies voice — narrows the inputs, never blocks the work', () => {
    const onlyUnknown: ClassifiedPassage[] = [
      passage({
        text: 'the only defining passage',
        authorship: 'unknown',
        curationAuthority: 'unknown',
      }),
    ];

    const exemplars = assembleVoiceExemplars(onlyUnknown);

    expect(exemplars).toEqual({ phrasing: [], terminology: [] });
  });

  it('a not-hers passage never contributes phrasing, even if curation authority is also not instructor', () => {
    const passages: ClassifiedPassage[] = [
      passage({ text: "a classmate's paste", authorship: 'not-hers', curationAuthority: 'peer' }),
    ];

    expect(assembleVoiceExemplars(passages)).toEqual({ phrasing: [], terminology: [] });
  });

  it('published or peer curation authority never supplies terminology — only instructor does', () => {
    const passages: ClassifiedPassage[] = [
      passage({
        text: 'a textbook excerpt',
        authorship: 'unknown',
        curationAuthority: 'published',
      }),
      passage({ text: "a classmate's note", authorship: 'unknown', curationAuthority: 'peer' }),
    ];

    expect(assembleVoiceExemplars(passages)).toEqual({ phrasing: [], terminology: [] });
  });

  it('caps each category independently at maxPerCategory, keeping stable order', () => {
    const passages: ClassifiedPassage[] = Array.from({ length: 5 }, (_, i) =>
      passage({ text: `hers-${i}`, authorship: 'hers' }),
    );

    const exemplars = assembleVoiceExemplars(passages, { maxPerCategory: 2 });

    expect(exemplars.phrasing).toEqual(['hers-0', 'hers-1']);
  });

  it('returns empty exemplar sets for an empty passage list, without throwing', () => {
    expect(assembleVoiceExemplars([])).toEqual({ phrasing: [], terminology: [] });
  });
});
