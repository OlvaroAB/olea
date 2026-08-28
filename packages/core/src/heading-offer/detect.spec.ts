import { describe, expect, it } from 'vitest';
import { parseDocument } from '../block/parse.js';
import { detectHeadingOffers, isQuestionShapedHeading } from './detect.js';

// features/F2-review.md, F2.10 — both of its own scenarios are tagged
// @manual (they describe the offer appearing on a real surface and the
// settings toggle suppressing it, neither of which this engine-only module
// renders). Named rather than silently skipped, same discipline
// `course/lifecycle.spec.ts` uses for its `describe.todo` entries:
//
//   - "offering, never creating silently" — the offer/accept surface itself;
//     this module only proposes candidates, never creates a card, which is
//     the half of that scenario a pure function can discharge (asserted
//     below); the "offers... and creates nothing until she accepts" half is
//     the wiring bead's to build and test.
//   - "toggleable off, cleanly" — the settings toggle is a caller decision
//     (whether to call `detectHeadingOffers` at all), not a parameter this
//     module owns; nothing here to assert.
describe.todo(
  'F2.10 "offering, never creating silently" — the render/accept surface (@manual, wiring bead)',
);
describe.todo('F2.10 "toggleable off, cleanly" — the settings gate (@manual, wiring bead)');

describe('isQuestionShapedHeading — the three declared rules', () => {
  it('matches a heading ending in a literal question mark', () => {
    expect(isQuestionShapedHeading('What is the Krebs cycle?')).toBe('question-mark');
  });

  it('matches a bare "?" heading', () => {
    expect(isQuestionShapedHeading('?')).toBe('question-mark');
  });

  it('matches yes/no subject-auxiliary inversion with no question mark', () => {
    expect(isQuestionShapedHeading('Is photosynthesis reversible')).toBe('yes-no-inversion');
    expect(isQuestionShapedHeading('Does insulin regulate glucose')).toBe('yes-no-inversion');
    expect(isQuestionShapedHeading('Can enzymes be reused')).toBe('yes-no-inversion');
  });

  it('matches wh-word + inversion with no question mark', () => {
    expect(isQuestionShapedHeading('What is mitosis')).toBe('wh-inversion');
    expect(isQuestionShapedHeading('How does ATP synthase work')).toBe('wh-inversion');
    expect(isQuestionShapedHeading('Why is the sky blue')).toBe('wh-inversion');
  });

  it('is case-insensitive on the opening word(s)', () => {
    expect(isQuestionShapedHeading('IS photosynthesis reversible')).toBe('yes-no-inversion');
    expect(isQuestionShapedHeading('what IS mitosis')).toBe('wh-inversion');
  });

  it('strips markdown emphasis before matching', () => {
    expect(isQuestionShapedHeading('**What is mitosis?**')).toBe('question-mark');
    expect(isQuestionShapedHeading('_Is photosynthesis reversible_')).toBe('yes-no-inversion');
  });

  it('does not match a wh-word opening a declarative topic title (conservative bias)', () => {
    expect(isQuestionShapedHeading('How Enzymes Work')).toBeNull();
    expect(isQuestionShapedHeading('Why Evolution Matters')).toBeNull();
    expect(isQuestionShapedHeading('How to Study Effectively')).toBeNull();
    expect(isQuestionShapedHeading('Where the Mitochondria Sit')).toBeNull();
  });

  it('does not match an ordinary declarative or label heading', () => {
    expect(isQuestionShapedHeading('The Krebs Cycle')).toBeNull();
    expect(isQuestionShapedHeading('Photosynthesis: An Overview')).toBeNull();
    expect(isQuestionShapedHeading('Definitions')).toBeNull();
    expect(isQuestionShapedHeading('Week 3 Lecture Notes')).toBeNull();
  });

  it('treats an empty or whitespace-only heading as not question-shaped', () => {
    expect(isQuestionShapedHeading('')).toBeNull();
    expect(isQuestionShapedHeading('   ')).toBeNull();
  });
});

