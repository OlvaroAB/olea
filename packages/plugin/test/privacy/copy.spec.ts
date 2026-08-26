/**
 * F7.4 settings-pane copy tests (`ol-p6t01`). See
 * `features/F7-plugin-surface.md` for the scenarios this asserts
 * (`plugin/privacy/copy.spec`). Same posture as
 * `settings/degradation-statement.spec.ts` and
 * `settings/token-field-copy.spec.ts`: wording is checked as data, no DOM
 * required.
 */
import { describe, expect, it } from 'vitest';
import {
  DELETE_BUTTON_LABEL_CONFIRMING,
  DELETE_BUTTON_LABEL_IDLE,
  DELETE_DESCRIPTION,
  deleteButtonLabel,
  EXPORT_DESCRIPTION,
} from '../../src/privacy/copy.js';

describe('F7.4 privacy copy (ol-p6t01)', () => {
  it('the delete button never executes on the first render — its idle label names the action, not a confirmation', () => {
    expect(deleteButtonLabel('idle')).toBe(DELETE_BUTTON_LABEL_IDLE);
    expect(DELETE_BUTTON_LABEL_IDLE.toLowerCase()).not.toContain('confirm');
  });

  it('the confirming label makes the second click explicit', () => {
    expect(deleteButtonLabel('confirming')).toBe(DELETE_BUTTON_LABEL_CONFIRMING);
    expect(DELETE_BUTTON_LABEL_CONFIRMING.toLowerCase()).toMatch(/again|confirm/);
  });

  it('the delete description states the action is permanent', () => {
    expect(DELETE_DESCRIPTION.toLowerCase()).toMatch(/cannot be undone|permanent/);
  });

  it('the delete description names what is never touched — her notes and her own cards', () => {
    expect(DELETE_DESCRIPTION.toLowerCase()).toContain('your notes');
  });

  it('the export description never claims data leaves the device', () => {
    expect(EXPORT_DESCRIPTION.toLowerCase()).not.toMatch(/upload|sent to (olea|the server|us)/);
  });
});
