/**
 * F4.6's once-asked course-avoidance steering question (`[D-265]`,
 * `ol-egov.141.54` [INTERV-5]).
 *
 * **The clause, in full (`docs/Olea_alpha_functional_scope.md`, F4.6):**
 * "Declining to open sessions about a whole course over several weeks, while
 * otherwise directing her own attention, underdetermines its cause — she may
 * be studying it elsewhere, ahead of it, or struggling with it — so it is
 * never read as anything on its own. Where the cause matters to the next
 * decision, Olea may ask, once, a dismissible question in the pattern the
 * contract already uses (asked once, at the point it matters): whether to
 * leave the course for now or to practise it differently. Her answer is
 * steering, honoured exactly like the three steering inputs above — never
 * evidence about her knowledge — and silence, whether she dismisses the
 * question or never answers it, is not interpreted as anything." Principle 7
 * (human-in-the-loop) and principle 16 (record what was shown, never a
 * diagnosis) both bind here: this module records the fact that the question
 * was shown and, if she answers, the literal option she chose — never a
 * belief about *why* she has been avoiding the course. The forbidden-framing
 * entry `[D-265]` adds to `docs/Olea_vocabulary_registry.md` §4 is explicit
 * that no wording, internal or student-facing, may assert a cause (struggling,
 * ahead, elsewhere) from avoidance alone — so nothing in this module ever
 * computes or stores one.
 *
 * ## Scope: this bead owns `home/`, not `session-builder/` or `oracle/`
 *
 * "Honoured exactly like the three steering inputs above" is the clause's own
 * instruction to feed her answer into the allocation the way `courseOrTopic`
 * already is — but that wiring lives in `../session-builder/provider.ts` and
 * `../oracle/`, outside this bead's `owns` (`packages/plugin/src/home/`
 * only). Recording her literal answer here, durably and dated, is what a
 * later bead needs to read before it can act on it; *acting* on it (deprior-
 * itising or reshaping that course's share of a composed session) is filed as
 * follow-on work rather than guessed at inside someone else's owned files —
 * see this bead's close evidence.
 *
 * ## Why the trigger and the store are Home's own, not a new core module
 *
 * Detecting "no session touched this course in a while, while she has kept
 * studying others" needs two facts no existing computation joins: which
 * concepts belong to which course (`../grove/provider.ts`'s own
 * `GroveCourseSection.model.cells`, already read by `./provider.ts` for the
 * coverage strips) and when each concept was last reviewed (`olea-core`'s
 * `readReviewLogHistory`, already the production reader `../retrospective/
 * offer-events.ts` and `../today/data-source.ts` both call). Both are already
 * EXPORTED, general-purpose reads — joining them for this one clause is new
 * work, but it is Home's own composition over two existing reads, the same
 * shape `./provider.ts`'s own `buildCourseRows` already is for the "scope
 * grew" quiet line, not a new capability that belongs in `packages/core`.
 * `./scope-growth-store.ts`'s own doc gives the identical reasoning for why
 * that quiet line's memory is Home's own store rather than a shared one; the
 * "asked" record below is the same kind of Home-local, UI-presentation
 * bookkeeping (not a knowledge-model fact), so it follows the same pattern.
 *
 * ## Declared thresholds (Class B — self-ratified, flagged for retroactive review)
 *
 * `AVOIDANCE_SILENT_DAYS` (21 — three weeks, the clause's own "several
 * weeks") and `AVOIDANCE_ACTIVE_ELSEWHERE_DAYS` (14 — two weeks) are declared,
 * not derived: defensible in plain English, not fitted against any corpus
 * (`docs/Olea_component_register.md`'s declared/derived line). They are also
 * deliberately conservative — the question can be shown **at most once ever**
 * per course, so a false-positive trigger is not a "try again" cost the way a
 * mistimed ranking nudge would be; erring toward asking later rather than
 * earlier is the safer failure.
 *
 * ## "At most once", precisely
 *
 * "Asked once, at the point it matters" is the exact phrase the clause itself
 * borrows from `[D-134]` Q1's own standing-offer pattern (`../retrospective/
 * offer-events.ts`: "Fired at the offer card's RENDER, not at a gesture of
 * hers"). This module follows the identical discipline: `./provider.ts`
 * calls `ObsidianHomeAvoidanceStore.markAsked` the moment a candidate course
 * is chosen for `load()`'s return value — before she has seen or reacted to
 * anything — so a card that renders once and is never interacted with (the
 * app closes, the leaf never opens again) still counts as asked and is never
 * offered again for that course. Declining — dismissing the card, or simply
 * never answering — writes nothing further; the "asked" fact alone, already
 * durable, is what prevents a second ask. `recordAnswer` is a SEPARATE,
 * additive write, called only when she actually presses one of the two
 * options, and it holds the literal option label she saw, never a summary of
 * it.
 */

