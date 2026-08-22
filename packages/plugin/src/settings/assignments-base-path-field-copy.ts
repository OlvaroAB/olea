/**
 * The assignments Base path field's UI copy (P5-T07). Held as pure data for
 * the same reason `base-url-field-copy.ts` and `token-field-copy.ts` are:
 * assertable without a DOM.
 *
 * See `../plan/settings-store.ts`'s module doc for why this field exists at
 * all and why leaving it blank is a legitimate, working state rather than a
 * misconfiguration.
 */

export const ASSIGNMENTS_BASE_PATH_FIELD_NAME = 'Assignments Base path';

export const ASSIGNMENTS_BASE_PATH_FIELD_DESCRIPTION =
  'Vault path to the Obsidian Bases file listing your assessments (F1.1) — the same one you already use for dates and weightings. Leave blank until you set one: prioritised ordering stays off and review, scheduling and the Today panel work exactly the same either way.';

export const ASSIGNMENTS_BASE_PATH_FIELD_PLACEHOLDER = '02 Assignments/Assignments.base';
