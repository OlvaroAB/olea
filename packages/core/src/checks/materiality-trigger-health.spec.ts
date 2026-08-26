import { describe, expect, it } from 'vitest';
import type { MaterialityTriggerCase } from './materiality-trigger-health.js';
import { checkMaterialityTriggerHealth } from './materiality-trigger-health.js';

const CLEAN_BATCH: readonly MaterialityTriggerCase[] = [
  { id: 'case-1', editKind: 'formatting-only', triggered: false },
  { id: 'case-2', editKind: 'formatting-only', triggered: false },
  { id: 'case-3', editKind: 'genuine-change', triggered: true },
  { id: 'case-4', editKind: 'genuine-change', triggered: true },
];

describe('checkMaterialityTriggerHealth — row 1.4 health check', () => {
  it('passes when every formatting-only case is silent and every genuine-change case fires', () => {
    const verdict = checkMaterialityTriggerHealth(CLEAN_BATCH);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.falseTriggers).toEqual([]);
    expect(verdict.measured.missedTriggers).toEqual([]);
    expect(verdict.measured.n).toBe(4);
  });

  it('fails and names the case id when a formatting-only edit fires anyway', () => {
    const batch: readonly MaterialityTriggerCase[] = [
      ...CLEAN_BATCH,
      { id: 'false-trigger-1', editKind: 'formatting-only', triggered: true },
    ];
    const verdict = checkMaterialityTriggerHealth(batch);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.falseTriggers).toEqual(['false-trigger-1']);
    expect(verdict.detail).toContain('false-trigger-1');
  });

  it('fails and names the case id when a genuine change does not fire — the planted failure', () => {
    // Plant a failure: take the clean batch and flip one genuine-change
    // case's `triggered` flag to false, as if the trigger under test had
    // silently swallowed a real edit. This is the self-test that proves the
    // check can actually report `ok: false`, not only ever pass.
    const planted: readonly MaterialityTriggerCase[] = CLEAN_BATCH.map((c) =>
      c.id === 'case-3' ? { ...c, triggered: false } : c,
    );
    const verdict = checkMaterialityTriggerHealth(planted);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.missedTriggers).toEqual(['case-3']);
    expect(verdict.detail).toContain('case-3');
  });

  it('fails on zero cases — a sweep that ran nothing cannot report a clean bill (N-013)', () => {
    const verdict = checkMaterialityTriggerHealth([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });

  it('reports both a false trigger and a missed trigger together when both are present', () => {
    const batch: readonly MaterialityTriggerCase[] = [
      { id: 'false-1', editKind: 'formatting-only', triggered: true },
      { id: 'missed-1', editKind: 'genuine-change', triggered: false },
    ];
    const verdict = checkMaterialityTriggerHealth(batch);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.falseTriggers).toEqual(['false-1']);
    expect(verdict.measured.missedTriggers).toEqual(['missed-1']);
  });
});
