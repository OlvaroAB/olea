import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import { PROVISIONAL_CONCEPT_KEY_PREFIX, provisionalConceptKey } from './concept-key.js';

describe('provisionalConceptKey', () => {
  it('is pure and total: the same input always mints the same key', () => {
    const input = { name: 'Imbrication', boundNotePath: null };
    expect(provisionalConceptKey(input)).toBe(provisionalConceptKey({ ...input }));
  });

  it('carries the provisional marker, greppable in a review-log line or a bug report', () => {
    expect(provisionalConceptKey({ name: 'Imbrication', boundNotePath: null })).toMatch(
      new RegExp(`^${PROVISIONAL_CONCEPT_KEY_PREFIX}:`),
    );
  });

  it('prefers the bound note path over the display name, when both are available', () => {
    const boundNotePath = '05 Zettelkasten/Imbrication.md' as VaultPath;
    const key = provisionalConceptKey({ name: 'Imbrication', boundNotePath });
    expect(key).toBe(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:${boundNotePath}`);
  });

  it('falls back to the display name when there is no bound note', () => {
    const key = provisionalConceptKey({ name: 'Imbrication', boundNotePath: null });
    expect(key).toBe(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:Imbrication`);
  });

  it('two different display names with no bound note mint two different keys', () => {
    const a = provisionalConceptKey({ name: 'Concept One', boundNotePath: null });
    const b = provisionalConceptKey({ name: 'Concept Two', boundNotePath: null });
    expect(a).not.toBe(b);
  });

  it(
    'is HONEST, not stable, across the edit that would matter — a renamed bound note mints ' +
      'a different key, which is the deliberately unclosed half this module documents',
    () => {
      const before = provisionalConceptKey({
        name: 'Imbrication',
        boundNotePath: '05 Zettelkasten/Imbrication.md' as VaultPath,
      });
      const afterRename = provisionalConceptKey({
        name: 'Imbrication',
        boundNotePath: '05 Zettelkasten/Imbrication (renamed).md' as VaultPath,
      });
      expect(afterRename).not.toBe(before);
    },
  );
});
