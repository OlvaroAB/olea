/**
 * The invented vocabulary these streams are built from (INV-3).
 *
 * **Every token below is a coined nonsense word, not a real or plausible
 * academic term, and not a fixture-vault string.** Two separate rules drive
 * that:
 *
 *  - INV-3: this is the public repo, so invented content only. Each token was
 *    checked against the read-only real-vault snapshot before being written
 *    here, whole-token, case-insensitively, with zero hits required. Coined
 *    single tokens are used precisely so that "zero hits including every
 *    constituent word" is a check that can actually pass — a two-word name like
 *    "Sediment Gradient" has constituent words that hit a study vault all day.
 *  - `ol-yj9`: the *fixture* vault's vocabulary has been renamed twice in one
 *    day. Nothing here reads a fixture string, and nothing here should ever be
 *    made to match one. These streams are self-contained; a consumer that wants
 *    them keyed to its own vault supplies its own ids through `StreamSpec`.
 *
 * Ids are namespaced under `syn:` for the same reason `eventId` is
 * (`./provenance.ts`): a concept id that turns up in a real projection is
 * immediately identifiable as fabricated.
 */

import { SYNTHETIC_ID_PREFIX } from './provenance.js';

/** The three FSRS-scheduled instrument types a synthetic concept carries (F2.14). */
export const SCHEDULED_TYPES = ['qa', 'cloze', 'mcq'] as const;
export type ScheduledType = (typeof SCHEDULED_TYPES)[number];

/** The card types — everything that is not the MCQ. The distinction early-warning-signal 2 is about. */
export const CARD_TYPES: readonly ScheduledType[] = ['qa', 'cloze'];

export interface SyntheticConcept {
  readonly conceptId: string;
  readonly courseId: string;
  /** Scheduled instruments for this concept, in stable order. */
  readonly instruments: readonly SyntheticInstrument[];
  /** The on-demand explain-back instrument (F5, F2.12). Never FSRS-scheduled. */
  readonly explainBackInstrumentId: string;
}

export interface SyntheticInstrument {
  readonly instrumentId: string;
  readonly instrumentType: ScheduledType;
  readonly conceptId: string;
  readonly courseId: string;
}

export interface SyntheticCourse {
  readonly courseId: string;
  readonly conceptIds: readonly string[];
}

function conceptId(token: string): string {
  return `${SYNTHETIC_ID_PREFIX}concept:${token}`;
}

function courseId(token: string): string {
  return `${SYNTHETIC_ID_PREFIX}course:${token}`;
}

function buildConcept(token: string, course: string): SyntheticConcept {
  const cid = conceptId(token);
  const crs = courseId(course);
  return {
    conceptId: cid,
    courseId: crs,
    instruments: SCHEDULED_TYPES.map((instrumentType) => ({
      instrumentId: `${SYNTHETIC_ID_PREFIX}inst:${token}:${instrumentType}`,
      instrumentType,
      conceptId: cid,
      courseId: crs,
    })),
    explainBackInstrumentId: `${SYNTHETIC_ID_PREFIX}inst:${token}:explain-back`,
  };
}

/** Coined course tokens. Verified zero-hit against the real-vault snapshot. */
export const COURSE_VANTREL = courseId('vantrel');
export const COURSE_QUORBIN = courseId('quorbin');

/**
 * The concept set. Eight concepts across two courses is enough for the
 * "effort imbalance" half of F6.5 to have two courses to be imbalanced
 * between, and small enough that a 90-day stream stays readable by hand.
 */
export const CONCEPTS: readonly SyntheticConcept[] = [
  buildConcept('melspar', 'vantrel'),
  buildConcept('dornith', 'vantrel'),
  buildConcept('kelvane', 'vantrel'),
  buildConcept('tirasp', 'vantrel'),
  buildConcept('ilmenor', 'quorbin'),
  buildConcept('sarquith', 'quorbin'),
  buildConcept('nubrast', 'quorbin'),
  buildConcept('plevin', 'quorbin'),
];

export const COURSES: readonly SyntheticCourse[] = [
  {
    courseId: COURSE_VANTREL,
    conceptIds: CONCEPTS.filter((c) => c.courseId === COURSE_VANTREL).map((c) => c.conceptId),
  },
  {
    courseId: COURSE_QUORBIN,
    conceptIds: CONCEPTS.filter((c) => c.courseId === COURSE_QUORBIN).map((c) => c.conceptId),
  },
];

/** Every scheduled instrument, in stable order — the deck the generator draws from. */
export const INSTRUMENTS: readonly SyntheticInstrument[] = CONCEPTS.flatMap((c) => c.instruments);

const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.conceptId, c]));

export function conceptById(id: string): SyntheticConcept | undefined {
  return CONCEPT_BY_ID.get(id);
}

/** The course a concept belongs to; `undefined` for anything this package did not invent. */
export function courseOfConcept(id: string): string | undefined {
  return CONCEPT_BY_ID.get(id)?.courseId;
}

const COURSE_IDS: ReadonlySet<string> = new Set(COURSES.map((c) => c.courseId));

function titleCase(token: string): string {
  return token.length === 0 ? token : token[0]?.toUpperCase() + token.slice(1);
}

/** The last `:`-delimited segment of an id — the coined token itself, with no prefix. */
function lastSegment(id: string): string {
  const parts = id.split(':');
  return parts[parts.length - 1] ?? id;
}

/**
 * A human-presentable form of a concept id — the same vetted, coined token
 * `CONCEPTS` already carries, title-cased. Never a real or plausible academic
 * term (see the module doc above): this only changes the casing of a token
 * already vetted zero-hit against the real-vault snapshot, so it needs no
 * separate check.
 *
 * `ol-mxw3` (WBF-1): a concept's id doubles as its canonical identity
 * throughout this package and `olea-core` (`rankOracle` keys mastery by it;
 * `ConceptAssessmentEdge.conceptName` *is* the id — see `olea-core`'s
 * `oracle/types.ts` for why v0.9 has no separate canonical-name layer). This
 * function is deliberately not a replacement for the id anywhere it is used
 * as a key or join — it exists only for a caller building what a screen shows
 * a person, one layer above every join, and it throws on an id this package
 * did not mint rather than silently handing back a raw `syn:` string for a
 * caller to render.
 */
export function conceptDisplayName(id: string): string {
  if (!CONCEPT_BY_ID.has(id)) {
    throw new Error(`olea-synthetic: conceptDisplayName called with an unknown concept id: ${id}`);
  }
  return titleCase(lastSegment(id));
}

/** `courseDisplayName`'s sibling for course ids — same discipline, same reason. */
export function courseDisplayName(id: string): string {
  if (!COURSE_IDS.has(id)) {
    throw new Error(`olea-synthetic: courseDisplayName called with an unknown course id: ${id}`);
  }
  return titleCase(lastSegment(id));
}
