// Regression test for a barrel omission the ilb-pln case runner discovered
// (`ol-egov.141.89.10.4` part 2's report): `packages/core/src/index.ts`'s
// `ingestion/budget.js` re-export block carried `classifyHeadroom` and
// `pacingDelayMs` but omitted three exports `budget.ts` itself already
// defines — `workflowAllowanceExhausted`, `spendFromWorkflowAllowance` and
// `MAX_ATTEMPTS` — so any caller outside this package that imports them from
// the public entry point (`olea-core`, never the internal path) got
// `undefined` instead of the real function/constant. This file is dedicated
// to that one export block (this bead's owns for `index.ts`) rather than
// added to an existing spec elsewhere.
import { describe, expect, it } from 'vitest';
import * as oleaCore from './index.js';

describe('olea-core barrel — ingestion/budget.js re-export completeness (ol-egov.141.89.10.4 part 3)', () => {
  it('exports workflowAllowanceExhausted, spendFromWorkflowAllowance and MAX_ATTEMPTS from the public entry point', () => {
    expect(typeof oleaCore.workflowAllowanceExhausted).toBe('function');
    expect(typeof oleaCore.spendFromWorkflowAllowance).toBe('function');
    expect(oleaCore.MAX_ATTEMPTS).toBe(8);
  });

  it('the re-exported functions behave exactly as budget.ts documents them', () => {
    expect(oleaCore.workflowAllowanceExhausted(0.5, 1)).toBe(true);
    expect(oleaCore.workflowAllowanceExhausted(2, 1)).toBe(false);
    expect(oleaCore.spendFromWorkflowAllowance(2, 1)).toBe(1);
    expect(oleaCore.spendFromWorkflowAllowance(0.5, 1)).toBe(0);
  });
});
