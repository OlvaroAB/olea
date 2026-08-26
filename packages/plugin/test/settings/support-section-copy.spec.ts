/**
 * `support-section-copy.ts` tests (F7.5's in-app feedback path,
 * `ol-p6t02`). Pure string constants — no `obsidian` import, no DOM — same
 * posture as `degradation-statement.spec.ts` and `token-field-copy.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_ISSUE_BUTTON_LABEL,
  REPORT_ISSUE_URL,
  SUPPORT_SECTION_HEADING,
  SUPPORT_SECTION_INTRO,
} from '../../src/settings/support-section-copy.js';

describe('F7.5 support section copy', () => {
  it('has a non-empty heading and button label', () => {
    expect(SUPPORT_SECTION_HEADING.length).toBeGreaterThan(0);
    expect(REPORT_ISSUE_BUTTON_LABEL.length).toBeGreaterThan(0);
  });

  it('points the "Report an issue" link at a real, well-formed https URL', () => {
    expect(() => new URL(REPORT_ISSUE_URL)).not.toThrow();
    expect(REPORT_ISSUE_URL.startsWith('https://')).toBe(true);
  });

  it('the intro names the diagnostics command, tying the two F7.5 halves together', () => {
    expect(SUPPORT_SECTION_INTRO).toContain('Olea: Copy diagnostics');
  });

  it('the intro never claims the diagnostics snapshot carries vault content', () => {
    expect(SUPPORT_SECTION_INTRO).toMatch(/content-free/i);
  });
});