import type { GroveCourseModel } from 'olea-core';
import type { GroveCourseSection } from '../grove/view.js';
import type { ObsidianDataHost } from '../plan/settings-store.js';

/** The two answers F4.6 defines — nothing else is a valid value, so this is never free text (see module doc: her "own words" means the literal label she chose, not a paraphrase). */
export type CourseAvoidanceAnswer = 'leave-for-now' | 'practise-differently';

/** Three weeks — see module doc, "Declared thresholds". */
export const AVOIDANCE_SILENT_DAYS = 21;
/** Two weeks — see module doc, "Declared thresholds". */
export const AVOIDANCE_ACTIVE_ELSEWHERE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One course's activity reading, as `findAvoidedCourse` needs it —
 * deliberately holding nothing about WHY, only WHETHER and WHEN.
 * `hasMaterial` is `model.status === 'declared' && model.cells.length > 0`
 * (see `courseActivityFromGrove`): a course with nothing built yet has
 * nothing to be silent ABOUT, so it is never a candidate.
 */
export interface CourseActivity {
  readonly course: string;
  readonly hasMaterial: boolean;
  /** The latest `review`-kind log timestamp (ms) citing any concept of this course's, across every device; `undefined` means never reviewed. */
  readonly lastReviewedAtMs: number | undefined;
}

/**
 * Joins a grove read (course → concept membership) with a review-log read
 * (concept → last-reviewed time) into one activity reading per course — the
 * glue `./provider.ts` calls, kept here and exported so it can be unit
 * tested against hand-built `GroveCourseSection`/timestamp fixtures without
 * a real vault. Only `'declared'` courses get concept membership at all
 * (`../grove/provider.ts`'s own three-way status is the only place that
 * mapping exists) — an `'inferred'` or `'no-registered-source'` course
 * always reads `hasMaterial: false, lastReviewedAtMs: undefined`, the same
 * "state what you're given, never guess" posture `./scope-growth-store.ts`
 * documents for its own prior-read comparison.
 */
export function courseActivityFromGrove(
  sections: readonly GroveCourseSection[],
  reviewedAtMsByConceptKey: ReadonlyMap<string, number>,
): readonly CourseActivity[] {
  return sections.map((section): CourseActivity => {
    const model: GroveCourseModel = section.model;
    if (model.status !== 'declared' || model.cells.length === 0) {
      return { course: section.course, hasMaterial: false, lastReviewedAtMs: undefined };
    }
    let lastReviewedAtMs: number | undefined;
    for (const cell of model.cells) {
      const at = reviewedAtMsByConceptKey.get(cell.conceptKey);
      if (at !== undefined && (lastReviewedAtMs === undefined || at > lastReviewedAtMs)) {
        lastReviewedAtMs = at;
      }
    }
    return { course: section.course, hasMaterial: true, lastReviewedAtMs };
  });
}

/**
 * F4.6's trigger, decided purely over already-summarised activity — no
 * vault, no store, so every branch is directly unit-testable.
 *
 * Two gates, both required, matching the clause's own two clauses:
 *  1. **"Over several weeks"** — the candidate course has had no review
 *     activity for at least `silentDays` (or none ever, while carrying real
 *     material).
 *  2. **"While otherwise directing her own attention"** — at least one OTHER
 *     course has been reviewed within `activeElsewhereDays`. Without this,
 *     a silent course is at least as likely to mean she has stopped studying
 *     altogether (`../study-session/absence.ts`'s reentry territory, a
 *     different feature answering a different question) as it is to mean
 *     she is routing around this one course specifically — and the clause
 *     names exactly that ambiguity as the reason a bare silence is "never
 *     read as anything on its own."
 *
 * `alreadyAsked` excludes a course the store already marked asked, so this
 * function alone cannot violate "at most once" — the store is still the
 * durable enforcement, since a caller could pass a stale `alreadyAsked` set.
 *
 * Deterministic pick when several courses qualify: the one silent longest
 * (a never-reviewed course sorts as maximally silent), course name breaking
 * any tie — the same "state a rule, never guess" posture `./provider.ts`'s
 * `pickCourseOffer` already documents for an unrelated selection.
 */
