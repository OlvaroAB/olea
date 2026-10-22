/**
 * Every string the gap and coverage views show her (F4.3, F4.5, F4.9, F4.10;
 * `ol-p5t06a`, with `ol-cvsc` [P3-T07h] folded in).
 *
 * **Why a copy module and not strings in the view.** `review/copy.ts` exists
 * because product copy was being assembled in a DOM builder where nothing
 * could assert on it (`ol-09kf`), and the strings on *this* surface are the
 * ones that most need asserting: every sentence here is a claim about what the
 * pipeline read, what her material contains, or what a past paper asked, and
 * F4.9 governs all three. `view.ts` renders what this module hands it and
 * decides nothing.
 *
 * **F4.9, which this surface has already breached in both directions
 * (`ol-f49h`).**
 *
 * > Honest framing in the UI: likelihood not prophecy; always advises covering
 * > the full syllabus; never implies knowledge of a real paper.
 *
 *  - **Half one, an invention.** The design kit's gap-view header read *"ranked
 *    by what this paper has actually asked"*, where *this paper* resolves to
 *    the assessment itself — dated, counted down, not yet sat. It has asked
 *    nothing. {@link rankingAttribution} attributes the asking to the prior
 *    papers actually cited, and counts them, so the sentence cannot outrun its
 *    evidence.
 *  - **Half two, an omission, and the larger one.** A search for the
 *    full-syllabus counterweight across all four design passes returned
 *    nothing: gap view, coverage gaps, countdown and session builder contained
 *    no such text at all. That is what turns *likelihood* into *prophecy* in
 *    use, whatever the rest of the copy says. {@link FULL_SYLLABUS_ADVICE} is
 *    its designed home, and {@link rankedCourseFraming} emits it as part of the
 *    ranked state rather than leaving it to a footer a caller may forget —
 *    "present wherever a ranking is shown" has to be structural or it is not a
 *    guarantee.
 *
 * **`ol-cvsc`, and the one property that matters more than the wording.** The
 * closing line may not assert exhaustiveness the pipeline has not established.
 * {@link coverageClosingLine} returns `null` whenever the scope does not grant
 * the claim, and {@link coverageScreenCopy} always renders the scope statement
 * — so *"we read and found nothing"* and *"we read nothing"* are different text
 * on the screen, not merely different fields in a record. A bare "no gaps
 * found" is unreachable through this module.
 *
 * **The ratified strings.** Two lines here are David's ratified copy from the
 * §8.2 run-4 record (`olea-service/docs/design/RECHECK-8.2-passes-3-4.md`, the
 * kit-says/ships-as table) and are reproduced as ratified, generalised only
 * where a hard-coded count would have been a lie: the material-gap heading, and
 * the closing line — whose self-justifying second sentence ("this list is short
 * because it is honest, not because it is truncated") is **dropped**, because a
 * line that argues for its own honesty is the tell.
 *
 * **STY-2 (`ol-l5og.18` child, `[D-224]`).** Two more things this surface had
 * breached, found by the 2026-09-04 kit-fidelity judgement of `ol-l5og.18.3`'s
 * own work: (1) a mastery-gap row's body was the oracle's raw `reasoning`
 * string — "priority score 0.081"-shaped debug output in front of a student —
 * fixed by {@link masteryGapLine} rather than a wording tweak, because the
 * defect was a fitted number reaching her, not a bad sentence; (2) `[D-224]`
 * asks for full-tab **per-concept detail pages**, and the prior build never
 * built the *page* half, only the full-tab half. {@link gapDetailEyebrow},
 * {@link masteryGapMeta}/{@link materialGapMeta} and
 * {@link masteryGapNarrative}/{@link materialGapNarrative} are that page's
 * copy; `view.ts` now navigates a mastery-gap or material-gap row's list entry
 * into one. Coverage-gap has no detail page — pass5g's own `GapClasses` note
 * says designing it in is how the three classes merged the first time.
 *
 * **Registry §22 (`[D-348]`, ruled, `ol-egov.141.89.9.58`).** A third thing
 * this surface breached, found by the sibling audit that landed the
 * registry entry (`ol-egov.141.89.9.27`): {@link masteryGapLine}'s usual
 * sentence ("recall here hasn't caught up") is deficit phrasing, and §22
 * forbids exactly that for a row whose need basis is `'unknown'` — no
 * eligible evidence at all — however high its ranking priority. The branch
 * in {@link masteryGapLine} on `row.need?.basis` is the fix; its `'unknown'`
 * sentence is new wording, **AWAITING A COPY PASS (Class B)** — not yet
 * reviewed by David, unlike the ratified strings above.
 *
 * **`[D-538]` (`ol-egov.141.89.7.81`): each row names its basis.** A row
 * states every basis its ranking rests on and no other, in the signed words:
 * past papers counted ("Appears in" / "Asked in"), the course objectives only
 * as "its course objectives name it" for an explicit name match, a link Olea's
 * reading inferred as Olea's reading, and an assessment note's own declared
 * scope as "its assessments point to it" — never as a brief, since that scope
 * may be words she typed herself. Where her material holds nothing for it,
 * the copy says what Olea did not find ("supporting material not found"),
 * never that it is absent. {@link basisClauses} and {@link basisFragments} are
 * the one place each phrase is written; the row line, both header lines, the
 * mastery narrative and the material-gap heading read them.
 *
 * **INV-1.** No `obsidian` import here — this module is unit-tested, which is
 * the entire point of it being separate from `view.ts`.
 */

import {
  type ConceptAssessmentEdge,
  type CoverageScope,
  type CoverageScopeSource,
  type EvidenceQuestionCitation,
  formatSourceCitation,
  type GapAffordance,
  type GapCourseView,
  type GapRow,
  type SourceReadState,
} from 'olea-core';

// ---------------------------------------------------------------------------
// Titles and section headings
// ---------------------------------------------------------------------------

export const GAP_VIEW_TITLE = 'Worth studying';
export const COVERAGE_VIEW_TITLE = 'Coverage';

