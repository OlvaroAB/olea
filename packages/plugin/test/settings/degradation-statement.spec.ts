/**
 * `degradation-statement.ts` tests. Pure string constants — no obsidian
 * import, no DOM — so these run in plain Vitest. Asserts the F7.8 promise
 * actually lands in the rendered text: the four things that keep working
 * with no AI, unconditionally, and that the AI-availability claim matches
 * what the wiring code actually does (conditional on the Worker being
 * configured and reachable) rather than a flat claim in either direction —
 * see `[STALE-AI1]` (`ol-egov.141.8.5`) for the defect this guards against.
 */
import { describe, expect, it } from 'vitest';
import {
  DEGRADATION_STATEMENT_BODY,
  DEGRADATION_STATEMENT_HEADING,
} from '../../src/settings/degradation-statement.js';

describe('F7.8 degradation statement', () => {
  it('names all four capabilities F7.8 promises keep working with no AI', () => {
    for (const capability of ['Cards', 'review', 'scheduling', 'Today panel']) {
      expect(DEGRADATION_STATEMENT_BODY).toContain(capability);
    }
  });

  it('states the no-AI guarantee unconditionally ("always work"), not as a future promise', () => {
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/always work with no AI connection at all/i);
  });

  it('covers all three degraded paths: switching AI off, leaving it unconfigured, and losing the connection', () => {
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/switching it off/i);
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/unconfigured/i);
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/losing the connection/i);
  });

  it('[STALE-AI1] does not claim AI is unavailable in this build — a real Worker transport, connection test, explain-back and generation pipeline all exist on main', () => {
    expect(DEGRADATION_STATEMENT_BODY).not.toMatch(/not (yet )?available/i);
    expect(DEGRADATION_STATEMENT_BODY).not.toMatch(/no AI (features |exists? )?(yet|exist)/i);
  });

  it('[STALE-AI1] states AI availability as conditional on the Worker being configured, matching isWorkerConfigured', () => {
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/token/i);
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/base url/i);
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/connection succeeds/i);
  });

  it('has a non-empty heading', () => {
    expect(DEGRADATION_STATEMENT_HEADING.length).toBeGreaterThan(0);
  });
});