describe('detectHeadingOffers — candidates from a parsed note', () => {
  it('offers a question-shaped heading with no card anywhere under it', () => {
    const doc = parseDocument('# What is mitosis?\n\nSome notes about mitosis.\n');

    const offers = detectHeadingOffers(doc, []);

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      headingText: 'What is mitosis?',
      level: 1,
      blockIndex: 0,
      rule: 'question-mark',
    });
  });

  it('never offers a declarative heading, however much content sits under it', () => {
    const doc = parseDocument('# The Krebs Cycle\n\nProduces ATP.\n');

    expect(detectHeadingOffers(doc, [])).toEqual([]);
  });

  it('does not offer a question-shaped heading that already has a card directly beneath it', () => {
    const source = '# What is mitosis?\n\nMitosis is cell division.\n';
    const doc = parseDocument(source);
    const cardStart = source.indexOf('Mitosis is cell division.');

    const offers = detectHeadingOffers(doc, [{ start: cardStart, end: cardStart + 10 }]);

    expect(offers).toEqual([]);
  });

  it('does not offer when the existing card sits under a nested sub-heading (conservative coverage window)', () => {
    const source = [
      '# What is mitosis?',
      '',
      '## Phases',
      '',
      'Prophase, metaphase, anaphase, telophase.',
      '',
    ].join('\n');
    const doc = parseDocument(source);
    const cardStart = source.indexOf('Prophase');

    const offers = detectHeadingOffers(doc, [{ start: cardStart, end: cardStart + 5 }]);

    expect(offers).toEqual([]);
  });

  it('does still offer a sibling question heading when the card belongs to a different subtree', () => {
    const source = [
      '# What is mitosis?',
      '',
      'No card here yet.',
      '',
      '# What is meiosis?',
      '',
      'Meiosis card already exists.',
      '',
    ].join('\n');
    const doc = parseDocument(source);
    const meiosisCardStart = source.indexOf('Meiosis card already exists.');

    const offers = detectHeadingOffers(doc, [
      { start: meiosisCardStart, end: meiosisCardStart + 5 },
    ]);

    expect(offers).toHaveLength(1);
    expect(offers[0]?.headingText).toBe('What is mitosis?');
  });

  it("stops a heading's coverage window at the next heading of equal or higher level, not a deeper one", () => {
    const source = [
      '# Course overview',
      '',
      '## What is mitosis?',
      '',
      '### Phases',
      '',
      'content under the sub-sub-heading',
      '',
      '## Next topic',
      '',
    ].join('\n');
    const doc = parseDocument(source);
    // A card placed under "## Next topic" must not be read as covering
    // "## What is mitosis?" even though it comes later in the document.
    const laterCardStart = source.indexOf('## Next topic');

    const offers = detectHeadingOffers(doc, [
      { start: laterCardStart + 1, end: laterCardStart + 5 },
    ]);

    expect(offers.map((o) => o.headingText)).toEqual(['What is mitosis?']);
  });

  it('is order-independent and returns one candidate per qualifying heading, in document order', () => {
    const source = [
      '# What is mitosis?',
      '',
      '# The Krebs Cycle',
      '',
      '# Is DNA double-stranded',
      '',
    ].join('\n');
    const doc = parseDocument(source);

    const offers = detectHeadingOffers(doc, []);

    expect(offers.map((o) => o.headingText)).toEqual([
      'What is mitosis?',
      'Is DNA double-stranded',
    ]);
  });

  it('creates nothing and mutates nothing — same input twice yields equal, independent results', () => {
    const doc = parseDocument('# What is mitosis?\n\nSome notes.\n');

    const first = detectHeadingOffers(doc, []);
    const second = detectHeadingOffers(doc, []);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('returns [] rather than guessing on a document with no headings at all', () => {
    const doc = parseDocument('Just a paragraph, no headings.\n');

    expect(detectHeadingOffers(doc, [])).toEqual([]);
  });
});
