/**
 * The manual assessment entry form's pure logic (F1.2, ol-egov.141.8.10) — split out from
 * `manual-assessment-entry.ts`'s DOM wiring so it is assertable without Obsidian, the same
 * discipline `settings-tab.ts`'s own module doc describes for every other field on this pane.
 */

import type { ManualAssessmentEntryInput, ManualAssessmentRecord } from 'olea-core';
import { MANUAL_ASSESSMENT_REQUIRED_FIELDS_NOTICE } from './manual-assessment-entry-field-copy.js';

/** The raw text of every field the settings-pane form renders, before validation. */
export interface ManualAssessmentFormFields {
  readonly course: string;
  readonly type: string;
  readonly weight: string;
  readonly due: string;
  readonly status: string;
}

export type ManualAssessmentFormResult =
  | { readonly ok: true; readonly input: ManualAssessmentEntryInput }
  | { readonly ok: false; readonly error: string };

/**
 * Trims every field, requires `course` and `type` to be non-blank (the only two fields
 * `../../core`'s `addManualAssessmentEntry` itself refuses to write without — `weight`, `due` and
 * `status` are exactly as optional here as they already are on `AssessmentRecord`), and omits a
 * blank optional field rather than passing an empty string through.
 */
export function validateManualAssessmentForm(
  fields: ManualAssessmentFormFields,
): ManualAssessmentFormResult {
  const course = fields.course.trim();
  const type = fields.type.trim();
  if (course === '' || type === '') {
    return { ok: false, error: MANUAL_ASSESSMENT_REQUIRED_FIELDS_NOTICE };
  }

  const weightRaw = fields.weight.trim();
  const due = fields.due.trim();
  const status = fields.status.trim();

  return {
    ok: true,
    input: {
      course,
      type,
      ...(weightRaw !== '' ? { weightRaw } : {}),
      ...(due !== '' ? { due } : {}),
      ...(status !== '' ? { status } : {}),
    },
  };
}

/** An empty set of form fields — the state the settings pane resets to after a successful add. */
export const EMPTY_MANUAL_ASSESSMENT_FORM_FIELDS: ManualAssessmentFormFields = {
  course: '',
  type: '',
  weight: '',
  due: '',
  status: '',
};

/**
 * One line describing an already-entered manual assessment, for the settings-pane list a Remove
 * button sits beside. Plain, no punctuation beyond the separators — matching every other
 * settings-pane label on this tab (`../settings-tab.ts`), never a sentence.
 */
export function describeManualAssessmentEntry(record: ManualAssessmentRecord): string {
  const parts = [record.course, record.type];
  if (record.due !== undefined) parts.push(record.due);
  if (record.status !== undefined) parts.push(record.status);
  return parts.join(' — ');
}
