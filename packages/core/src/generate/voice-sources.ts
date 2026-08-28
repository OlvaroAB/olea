/**
 * Voice-fidelity exemplar assembly (F3.8, `[D-101]`) — the generation-side
 * consumer the `features/F3-learn-from-anything.md` scenario "Voice fidelity
 * reads the authorship fact at exemplar assembly" binds to `[D-101]`'s
 * classification (`@auto:core/generate/voice-sources.spec`).
 *
 * `[D-101]` rules two orthogonal facts per passage: authorship
 * (hers/not-hers/unknown) and curation authority
 * (instructor/published/peer/unknown), and names this file's exact job as
 * its first-wave consumer #3 (knowledge model §3.2): "hers exemplifies
 * phrasing, instructor supplies terminology (F3.8, now enforceable as
 * written); unknown remains legitimate grounding for content but is never a
 * voice exemplar."
 *
 * **Classification itself is F1's block, not this file's** — the scenario
 * file says so explicitly, and this module's `ClassifiedPassage` input is
 * deliberately a plain data shape rather than something this file derives
 * from a vault. `[D-101]`'s own classifier has no production implementation
 * yet (filed separately); until it lands, every real call site supplies
 * `authorship: 'unknown'` for every passage, which this function already
 * handles correctly — an empty exemplar set, never a wrong one (D-089's
 * degrade-toward-unknown posture).
 *
 * Same `[D-008]` shape as `../misconception/digest.js`: pure, synchronous,
 * bounded, no network call, assembled fresh per generation request from a
 * local projection, and small enough to travel as request context rather
 * than server state.
 */

export type PassageAuthorship = 'hers' | 'not-hers' | 'unknown';
export type PassageCurationAuthority = 'instructor' | 'published' | 'peer' | 'unknown';

export interface ClassifiedPassage {
  readonly text: string;
  readonly authorship: PassageAuthorship;
  readonly curationAuthority: PassageCurationAuthority;
}

export interface VoiceExemplars {
  /** Confident-hers passages, quoted verbatim — never a rewrite, never a summary. */
  readonly phrasing: readonly string[];
  /** Instructor-curated passages, quoted verbatim — the source's own terminology. */
  readonly terminology: readonly string[];
}

const DEFAULT_MAX_EXEMPLARS = 8;

export interface AssembleVoiceExemplarsOptions {
  /** Upper bound per category, so the exemplar set stays a few kilobytes regardless of how much grounded material one request carries. */
  readonly maxPerCategory?: number;
}

/**
 * `unknown` — for authorship, for curation authority, or both — never
 * contributes to either list. An unknown passage stays legitimate grounding
 * content elsewhere in the request (e.g. `sourceChunks`); it is simply never
 * a voice exemplar, per the ruling's asymmetric licence: hers is hard to
 * earn, easy to lose, and generation proceeds regardless (narrowing the
 * voice inputs is not a refusal).
 */
export function assembleVoiceExemplars(
  passages: readonly ClassifiedPassage[],
  options: AssembleVoiceExemplarsOptions = {},
): VoiceExemplars {
  const max = options.maxPerCategory ?? DEFAULT_MAX_EXEMPLARS;
  const phrasing = passages
    .filter((passage) => passage.authorship === 'hers')
    .map((passage) => passage.text)
    .slice(0, max);
  const terminology = passages
    .filter((passage) => passage.curationAuthority === 'instructor')
    .map((passage) => passage.text)
    .slice(0, max);
  return { phrasing, terminology };
}
