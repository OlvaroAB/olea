import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import {
  conceptIdentityNormalizationIndex,
  mintOpaqueConceptKey,
  OPAQUE_CONCEPT_KEY_PREFIX,
  PROVISIONAL_CONCEPT_KEY_PREFIX,
  provisionalConceptKey,
} from './concept-key.js';

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

describe('mintOpaqueConceptKey (ol-bo48, ONT-R1 ol-2zfj.86, ONT-R6 ol-2zfj.88, [D-174])', () => {
  it('carries the opaque marker, distinct from the provisional prefix', () => {
    expect(mintOpaqueConceptKey(() => 'fixed-nonce')).toBe(
      `${OPAQUE_CONCEPT_KEY_PREFIX}:fixed-nonce`,
    );
    expect(OPAQUE_CONCEPT_KEY_PREFIX).not.toBe(PROVISIONAL_CONCEPT_KEY_PREFIX);
  });

  it('takes no content input at all — there is no name, path or wording parameter to derive from', () => {
    // Structural, not merely behavioural: mintOpaqueConceptKey's only parameter is an optional
    // nonce source (declared length 0, since it is defaulted), so unlike provisionalConceptKey's
    // required `{ name, boundNotePath }` input, there is nothing content-shaped to pass in the
    // first place.
    expect(mintOpaqueConceptKey.length).toBe(0);
    expect(provisionalConceptKey.length).toBe(1);
  });

  it('is content-independent: two mints for what would be the same content never coincide unless the nonce source says so', () => {
    let calls = 0;
    const nonceSource = () => `nonce-${++calls}`;
    const first = mintOpaqueConceptKey(nonceSource);
    const second = mintOpaqueConceptKey(nonceSource);
    expect(first).not.toBe(second);
  });

  it('defaults to a real random nonce (crypto.randomUUID) — two default-generated keys never collide', () => {
    const a = mintOpaqueConceptKey();
    const b = mintOpaqueConceptKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^${OPAQUE_CONCEPT_KEY_PREFIX}:`));
  });

  it('the injected nonce source is called exactly once per mint', () => {
    let calls = 0;
    mintOpaqueConceptKey(() => {
      calls += 1;
      return 'n';
    });
    expect(calls).toBe(1);
  });
});

describe('conceptIdentityNormalizationIndex (ONT-R1, ol-2zfj.86, C7.11)', () => {
  it('is pure and total: the same wording always normalises the same way', () => {
    expect(conceptIdentityNormalizationIndex('Osmosis')).toBe(
      conceptIdentityNormalizationIndex('Osmosis'),
    );
  });

  it('case-folds', () => {
    expect(conceptIdentityNormalizationIndex('OSMOSIS')).toBe(
      conceptIdentityNormalizationIndex('osmosis'),
    );
  });

  it('collapses and trims whitespace', () => {
    expect(conceptIdentityNormalizationIndex('  Membrane   transport  ')).toBe(
      conceptIdentityNormalizationIndex('Membrane transport'),
    );
  });

  it('applies Unicode NFKC normalisation — composed and decomposed forms collide', () => {
    const composed = 'étude'; // 'étude', precomposed é
    const decomposed = 'étude'; // 'e' + combining acute accent
    expect(conceptIdentityNormalizationIndex(composed)).toBe(
      conceptIdentityNormalizationIndex(decomposed),
    );
  });

  it('strips minimal punctuation (quotes, terminal punctuation, commas, colons)', () => {
    expect(conceptIdentityNormalizationIndex('"Osmosis," (basic)!')).toBe(
      conceptIdentityNormalizationIndex('Osmosis basic'),
    );
  });

  it('does NOT strip hyphens or mid-word apostrophes — the stripping is "minimal," not exhaustive', () => {
    expect(conceptIdentityNormalizationIndex('co-occurrence')).not.toBe(
      conceptIdentityNormalizationIndex('co occurrence'),
    );
    expect(conceptIdentityNormalizationIndex("student's")).toContain("'");
  });

  it('applies a naive plural fold: one trailing "s" only', () => {
    expect(conceptIdentityNormalizationIndex('membranes')).toBe(
      conceptIdentityNormalizationIndex('membrane'),
    );
  });

  it('never folds a trailing "ss" as a plural', () => {
    expect(conceptIdentityNormalizationIndex('glass')).toBe('glass');
  });

  it('never folds a single-character string to empty', () => {
    expect(conceptIdentityNormalizationIndex('s')).toBe('s');
  });

  it('excludes containment — a shortened or lengthened form never collides', () => {
    // The ruling's own example: "cell" is never treated as matching "cell
    // biology" merely because one contains the other.
    expect(conceptIdentityNormalizationIndex('cell')).not.toBe(
      conceptIdentityNormalizationIndex('cell biology'),
    );
  });

  it('two genuinely distinct wordings never collide', () => {
    expect(conceptIdentityNormalizationIndex('Osmosis')).not.toBe(
      conceptIdentityNormalizationIndex('Diffusion'),
    );
  });
});