export function findAvoidedCourse(
  courses: readonly CourseActivity[],
  nowMs: number,
  alreadyAsked: ReadonlySet<string>,
  options?: { readonly silentDays?: number; readonly activeElsewhereDays?: number },
): string | undefined {
  const silentMs = (options?.silentDays ?? AVOIDANCE_SILENT_DAYS) * DAY_MS;
  const activeMs = (options?.activeElsewhereDays ?? AVOIDANCE_ACTIVE_ELSEWHERE_DAYS) * DAY_MS;

  const candidates = courses
    .filter((c) => c.hasMaterial && !alreadyAsked.has(c.course))
    .filter((c) => c.lastReviewedAtMs === undefined || nowMs - c.lastReviewedAtMs >= silentMs)
    .sort((a, b) => {
      const aKey = a.lastReviewedAtMs ?? -Infinity;
      const bKey = b.lastReviewedAtMs ?? -Infinity;
      if (aKey !== bKey) return aKey - bKey;
      return a.course < b.course ? -1 : a.course > b.course ? 1 : 0;
    });

  for (const candidate of candidates) {
    const activeElsewhere = courses.some(
      (c) =>
        c.course !== candidate.course &&
        c.lastReviewedAtMs !== undefined &&
        nowMs - c.lastReviewedAtMs < activeMs,
    );
    if (activeElsewhere) return candidate.course;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Copy — kept here, not in `./copy.ts`, because that file is owned by a
// concurrent lane auditing it against `docs/Olea_vocabulary_registry.md`
// (`[VOC-8]`); this module is its own vocabulary site for the one surface it
// adds, same convention `./copy.ts`'s own `allHomeStrings()` documents for
// itself. `test/home/avoidance.spec.ts` runs the identical honesty sweep
// over `allCourseAvoidanceStrings()`.
// ---------------------------------------------------------------------------

/**
 * The two option labels are `docs/Olea_vocabulary_registry.md` §16's own
 * words, verbatim ("leave the course for now, or to practise it
 * differently") — not paraphrased, per this bead's brief. These are also
 * exactly what gets stored as her "own words" answer (see module doc,
 * "At most once, precisely").
 */
export const COURSE_AVOIDANCE_LEAVE_ACTION = 'Leave the course for now';
export const COURSE_AVOIDANCE_PRACTISE_ACTION = 'Practise it differently';

/** Reuses `./copy.ts#DISMISS_OFFER_ACTION`'s own label at the call site (`./view.ts`) rather than a second dismiss word — see that constant's own use on the retrospective offer card. */

/**
 * The question's own framing sentence. States only the fact `./provider.ts`
 * computed (no session has touched the course recently) — never a cause.
 * `[D-265]`'s forbidden-framing entry (registry §4) is explicit that no
 * wording may read this as evidence of struggling, being ahead, or studying
 * elsewhere, so this sentence stops at the fact and lets the two options
 * speak for her.
 */
export function courseAvoidanceQuestionLine(course: string): string {
  return `It has been a while since a session covered ${course}.`;
}

/** Every string this module can render, for `test/home/avoidance.spec.ts`'s honesty checks — same convention `./copy.ts#allHomeStrings` documents. */
export function allCourseAvoidanceStrings(): readonly string[] {
  return [
    COURSE_AVOIDANCE_LEAVE_ACTION,
    COURSE_AVOIDANCE_PRACTISE_ACTION,
    courseAvoidanceQuestionLine('TESTC101'),
  ];
}

// ---------------------------------------------------------------------------
// Store — Home's own, per-install, keyed by course. See module doc, "Why the
// trigger and the store are Home's own, not a new core module".
// ---------------------------------------------------------------------------

export const HOME_AVOIDANCE_STORAGE_KEY = 'homeCourseAvoidance';

export interface CourseAvoidanceAnswerRecord {
  readonly value: CourseAvoidanceAnswer;
  /** The literal option label shown and chosen — principle 16: record what was shown, never a diagnosis. */
  readonly text: string;
  readonly recordedAt: string;
}

export interface CourseAvoidanceRecord {
  /** Once this exists, `findAvoidedCourse` must never be handed this course again — see `ObsidianHomeAvoidanceStore.markAsked`. */
  readonly askedAt: string;
  /** Absent when she dismissed or never answered — "declining changes nothing" means nothing is written here, not a placeholder value. */
  readonly answer?: CourseAvoidanceAnswerRecord;
}

export interface HomeCourseAvoidance {
  readonly version: 1;
  readonly courses: Readonly<Record<string, CourseAvoidanceRecord>>;
}

function isCourseAvoidanceAnswerRecord(value: unknown): value is CourseAvoidanceAnswerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    (c.value === 'leave-for-now' || c.value === 'practise-differently') &&
    typeof c.text === 'string' &&
    typeof c.recordedAt === 'string'
  );
}

