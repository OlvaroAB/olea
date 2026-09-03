/**
 * Copy for the course-setup confirmation surface itself — C7.8's course
 * lifecycle BEGINNING clause (`[D-098]`, point 1): *"detection proposes
 * ('this looks like a course'), she confirms and names."*
 *
 * Detection (the root-path mapping, `features/F1-sources.md`'s
 * `core/course/lifecycle.spec` / `core/course/mapping.spec`) is core-side and
 * unbuilt (ol-0r92.5's report). This module holds only the strings the
 * plugin-side confirmation renders once a proposal already exists — it takes
 * the suggested name and root path as given, the same "caller supplies the
 * fact, this module never derives it" split `../today/copy.ts` and `./copy.ts`
 * both use.
 *
 * ## Never implies a course record already exists
 *
 * `features/F1-sources.md`'s scenario "detection proposes a course and never
 * creates one" is explicit: *"no course record exists until she confirms it
 * and supplies its name; nothing is auto-created and silently populated."*
 * `COURSE_PROPOSAL_HEADING` states a reading ("looks like"), never a fact
 * ("is") — `confirmation-copy.spec.ts` asserts no string here reads as
 * "created", "added" or "saved" ahead of her confirming.
 *
 * ## The first-read readout's state labels (F1.4/`[D-213]`, `ol-0r92.47`)
 *
 * `FIRST_READ_STATE_LABELS` is copied verbatim from the amended F1.4 clause's
 * own parenthetical — *"the reading engine's own honest counts (files
 * waiting, in flight, done, deferred, failed)"* — rather than invented here,
 * because the clause already settled the vocabulary question `[D-213]`
 * explicitly left open ("copy for the five state labels ... the vocabulary
 * registry governs; deferred must not read as failed"). Five distinct words,
 * none of them "failed" applied twice: `deferred`'s own label carries no
 * "fail"/"error"/"stuck" root, which is the whole of what keeps it from
 * reading as a sixth way to say failed (`confirmation-copy.spec.ts` asserts
 * this directly). `formatFirstReadCountsLine` joins them as plain counts —
 * `"12 files waiting · 3 in flight · 5 done · 1 deferred · 0 failed"` — never
 * a fraction, a percentage or anything a bar could be drawn from (D-213
 * point 2, reusing F8.3's reasoning against a coverage scalar).
 */

import type { JobStatus } from 'olea-core';

/** States a reading, never a fact — no course record exists yet. See this module's doc. */
export const COURSE_PROPOSAL_HEADING = 'This looks like a course';

/** Label for the name field she confirms or overwrites — "she confirms and names" (C7.8/[D-098] point 1). */
export const COURSE_NAME_FIELD_LABEL = 'Name';

/** The one action this surface offers: accepting the proposal and the name as it stands (edited or not). */
export const CONFIRM_BUTTON_LABEL = 'Confirm';

/**
 * The five ingestion-queue states' display words, in the order the amended
 * F1.4 clause states them — see this module's doc. Keys match `olea-core`'s
 * `JobStatus` union exactly, so a sixth status added there is a type error
 * here rather than a silently-missing label.
 */
export const FIRST_READ_STATE_LABELS: Readonly<Record<JobStatus, string>> = {
  queued: 'files waiting',
  'in-flight': 'in flight',
  done: 'done',
  deferred: 'deferred',
  failed: 'failed',
};

/** Report order for the five states — the same order `FIRST_READ_STATE_LABELS` and the clause itself use. */
export const FIRST_READ_STATE_ORDER: readonly JobStatus[] = [
  'queued',
  'in-flight',
  'done',
  'deferred',
  'failed',
];

/**
 * One folder's counts as a plain-text line — never a bar, never a derived
 * percentage (D-213 point 2). `counts` is `olea-core`'s `QueueSnapshot`
 * five-state shape (or the same shape scoped to one folder, per
 * `ingestion/wiring.ts`'s `summarizeFirstReadByFolder`); every one of the
 * five states is always rendered, even at zero, so a folder with nothing
 * failed still shows "0 failed" rather than omitting the state.
 */
export function formatFirstReadCountsLine(counts: Readonly<Record<JobStatus, number>>): string {
  return FIRST_READ_STATE_ORDER.map(
    (status) => `${String(counts[status])} ${FIRST_READ_STATE_LABELS[status]}`,
  ).join(' · ');
}

/** Every string this module can put on screen — same corpus-test shape as `./kinship-copy.ts` and `./copy.ts`. */
export function allConfirmationStrings(): readonly string[] {
  return [
    COURSE_PROPOSAL_HEADING,
    COURSE_NAME_FIELD_LABEL,
    CONFIRM_BUTTON_LABEL,
    ...FIRST_READ_STATE_ORDER.map((status) => FIRST_READ_STATE_LABELS[status]),
  ];
}
