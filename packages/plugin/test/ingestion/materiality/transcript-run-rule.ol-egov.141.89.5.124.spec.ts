// Scenarios: features/F1-sources.md, C5.3 / [D-579] (ol-egov.141.89.5.124). Test id:
// @auto:plugin/ingestion/materiality/transcript-run-rule.ol-egov.141.89.5.124.spec
//
// Runs of windows at or above the transcript floor that stand fewer than two passage lengths apart
// are one region ([D-579]); runs two or more passage lengths apart, or a second region elsewhere,
// stay ambiguous; a note passage keeps the run rule as it was. All text is synthetic ("course A").
import { digestPassage, TRANSCRIPT_RUN_MERGE_GAP_PASSAGES } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { resolveAnchoredPassage } from '../../../src/ingestion/materiality/passage-grain.js';
import { resolveTranscriptPassage } from '../../../src/ingestion/materiality/transcript-grain.js';

/** n distinct invented words, each carrying a label so different groups never share a word. */
function group(label: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${label}${i}x`);
}

const A = group('alpha', 14);
const B = group('bravo', 13);
const C = group('carol', 13);
/** The cited passage: three groups, 40 distinct words. */
const PASSAGE = [...A, ...B, ...C];
const WIDTH = PASSAGE.length;

/**
 * The passage's own place after an edit: its three groups with ten replaced words between each.
 * Windows of the passage's length cross 0.55 in two runs here (one around the first two groups,
 * one around the last two) with a dip between them.
 */
function editedPlace(tag: string): string[] {
  return [...A, ...group(`${tag}g1`, 10), ...B, ...group(`${tag}g2`, 10), ...C];
}

function filler(tag: string, n: number): string[] {
  return group(`${tag}fill`, n);
}

describe('transcript run rule, [D-579] (ol-egov.141.89.5.124)', () => {
  it('declares the gap as two passage lengths', () => {
    expect(TRANSCRIPT_RUN_MERGE_GAP_PASSAGES).toBe(2);
  });

  it("several runs at the part's own place, less than two passage lengths apart, relocate to it", () => {
    const stream = [...filler('pre', 120), ...editedPlace('own'), ...filler('post', 120)];
    const resolution = resolveTranscriptPassage(PASSAGE.join(' '), stream);
    expect(resolution.kind).toBe('changed');
    if (resolution.kind !== 'changed') return;
    // The region read is the part's own place: it holds the cited groups, nothing of the filler.
    expect(resolution.text).toContain('alpha0x');
    expect(resolution.text).toContain('carol12x');
    expect(resolution.text).not.toContain('prefill');
    expect(resolution.text).not.toContain('postfill');
  });

  it('runs two or more passage lengths apart stay ambiguous', () => {
    const apart = filler('gap', 3 * WIDTH);
    const stream = [...filler('pre', 60), ...editedPlace('one'), ...apart, ...editedPlace('two')];
    expect(resolveTranscriptPassage(PASSAGE.join(' '), stream)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    });
  });

  it('a second region elsewhere in the transcript stays ambiguous', () => {
    const second = [...A, ...filler('oneword', 4), ...B, ...C]; // an edited copy, a single run
    const stream = [...editedPlace('own'), ...filler('mid', 300), ...second];
    expect(resolveTranscriptPassage(PASSAGE.join(' '), stream)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    });
  });

  it('a note passage is unaffected: two near blocks that resemble it stay ambiguous', async () => {
    const text = PASSAGE.join(' ');
    // Two adjacent blocks, each holding about half the passage: near each other, yet two candidates.
    const files: Record<string, string> = {
      'A.md': `${[...A, ...B].join(' ')} ${filler('x', 3).join(' ')}\n\n${[...B, ...C].join(' ')} ${filler('y', 3).join(' ')}\n`,
    };
    const notes = {
      exists: async (path: string) => files[path] !== undefined,
      material: async (path: string) => files[path] as string,
      markdownPaths: async () => Object.keys(files),
    };
    const resolved = await resolveAnchoredPassage(
      { text, passageDigest: await digestPassage(text), anchorPath: 'A.md', citedPath: 'A.md' },
      notes,
    );
    expect(resolved).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
  });
});
