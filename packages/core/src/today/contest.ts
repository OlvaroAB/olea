/**
 * Every claim the Today panel asserts, enumerated so the contest gesture can
 * be attached to ALL of them rather than to the ones a renderer remembered
 * (`ol-fgba` [DISP-1]; `[D-046]` clause 4, mechanised by `[D-095]`;
 * `features/F6-today.md`'s "Principle 12.4 — every reading on this panel is
 * contestable" block, cited by path per INV-3).
 *
 * **Why enumeration lives in core and not in the view.** DSN-1's frame 01
 * argument is that the gesture must look identical on every claim, because a
 * per-surface affordance is how *every claim contestable* narrows to *every
 * claim on the surfaces we remembered*. A renderer that decides per-section
 * whether to draw the gesture is exactly that narrowing. So the panel's
 * claims are produced as a list, from the same view-model the renderer draws
 * from, and the renderer's only job is to put the same affordance on every
 * item in it. A claim the panel shows and this function omits is a test
 * failure, not a rendering choice.
 *
 * **The evidence rides with the claim.** Each enumerated claim carries an
 * `evidence` selector that resolves ENTIRELY ON DEVICE — a filter over her own
 * review log. Opening the dispute sheet issues no request and works with the
 * network down (`docs/dev/artifact-envelope.md` §3, cited by path). The
 * service never learns what a selector selects, because it never sees one.
 *
 * **No content, per D-005.** A claim carries opaque concept ids, a course code
 * she typed herself, counts, and a fingerprint. Never a rendered sentence:
 * the words live in `packages/plugin/src/today/copy.ts` and are built from
 * these fields, never stored in them.
 */

import { MASTERY_ORDER } from '../mastery/display.js';
import type { ClaimRendering, ContestedClaim } from '../review-log/contest.js';
import type { MasteryOverview } from './mastery-overview.js';
import type { TodayViewModel } from './panel.js';
import type { RhythmInsight } from './rhythm.js';

/**
 * A selector the client runs over her own local log — DSN-1 frame 08's
 * "events" evidence arm. Never a copy of the evidence, so it cannot go stale
 * and cannot leak: it is a filter, and the log it filters never leaves the
 * vault.
 */
export interface EventsEvidenceRef {
  readonly kind: 'events';
  readonly conceptIds: readonly string[];
  /** ISO date (`YYYY-MM-DD`); the window the claim was computed over. */
  readonly since: string;
}

/** One claim the Today panel asserts, with everything a contest needs. */
export interface TodayClaim {
  /**
   * Stable within one render, and stable ACROSS renders for the same claim —
   * the dispute record joins on `claimRendering` + `conceptIds`, so this id is
   * for the renderer's own keying, never for the record.
   */
  readonly id: string;
  readonly rendering: ClaimRendering;
  /** Her course code, verbatim (R1/R2 — never normalised). Absent for panel-wide readings. */
  readonly course?: string;
  readonly conceptIds: readonly string[];
  /** See `ContestedClaim.evidenceBasis` — the hinge of evidence-relative aging. */
  readonly evidenceBasis: string;
  readonly evidence: EventsEvidenceRef;
  /**
   * Whether a contest on this claim is ruled. `false` means DSN-1 left the
   * routing open (questions 6–10) — the panel still shows the claim, and the
   * gesture is withheld with the open question named, rather than the claim
   * being quietly routed to whichever kind looks closest.
   */
  readonly contestable: boolean;
}

/**
 * The window every Today claim is computed over, echoed onto the claim so the
 * evidence selector states its own scope rather than implying it read
 * everything (`ol-1n1v`'s argument, applied to the contest sheet).
 */
function sinceFrom(today: string, windowDays: number): string {
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - windowDays);
  return day.toISOString().slice(0, 10);
}

/**
 * An opaque, stable fingerprint of the evidence a claim rests on.
 *
 * Two claims computed from the same evidence share a fingerprint; a claim
 * recomputed after new evidence arrives does not. That is the whole mechanic
 * of evidence-relative aging (`[D-095]` §3) — a held dispute rides its claim
 * until the claim is recomputed on substantially new evidence, then the claim
 * arrives fresh and the dispute retires with it. **No calendar appears here**,
 * on purpose: a fixed retention window would let one bad day shadow a concept
 * forever, or forget a real, still-standing objection after an arbitrary
 * number of weeks.
 *
 * Deliberately NOT a hash of her content — it folds only counts, states and
 * ids, so it cannot carry text even by accident (D-005).
 */
export function evidenceBasisOf(parts: readonly (string | number)[]): string {
  return parts.map((part) => String(part)).join('|');
}

export interface EnumerateTodayClaimsInput {
  readonly viewModel: TodayViewModel;
  /** Concept ids per course, so a course-level reading can name its evidence. */
  readonly conceptIdsByCourse: Readonly<Record<string, readonly string[]>>;
  /** ISO date (`YYYY-MM-DD`). The panel's own "today", never read from a clock here. */
  readonly today: string;
}

