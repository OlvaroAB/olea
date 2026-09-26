/**
 * A composition's own account (`[D-331]`, `ol-egov.141.89.10.65`): the shapes `./compose.ts`
 * computes alongside a composed session and `./composition-record.ts` freezes into the durable
 * composition record. Kept in their own module so the composer and the record share one
 * definition without the record module importing the composer's internals, or the composer
 * importing the record.
 *
 * **Why these shapes exist.** `[D-331]` (ruled 2026-09-25) preserves what a composition selected,
 * what it set aside and why. Before this module the composer computed both and kept neither: the
 * F2.19 grouping score only sorted a tie band, and the set-aside material survived only as
 * `overflow`'s per-class counts, which F6.7 keeps off every surface. These types carry the
 * missing facts as discrete values and ids, never prose and never a count a surface could total.
 *
 * **F2.19 holds here too.** {@link GroupingSignal} names which of F2.19's three continuous
 * signals decided the order inside ONE composition's tie bands. It is a fact about that
 * composition, read off the same blend that ordered it; it is never a property of a course, a
 * concept or the student, never a phase, and no reader may aggregate it across compositions into
 * one ("course A is in its exam period"). F2.19 forbids that entity, and nothing here defines it.
 */

/**
 * Which of F2.19's three blended signals decided the within-course grouping of one composition,
 * as one discrete value (`./compose.ts`'s `dominantGroupingSignal` computes it):
 *
 * - `'assessment-scope'`: an approaching assessment's own scope (F4.7's proximity weight times
 *   scope membership);
 * - `'arrival-cohort'`: material that arrived together in one source note (`[D-149]`'s cohort,
 *   blended into relatedness by its decay weight);
 * - `'relatedness'`: concept relatedness (C7.10's typed adjacency);
 * - `'none'`: no signal decided any adjacency, so the order inside every tie is the urgency
 *   order alone (`overdue-first`, then its stated residual tiebreak). This is the reading
 *   whenever no signal was supplied, every tie band held one concept, or every score tied.
 */
export const GROUPING_SIGNALS = [
  'assessment-scope',
  'arrival-cohort',
  'relatedness',
  'none',
] as const;
export type GroupingSignal = (typeof GROUPING_SIGNALS)[number];

/** Why a whole course was set aside by one composition: another course was chosen for this session (C5.6's one-course session, F2.18). The branch that chose it is on the record itself. */
export const SET_ASIDE_COURSE_REASONS = ['another-course-chosen'] as const;
export type SetAsideCourseReason = (typeof SET_ASIDE_COURSE_REASONS)[number];

/**
 * Why a concept of the session's own course was set aside:
 *
 * - `'did-not-fit'`: the time she set was spent before it was reached, either at selection (its
 *   whole concept group did not fit) or at the fill (it was selected and no instrument of it got
 *   a slot);
 * - `'no-instruments'`: it was selected and nothing practises it yet (F4.5/F4.10's gap);
 * - `'yields-to-part'`: C7.9's containment rule, a broad concept yielding to one of its own parts
 *   present in the same candidate pool.
 */
export const SET_ASIDE_CONCEPT_REASONS = [
  'did-not-fit',
  'no-instruments',
  'yields-to-part',
] as const;
export type SetAsideConceptReason = (typeof SET_ASIDE_CONCEPT_REASONS)[number];

/**
 * Why a single instrument was set aside while its concept was not: `'cited-passage-changed'`,
 * `[D-330]`'s removal cause (a confirmed digest disagreement, or `[D-351]`'s revalidation still
 * pending), withheld at compose time or dropped from an already-open session at extend time.
 */
export const SET_ASIDE_INSTRUMENT_REASONS = ['cited-passage-changed'] as const;
export type SetAsideInstrumentReason = (typeof SET_ASIDE_INSTRUMENT_REASONS)[number];

export interface SetAsideCourse {
  readonly courseId: string;
  readonly reason: SetAsideCourseReason;
}

export interface SetAsideConcept {
  readonly conceptKey: string;
  readonly reason: SetAsideConceptReason;
}

export interface SetAsideInstrument {
  readonly instrumentId: string;
  /** The concept it was composed under, the key the composer partitioned by. */
  readonly conceptKey: string;
  readonly reason: SetAsideInstrumentReason;
}

/**
 * Everything one composition weighed and did not serve, each with why, all by id. Three grains,
 * each the grain the composer actually decided at: a course (the session is one course), a
 * concept (selection and the fill pick concepts), an instrument (removal picks instruments).
 * Material outside her own steering, suspended or withdrawn by her, or refused by the ranking
 * never reached the composer as a candidate and is not listed.
 *
 * Arrays are in the order the composer weighed them, never re-sorted by a reader's preference:
 * courses by id, concepts fill-level first (in session order) then selection-level (urgency
 * order) then containment (input order), instruments in session order.
 */
export interface CompositionSetAside {
  readonly courses: readonly SetAsideCourse[];
  readonly concepts: readonly SetAsideConcept[];
  readonly instruments: readonly SetAsideInstrument[];
}