/**
 * The material-gap section heading.
 *
 * **Amended from the ratified copy on David's instruction, 2026-08-16.** The
 * ratified string read "Named by *the paper*, missing from your materials", and
 * that definite singular is exactly the F4.9 ambiguity `ol-f49h` half one is
 * about: with no antecedent on this surface, "the paper" reads as *the exam
 * ahead* — which Olea has not seen and must never imply it has. The plural
 * possessive can only mean the past papers of hers that were actually cited,
 * which is the true claim and the one `rankedCourseFraming` already counts.
 *
 * The change is one word wide on purpose. Told the framing strings were his to
 * review, David delegated: "proceed with your best suggestion and we'll update
 * later when testing through the finished alpha product." So this is a
 * reversible default carrying his authority, not a lane quietly editing
 * ratified copy — and the full inventory is in run 16's report to read back.
 *
 * **Amended under `[D-538]` (2026-10-06).** The second half no longer asserts
 * absence ("missing from your materials"): it says what Olea did not find.
 * And the heading names the bases present among the material gaps it heads
 * ({@link materialGapHeading}), so a material gap ranked on the objectives
 * alone is never headed as named by past papers. This constant is the
 * past-paper form, the one the ratified heading was written for.
 */
export const MATERIAL_GAP_HEADING = 'Named by your past papers, supporting material not found';

/** The coverage-gap section heading (F4.5: notes exist, cards do not). */
export const COVERAGE_GAP_HEADING = 'In your notes, not yet in your cards';

/**
 * What the screen says when it could not build a view at all — a vault it
 * could not walk, an extraction pass that threw.
 *
 * **This is the same distinction the rest of the surface is about, one level
 * up.** *"No gaps"* is a claim about her material; a failed read supports no
 * claim about her material. `review/copy.ts`'s `REVIEW_UNAVAILABLE_*` and
 * `today/copy.ts`'s `DUE_UNAVAILABLE` draw exactly this line, and this is the
 * same statement in the same voice on the surface where getting it wrong costs
 * the most. It does not read as a crash, it does not blame her, and it does not
 * say a feature is missing — it says what happened.
 */
export const GAP_UNAVAILABLE_TITLE = 'Olea could not read your sources just now.';
export const GAP_UNAVAILABLE_BODY =
  'So there is nothing here to show. This is not a claim that your materials cover everything — try again in a moment.';

/**
 * The one action the body text above already promises ("try again in a
 * moment") and, until `[STY-0h]` (`ol-l5og.18.8`), had nowhere to press.
 * Same word `explain-back/copy.ts`'s `EXPLAIN_BACK_DISCARD_LABEL` already
 * uses for the identical "throw this attempt away, ask again" gesture — one
 * fewer word for the vocabulary registry to carry two meanings of.
 */
export const GAP_UNAVAILABLE_RETRY_LABEL = 'Try again';

/**
 * The eyebrow above the two lines just above — same wording
 * `pass5-refusal-trends-shell`'s `RefusalCouldNotCheck` uses in
 * `olea-service`'s design kit for the identical "checked nothing, decided
 * nothing" state, reused verbatim rather than re-paraphrased for a state
 * this pane and that kit both mean the same thing by.
 */
export const GAP_UNAVAILABLE_EYEBROW = "Couldn't check · nothing was decided";

// ---------------------------------------------------------------------------
// F4.9 — the framing that governs every ranked surface
// ---------------------------------------------------------------------------

/**
 * F4.9's second and third clauses, in one designed sentence rather than a
 * disclaimer bolted to a footer.
 *
 * The first half refuses prophecy without pretending the ranking is arbitrary;
 * the second gives the ranking its actual job — deciding order, not deciding
 * scope. Both halves are needed: "cover the whole syllabus" alone reads as a
 * hedge that undercuts the feature, and "this is where the evidence points"
 * alone is the prophecy F4.9 forbids.
 */
export const FULL_SYLLABUS_ADVICE =
  'This is where the evidence points, not where the exam will go. Cover the whole syllabus; let this decide what you do first.';

/**
 * The `[D-226]` ruling 2 objectives-basis attribution, drawn directly from
 * F4.2's own ratified clause text ("An objectives document declares what is
 * in scope; it does not evidence how often something is examined") rather
 * than invented screen copy — no registry row exists yet for this sentence
 * (checked `docs/Olea_vocabulary_registry.md`, 2026-09-19; `ol-af3j`'s own
 * notes record the same gap as of 2026-09-07), so this is proposed copy for
 * ratification, flagged rather than presented as final. It never states a
 * count: unlike a past paper, an objectives document's evidence is not a
 * citation frequency, and `GapRow` does not carry a distinct
 * objectives-source count today (see {@link rankingAttribution}'s doc).
 */
export const OBJECTIVES_ATTRIBUTION_SENTENCE =
  'Ranked by your registered course objectives — they declare what is in scope, not how often something is examined.';

/** The mixed-course form of {@link OBJECTIVES_ATTRIBUTION_SENTENCE}, appended after the past-paper sentence rather than replacing it — F4.2: "each basis is stated for what it is." */
export const OBJECTIVES_ATTRIBUTION_CLAUSE =
  'Some of this ranking also draws on your registered course objectives, for what they declare in scope.';

/**
 * The `[D-247]`/`[D-399]` brief-basis attribution (`ol-egov.141.89.10.74`):
 * F4.2 gives the current assessment briefs "their own attribution sentence",
 * like objectives, and its own example names the reason as the brief for
 * that assessment. A brief names what that one assessment covers; like an
 * objectives document it never evidences how often something is examined,
 * so this sentence carries no frequency framing and no count. Proposed copy
 * built from the clause's own words, **AWAITING A COPY PASS (Class B)** —
 * the registry has no row for it yet.
 */
export const ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE =
  'Ranked by what your assessment briefs say they cover — a brief names what is in scope for that assessment, not how often something is examined.';

/** The mixed form of {@link ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE}, appended after the sentence for the other basis — F4.2: "each basis is stated for what it is." */
export const ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE =
  'Some of this ranking also draws on your assessment briefs, for what they say each assessment covers.';

/** One evidence basis behind a ranked row — `ConceptAssessmentEdge.basis`, with its documented `'past-paper'` default applied. */
export type GapRowEvidenceBasis = NonNullable<ConceptAssessmentEdge['basis']>;

/**
 * The evidence bases behind each ranked row, keyed by {@link gapRowBasisKey}.
 * Built from the same edges the ranking was composed from
 * ({@link gapRowEvidenceBases}); the caller hands it to
 * {@link rankingAttribution} so the sentence can tell an objectives-only row
 * from a brief-only one — both carry an empty `citations` array, and
 * `GapRow` itself carries no basis.
 */
export type GapRowEvidenceBases = ReadonlyMap<string, ReadonlySet<GapRowEvidenceBasis>>;

/** The key {@link GapRowEvidenceBases} is read by: course and opaque concept key, never the display name. */
export function gapRowBasisKey(course: string, conceptKey: string): string {
  return `${course}\u0000${conceptKey}`;
}

