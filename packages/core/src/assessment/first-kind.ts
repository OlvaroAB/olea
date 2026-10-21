/**
 * The one home of the format-class-to-kind mapping (`ol-egov.141.89.105.25`).
 *
 * F4.8 as amended by `[D-550]`: the instrument kind each declared format class asks for.
 * Recall-style asks for multiple choice ("MCQ drilling matches a recall-style paper"). Written and
 * practical ask for the question-and-answer card, the fallback `[D-550]` (a) rules until a
 * structured-argument or ordered-process instrument exists (its evidence reads as self-rated
 * recall, `ol-egov.141.89.105.13`). Declared, not fitted. Non-persisted, Class B: replacing `'qa'`
 * for written or practical is a later change here, behind its own decision.
 *
 * Readers: the plugin's primary-kind producer (`generation/kind-inputs.ts`) and the session
 * composer's same-day format preference (`../study-session/build.ts`, F2.17). The paper blueprint
 * maps a class to a generator task, a different question, and keeps its own table.
 */

import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { AssessmentFormatClass } from './format-class.js';

export const FIRST_KIND_BY_FORMAT_CLASS: Readonly<
  Record<AssessmentFormatClass, SchedulableInstrumentType>
> = Object.freeze({
  'recall-style': 'mcq',
  written: 'qa',
  practical: 'qa',
});

/** The first kind `formatClass` asks for — {@link FIRST_KIND_BY_FORMAT_CLASS}. */
export function firstKindForFormatClass(
  formatClass: AssessmentFormatClass,
): SchedulableInstrumentType {
  return FIRST_KIND_BY_FORMAT_CLASS[formatClass];
}