function isCourseAvoidanceRecord(value: unknown): value is CourseAvoidanceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.askedAt !== 'string') return false;
  if (c.answer === undefined) return true;
  return isCourseAvoidanceAnswerRecord(c.answer);
}

function isHomeCourseAvoidance(value: unknown): value is HomeCourseAvoidance {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.version !== 1) return false;
  if (typeof c.courses !== 'object' || c.courses === null) return false;
  return Object.values(c.courses as Record<string, unknown>).every(isCourseAvoidanceRecord);
}

/**
 * `data.json` read-modify-write, same shape `./scope-growth-store.ts` uses —
 * but **merges rather than replaces** on every save, the opposite of that
 * store's own "replace, not merge" rule. The two differ for the reason each
 * one's own doc gives: the scope-growth store's map is a FRESH read's prior,
 * recomputed for every currently-'declared' course on every load, so an
 * entry it does not just recompute is stale and must not linger. This
 * store's entries are a PERMANENT record of a one-time event ("this course
 * was asked about") that must survive the course later becoming un-declared,
 * un-asked-again being exactly the property `[D-265]`'s "at most once"
 * requires — so a save here only ever adds or updates the one course it was
 * called for, never drops another course's own row.
 */
export class ObsidianHomeAvoidanceStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<ReadonlyMap<string, CourseAvoidanceRecord>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[HOME_AVOIDANCE_STORAGE_KEY];
    if (!isHomeCourseAvoidance(candidate)) return new Map();
    return new Map(Object.entries(candidate.courses));
  }

  private async saveOne(course: string, record: CourseAvoidanceRecord): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const currentRaw = blob[HOME_AVOIDANCE_STORAGE_KEY];
    const current: HomeCourseAvoidance = isHomeCourseAvoidance(currentRaw)
      ? currentRaw
      : { version: 1, courses: {} };
    const value: HomeCourseAvoidance = {
      version: 1,
      courses: { ...current.courses, [course]: record },
    };
    blob[HOME_AVOIDANCE_STORAGE_KEY] = value;
    await this.host.saveData(blob);
  }

  /**
   * Idempotent: a course already asked is left exactly as it was (its
   * existing `answer`, if any, is never touched) — a caller that races two
   * loads before the first save lands cannot regress an answered course back
   * to unanswered.
   */
  async markAsked(course: string, askedAt: string): Promise<void> {
    const existing = (await this.load()).get(course);
    if (existing !== undefined) return;
    await this.saveOne(course, { askedAt });
  }

  /**
   * Records her literal answer. Only meaningful for a course already marked
   * asked — see module doc, "At most once, precisely" — but this does not
   * itself enforce that ordering; `./view.ts` only ever calls it from the
   * `onAnswer` closure `./provider.ts` attaches to an already-asked
   * candidate, so the two can never disagree in production.
   */
  async recordAnswer(course: string, answer: CourseAvoidanceAnswerRecord): Promise<void> {
    const existing = (await this.load()).get(course);
    const askedAt = existing?.askedAt ?? answer.recordedAt;
    await this.saveOne(course, { askedAt, answer });
  }
}