/**
 * Collect {@link GapRowEvidenceBases} from the concept↔assessment edges
 * (`ComposeOracleRankingResult.edges`). An edge with no `basis` reads as
 * `'past-paper'`, the default `ConceptAssessmentEdge.basis` documents; an
 * edge with no `conceptKey` falls back to its name, as the edge builder does.
 */
export function gapRowEvidenceBases(edges: readonly ConceptAssessmentEdge[]): GapRowEvidenceBases {
  const bases = new Map<string, Set<GapRowEvidenceBasis>>();
  for (const edge of edges) {
    const key = gapRowBasisKey(edge.course, edge.conceptKey ?? edge.conceptName);
    const set = bases.get(key) ?? new Set<GapRowEvidenceBasis>();
    set.add(edge.basis ?? 'past-paper');
    bases.set(key, set);
  }
  return bases;
}

/**
 * The gap view's ranking attribution — F4.9 half one's fix, extended for
 * `[D-226]` ruling 2's own attribution sentence.
 *
 * Derived from the citations actually behind the rows, so the sentence names a
 * number of documents that exist and were read. Past tense, and the subject is
 * always the prior papers: the assessment ahead is never the thing that asked.
 *
 * **The objectives-basis branch, and the reachability gap it stops short
 * of (`[D-226]` ruling 2, `ol-oxa2`).** A ranked `GapRow` whose `citations`
 * array is empty is no longer "no evidence" as of the sibling core bead that
 * admits objectives citations on their own basis (`ol-af3j`,
 * `evidence-edge/build.ts`): that module's own "evidential, not membership"
 * rule never emits an edge with no evidence at all, and every past-paper
 * edge always carries at least one citation, so an EMPTY `citations` array
 * on a row that survived to `ranked` can only mean every surviving edge
 * behind it is `basis: 'objectives'` — a safe inference from data already on
 * `GapRow`, not a guess. What it CANNOT do is name how many objectives
 * documents, or which ones: `GapRow` does not carry
 * `OracleConceptFactors.objectivesCitations`/`distinctObjectivesSourceCount`
 * (`oracle/types.ts`) today, because threading them from `ConceptPriority`
 * through `gap/build.ts`'s `buildRow` is out of this bead's owned files
 * (`packages/core/src/gap/build.ts` is live-owned by another lane,
 * `ol-2zfj.84`, as of 2026-09-19). Filed as follow-on `ol-oxa2.1`.
 *
 * **The brief basis breaks that inference (`ol-egov.141.89.10.74`,
 * `[D-399]`).** Once an assessment declares a scope, a concept ranked only by
 * its brief also reaches here with empty `citations`, and the inference above
 * would call it objectives-based. `bases` ({@link gapRowEvidenceBases}, from
 * the same edges the ranking used) settles each row by its own edges: the
 * brief is named as the brief, objectives as objectives, and both are stated
 * when both are present. Omitting `bases` keeps the inference exactly as
 * before for every caller that has not threaded the edges through yet.
 */
export function rankingAttribution(rows: readonly GapRow[], bases?: GapRowEvidenceBases): string {
  const sources = new Set<string>();
  for (const row of rows) for (const citation of row.citations) sources.add(citation.sourcePath);
  const n = sources.size;
  const { hasObjectivesEvidence, hasBriefEvidence } = nonPaperBases(rows, bases);
  if (n === 0) {
    if (rows.length === 0) {
      // Reachable whenever there are no rows at all. Says what is true of
      // that state instead of borrowing the sentence for the other one.
      return 'Ranked by the evidence behind these concepts — no past paper is cited here.';
    }
    // Every row present is objectives- or brief-basis. Never the past-paper
    // sentence's frequency framing ("never wears a past paper's clothes", F4.2).
    if (hasObjectivesEvidence && hasBriefEvidence) {
      return `${OBJECTIVES_ATTRIBUTION_SENTENCE} ${ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE}`;
    }
    return hasBriefEvidence
      ? ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE
      : OBJECTIVES_ATTRIBUTION_SENTENCE;
  }
  const pastPaperSentence =
    n === 1
      ? 'Ranked by what 1 past paper of yours has asked.'
      : `Ranked by what ${n} past papers of yours have asked.`;
  return [
    pastPaperSentence,
    ...(hasObjectivesEvidence ? [OBJECTIVES_ATTRIBUTION_CLAUSE] : []),
    ...(hasBriefEvidence ? [ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE] : []),
  ].join(' ');
}

/**
 * Which non-past-paper bases stand behind `rows`.
 *
 * **A row's own carried basis wins** (`GapRow.basis`, `[D-538]`,
 * `ol-egov.141.89.7.81`): the core build reads it from the ranking's
 * SURVIVING evidence, so an assessment already sat (its edge vetoed, C5.10)
 * is never named here. `bases` is built from every edge before the veto, so it
 * is read only for a row that carries no basis (one no build produced). With
 * neither, the objectives-basis paragraph above's inference stands unchanged:
 * a ranked row with zero citations is read as objectives-basis — which a
 * brief-only row would wrongly share, and is exactly why a caller that has the
 * edges passes them.
 */
function nonPaperBases(
  rows: readonly GapRow[],
  bases: GapRowEvidenceBases | undefined,
): { readonly hasObjectivesEvidence: boolean; readonly hasBriefEvidence: boolean } {
  let hasObjectivesEvidence = false;
  let hasBriefEvidence = false;
  for (const row of rows) {
    if (row.basis !== undefined) {
      if (row.basis.objectives !== null) hasObjectivesEvidence = true;
      if (row.basis.assessmentPaths.length > 0) hasBriefEvidence = true;
      continue;
    }
    const rowBases = bases?.get(gapRowBasisKey(row.course, row.conceptKey));
    if (rowBases === undefined) {
      // No edges supplied, or a row they do not cover: the unsupplied inference, per row.
      if (row.citations.length === 0) hasObjectivesEvidence = true;
      continue;
    }
    if (rowBases.has('objectives')) hasObjectivesEvidence = true;
    if (rowBases.has('assessment-brief')) hasBriefEvidence = true;
  }
  return { hasObjectivesEvidence, hasBriefEvidence };
}

/**
 * The framing paragraphs shown above any ranking, in order.
 *
 * The full-syllabus advice is emitted here, from the ranked state, so "present
 * wherever a ranking is shown" is a property of the code path rather than of a
 * caller's diligence.
 */
