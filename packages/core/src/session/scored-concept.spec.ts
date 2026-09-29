// Scenarios: features/F2-review.md, "F2.14 — Instruments are enumerated from her
// vault" — the `[D-419]` / `[D-423]` block, "one shared rule names the scored
// concept and the context, and nothing else decides credit" —
// @auto:core/session/scored-concept.spec (`ol-egov.141.89.9.65`).
//
// Concept ids are structural placeholders (INV-3).
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import {
  contextConceptIds,
  creditsConcept,
  orderNoteConcepts,
  scoredConceptId,
  scoredConceptOf,
} from './scored-concept.js';

function concept(name: string): ConceptRecord {
  return { key: `key:${name}`, name, tier: 2, courses: ['TEST101'], sourcePaths: ['Notes/one.md'] };
}

describe('the scored concept is the first id, the context concepts are the rest', () => {
  it('names the first id of a list, in her order, as the scored concept', () => {
    expect(scoredConceptId(['b', 'a', 'c'])).toBe('b');
    expect(scoredConceptOf({ conceptIds: ['b', 'a', 'c'] })).toBe('b');
  });

  it('names every later id, in the same order, as a context concept', () => {
    expect(contextConceptIds(['b', 'a', 'c'])).toEqual(['a', 'c']);
  });

  it('a one-element list has a scored concept and no context — the common case', () => {
    expect(scoredConceptId(['only'])).toBe('only');
    expect(contextConceptIds(['only'])).toEqual([]);
  });

  it('an empty list credits nothing rather than inventing an id', () => {
    expect(scoredConceptId([])).toBeUndefined();
    expect(contextConceptIds([])).toEqual([]);
    expect(creditsConcept({ conceptIds: [] }, 'a')).toBe(false);
  });

  it('never reorders, sorts or de-duplicates what it is given', () => {
    const list = ['z', 'a', 'z'];
    expect(scoredConceptId(list)).toBe('z');
    expect(contextConceptIds(list)).toEqual(['a', 'z']);
    expect(list).toEqual(['z', 'a', 'z']);
  });
});

describe('only the scored concept is credited', () => {
  const record = { conceptIds: ['first', 'second', 'third'] };

  it('credits the first id', () => {
    expect(creditsConcept(record, 'first')).toBe(true);
  });

  it('does not credit a concept the record only names as context', () => {
    expect(creditsConcept(record, 'second')).toBe(false);
    expect(creditsConcept(record, 'third')).toBe(false);
  });

  it('does not credit a concept the record does not name at all', () => {
    expect(creditsConcept(record, 'elsewhere')).toBe(false);
  });

  it('reads whatever list the record carries — the same rule serves an instrument and a review record', () => {
    // An instrument and the review recorded from it under the same order agree;
    // a review recorded after the topics were reordered carries its own list.
    const instrument = { conceptIds: ['a', 'b'] };
    const reviewBefore = { conceptIds: ['a', 'b'] };
    const reviewAfterReorder = { conceptIds: ['b', 'a'] };
    expect(scoredConceptOf(instrument)).toBe(scoredConceptOf(reviewBefore));
    expect(scoredConceptOf(reviewAfterReorder)).toBe('b');
    // The earlier record is a value; nothing here rewrote it.
    expect(scoredConceptOf(reviewBefore)).toBe('a');
  });
});

describe('orderNoteConcepts puts her first-listed resolving topic first', () => {
  const alpha = concept('Alpha');
  const beta = concept('Beta');
  const gamma = concept('Gamma');
  const delta = concept('Delta');

  it('orders by her topic order, not the extractor’s', () => {
    const ordered = orderNoteConcepts(['Beta', 'Alpha'], [alpha, beta]);
    expect(ordered.map((c) => c.name)).toEqual(['Beta', 'Alpha']);
  });

  it('a topic that resolves to no concept is dropped, and the next one that resolves is scored', () => {
    const ordered = orderNoteConcepts(['Unknown', 'Alpha', 'Beta'], [beta, alpha]);
    expect(ordered.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });

  it('a concept the extractor bound but her topics did not reach travels after every topic', () => {
    // Gamma is attested by a body link, not by her `topic:`; Delta likewise.
    const ordered = orderNoteConcepts(['Beta', 'Alpha'], [gamma, alpha, delta, beta]);
    expect(ordered.map((c) => c.name)).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta']);
    // The scored concept is her first topic, never a linked concept that
    // happens to come earlier in the extractor's own order.
    expect(scoredConceptId(ordered.map((c) => c.key))).toBe('key:Beta');
  });

  it('a topic she lists twice is one concept, at its first position', () => {
    const ordered = orderNoteConcepts(['Alpha', 'Beta', 'Alpha'], [alpha, beta]);
    expect(ordered.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });

  it('with no resolving topic the first concept the extractor attested is the scored one (today’s fallback, kept)', () => {
    const ordered = orderNoteConcepts([], [gamma, delta]);
    expect(ordered.map((c) => c.name)).toEqual(['Gamma', 'Delta']);
    const none = orderNoteConcepts(['Alpha'], []);
    expect(none).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const topics = ['Beta', 'Alpha'] as const;
    const noteConcepts = [alpha, beta];
    orderNoteConcepts(topics, noteConcepts);
    expect(topics).toEqual(['Beta', 'Alpha']);
    expect(noteConcepts.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });
});
