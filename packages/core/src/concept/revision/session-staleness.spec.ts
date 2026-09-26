/**
 * `hasCitationRevisionChangedInScope` — `[ILB-CHG-4]` (`ol-egov.141.89.5.4`),
 * component register row 3.6's staleness fact, sourced from this chain's own
 * pending-revalidation record (`[D-343]`/`[D-351]`) rather than a vault
 * `firstSeen`/arrival read. See the module's own doc for why only a NEWLY
 * pending instrument counts, mirroring `queue/rebuild-controller.ts`'s
 * `diffSittingScopeSnapshots` `itemsDueInScope` direction exactly.
 *
 * INV-3: every id here is coined. No course code, note title or wording
 * comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { hasCitationRevisionChangedInScope } from './session-staleness.js';

describe('hasCitationRevisionChangedInScope', () => {
  it('reports false when both sets are empty — nothing pending at freeze, nothing pending now', () => {
    expect(hasCitationRevisionChangedInScope(new Set(), new Set())).toBe(false);
  });

  it('reports false when the current set is identical to the frozen set — already pending before the freeze is not a change', () => {
    const frozen = new Set(['inst-1', 'inst-2']);
    const current = new Set(['inst-1', 'inst-2']);
    expect(hasCitationRevisionChangedInScope(frozen, current)).toBe(false);
  });

  it('reports true when an instrument id is pending now but was not pending at freeze time', () => {
    const frozen = new Set(['inst-1']);
    const current = new Set(['inst-1', 'inst-2']);
    expect(hasCitationRevisionChangedInScope(frozen, current)).toBe(true);
  });

  it('reports true when the frozen set was empty and the current set names any pending instrument', () => {
    expect(hasCitationRevisionChangedInScope(new Set(), new Set(['inst-1']))).toBe(true);
  });

  it('reports false when an instrument RESOLVED out of pending since the freeze — losing a pending mark is not a staleness signal', () => {
    const frozen = new Set(['inst-1', 'inst-2']);
    const current = new Set(['inst-1']); // inst-2 resolved (e.g. an immaterial verdict restored it)
    expect(hasCitationRevisionChangedInScope(frozen, current)).toBe(false);
  });

  it('reports true on a mix: one instrument resolved out, another newly entered pending', () => {
    const frozen = new Set(['inst-1', 'inst-2']);
    const current = new Set(['inst-3']); // inst-2 resolved, inst-3 is new
    expect(hasCitationRevisionChangedInScope(frozen, current)).toBe(true);
  });
});
