import { describe, expect, it } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';

describe('canonicalizeForMateriality — row 1.4 formatting-only gate', () => {
  it('is unaffected by heading level changes', () => {
    const a = canonicalizeForMateriality('# Weathering\n\nBasalt breaks down into clay.');
    const b = canonicalizeForMateriality('## Weathering\n\nBasalt breaks down into clay.');
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

  // ol-egov.141.89.5.60, [D-511]: marker characters that carry content are kept.
  describe('content-carrying markers stay visible (ol-egov.141.89.5.60, D-511)', () => {
    const unequal: Array<[string, string, string]> = [
      ['list sign changed', '+ x', '- x'],
      ['list sign star vs dash', '* x', '- x'],
      ['block-quote added before a number', '> 5 days', '5 days'],
      ['leading number changed', '3. step', '4. step'],
      ['ordered vs unordered marker', '1. feldspar', '- feldspar'],
      ['unpaired asterisk between letters', 'm*a', 'ma'],
      ['underscore inside a token', 'x_1', 'x1'],
      ['hash tag vs plain word', '#tag', 'tag'],
      ['intra-word paired asterisks', 'a*b*c', 'abc'],
      ['arithmetic asterisks', '2*3*4', '234'],
      ['escaped asterisks', '\\*a\\*', 'a'],
      ['unpaired leading emphasis run', '*a', 'a'],
      ['mismatched run lengths', '**a*', 'a'],
    ];
    for (const [name, a, b] of unequal) {
      it(`DOES change: ${name}`, () => {
        expect(canonicalizeForMateriality(a)).not.toBe(canonicalizeForMateriality(b));
      });
    }

    const equal: Array<[string, string, string]> = [
      ['heading level', '# A', '## A'],
      ['heading marker removed', '## A', 'A'],
      ['bold added', 'The rate is **high** today.', 'The rate is high today.'],
      ['italic star', '*it* works', 'it works'],
      ['italic underscore', '_it_ works', 'it works'],
      ['double underscore', '__b__ works', 'b works'],
      ['triple', '***both*** works', 'both works'],
      ['phrase emphasis', '**two words** here', 'two words here'],
      ['emphasis before punctuation', 'See *this*.', 'See this.'],
      ['trailing spaces', 'the rate is 5 percent   ', 'the rate is 5 percent'],
      ['whitespace reflow', 'the  rate\tis 5  percent', 'the rate is 5 percent'],
      ['blank lines', 'a\n\n\nb', 'a\nb'],
      ['space after list marker', '-   x', '- x'],
    ];
    for (const [name, a, b] of equal) {
      it(`stays free: ${name}`, () => {
        expect(canonicalizeForMateriality(a)).toBe(canonicalizeForMateriality(b));
      });
    }
  });
});
