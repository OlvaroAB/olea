import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ol-l5og.13 — Space/Enter on a focused button must activate the button, not
 * the screen-wide key binding. `review/view.ts` imports `obsidian` at runtime
 * and cannot be mounted under Vitest (see view-focus-document.spec.ts), so this
 * pins the guard as a source-text assertion, the same technique that file uses.
 */
describe('ReviewView.handleKeydown — focused-button activation guard (ol-l5og.13)', () => {
  const source = readFileSync(resolve(__dirname, '../../src/review/view.ts'), 'utf8').replace(
    /\/\/.*$/gm,
    '',
  );
  const handler = source.slice(source.indexOf('private async handleKeydown('));
  const guard = handler.slice(0, handler.indexOf('resolveReviewKey('));

  it('returns before resolveReviewKey when Space or Enter lands on a button-like target', () => {
    expect(guard).toMatch(/evt\.key === ' '/);
    expect(guard).toMatch(/evt\.key === 'Enter'/);
    expect(guard).toMatch(/tagName === 'BUTTON'/);
    expect(guard).toMatch(/tagName === 'A'/);
    expect(guard).toMatch(/getAttribute\('role'\) === 'button'/);
  });

  it('keeps the text-field exemption ahead of the button guard', () => {
    expect(guard.indexOf("tagName === 'INPUT'")).toBeGreaterThan(-1);
    expect(guard.indexOf("tagName === 'INPUT'")).toBeLessThan(
      guard.indexOf("tagName === 'BUTTON'"),
    );
  });
});
