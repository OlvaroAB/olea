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
  DELETE_DONE_MESSAGE,
  deleteButtonLabel,
  deleteCompletionMessage,
  EXPORT_DESCRIPTION,
  PRIVACY_SECTION_INTRO,
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

  // ol-egov.141.8.7 (privacy follow-up): before this bead, settings-section.ts showed
  // DELETE_DONE_MESSAGE unconditionally, whatever runFullDelete's remainingOleaPaths said —
  // the previous lane's widened full delete introduced that field precisely so a completion
  // message could be honest about a discovery-limited host leaving something behind. Pulled
  // out as a pure function (this file's existing posture) because settings-section.ts itself
  // needs a real Obsidian host to exercise (Setting/createEl/Notice), same limitation this
  // file's own module doc already states for every other string here.
  it('the all-clear message is shown only when nothing remains under .olea/', () => {
    expect(deleteCompletionMessage(0)).toBe(DELETE_DONE_MESSAGE);
  });

  it('when something remains, the message says so and how many, never the all-deleted text', () => {
    const message = deleteCompletionMessage(3);
    expect(message).not.toBe(DELETE_DONE_MESSAGE);
    expect(message).toMatch(/3/);
    expect(message.toLowerCase()).toMatch(/could not|couldn't|remain/);
  });

  it('the singular case reads naturally, not "1 files"', () => {
    expect(deleteCompletionMessage(1)).not.toMatch(/1 files/);
  });

  // ol-egov.141.8.7: before this bead the description named only the two logs and the cache;
  // the full delete and the export now reach every folder under .olea/ (C6.2a).
  it('the delete description names more than the cache and the two logs', () => {
    expect(DELETE_DESCRIPTION.toLowerCase()).toMatch(
      /every other record|everything.*olea.*created/,
    );
  });

  it('the export description names more than the two logs and instrument cards', () => {
    expect(EXPORT_DESCRIPTION.toLowerCase()).toMatch(/every other record/);
  });

  it('the intro says what Olea writes without naming internal folder or store names', () => {
    for (const internalName of ['.olea', 'concepts/', 'relations/', 'same-as', 'citations/']) {
      expect(PRIVACY_SECTION_INTRO).not.toContain(internalName);
    }
  });

  // A full delete clears only the five D-006 cache keys and resets the device id
  // (full-delete.ts, cache-purge.ts) — which other data.json keys it should clear is an open
  // decision (this bead's report). The description must not claim more than the code does.
  it('the delete description never claims every setting or preference is cleared', () => {
    expect(DELETE_DESCRIPTION.toLowerCase()).not.toMatch(/every setting|all settings|preferences/);
  });
});