export function rankedCourseFraming(
  rows: readonly GapRow[],
  bases?: GapRowEvidenceBases,
): readonly string[] {
  return [rankingAttribution(rows, bases), FULL_SYLLABUS_ADVICE];
}

// ---------------------------------------------------------------------------
// pass5g's syllabus counterweight — a structural block, not a footer
// (`[D-224]` / `ol-l5og.20`, `ol-l5og.18.3`)
// ---------------------------------------------------------------------------

/**
 * The corrected kit's on-screen counterweight (`SyllabusCounterweight`,
 * `docs/design/pass5g-pass4-corrections`), distinct from
 * {@link FULL_SYLLABUS_ADVICE} above rather than a replacement for it:
 * `FULL_SYLLABUS_ADVICE` is the ratified F4.9 sentence and is left exactly as
 * ratified; this is the kit's separate, more concrete block naming how much
 * of the syllabus actually has something built, from data the ranking
 * already carries. `view.ts` renders it unconditionally beside every ranked
 * course's rows — never behind a dismiss control, matching the kit's own
 * "not dismissible" framing.
 *
 * "Something built" means `'mastery-gap'` specifically — the class whose
 * material AND instruments both exist (see `gap/build.ts`'s module doc for
 * why the three classes are told apart by what is missing). A course with
 * zero ranked rows still gets the sentence, without a denominator it cannot
 * honestly state.
 */
export function syllabusCounterweightSentence(courseName: string, rows: readonly GapRow[]): string {
  const total = rows.length;
  if (total === 0) {
    return 'Ranking tells you where to start, not what to skip. Covering the whole syllabus still comes first.';
  }
  const built = rows.filter((r) => r.gapClass === 'mastery-gap').length;
  const conceptsNoun = total === 1 ? 'concept' : 'concepts';
  const haveVerb = built === 1 ? 'has' : 'have';
  const itThem = built === 1 ? 'it' : 'them';
  return (
    'Ranking tells you where to start, not what to skip. Covering the whole syllabus still comes ' +
    `first — ${built} of ${total} ${conceptsNoun} in ${courseName} ${haveVerb} something built for ${itThem}.`
  );
}

/**
 * The counterweight's optional second line — the kit's own
 * "9 with nothing built · 2 with no material" breakdown, counted from the
 * same rows rather than a second computation. `null` when both counts are
 * zero (every ranked row is already a mastery gap), so the block does not
 * grow an empty breakdown line.
 *
 * Deliberately omits the kit's "See the whole grove" link: that names a
 * different surface (`Grove`, a separate view/command), and adding a
 * navigation affordance to it is not this bead's call to make — no clause
 * names that door from this screen.
 */
export function syllabusCounterweightBreakdown(rows: readonly GapRow[]): string | null {
  const nothingBuilt = rows.filter((r) => r.gapClass === 'coverage-gap').length;
  const noMaterial = rows.filter((r) => r.gapClass === 'material-gap').length;
  if (nothingBuilt === 0 && noMaterial === 0) return null;
  const parts: string[] = [];
  if (nothingBuilt > 0) {
    parts.push(`${nothingBuilt} with nothing built`);
  }
  if (noMaterial > 0) {
    // `[D-538]`: what Olea did not find, never a claim that her material lacks it.
    parts.push(`${noMaterial} with no supporting material found`);
  }
  return parts.join(' · ');
}

/**
 * A course the oracle declined to rank.
 *
 * States its own scope inside its own sentence — the move the design pass's
 * abstain row already got right, and the same move `ol-cvsc` requires of the
 * coverage screen. The framing strings above are deliberately not produced for
 * an abstention: there is no ranking to frame.
 */
export function abstainedCourseSentence(course: GapCourseView): string {
  if (course.status !== 'abstained') {
    throw new Error('abstainedCourseSentence: called with a ranked course');
  }
  const n = course.assessmentPaths.length;
  if (n === 1) {
    return 'Not enough evidence to rank this course — no past paper or objective we have cites its one assessment.';
  }
  return `Not enough evidence to rank this course — no past paper or objective we have cites any of its ${n} assessments.`;
}

/**
 * The honest answer to "why is this lower than I expected?", shown only on a
 * row where R7's readiness weighting actually fired.
 *
 * R7's framing clause says the UI never says *"MCQs don't count"*; it equally
 * must not imply MCQs are enough, and the last sentence is what keeps the two
 * readings apart. `null` when the weighting did not apply — a reason is never
 * offered for something that did not happen.
 */
