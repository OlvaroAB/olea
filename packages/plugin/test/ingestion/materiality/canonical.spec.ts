import { describe, expect, it } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';

describe('canonicalizeForMateriality — row 1.4 formatting-only gate', () => {
  it('is unaffected by heading level changes', () => {
    const a = canonicalizeForMateriality('# Weathering\n\nBasalt breaks down into clay.');
    const b = canonicalizeForMateriality('## Weathering\n\nBasalt breaks down into clay.');
    expect(a).toBe(b);
  });

  it('is unaffected by list-marker changes', () => {
    const a = canonicalizeForMateriality('- feldspar\n- mica');
    const b = canonicalizeForMateriality('1. feldspar\n2. mica');
    expect(a).toBe(b);
  });

  it('is unaffected by emphasis markers', () => {
    const a = canonicalizeForMateriality('This is **important** and *also* this.');
    const b = canonicalizeForMateriality('This is important and also this.');
    expect(a).toBe(b);
  });

  it('is unaffected by collapsed/expanded whitespace and blank-line reflow', () => {
    const a = canonicalizeForMateriality('Line one.\n\n\nLine two.');
    const b = canonicalizeForMateriality('Line one.\nLine two.');
    expect(a).toBe(b);
  });

  it('is unaffected by blockquote markers', () => {
    const a = canonicalizeForMateriality('> Basalt breaks down into clay.');
    const b = canonicalizeForMateriality('Basalt breaks down into clay.');
    expect(a).toBe(b);
  });

  it('DOES change when a word changes — content, not formatting', () => {
    const a = canonicalizeForMateriality('Basalt breaks down into clay.');
    const b = canonicalizeForMateriality('Basalt breaks down into sand.');
    expect(a).not.toBe(b);
  });

  it("DOES change on a negation insert (D-093's minimal-edit, maximal-meaning example)", () => {
    const a = canonicalizeForMateriality('Basalt weathers quickly.');
    const b = canonicalizeForMateriality('Basalt does not weather quickly.');
    expect(a).not.toBe(b);
  });

  it('DOES change on a number swap', () => {
    const a = canonicalizeForMateriality('The reaction completes in 3 hours.');
    const b = canonicalizeForMateriality('The reaction completes in 30 hours.');
    expect(a).not.toBe(b);
  });
});