/**
 * Every claim the panel asserts, in render order.
 *
 * Covers F6.2's per-course mastery readings, F6.5's observed-pattern insights
 * and F6.9's rhythm reading — the three things `features/F6-today.md`'s
 * contest block names. The insights and the rhythm line come back with
 * `contestable: false` and their open-question number attached by
 * `routeClaimRendering`, because `[D-095]` does not enumerate a trend sentence
 * or a vault-freshness line and this module refuses to guess.
 */
export function enumerateTodayClaims(input: EnumerateTodayClaimsInput): readonly TodayClaim[] {
  const claims: TodayClaim[] = [];
  const since = sinceFrom(input.today, input.viewModel.windowDays);

  claims.push(...masteryClaims(input.viewModel.mastery, input.conceptIdsByCourse, since));

  if (input.viewModel.insights !== null) {
    // F6.5's observed-pattern insights are trend sentences: they assert a
    // position over review events and move nothing. DSN-1 open question 6 —
    // routed nowhere, so the claim is enumerated (she can see it) and the
    // gesture is withheld (nothing invents its kind).
    claims.push({
      id: 'insights',
      rendering: 'trend-sentence',
      conceptIds: allConceptIds(input.conceptIdsByCourse),
      evidenceBasis: evidenceBasisOf(['insights', input.viewModel.windowDays, since]),
      evidence: { kind: 'events', conceptIds: allConceptIds(input.conceptIdsByCourse), since },
      contestable: false,
    });
  }

  const rhythm = input.viewModel.rhythm;
  if (rhythm !== null) {
    // F6.9 asserts a fact about the vault (material arrived, or did not),
    // never about her knowledge. DSN-1 open question 9.
    claims.push({
      id: 'rhythm',
      rendering: 'vault-freshness-line',
      conceptIds: allConceptIds(input.conceptIdsByCourse),
      evidenceBasis: evidenceBasisOf(['rhythm', rhythmFingerprint(rhythm)]),
      evidence: { kind: 'events', conceptIds: allConceptIds(input.conceptIdsByCourse), since },
      contestable: false,
    });
  }

  return claims;
}

function masteryClaims(
  mastery: MasteryOverview | null,
  conceptIdsByCourse: Readonly<Record<string, readonly string[]>>,
  since: string,
): readonly TodayClaim[] {
  if (mastery === null) return [];
  return mastery.courses.map((course) => {
    const conceptIds = conceptIdsByCourse[course.course] ?? [];
    return {
      id: `mastery:${course.course}`,
      rendering: 'mastery-reading' as const,
      course: course.course,
      conceptIds,
      evidenceBasis: evidenceBasisOf([
        'mastery',
        course.course,
        ...MASTERY_ORDER.map((state) => `${state}=${course.distribution.counts[state]}`),
      ]),
      evidence: { kind: 'events' as const, conceptIds, since },
      contestable: true,
    };
  });
}

function allConceptIds(
  conceptIdsByCourse: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const ids = new Set<string>();
  for (const list of Object.values(conceptIdsByCourse)) for (const id of list) ids.add(id);
  return [...ids].sort();
}

function rhythmFingerprint(rhythm: RhythmInsight): string {
  return `${rhythm.status}:${rhythm.measured === null ? 'none' : rhythm.measured.courses.length}`;
}

/**
 * Turn one enumerated claim into the shape `contestClaim` takes. Exists so a
 * caller cannot assemble a `ContestedClaim` by hand and drift from what the
 * panel actually asserted.
 */
export function contestedClaimFor(claim: TodayClaim): ContestedClaim {
  return {
    rendering: claim.rendering,
    conceptIds: claim.conceptIds,
    evidenceBasis: claim.evidenceBasis,
  };
}

/**
 * The HELD outcome, as data: which reviews the reading was folded from and
 * when they happened.
 *
 * This is `[D-046]` clause 4's hard half — *"the state may hold, with its
 * reasoning shown"* — and DSN-1 frame 04 calls it the ending that decides
 * whether contesting feels real. The answer is the evidence and its dates, and
 * nothing else: **no confidence number, no probability, no verdict on her, and
 * no adjustment to agree.** A reading moves only when a grade beneath it is
 * re-derived and the evidence itself moves.
 */
export interface HeldReadingBasis {
  /** Newest first — "you explained it back three weeks ago" is the newest one. */
  readonly reviews: readonly { readonly eventId: string; readonly timestamp: string }[];
  /** How many events the reading was folded from in total. */
  readonly reviewCount: number;
  /** The window the fold ranged over, so the sheet can state its own scope. */
  readonly since: string;
}

export function heldReadingBasis(input: {
  readonly entries: readonly {
    readonly eventId: string;
    readonly timestamp: string;
    readonly kind: string;
    readonly conceptIds?: readonly string[];
  }[];
  readonly claim: TodayClaim;
}): HeldReadingBasis {
  const wanted = new Set(input.claim.conceptIds);
  const reviews = input.entries
    .filter((entry) => entry.kind === 'review')
    .filter((entry) => (entry.conceptIds ?? []).some((id) => wanted.has(id)))
    .filter((entry) => entry.timestamp.slice(0, 10) >= input.claim.evidence.since)
    .map((entry) => ({ eventId: entry.eventId, timestamp: entry.timestamp }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return { reviews, reviewCount: reviews.length, since: input.claim.evidence.since };
}
