/**
 * `classifyRelocation` — `[D-093]`'s "exact heals silently, near only
 * proposes" split (`features/F3-learn-from-anything.md`'s
 * `core/instrument/material-change.spec` scenarios).
 *
 * INV-3: every string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { classifyRelocation, normalizeWhitespace } from './relocate.js';
import type { RelocationCandidate } from './types.js';

function candidate(text: string, sourcePath = 'Note B.md'): RelocationCandidate {
  return {
    anchor: { sourcePath, location: { page: 1, charRange: { start: 0, end: text.length } } },
    text,
  };
}

describe('normalizeWhitespace', () => {
  it('collapses runs of whitespace to one space and trims', () => {
    expect(normalizeWhitespace('  a paragraph   moved\n\nto here  ')).toBe(
      'a paragraph moved to here',
    );
  });
});

describe('classifyRelocation', () => {
  it('reports exact for a whitespace-only difference', () => {
    const old = 'the mineral forms under high pressure and slow cooling';
    const result = classifyRelocation(old, [
      candidate('  the mineral forms under\nhigh pressure and slow cooling  '),
    ]);
    expect(result.kind).toBe('exact');
  });

  it('reports none when no candidate shares enough wording', () => {
    const old = 'the mineral forms under high pressure and slow cooling';
    const result = classifyRelocation(old, [
      candidate('an entirely unrelated sentence about tides'),
    ]);
    expect(result.kind).toBe('none');
  });

  it('reports near for a candidate sharing most but not all wording', () => {
    const old = 'the mineral forms under high pressure and slow cooling over centuries';
    const result = classifyRelocation(old, [
      candidate('the mineral forms under high pressure and rapid cooling over centuries'),
    ]);
    expect(result.kind).toBe('near');
  });

  it('prefers an exact match over a near match when both are present', () => {
    const old = 'the mineral forms under high pressure and slow cooling';
    const near = candidate('the mineral forms under high pressure and rapid cooling');
    const exact = candidate('the mineral forms under high pressure and slow cooling');
    const result = classifyRelocation(old, [near, exact]);
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') expect(result.candidate).toBe(exact);
  });

  it('picks the highest-overlap candidate among several near matches', () => {
    const old = 'igneous rock forms from cooled magma deep underground over long periods';
    const weaker = candidate('igneous rock forms from cooled lava near the surface quickly');
    const stronger = candidate('igneous rock forms from cooled magma deep underground quickly');
    const result = classifyRelocation(old, [weaker, stronger]);
    expect(result.kind).toBe('near');
    if (result.kind === 'near') expect(result.candidate).toBe(stronger);
  });
});
