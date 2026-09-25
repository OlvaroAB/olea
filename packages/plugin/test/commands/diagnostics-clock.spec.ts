/**
 * `diagnostics-clock.ts` — the pure clock seam `diagnostics-clipboard.ts` stamps its report's
 * `generatedAt` from (`ol-3ux7.64.26`). Split out because `diagnostics-clipboard.ts` itself
 * imports `obsidian`, which has no runtime under Vitest — see that file's own module doc and
 * this file's.
 */
import { describe, expect, it } from 'vitest';
import { resolveDiagnosticsGeneratedAt } from '../../src/commands/diagnostics-clock.js';

describe('resolveDiagnosticsGeneratedAt', () => {
  it('a stubbed clock reaches the output verbatim, as an ISO string', () => {
    const stubbed = new Date('2026-01-02T03:04:05.000Z');
    expect(resolveDiagnosticsGeneratedAt(() => stubbed)).toBe('2026-01-02T03:04:05.000Z');
  });

  it('defaults to the real wall clock when no clock is given, identical to a bare new Date() read', () => {
    const before = Date.now();
    const result = resolveDiagnosticsGeneratedAt(undefined);
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    expect(resultMs).toBeGreaterThanOrEqual(before);
    expect(resultMs).toBeLessThanOrEqual(after);
  });
});
