/**
 * `base-url-field-copy.ts` tests. Pure string constants — no obsidian
 * import, no DOM.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.1 — the base URL field" —
 * @auto:plugin/settings/base-url-field-copy.spec.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_URL_FIELD_DESCRIPTION,
  BASE_URL_FIELD_NAME,
  BASE_URL_FIELD_PLACEHOLDER,
} from '../../src/settings/base-url-field-copy.js';

describe('base URL field copy', () => {
  it('has a non-empty name', () => {
    expect(BASE_URL_FIELD_NAME.length).toBeGreaterThan(0);
  });

  it('placeholder looks like a URL, not a live example — the shipped default is blank', () => {
    expect(BASE_URL_FIELD_PLACEHOLDER).toMatch(/^https?:\/\//);
  });

  it('description says AI features stay off, not that anything is broken, when left blank', () => {
    expect(BASE_URL_FIELD_DESCRIPTION).toMatch(/leave blank/i);
    for (const errorWord of [/invalid/i, /error/i, /broken/i, /wrong/i]) {
      expect(BASE_URL_FIELD_DESCRIPTION).not.toMatch(errorWord);
    }
  });

  it('description restates the F7.8 guarantee that the rest of Olea is unaffected', () => {
    for (const capability of ['cards', 'review', 'scheduling', 'Today panel']) {
      expect(BASE_URL_FIELD_DESCRIPTION).toMatch(new RegExp(capability, 'i'));
    }
  });
});