export function readinessNote(row: GapRow): string | null {
  if (!row.readiness.applied) return null;
  return 'Ranked lower here because this is a multiple-choice paper and you have practised this one on multiple-choice questions. Your mastery reading is unchanged.';
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function paperCount(n: number): string {
  return n === 1 ? '1 past paper' : `${n} past papers`;
}

/**
 * Whether a row has a past-paper basis (`ol-egov.141.89.7.67`, `[D-529]`).
 * `distinctSourceCount` counts past-paper sources only (core `gap/build.ts`),
 * so 0 means the concept is ranked on an objectives document or a brief alone,
 * and such a row never states a past-paper count.
 */
function hasPastPaperBasis(row: GapRow): boolean {
  return row.distinctSourceCount > 0;
}

// ---------------------------------------------------------------------------
// `[D-538]` — one phrase per basis, written once (`ol-egov.141.89.7.81`)
// ---------------------------------------------------------------------------

/**
 * "Its course objectives name it" — registry §29's ruled sentence (row 33), word
 * for word, and only for an explicit name match (`GapRow.basis.objectives ===
 * 'named'`).
 */
const OBJECTIVES_NAME_IT = 'its course objectives name it';

/**
 * A link Olea's reading made between the concept and the objectives
 * (`[D-432]`'s semantic alignment): never "name it", and never §29's "covered
 * by" either, since "cover" means her material on this surface (F4.10, F8.3).
 * Built from registry §28's "Olea's reading" and §35's own account of the same
 * fact ("which Olea's reading places under one of its objectives").
 * **Proposed by `ol-egov.141.89.7.81`, needing a registry entry before any row
 * carries an inferred link**; nothing produces one today (core
 * `gap/build.ts`'s `GapRowObjectivesLink`).
 */
const OBJECTIVES_INFERRED = "Olea's reading places it under its course objectives";

/**
 * An assessment note's own declared scope (the `'assessment-brief'` basis):
 * registry §29's ruled "Its assessments point to it.", chosen by `[D-538]` over
 * "the brief names it", because the scope property may hold words she typed
 * herself rather than the course's document.
 */
const ASSESSMENTS_POINT_TO_IT = 'its assessments point to it';

/** The header-line forms of the three phrases above; "your", as the ratified heading says it. */
const NAMED_BY_OBJECTIVES = 'named by your course objectives';
const INFERRED_UNDER_OBJECTIVES = "placed under your course objectives by Olea's reading";
const POINTED_TO_BY_ASSESSMENTS = 'pointed to by your assessments';

/**
 * `[D-538]`: "supporting material not found", in place of an absence claim
 * ("it isn't in your materials"). A material gap is a concept no note of hers
 * was found naming (core `classifyGap`), which is what Olea found, not a fact
 * about her vault. The sentence names Olea as the one that looked; the
 * header-line and heading form is the ruling's own phrase.
 */
const NOT_FOUND_SENTENCE = "Olea hasn't found supporting material for it.";
const SUPPORTING_MATERIAL_NOT_FOUND = 'supporting material not found';

/** Registry §29's ruled sentence for a concept with no recall evidence (`[D-348]`, §22). */
const RECALL_NOT_KNOWN_YET = 'How well you recall it is not known yet.';

/** How the past-paper basis is worded where it stands: the row line's frame by class, or the narrative's. */
type PastPaperFrame = 'appears' | 'asked' | 'narrative';

function pastPaperClause(n: number, frame: PastPaperFrame): string {
  switch (frame) {
    case 'appears':
      return `appears in ${paperCount(n)}`;
    case 'asked':
      return `asked in ${paperCount(n)}`;
    case 'narrative':
      return `it's been asked in ${paperCount(n)}`;
  }
}

function objectivesLink(row: GapRow): 'named' | 'inferred' | null {
  return row.basis?.objectives ?? null;
}

function hasAssessmentBasis(row: GapRow): boolean {
  return (row.basis?.assessmentPaths.length ?? 0) > 0;
}

/**
 * Every basis a row's ranking rests on, as sentence clauses, in `[D-538]`'s
 * order: past papers, objectives, assessments. Only past papers are counted;
 * the objectives and the assessments never carry a count and are never said
 * to appear in or be asked in anything (`[D-529]`). A row carrying no basis
 * (one no build produced) names its past papers only.
 */
function basisClauses(row: GapRow, frame: PastPaperFrame): string[] {
  const clauses: string[] = [];
  if (hasPastPaperBasis(row)) clauses.push(pastPaperClause(row.distinctSourceCount, frame));
  const objectives = objectivesLink(row);
  if (objectives === 'named') clauses.push(OBJECTIVES_NAME_IT);
  if (objectives === 'inferred') clauses.push(OBJECTIVES_INFERRED);
  if (hasAssessmentBasis(row)) clauses.push(ASSESSMENTS_POINT_TO_IT);
  return clauses;
}

/** The same bases as header-line fragments, joined by the caller with " · ". */
function basisFragments(row: GapRow): string[] {
  const fragments: string[] = [];
  if (hasPastPaperBasis(row)) fragments.push(pastPaperClause(row.distinctSourceCount, 'asked'));
  const objectives = objectivesLink(row);
  if (objectives === 'named') fragments.push(NAMED_BY_OBJECTIVES);
  if (objectives === 'inferred') fragments.push(INFERRED_UNDER_OBJECTIVES);
  if (hasAssessmentBasis(row)) fragments.push(POINTED_TO_BY_ASSESSMENTS);
  return fragments;
}

/** `a`, `a, and b`, `a, b, and c`: after the first clause the rest join with ", and". */
function joinClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? '';
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A row line: its bases, then the class's own clause after a semicolon; with no basis, the clause alone. */
function withBasisLead(row: GapRow, frame: PastPaperFrame, clause: string): string {
  const lead = basisClauses(row, frame);
  return capitalise(lead.length === 0 ? clause : `${joinClauses(lead)}; ${clause}`);
}

function instrumentsLabel(row: GapRow): string {
  return row.instrumentCount === 1 ? '1 instrument' : `${row.instrumentCount} instruments`;
}

/**
 * The mastery-gap row's summary line (F4.3) — what she can act on, never the
 * oracle's own bookkeeping.
 *
 * **Replaces `row.reasoning` on this surface** (STY-2, `ol-l5og.18` child).
 * `oracle/rank.ts`'s `reasoning` string is a developer audit trail —
 * "yield rank 1, confidence 1.00, weight score 0.30, due in 38 days …
 * Priority score 0.081" — mechanically assembled so an engineer can check the
 * order matches the stated reasons (`rank.ts`'s own doc). It was never
 * written to be read by her, and printing it verbatim put fitted numbers in
 * front of a student on the one surface built to explain a ranking rather
 * than just apply one — exactly the case `docs/Olea_component_register.md`'s
 * declared/derived line rules on: `priorityScore`, `gapScore`, confidence and
 * weight are all derived (fitted, unratified — R7's own module doc calls its
 * weight "provisional and unratified"), so none of them may reach her,
 * however honestly labelled. This sentence carries the same two COUNTED
 * facts the reasoning string carries — how much is built, how often it has
 * been asked — with no fitted number in it at all.
 *
 * **The `[D-348]` branch (registry §22).** `GapRow.need` already carries a
 * basis when the caller supplies one (`gap/build.ts`'s `BuildGapViewInput.need`;
 * the production caller is `gap/provider.ts`, which passes it to `buildGapView`
 * from its `needByConcept`). "Recall here
 * hasn't caught up" is a measured-shortfall claim, which is exactly what §22
 * forbids saying about a row whose need basis is `'unknown'`: no eligible
 * evidence exists at all, so there is nothing to say has or hasn't caught up
 * — that is true even when the same row is ranked at the declared maximum
 * priority a never-practised concept gets (`UNKNOWN_NEED_VALUE`,
 * `mastery/attainment.ts`). `row.need?.basis === 'unknown'` gets its own
 * sentence that names the absence of evidence and claims nothing about her
 * knowledge; `'estimated'` — or no `need` supplied at all — keeps the
 * existing wording unchanged. The `'unknown'` sentence below is the signed
 * never-checked sentence (David, sheet v50, "Unknown-need copy"); a row
 * whose earlier answers were excluded because their passage changed reads
 * {@link changedPassageGapLine} instead, once a row carries that signal.
 *
 * **`[D-538]`.** The lead names every basis the row rests on
 * ({@link basisClauses}); the clause after the semicolon, the signed
 * unknown-need one included, is unchanged.
 */
export function masteryGapLine(row: GapRow): string {
  const instruments = instrumentsLabel(row);
  if (row.need?.basis === 'unknown') {
    return withBasisLead(
      row,
      'asked',
      `you have ${instruments} built, but Olea has no recall evidence for it yet, so this says nothing about what you know.`,
    );
  }
  return withBasisLead(
    row,
    'asked',
    `you have ${instruments} built but recall here hasn't caught up.`,
  );
}

/**
 * The sentence for a row whose earlier answers are excluded from the current
 * recall reading because the material behind them changed (`[D-522]`,
 * `[D-536]`; sheet v50 "Unknown-need copy"). It describes exclusion from the
 * current reading only; her historical attainment is untouched and the
 * sentence never says otherwise. **No caller yet**: `GapRow` carries no
 * row-level signal for this case, so the lane that adds one to the row wires
 * this in. Its lead names the row's bases the same way as
 * {@link masteryGapLine}'s (`[D-538]`).
 */
export function changedPassageGapLine(row: GapRow): string {
  return withBasisLead(
    row,
    'asked',
    `you have ${instrumentsLabel(row)} built, but the material behind your earlier answers has changed, so they don't count until it's checked again.`,
  );
}

/**
 * One gap row's sentence, per class.
 *
 * The material-gap line began as **ratified copy** ("Appears in N past
 * papers; it isn't in your materials.", F4.10's own example). Under
 * `[D-538]` its lead names every basis the row rests on, and its second
 * clause says what Olea did not find rather than asserting the material is
 * absent: a statement about what was ingested, never a judgement about her
 * notes. The coverage-gap line takes the same lead.
 *
 * The mastery-gap line is {@link masteryGapLine} — see that function's doc for
 * why this stopped being the oracle's raw `reasoning` string.
 */
export function gapRowLine(row: GapRow): string {
  switch (row.gapClass) {
    case 'material-gap':
      return withBasisLead(row, 'appears', NOT_FOUND_SENTENCE);
    case 'coverage-gap':
      return withBasisLead(row, 'appears', 'you have notes on it but no cards yet.');
    case 'mastery-gap':
      return masteryGapLine(row);
  }
}

// ---------------------------------------------------------------------------
// pass5g's per-concept detail pages (`[D-224]` / `ol-l5og.20`) — one page per
// mastery-gap or material-gap row, opened from the list; coverage-gap stays
// list-only, per the corrected kit's own note that it is "deliberately
// absent here"
// ---------------------------------------------------------------------------

/** The two gap classes pass5g draws a full detail page for. Coverage-gap has none — see this section's own note. */
export type GapDetailClass = 'mastery-gap' | 'material-gap';

/** The detail page's eyebrow (`[D-224]`) — course and class, matching pass5g's "COGS214 · mastery gap" / "COGS214 · material gap". */
export function gapDetailEyebrow(course: string, gapClass: GapDetailClass): string {
  return `${course} · ${gapClass === 'material-gap' ? 'material gap' : 'mastery gap'}`;
}

/**
 * The mastery-gap detail page's header meta line (`[D-224]`).
 *
 * pass5g's own reads "6 instruments · 4 attempts in 10 days" — the second
 * half needs per-attempt review-log history `GapRow` does not carry (no
 * data-model change is in this bead's `owns`: view/copy/provider only, same
 * disclosed gap `ol-l5og.18.3`'s close evidence already recorded). This
 * states what is actually known instead of a placeholder for what is not.
 * Then each basis the row rests on (`[D-538]`), joined the same way.
 */
export function masteryGapMeta(row: GapRow): string {
  return [instrumentsLabel(row), ...basisFragments(row)].join(' · ');
}

/**
 * The material-gap detail page's header meta line (`[D-224]`) — F4.10's fact,
 * not a claim about the exam ahead: each basis (`[D-538]`), then what Olea did
 * not find.
 */
export function materialGapMeta(row: GapRow): string {
  return capitalise([...basisFragments(row), SUPPORTING_MATERIAL_NOT_FOUND].join(' · '));
}

/**
 * The material-gap section heading (H1 of `[D-538]`): the bases present among
 * the material gaps it heads, in the same nouns as the rows, then what Olea did
 * not find. Past papers and objectives that name it share one "named by";
 * a heading over past-paper rows alone is {@link MATERIAL_GAP_HEADING}. Rows of
 * another class are not read.
 */
export function materialGapHeading(rows: readonly GapRow[]): string {
  const material = rows.filter((row) => row.gapClass === 'material-gap');
  const namedBy = [
    ...(material.some(hasPastPaperBasis) ? ['your past papers'] : []),
    ...(material.some((row) => objectivesLink(row) === 'named') ? ['your course objectives'] : []),
  ];
  const parts = [
    ...(namedBy.length > 0 ? [`named by ${namedBy.join(' and ')}`] : []),
    ...(material.some((row) => objectivesLink(row) === 'inferred')
      ? [INFERRED_UNDER_OBJECTIVES]
      : []),
    ...(material.some(hasAssessmentBasis) ? [POINTED_TO_BY_ASSESSMENTS] : []),
    SUPPORTING_MATERIAL_NOT_FOUND,
  ];
  return capitalise(parts.join(', '));
}

/**
 * The mastery-gap detail page's narrative (F4.3, `[D-224]`) — never pass5g's
 * attempt-by-attempt story (its `ATTEMPTS` table), which needs per-attempt
 * history this pipeline does not expose to the plugin layer (same disclosed
 * gap as {@link masteryGapMeta}). What exists, then why it is ranked here —
 * COUNTED facts and named bases, no fitted score.
 *
 * **Why it is ranked here names its bases (`[D-538]`)**: the row's score is
 * relevance times need (`[D-521]`), and the relevance comes from the bases, so
 * recall alone is never the whole reason. **A row whose need is unknown**
 * (`[D-348]`, registry §22) is never told recall is "worth another pass": it
 * reads §29's ruled "How well you recall it is not known yet." after its bases.
 */
export function masteryGapNarrative(row: GapRow): readonly string[] {
  const first = `Your notes cover this, and ${instrumentsLabel(row)} are built from them — the material and the practice both exist.`;
  const bases = basisClauses(row, 'narrative');
  if (row.need?.basis === 'unknown') {
    return [
      first,
      ...(bases.length > 0 ? [`It's ranked here because ${joinClauses(bases)}.`] : []),
      RECALL_NOT_KNOWN_YET,
    ];
  }
  return [
    first,
    `It's ranked here because ${joinClauses([...bases, 'recall on it is worth another pass'])}.`,
  ];
}

/**
 * The material-gap detail page's narrative (F4.10, `[D-224]`) — the same fact
 * {@link gapRowLine} states, then F4.10's own distinction: never a judgement
 * about what she knows. Under `[D-538]` it no longer calls this "a gap in your
 * material", an absence claim; it says what Olea has to build from, and
 * reuses the signed unknown-need sentence's "this says nothing about what you
 * know". Never the kit's quoted "one note that touched it" — `GapRow.notePaths`
 * is empty by definition for a material gap (`classifyGap`: no note names it at
 * all), so there is no mention to quote, honestly.
 */
export function materialGapNarrative(row: GapRow): readonly string[] {
  return [
    gapRowLine(row),
    'So Olea has nothing to build practice from yet. This says nothing about what you know.',
  ];
}

/** The detail page's back-to-list control. Navigation chrome, not a claim about her material — no clause governs its wording. */
export const GAP_DETAIL_BACK_LABEL = '‹ Back to the list';

// ---------------------------------------------------------------------------
// pass5g's past-paper chips (`[D-224]`) — named, never divided
// ---------------------------------------------------------------------------

/** The label above a row's chip strip — F4.9's "counted, never divided" applied to the prefix too. */
export function pastPapersLabel(distinctSourceCount: number): string {
  return `Asked in ${paperCount(distinctSourceCount)}:`;
}

/**
 * One past-paper citation's chip — its own name (R2, verbatim; her vault's
 * own naming, not a derived slug) paired with the question label, so the
 * same paper cited on two questions still reads as one paper rather than a
 * repeated, unnamed source.
 *
 * **Reuses `olea-core`'s `formatSourceCitation`** (`ol-cph9`) rather than a
 * second, re-typed basename routine — the same call `registry/copy.ts` and
 * `explain-back/modal.ts`'s `citationLabelFor` already make for every other
 * source citation on this surface. Passing only `sourcePath` (no
 * page/section/heading) makes it behave exactly as this chip always did over
 * a real vault path: strip the folder, strip the extension, keep the name.
 * Over an id shaped with neither a `/` nor a `.` — `packages/synthetic`'s
 * coined `sourcePath`s, or a display name a caller has already substituted
 * in (`packages/workbench/src/oracle/display-names.ts`) — the extraction is
 * a no-op and the string passes through unchanged, so this chip renders
 * whatever student-facing name the caller resolved rather than a raw id, the
 * same way `scopeSourceLine` does for `CoverageScopeSource.sourcePath`.
 *
 * **Deliberately no invented date.** The kit's chip reads "June 2024 · Q3";
 * `Source` (`olea-core`) carries no sitting-date field, and there is no
 * reader for one — so this names what is actually known (the file, verbatim)
 * rather than parsing a date out of a filename that might not encode one.
 * Widening `Source` to carry a real sitting date is a data-model change this
 * bead's `owns` (view/copy/provider) does not reach; filed separately.
 */
export function pastPaperChipLabel(citation: EvidenceQuestionCitation): string {
  const name = formatSourceCitation({ sourcePath: citation.sourcePath });
  return `${name} · ${citation.questionLabel}`;
}

/** A row's chip strip, in citation order — empty for a row ranked without a past paper (`GapRow.citations`), which draws no chips. */
export function pastPaperChips(row: GapRow): readonly string[] {
  return row.citations.map(pastPaperChipLabel);
}

/**
 * Action labels. There is no commissioning label here — `olea-core`'s
 * `affordancesFor` never returns a draft/generate affordance on any class
 * (F4.5's draft verb is withdrawn under `[D-063]`; F4.10 never had one: "not
 * relabelled, not disabled, not conditional") — so this map never has to be
 * the guard.
 */
const AFFORDANCE_LABELS: Readonly<Record<GapAffordance, string>> = {
  'open-concept': 'Open the concept',
  'build-session': 'Build a session from this',
  'find-source': 'Find the source',
};

export function affordanceLabel(affordance: GapAffordance): string {
  return AFFORDANCE_LABELS[affordance];
}

// ---------------------------------------------------------------------------
// ol-cvsc — the scope statement, and the claim it gates
// ---------------------------------------------------------------------------

/** The word for one source's read state on its own row. Four states, four words — collapsing any two is the defect this bead exists for. */
const READ_STATE_LABELS: Readonly<Record<SourceReadState, string>> = {
  read: 'read',
  'read-yielded-nothing': 'opened, nothing in it',
  unreadable: 'could not be read',
  'not-attempted': 'not read on this pass',
};

export function readStateLabel(state: SourceReadState): string {
  return READ_STATE_LABELS[state];
}

/**
 * The row label for a source with a page still waiting to be read (`[D-448]`, registry section 30):
 * a Class B default derived from the ruled sentence, flagged for review (`ol-egov.141.89.8.44`).
 */
export const NOT_FULLY_READ_YET_LABEL = 'not fully read yet';

/**
 * A source Olea can open that still has a page waiting (`[D-326]`'s unsettled reading) and so is
 * neither read in full nor a source "no reader" covers (`[D-448]`). A source whose pass already
 * settled on a failed unit keeps its own state's word: that is a different fact.
 */
export function isNotFullyReadYet(source: CoverageScopeSource): boolean {
  return (
    source.readingCompleteness === 'unsettled' &&
    (source.readState === 'read' || source.readState === 'not-attempted')
  );
}

/** One source's row in the scope list — path and what happened to it, so the denominator is visible rather than asserted. */
export function scopeSourceLine(source: CoverageScopeSource): string {
  const label = isNotFullyReadYet(source)
    ? NOT_FULLY_READ_YET_LABEL
    : readStateLabel(source.readState);
  return `${source.sourcePath} — ${label}`;
}

/**
 * The sentence for the sources not fully read yet. The plural is `[D-448]`'s own, verbatim; the
 * singular is a Class B default derived from it (`ol-egov.141.89.8.44`).
 */
export function notFullyReadSentence(n: number): string {
  return n === 1
    ? 'One of your sources is not fully read yet: some pages or transcript parts are still waiting to be read, so this list may grow.'
    : `${n} of your sources are not fully read yet: some pages or transcript parts are still waiting to be read, so this list may grow.`;
}

function countedSources(n: number): string {
  return n === 1 ? '1 source' : `${n} sources`;
}

/**
 * What this pass actually read, in sentences.
 *
 * Every non-read state gets its own sentence with its own reason, because the
 * user-visible consequence differs: a source that opened empty backs no claim,
 * a source that could not be read leaves a hole of unknown size, and a source
 * no reader covers was never in scope at all. A single "some sources were
 * skipped" would restore exactly the ambiguity the bead removes.
 */
export function coverageScopeStatement(scope: CoverageScope): readonly string[] {
  const total = scope.sources.length;
  const lines: string[] = [];

  if (total === 0) {
    return [
      'Olea has read none of your sources for this exam. Nothing below is a finding about your notes.',
    ];
  }

  // `[D-448]`: a source with a page still waiting is not read in full, so it is neither counted
  // among the sources read nor said to have no reader; it has its own sentence below.
  const notFullyRead = scope.sources.filter(isNotFullyReadYet).length;
  const readInFull = scope.sources.filter(
    (s) => s.readState === 'read' && !isNotFullyReadYet(s),
  ).length;

  if (readInFull === 0 && notFullyRead > 0) {
    // Nothing read in full but pages are only waiting: "could not read any" would be untrue, so the
    // sentence below stands alone.
  } else if (readInFull === 0) {
    lines.push(
      total === 1
        ? 'Olea could not read your one source for this exam. Nothing below is a finding about your notes.'
        : `Olea could not read any of your ${countedSources(total)} for this exam. Nothing below is a finding about your notes.`,
    );
  } else if (readInFull === total) {
    lines.push(
      total === 1
        ? 'Read your one source for this exam.'
        : `Read all ${countedSources(total)} for this exam.`,
    );
  } else {
    lines.push(`Read ${readInFull} of your ${countedSources(total)} for this exam.`);
  }

  if (scope.yieldedNothingCount > 0) {
    lines.push(
      scope.yieldedNothingCount === 1
        ? 'One opened but had nothing in it to read.'
        : `${scope.yieldedNothingCount} opened but had nothing in them to read.`,
    );
  }
  if (scope.unreadableCount > 0) {
    lines.push(
      scope.unreadableCount === 1
        ? 'One could not be read at all — a scan, or a file Olea cannot open yet.'
        : `${scope.unreadableCount} could not be read at all — scans, or files Olea cannot open yet.`,
    );
  }
  if (notFullyRead > 0) lines.push(notFullyReadSentence(notFullyRead));
  // `[D-196]`'s structural reason stays, said only of a source no reader covers: a source with a
  // page still waiting has its own sentence above.
  const noReader = scope.sources.filter(
    (s) => s.readState === 'not-attempted' && !isNotFullyReadYet(s),
  ).length;
  if (noReader > 0) {
    lines.push(
      noReader === 1
        ? 'One was not read on this pass: Olea has no reader for its kind yet.'
        : `${noReader} were not read on this pass: Olea has no reader for their kind yet.`,
    );
  }

  if (!scope.canStateExhaustiveness) {
    lines.push('So this list covers what was read, and nothing else.');
  }
  return lines;
}

/**
 * The closing line — **ratified copy**, and `null` whenever the scope does not
 * grant the claim.
 *
 * Returning `null` rather than a hedged variant is the whole design: a hedged
 * exhaustiveness claim is the unscoped claim with hedging words added, which is
 * the same bet, worse written. When the claim is unavailable the scope
 * statement above is what she reads instead, and it says what is actually
 * known.
 *
 * The noun follows the sources: "past papers" exactly when every source read
 * was one — which is the case the line was ratified for — and "sources"
 * otherwise, rather than calling an objectives document a past paper to keep a
 * sentence intact.
 */
export function coverageClosingLine(scope: CoverageScope): string | null {
  if (!scope.canStateExhaustiveness) return null;
  const allPastPapers = scope.sources.every((s) => s.role === 'past-paper');
  const n = scope.readCount;
  const noun = allPastPapers
    ? n === 1
      ? 'the one past paper'
      : `the ${n} past papers`
    : n === 1
      ? 'the one source'
      : `the ${n} sources`;
  return `Nothing else in ${noun} we could read is missing from your materials.`;
}

/**
 * The coverage screen's copy, in render order.
 *
 * **The empty case is why this function exists.** With no gap rows, the screen
 * must say which of the two very different things happened, and it must say it
 * in text: nothing was missing in what we read, or we did not read it all. A
 * caller cannot render a bare reassurance through this path because there is no
 * branch here that produces one.
 */
export function coverageScreenCopy(input: {
  readonly scope: CoverageScope;
  readonly gapRowCount: number;
}): readonly string[] {
  const { scope, gapRowCount } = input;
  const lines: string[] = [];

  // Three states, not two. When nothing was read at all, "no gaps found" is
  // omitted entirely rather than qualified: there was no search, so reporting
  // its result — however hedged — is the exact sentence this bead rejects. The
  // scope statement below is the whole of what is known in that case.
  if (gapRowCount === 0 && scope.readCount > 0) {
    lines.push(
      scope.canStateExhaustiveness
        ? 'No gaps found in what Olea read.'
        : 'No gaps found in what Olea could read — and it could not read all of it.',
    );
  }

  lines.push(...coverageScopeStatement(scope));

  const closing = coverageClosingLine(scope);
  if (closing !== null) lines.push(closing);

  return lines;
}

// ---------------------------------------------------------------------------
// The enumeration David reviews, and the F4.9 audit runs over
// ---------------------------------------------------------------------------

/**
 * Every fixed string and label this module can produce.
 *
 * Derived sentences are not enumerable in the abstract, so `copy.spec.ts`
 * exercises those against representative models and audits the results with the
 * same rules. `ol-f49h` records exactly why this list is not itself the audit:
 * *"the list is where strings are RECORDED, not where they are CHECKED. An
 * inventory is not an audit."*
 */
export function allGapStrings(): readonly string[] {
  return [
    GAP_VIEW_TITLE,
    COVERAGE_VIEW_TITLE,
    MATERIAL_GAP_HEADING,
    COVERAGE_GAP_HEADING,
    GAP_UNAVAILABLE_TITLE,
    GAP_UNAVAILABLE_BODY,
    GAP_UNAVAILABLE_RETRY_LABEL,
    GAP_UNAVAILABLE_EYEBROW,
    FULL_SYLLABUS_ADVICE,
    GAP_DETAIL_BACK_LABEL,
    ...Object.values(AFFORDANCE_LABELS),
    ...Object.values(READ_STATE_LABELS),
  ];
}
