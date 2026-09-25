/**
 * `classifyMisconceptionConceptIdScheme` (`ol-2zfj.155`) — the pure classifier
 * `../concept/confusion-pairing/corroborate.ts`'s legacy read path relies on
 * to tell a legacy (name-keyed) `MisconceptionRecord.conceptId`/
 * `.confusedWithConceptId` value apart from a new, opaque-keyed one, per
 * `[D-088]`'s conservation property.
 *
 * INV-3: every id and name here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { OPAQUE_CONCEPT_KEY_PREFIX } from '../concept/concept-key.js';
import { classifyMisconceptionConceptIdScheme } from './types.js';

describe('classifyMisconceptionConceptIdScheme', () => {
  it('classifies a plain concept name as legacy-name', () => {
    expect(classifyMisconceptionConceptIdScheme('Mechanical advantage')).toBe('legacy-name');
  });

  it('classifies an opaque-key-prefixed id as opaque-key', () => {
    expect(classifyMisconceptionConceptIdScheme(`${OPAQUE_CONCEPT_KEY_PREFIX}:abc123`)).toBe(
      'opaque-key',
    );
  });

  it('classifies the provisional (non-persisted) stand-in prefix as legacy-name — it is not the opaque scheme', () => {
    expect(classifyMisconceptionConceptIdScheme('concept-prov1:Courses/Sample/note.md')).toBe(
      'legacy-name',
    );
  });

  it('requires the prefix plus its colon separator — a mere substring match is not enough', () => {
    // "concept-key10" contains OPAQUE_CONCEPT_KEY_PREFIX as a raw substring but is not the
    // `${OPAQUE_CONCEPT_KEY_PREFIX}:` shape mintOpaqueConceptKey actually produces.
    expect(classifyMisconceptionConceptIdScheme(`${OPAQUE_CONCEPT_KEY_PREFIX}0`)).toBe(
      'legacy-name',
    );
  });

  it('is a pure, total string test — the empty string classifies as legacy-name, never throws', () => {
    expect(classifyMisconceptionConceptIdScheme('')).toBe('legacy-name');
  });
});
