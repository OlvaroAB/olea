/**
 * `grove/copy.ts` honesty tests (F8.1, F8.2, F8.3, `ol-0r92.17`, `ol-o8eo`) —
 * same pattern `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their
 * own `allXStrings()` sweep, plus `gap/copy.ts#coverageScopeStatement`'s own
 * convention of sweeping a TEMPLATED function's output across representative
 * fixtures, since `allGroveStrings()` alone cannot enumerate one.
 */
import type { GroveCourseSummary, VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  allGroveStrings,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_MATERIAL_GAP_LABEL,
  GROVE_VIEW_TITLE,
  grovePapersLabel,
  groveScopeCorrectionReceiptLine,
  groveStateLabel,
  groveSummaryLine,
} from '../../src/grove/copy.js';

const SUMMARIES: readonly GroveCourseSummary[] = [
  { builtCount: 0, denominatorCount: 0, denominatorSourcePaths: [], pastPaperSourcePaths: [] },
  {
    builtCount: 1,
    denominatorCount: 1,
    denominatorSourcePaths: ['03 Research/Objectives.md'],
    pastPaperSourcePaths: [],
  },
  {
    builtCount: 3,
    denominatorCount: 7,
    denominatorSourcePaths: ['03 Research/Objectives.md', '03 Research/Past Paper 2024.md'],
    pastPaperSourcePaths: ['03 Research/Past Paper 2024.md'],
  },
];

const SHRINK_RECEIPTS: readonly string[] = [
  groveScopeCorrectionReceiptLine('03 Research/Past Paper 2024.md' as VaultPath, 7, 5),
  groveScopeCorrectionReceiptLine('03 Research/Objectives.md' as VaultPath, 1, 0),
];

/** Representative `grovePapersLabel` outputs (`ol-l5og.18.2`) — same "sweep a templated function's output" convention `SUMMARIES`/`SHRINK_RECEIPTS` already follow. */
const PAPERS_LABELS: readonly string[] = [
  grovePapersLabel(0, 0),
  grovePapersLabel(0, 1),
  grovePapersLabel(2, 6),
  grovePapersLabel(6, 6),
];

/** Every string this module can put in front of her, across representative summaries — the sweep target for F8.3's ban, matching `gap/copy.ts`'s own convention. */
function everyProducibleString(): readonly string[] {
  return [
    ...allGroveStrings(),
    ...SUMMARIES.map(groveSummaryLine),
    ...SHRINK_RECEIPTS,
    ...PAPERS_LABELS,
  ];
}

describe('grove copy — F8.3 no scalar', () => {
  it('never contains a percentage, ratio or fraction, across every producible string', () => {
    for (const text of everyProducibleString()) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('exposes a real, non-empty title', () => {
    expect(GROVE_VIEW_TITLE.length).toBeGreaterThan(0);
  });

  it('every string is non-empty', () => {
    for (const text of everyProducibleString()) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('labels an Olea-inferred count as a guess, per F8.1’s own escape hatch', () => {
    // F8.1: "scope Olea inferred alone is a guess and must be labelled one."
    expect(GROVE_INFERRED_DISCLAIMER.toLowerCase()).toContain('not yet');
  });

  it('the summary line names the count and the source separately — never their quotient', () => {
    const line = groveSummaryLine(SUMMARIES[2] as GroveCourseSummary);
    expect(line).toContain('3 of 7 built');
    expect(line).toContain('2 registered sources');
  });

  it('the papers label (`ol-l5og.18.2`) names the count and the registered denominator separately — never their quotient', () => {
    expect(grovePapersLabel(2, 6)).toBe('Asked in 2 of 6 registered past papers.');
    expect(grovePapersLabel(1, 1)).toBe('Asked in 1 of 1 registered past paper.');
  });

  it('the shrink receipt (`[D-184]`) names the reclassified document and both counts, once', () => {
    const line = groveScopeCorrectionReceiptLine(
      '03 Research/Past Paper 2024.md' as VaultPath,
      7,
      5,
    );
    expect(line).toContain('03 Research/Past Paper 2024.md');
    expect(line).toContain('7');
    expect(line).toContain('5');
    expect(line.toLowerCase()).not.toMatch(/\bwrong\b|\bmistake\b|\bfault\b/);
  });
});

describe('grove copy — vocabulary registry §6 discipline', () => {
  it('never coins a fourth olive noun for a material gap — it is plain language', () => {
    expect(GROVE_MATERIAL_GAP_LABEL.toLowerCase()).not.toContain('ground');
    expect(GROVE_MATERIAL_GAP_LABEL.toLowerCase()).not.toContain('grove');
  });

  it('never says "not worth building" for a stalled ground reading — F4.5, [D-063]', () => {
    for (const text of everyProducibleString()) {
      expect(text.toLowerCase()).not.toContain('not worth building');
      expect(text.toLowerCase()).not.toContain('olea decided');
    }
  });

  it('reads the four growth-stage words verbatim from olea-core, never re-wording them', () => {
    expect(groveStateLabel('seed')).toBe('seed');
    expect(groveStateLabel('sprout')).toBe('sprout');
    expect(groveStateLabel('sapling')).toBe('sapling');
    expect(groveStateLabel('tree')).toBe('tree');
    expect(groveStateLabel('ground')).toBe('ground');
  });
});
