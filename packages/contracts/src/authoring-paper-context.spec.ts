// `[D-561]` / `[D-562]` (`ol-egov.141.89.7.97`). What this file has to prove:
//
//   1. both request fields are optional: absent parses to undefined, the request every caller sends today;
//   2. the earlier-part limits sit at their named values, and a boundary is accepted while one past it is refused;
//   3. the shared-passage forms are exactly the four text forms (no figure), and the text bound is enforced;
//   4. nothing is trimmed, and a blank question or passage is refused.
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_EARLIER_PART_MAX_CHARS,
  AUTHORING_EARLIER_PARTS_LIMIT,
  AUTHORING_SHARED_PASSAGE_FORMS,
  AUTHORING_SHARED_PASSAGE_MAX_CHARS,
  authoringEarlierPart,
  authoringEarlierPartsField,
  authoringSharedPassage,
  authoringSharedPassageField,
} from './authoring-paper-context.js';

describe('the request fields are optional — absent is the request every caller sends today', () => {
  it('each field accepts undefined and returns undefined', () => {
    expect(authoringEarlierPartsField.parse(undefined)).toBeUndefined();
    expect(authoringSharedPassageField.parse(undefined)).toBeUndefined();
  });
});

describe('the named limits', () => {
  it('are the ruled values', () => {
    expect(AUTHORING_EARLIER_PARTS_LIMIT).toBe(10);
    expect(AUTHORING_EARLIER_PART_MAX_CHARS).toBe(2000);
    expect(AUTHORING_SHARED_PASSAGE_MAX_CHARS).toBe(6000);
    expect([...AUTHORING_SHARED_PASSAGE_FORMS]).toEqual([
      'scenario',
      'extract',
      'table',
      'data-set',
    ]);
    expect(Object.isFrozen(AUTHORING_SHARED_PASSAGE_FORMS)).toBe(true);
  });
});

describe('earlier parts', () => {
  it('keeps question and answer exactly as sent, untrimmed; the answer is optional', () => {
    const part = { question: '  A synthetic question?  ', answer: ' A synthetic answer. ' };
    expect(authoringEarlierPart.parse(part)).toEqual(part);
    expect(authoringEarlierPart.parse({ question: 'Q?' })).toEqual({ question: 'Q?' });
  });

  it('refuses a blank or missing question', () => {
    expect(authoringEarlierPart.safeParse({ question: '' }).success).toBe(false);
    expect(authoringEarlierPart.safeParse({ question: '   ' }).success).toBe(false);
    expect(authoringEarlierPart.safeParse({ answer: 'only an answer' }).success).toBe(false);
  });

  it('accepts a question and an answer at the character limit, refuses one past it', () => {
    const at = 'x'.repeat(AUTHORING_EARLIER_PART_MAX_CHARS);
    const over = `${at}x`;
    expect(authoringEarlierPart.safeParse({ question: at, answer: at }).success).toBe(true);
    expect(authoringEarlierPart.safeParse({ question: over }).success).toBe(false);
    expect(authoringEarlierPart.safeParse({ question: 'Q?', answer: over }).success).toBe(false);
  });

  it('takes one to ten entries: empty and eleven are refused, one and ten are accepted', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}?` }));
    expect(authoringEarlierPartsField.safeParse([]).success).toBe(false);
    expect(authoringEarlierPartsField.safeParse(make(1)).success).toBe(true);
    expect(authoringEarlierPartsField.safeParse(make(AUTHORING_EARLIER_PARTS_LIMIT)).success).toBe(
      true,
    );
    expect(
      authoringEarlierPartsField.safeParse(make(AUTHORING_EARLIER_PARTS_LIMIT + 1)).success,
    ).toBe(false);
  });
});

describe('the shared passage', () => {
  it('accepts each of the four text forms, and refuses figure and anything else', () => {
    for (const form of AUTHORING_SHARED_PASSAGE_FORMS) {
      expect(authoringSharedPassage.safeParse({ form, text: 'A synthetic passage.' }).success).toBe(
        true,
      );
    }
    expect(authoringSharedPassage.safeParse({ form: 'figure', text: 'x' }).success).toBe(false);
    expect(authoringSharedPassage.safeParse({ form: 'chart', text: 'x' }).success).toBe(false);
    expect(authoringSharedPassage.safeParse({ text: 'x' }).success).toBe(false);
  });

  it('keeps the text exactly as sent, untrimmed, and refuses a blank one', () => {
    const text = '  A synthetic table.\n| a | b |  ';
    expect(authoringSharedPassage.parse({ form: 'table', text })).toEqual({ form: 'table', text });
    expect(authoringSharedPassage.safeParse({ form: 'table', text: '  ' }).success).toBe(false);
    expect(authoringSharedPassage.safeParse({ form: 'table', text: '' }).success).toBe(false);
  });

  it('accepts text at the character limit, refuses one past it', () => {
    const at = 'x'.repeat(AUTHORING_SHARED_PASSAGE_MAX_CHARS);
    expect(authoringSharedPassage.safeParse({ form: 'extract', text: at }).success).toBe(true);
    expect(authoringSharedPassage.safeParse({ form: 'extract', text: `${at}x` }).success).toBe(
      false,
    );
  });
});
