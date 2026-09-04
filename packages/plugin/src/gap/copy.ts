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
 * **INV-1.** No `obsidian` import here — this module is unit-tested, which is
 * the entire point of it being separate from `view.ts`.
 */

import type {
  CoverageScope,
  CoverageScopeSource,
  EvidenceQuestionCitation,
  GapAffordance,
  GapCourseView,
  GapRow,
  SourceReadState,
  VaultPath,
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
 */
export const MATERIAL_GAP_HEADING = 'Named by your past papers, missing from your materials';

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
 * The gap view's ranking attribution — F4.9 half one's fix.
 *
 * Derived from the citations actually behind the rows, so the sentence names a
 * number of documents that exist and were read. Past tense, and the subject is
 * always the prior papers: the assessment ahead is never the thing that asked.
 */
export function rankingAttribution(rows: readonly GapRow[]): string {
  const sources = new Set<string>();
  for (const row of rows) for (const citation of row.citations) sources.add(citation.sourcePath);
  const n = sources.size;
  if (n === 0) {
    // Reachable whenever a ranked entry's citations are empty. Says what is
    // true of that state instead of borrowing the sentence for the other one.
    return 'Ranked by the evidence behind these concepts — no past paper is cited here.';
  }
  if (n === 1) return 'Ranked by what 1 past paper of yours has asked.';
  return `Ranked by what ${n} past papers of yours have asked.`;
}

/**
 * The framing paragraphs shown above any ranking, in order.
 *
 * The full-syllabus advice is emitted here, from the ranked state, so "present
 * wherever a ranking is shown" is a property of the code path rather than of a
 * caller's diligence.
 */
export function rankedCourseFraming(rows: readonly GapRow[]): readonly string[] {
  return [rankingAttribution(rows), FULL_SYLLABUS_ADVICE];
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
    parts.push(`${noMaterial} with no material`);
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
 * One gap row's sentence, per class.
 *
 * The material-gap line is **ratified copy**, with its count derived rather
 * than hard-coded. Its second clause is a statement about what was ingested,
 * not a judgement about her notes, and it is phrased that way deliberately.
 *
 * A mastery-gap row shows the oracle's own mechanically-assembled reasoning
 * verbatim — this module does not re-narrate a string that exists precisely so
 * that "the reasoning matches what actually drove the order" stays testable.
 */
export function gapRowLine(row: GapRow): string {
  switch (row.gapClass) {
    case 'material-gap':
      return `Appears in ${paperCount(row.distinctSourceCount)}; it isn't in your materials.`;
    case 'coverage-gap':
      return `Appears in ${paperCount(row.distinctSourceCount)}; you have notes on it but no cards yet.`;
    case 'mastery-gap':
      return row.reasoning;
  }
}

// ---------------------------------------------------------------------------
// pass5g's past-paper chips (`[D-224]`) — named, never divided
// ---------------------------------------------------------------------------

/** The label above a row's chip strip — F4.9's "counted, never divided" applied to the prefix too. */
export function pastPapersLabel(distinctSourceCount: number): string {
  return `Asked in ${paperCount(distinctSourceCount)}:`;
}

/**
 * One past-paper citation's chip — its own filename (R2, verbatim; her
 * vault's own naming, not a derived slug) paired with the question label, so
 * the same paper cited on two questions still reads as one paper rather than
 * a repeated, unnamed source.
 *
 * **Deliberately no invented date.** The kit's chip reads "June 2024 · Q3";
 * `Source` (`olea-core`) carries no sitting-date field, and there is no
 * reader for one — so this names what is actually known (the file, verbatim)
 * rather than parsing a date out of a filename that might not encode one.
 * Widening `Source` to carry a real sitting date is a data-model change this
 * bead's `owns` (view/copy/provider) does not reach; filed separately.
 */
export function pastPaperChipLabel(citation: EvidenceQuestionCitation): string {
  const path: VaultPath = citation.sourcePath;
  const file = path.slice(path.lastIndexOf('/') + 1);
  const name = file.replace(/\.[^./]+$/, '');
  return `${name} · ${citation.questionLabel}`;
}

/** A row's chip strip, in citation order — `citations` is never empty for a ranked entry (`GapRow`'s own doc). */
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

/** One source's row in the scope list — path and what happened to it, so the denominator is visible rather than asserted. */
export function scopeSourceLine(source: CoverageScopeSource): string {
  return `${source.sourcePath} — ${readStateLabel(source.readState)}`;
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

  if (scope.readCount === 0) {
    lines.push(
      total === 1
        ? 'Olea could not read your one source for this exam. Nothing below is a finding about your notes.'
        : `Olea could not read any of your ${countedSources(total)} for this exam. Nothing below is a finding about your notes.`,
    );
  } else if (scope.readCount === total) {
    lines.push(
      total === 1
        ? 'Read your one source for this exam.'
        : `Read all ${countedSources(total)} for this exam.`,
    );
  } else {
    lines.push(`Read ${scope.readCount} of your ${countedSources(total)} for this exam.`);
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
  if (scope.notAttemptedCount > 0) {
    lines.push(
      scope.notAttemptedCount === 1
        ? 'One was not read on this pass: Olea has no reader for its kind yet.'
        : `${scope.notAttemptedCount} were not read on this pass: Olea has no reader for their kind yet.`,
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
    ...Object.values(AFFORDANCE_LABELS),
    ...Object.values(READ_STATE_LABELS),
  ];
}
