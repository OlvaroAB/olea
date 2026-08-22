/**
 * `degradation-statement.ts` tests. Pure string constants — no obsidian
 * import, no DOM — so these run in plain Vitest. Asserts the F7.8 promise
 * actually lands in the rendered text: the four things that keep working
 * with no AI, and that the statement is unconditional rather than "works
 * without AI once you configure X".
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

  it('states the guarantee unconditionally ("always work"), not as a future promise', () => {
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/always work/i);
  });

  it('covers both halves of F7.8: switching AI off by choice, and the AI service being unreachable', () => {
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/switching it off/i);
    expect(DEGRADATION_STATEMENT_BODY).toMatch(/losing the connection/i);
  });

  it('has a non-empty heading', () => {
    expect(DEGRADATION_STATEMENT_HEADING.length).toBeGreaterThan(0);
  });
});
