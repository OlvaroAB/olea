/**
 * `token-field-copy.ts` tests. Pure string/boolean constants — no obsidian
 * import, no DOM.
 *
 * **Superseded assertions, not deleted history.** Through P2-T10 this file
 * asserted `TOKEN_FIELD_DISABLED === true` and copy saying "not available
 * yet" — correct then, because no transport existed. `ol-k57j` built one
 * (`../../src/worker/transport.ts`), so the field is live now; see
 * `features/F7-plugin-surface.md`'s new "F7.1 — the token field is live"
 * section for the scenario this file now asserts, and the note left on the
 * old P2-T10 section marking it superseded rather than rewriting it.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.1 — the token field is
 * live" — @auto:plugin/settings/token-field-copy.spec.
 */
import { describe, expect, it } from 'vitest';
import {
  TOKEN_FIELD_DESCRIPTION,
  TOKEN_FIELD_DISABLED,
  TOKEN_FIELD_NAME,
  TOKEN_FIELD_PLACEHOLDER,
} from '../../src/settings/token-field-copy.js';

const ERROR_IMPLYING_WORDS = [/invalid/i, /incorrect/i, /wrong/i, /error/i, /failed/i, /expired/i];

describe('token field — live (F7.1, ol-k57j)', () => {
  it('is enabled', () => {
    expect(TOKEN_FIELD_DISABLED).toBe(false);
  });

  it('has a name identifying the field', () => {
    expect(TOKEN_FIELD_NAME.length).toBeGreaterThan(0);
  });

  it('description and placeholder never imply the user did something wrong', () => {
    for (const copy of [TOKEN_FIELD_DESCRIPTION, TOKEN_FIELD_PLACEHOLDER]) {
      for (const errorWord of ERROR_IMPLYING_WORDS) {
        expect(copy).not.toMatch(errorWord);
      }
    }
  });

  it('description states the value is stored locally, never in the vault, and never logged', () => {
    expect(TOKEN_FIELD_DESCRIPTION).toMatch(/stored locally/i);
    expect(TOKEN_FIELD_DESCRIPTION).toMatch(/never the vault/i);
    expect(TOKEN_FIELD_DESCRIPTION).toMatch(/never logged/i);
  });

  it('placeholder invites pasting a token rather than saying nothing is available', () => {
    expect(TOKEN_FIELD_PLACEHOLDER).toMatch(/token/i);
  });
});
