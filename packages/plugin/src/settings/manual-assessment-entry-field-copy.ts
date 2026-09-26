/**
 * The manual assessment entry surface's copy (F1.2, ol-egov.141.8.10). Held as pure data for the
 * same reason `assignments-base-path-field-copy.ts`/`token-field-copy.ts` are: assertable without
 * a DOM.
 *
 * Every string here is new — flagged Class B for the copy pass (`docs/design/copy-pass-2026-09/`
 * in the service repo) — and checked against `docs/Olea_vocabulary_registry.md` via
 * `pnpm run check:vocabulary` (service repo). This section is shown ONLY while no readable
 * Assignments Base exists (`../../../core`'s `hasReadableAssessmentsBase` — see
 * `manual-assessment-entry.ts`'s module doc), so its own wording says "fallback," never reading
 * as an equal, permanent alternative to the Base (F1.2: "never the default path").
 */

export const MANUAL_ASSESSMENT_SECTION_HEADING = 'Assessments (entered by hand)';

export const MANUAL_ASSESSMENT_SECTION_DESCRIPTION =
  'No Assignments Base could be read above, so add each assessment here instead — a fallback, ' +
  'not a replacement. Set an Assignments Base path above and this list stops being used as soon ' +
  'as that Base can be read.';

export const MANUAL_ASSESSMENT_EMPTY_LIST_TEXT = 'No assessments entered yet.';

export const MANUAL_ASSESSMENT_COURSE_FIELD_NAME = 'Course';
export const MANUAL_ASSESSMENT_COURSE_FIELD_PLACEHOLDER = 'e.g. Course A';
export const MANUAL_ASSESSMENT_TYPE_FIELD_NAME = 'Type';
export const MANUAL_ASSESSMENT_TYPE_FIELD_PLACEHOLDER = 'e.g. Quiz';
export const MANUAL_ASSESSMENT_WEIGHT_FIELD_NAME = 'Weight';
export const MANUAL_ASSESSMENT_WEIGHT_FIELD_PLACEHOLDER = 'e.g. 20 or 0.2';
export const MANUAL_ASSESSMENT_DUE_FIELD_NAME = 'Due date';
export const MANUAL_ASSESSMENT_STATUS_FIELD_NAME = 'Status';
export const MANUAL_ASSESSMENT_STATUS_FIELD_PLACEHOLDER = 'e.g. not started';

export const MANUAL_ASSESSMENT_ADD_BUTTON_LABEL = 'Add assessment';
export const MANUAL_ASSESSMENT_REMOVE_BUTTON_LABEL = 'Remove';

export const MANUAL_ASSESSMENT_REQUIRED_FIELDS_NOTICE = 'Course and type are both required.';
