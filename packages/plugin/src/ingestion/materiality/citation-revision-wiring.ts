/**
 * `CitationRevisionTrigger` / `buildCitationRevisionWiring` — `[CORP-3b]`'s
 * (`ol-2zfj.35`) production caller: the plugin-side reader
 * `packages/core/src/concept/revision/material-change.ts`'s own module doc
 * names as unbuilt ("a vault-reading caller, plugin-side, unbuilt — see this
 * bead's close notes for the exact hook").
 *
 * ===========================================================================
 * SCOPE: MCQ, Q&A AND CLOZE, ONE BATCH PASS PER TICK — READ BEFORE EXTENDING
 * ===========================================================================
 * `[D-093]`'s own scenario text says a changed cited passage "gets the model
 * read at the next BATCH PASS" — not on every keystroke. This trigger runs
 * from the same periodic interval `main.ts` already drives
 * `tickIngestionAndMaybeRunCorpusRelations`/`drainEmbeddings` from
 * (`INGESTION_TICK_INTERVAL_MS`), doing one whole-vault
 * `enumerateVaultInstruments` walk per tick — never per `'modify'` event, the
 * way row 1.4's file-level `MaterialityTrigger` does. That is deliberate:
 * `evaluateCitedPassageRevision`'s `'not-found'` branch needs a genuinely
 * vault-wide check before it can honestly report a passage gone (a per-file
 * incremental check cannot tell "deleted" from "moved to a file that hasn't
 * been re-scanned yet") — see `citation-hash-store.ts`'s module doc for the
 * identity reasoning behind that, so a batch pass is not merely acceptable
 * here, it is what the free/paid split's own performance shape already
 * assumes.
 *
 * ===========================================================================
 * `[D-366]`/`[D-398]` — EVERY FORMAT IS TRACKED, EXCEPT WHEN SELF-CONTAINED
 * ===========================================================================
 * Every instrument type is tracked — `evaluateCitedPassageRevision`,
 * `buildSuccessorRevisionEnqueueInput` and `InstrumentRevisionJobPayload`
 * never assumed MCQ (they key everything by `instrumentId` and plain text)
 * — **except** when it is exempt under `[D-366]` (David, 2026-09-25, ruled
 * on `ol-v7r5.83`, extended to MCQ by `[D-398]`, ruled 2026-09-27 on
 * `ol-v7r5.97`): "editing a self-contained, learner-authored card should
 * update that card without automatic suspension... use actual source
 * dependencies and authorship, never file location." `[D-398]`'s own
 * binding conditions: the exemption rests on authorship and actual source
 * dependency, never file location alone, for EVERY format; an item citing a
 * passage other than itself — even one that happens to sit in its own note
 * — stays tracked; a generated item sharing a note with its source is not
 * exempt either. MCQ was previously unconditional (`ol-v7r5.68`'s own
 * scope); `[D-398]` removes that carve-out.
 *
 * `isTrackedForRevision` below is that rule, decided from ONE recorded
 * signal — `sourceProvenance`'s mere presence, never `citedPassagePath`'s
 * `sourcePath === notePath` fallback (that decides only WHICH text to diff
 * for an instrument already known to be tracked; it is not itself an
 * authorship test, and using it as one is exactly the bug `[D-398]` names:
 * "a card citing a separate passage in the same note, or a generated card
 * whose citation names the note it sits in, can be exempt" under the old,
 * file-location-shaped test). `sourceProvenance` absent is `[D-366]`'s
 * "self-contained, learner-authored" case: nothing mints a citation sidecar
 * for a hand-authored instrument, of any format (`enumerate.ts`'s own doc).
 * `sourceProvenance` present — even self-referential, naming the
 * instrument's own note (`materialize-card.ts`'s own `[D-366]` Class B
 * write) — means a generation pipeline minted it, so the item is tracked
 * regardless of where that citation points: a genuine dependency on
 * separate material stays trackable, and a generated item merely sharing a
 * note with its source is never mistaken for self-contained again. See
 * `isTrackedForRevision`'s own doc for the one format where this signal is
 * not yet fully verified (MCQ), and `report.authorshipUnverified` for how
 * that residual risk is counted rather than silently accepted or blocked
 * on.
 *
 * The `[D-133]` predecessor/successor chain a `'revised'` outcome enqueues
 * stays enqueue-only here for every instrument type — this file never
 * generates a successor, only asks the existing ingestion queue to
 * (`CitationRevisionActions.enqueue`'s own doc). **Generating one for a Q&A
 * or cloze predecessor is not yet wired end to end**: `materialize-card.ts`
 * has no `predecessorInstrumentId` parameter today (its own module doc:
 * "drafts a card REVISION yet, so `predecessorInstrumentId` has no
 * producer"), and `revision-job-runner.ts` drafts every successor through
 * `draftQuizCardsForConcept` regardless of the predecessor's original
 * `instrumentType` — both outside this bead's `owns`, reported rather than
 * changed here (see this bead's hand-back notes).
 *
 * ===========================================================================
 * "THE CITED PASSAGE" — WHAT THIS CALLER FEEDS `evaluateCitedPassageRevision`
 * ===========================================================================
 * See `citation-hash-store.ts`'s module doc for the full Class B reasoning.
 * In one line: an instrument's cited passage is its home note's own text
 * with every instrument block's span stripped out
 * (`citation-material.ts`'s `stripInstrumentSpans`) — never the instrument's
 * own wording. That keeps the predecessor instrument physically unchanged in
 * the vault when a `'revised'` outcome suspends it (a real, still-present
 * block gets suspended, not one whose bytes a judge call just rewrote), at
 * the cost of every TRACKED instrument sharing one note reacting to the same
 * material delta rather than to its own individually-nearest passage — every
 * format alike, only when it is tracked at all (see the `[D-366]`/`[D-398]`
 * section above: a self-contained one, MCQ included since `[D-398]`, is
 * exempt, so this shared-note cost never reaches it).
 *
 * **Exception, since `[D-179]`/`[D-214]` split an instrument's home note from
 * its actual source (`ol-0r92.46`): when `sourceProvenance.sourcePath` names
 * a markdown note distinct from `notePath`, THAT note's raw text is the
 * cited passage instead — never home-note-minus-spans.** Before that split,
 * an instrument's home note and its cited material were the same file, so
 * "home note minus instrument spans" and "the material" were one and the
 * same text; a bare-dropped source (`[D-179]`) or an authored note
 * (`[D-214]`) puts the instrument in a *sibling* home note that never
 * carries her material at all — that note's own text never changes when she
 * edits her real note, so the pre-existing rule left every split-home-note
 * instrument's cited passage permanently "unchanged," silently. The home
 * note itself is never the source in that shape; `citedPassagePath` below is
 * the one seam that decides which file to read. The check is markdown-only
 * (`isMarkdownVaultPath`) so a bare PDF/PPTX/DOCX/image source — whose
 * `sourceProvenance.sourcePath` names a binary this module cannot diff as
 * text — keeps the pre-existing home-note-minus-spans behaviour unchanged;
 * only an authored note's own source note is ever substituted in.
 *
 * ===========================================================================
 * `[D-446]` PASSAGE GRAIN — WHEN THE CITATION CARRIES A PASSAGE DIGEST
 * (`ol-egov.141.89.5.32`)
 * ===========================================================================
 * Everything above describes the WHOLE-NOTE grain, which stays exactly as it was for every
 * instrument whose citation carries no `passageDigest`. For one that does — minted at authoring
 * by the shared segmentation rule (`olea-core`'s `source/passage-identity.ts`, called from
 * `materialize-mcq.ts`/`materialize-card.ts`) — the first pass baselines the anchor AT that
 * passage (`CitationAnchorRecord.text` is the passage, `.passageDigest` its versioned digest), and
 * every later pass asks `passage-grain.ts`'s `resolveAnchoredPassage` where the passage stands
 * now. A note edited elsewhere, or the passage moved, reformatted or healed to another note, is
 * settled there with NO judge call; only a passage whose own words changed, and which nothing
 * else in its note resembles, reaches the judge, as an old-passage/new-passage pair. What cannot
 * be located — gone, the same text standing twice, a retired rule — is left UNRESOLVED and
 * WITHHELD before its next presentation with its own recorded reason (`PendingRevalidation.reason`:
 * `passage-missing`, `passage-ambiguous`, `passage-rule-unsupported`), which is distinct from a
 * change confirmed by the judge (suspension) and from a check still awaiting or failing to reach
 * the judge (a pending fact with no reason); none of the three reads as another. The withholding
 * never enters the `[D-400]` dispatch budget, and lifts the pass the passage is found again.
 * Where no digest resolves to exactly one passage at first sighting (`report.passageSeedUnresolved`),
 * the question is WITHHELD (`[D-514]`, `ol-egov.141.89.5.71`): an anchor with no passage text and the
 * pending fact for the reason; the edited note is never baselined in the passage's place.
 *
 * ===========================================================================
 * `[D-400]` — ONE AUTOMATIC RETRY PER ORIGINAL CHECK, NEVER A FRESH
 * ALLOWANCE ON RESTART; A PROVIDER ERROR IS RECOVERED THE SAME WAY
 * ===========================================================================
 * Without this section, `evaluateCitedPassageRevision` dispatches to the
 * judge on EVERY tick for as long as a real difference sits unresolved
 * (`material-change.ts`'s own doc: its pending-fact recording is
 * unconditional, and so, once a judge is configured, is the dispatch right
 * after it) — whether the previous dispatch was lost to the app closing
 * mid-`await`, or a provider failure this loop's own outer `catch` below
 * swallowed and `continue`d past. Unbounded, silent, unmetered retries
 * either way. `[D-400]` (ruled 2026-09-27, gate case `CHG-57f55b30941e3290`,
 * "restart with an escalation pending") bounds this to exactly ONE automatic
 * retry per original check, tracked on the SAME `PendingRevalidation` record
 * `[D-351]` already keys to the difference being checked
 * (`citation-hash-store.ts`'s own `[D-400]` doc: `dispatchedAt`/`retriedAt`).
 *
 * The gate below runs right before the step that would dispatch: if the
 * PERSISTED fact for this exact difference already carries a spent retry
 * (`retriedAt` set), no further dispatch fires — ever, no matter how many
 * more restarts happen — and the tick counts it under `report.retryExhausted`
 * instead. Otherwise it dispatches — recording the attempt BEFORE the
 * (re-)dispatch itself, so the budget is spent even if this attempt ALSO
 * throws or is itself lost — as the original check when nothing has been
 * dispatched yet for this exact difference, or as the one permitted retry
 * when a dispatch is already recorded and still unresolved.
 *
 * **No age/timeout check gates the retry.** Every step in this trigger's own
 * per-instrument loop is fully `await`ed before the next one starts, so the
 * only way a NEW `tick()` call ever observes a still-unresolved dispatch
 * from an EARLIER one is that the earlier attempt has already concluded one
 * way or another by the time it did — a lost call (a restart mid-`await`, or
 * a provider failure this loop's own `catch` swallowed), or a genuine answer
 * whose RESOLVING write itself failed (`applyOutcome`'s own per-write
 * `catch` blocks). Retrying immediately is correct in every one of those
 * cases; artificially waiting would only delay an ordinary write-retry that
 * has nothing to do with the judge at all. The one theoretical exception —
 * two `tick()` calls truly overlapping in execution, `main.ts`'s own fixed
 * interval firing before the previous pass resolved — is the SAME accepted,
 * rare, at-least-once cost this file's `'revised'` outcome already takes for
 * a duplicate suspend/enqueue attempt; it is not a correctness failure here
 * either, since the retry budget still bounds the total to two attempts.
 *
 * **This supersedes `[D-343]`'s "an unavailable verdict counts as confirmed
 * changed" for exactly this lost-call case**: instead of confirming the
 * change once the retry also goes unanswered, the item stays pending and
 * `[D-400]` calls for a recoverable deferred state rather than a silent
 * withholding — `report.retryExhausted` is the only signal this file raises
 * for that; the wording, its registered term, and any new persisted or
 * served shape for actually SHOWING that state to her are not settled by
 * `[D-400]` and are not built here (see this bead's hand-back notes).
 * `[D-343]` is otherwise unchanged: a real `material`/`uncertain`/judge-
 * returned-`unavailable` verdict still confirms the change exactly as
 * before, and the D-311 obsolete-answer guard (`isPendingRevalidationCurrent`)
 * applies to a retry's own late answer exactly as it already does to an
 * original one — no changes needed there.
 *
 * ===========================================================================
 * AN OUTAGE NEVER SPENDS THE `[D-400]` BUDGET — THE BOUND IS PER REACHABLE
 * ATTEMPT (`ol-egov.141.89.5.33`)
 * ===========================================================================
 * `[D-400]`'s bound is ONE retry PER ORIGINAL CHECK, deliberately shared
 * between a call truly lost (a restart mid-`await`) and "a provider failure
 * this loop's own outer `catch` below swallowed" — see the section above.
 * But a `WorkerMaterialityJudge` call made while the Worker is flatly
 * UNREACHABLE (no connection at all, not a configured-but-erroring Worker)
 * is not a check that was ever really attempted — the moment F runner host
 * found that the pre-existing code could not tell the two apart, so an edit
 * made during an outage could spend both the original check AND the retry
 * before the Worker was ever reachable, leaving it stuck in the
 * `retryExhausted` state forever with no automatic dispatch ever reaching
 * the Worker — `[D-400]`'s own condition 4 ("a recoverable deferred state")
 * was never actually earned for that item.
 *
 * `deps.isOnline` (optional, defaults to `() => true` — the same permissive
 * default `ingestion/process-now.ts`'s own `isOnline` takes for tests and an
 * unwired caller; production `main.ts` supplies `() => navigator.onLine`,
 * the identical source `[D-420]`'s own `registry/deferred-recheck-retry.ts`
 * already uses for the SAME reachability question) is read once per `tick()`
 * call below and gates the DISPATCH half only: `[D-400]`'s `retryExhausted`
 * accounting (a difference whose retry is already spent) is untouched by
 * reachability — a genuinely spent budget stays spent, offline or not — but
 * a NOT-YET-exhausted difference records no dispatch and never reaches
 * `judge.judge()` while offline, taking the ordinary `'judge-unavailable'`
 * outcome instead (exactly `evaluateCitedPassageRevision`'s own `judge ===
 * null` branch: the pending fact is still recorded per `[D-351]`, nothing
 * else advances, and the SAME delta is retried — for real, this time — on
 * the first tick after `isOnline()` reads true again). No new persisted
 * field: `deps.isOnline` reads a live signal each call, so an in-memory-only
 * "was this dispatch actually attempted while reachable" concept, matching
 * this bead's scope (the plugin staying running; a restart mid-outage is
 * `[D-427]`'s separate, open question, not this one).
 */

import {
  buildSuccessorRevisionEnqueueInput,
  type CitedPassageRevisionOutcome,
  type Clock,
  type CurrentPassageState,
  digestPassage,
  type EnqueueInput,
  enumerateVaultInstruments,
  evaluateCitedPassageRevision,
  hashContent,
  hashText,
  locatePassageByDigest,
  PASSAGE_RULES,
  type PassageRule,
  type PendingRevalidationRecorder,
  parsePassageDigest,
  projectInstrumentValidity,
  type RelocationCandidate,
  type RevisionJudgeInput,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  readInstrumentCitation,
  readReviewLogHistory,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';
import type {
  CitationAnchorRecord,
  CitationHashStore,
  PendingReason,
} from './citation-hash-store.js';
import { stripInstrumentSpans } from './citation-material.js';
import {
  type PassageNotes,
  type PassageResolution,
  resolveAnchoredPassage,
} from './passage-grain.js';
import type { MaterialityJudge } from './types.js';

/** `RevisionJudgePort` is `{previousText, currentText}` only; `MaterialityJudge` also requires `path`, unused inside `WorkerMaterialityJudge.judge` (see that file's own doc: "`path` never leaves this method"). Adapts explicitly rather than relying on TS's method-bivariance to paper over the shape gap. */
export function adaptMaterialityJudgeAsRevisionJudge(
  judge: MaterialityJudge | null,
): RevisionJudgePort | null {
  if (judge === null) return null;
  return {
    judge: (input: RevisionJudgeInput): Promise<RevisionJudgeVerdict> =>
      judge.judge({ path: 'citation-revision', ...input }),
  };
}

export interface CitationRevisionTickReport {
  readonly tracked: number;
  readonly revised: number;
  readonly refreshed: number;
  readonly relocated: number;
  readonly relocationProposed: number;
  readonly stranded: number;
  readonly judgeUnavailable: number;
  readonly newlyBaselined: number;
  /**
   * Defect 5 (`ol-egov.141.89.5.7`): a passage whose raw text changed but
   * whose canonicalised text did not — a reformat, never a content change —
   * exited free, the same "exact-equivalence exits apply at the citation
   * grain too" row 1.4's file-level trigger already gives (chg.md sec 2).
   * Never a judge call, never a dependant invalidation.
   */
  readonly formattingOnly: number;
  /**
   * `[D-351]`: a verdict was computed against an EARLIER content hash, but
   * this instrument's persisted pending-revalidation fact has since moved on
   * to a newer one — a late result for an earlier edit, once a newer edit
   * has already raised its own pending state (only possible when two ticks
   * overlap: `main.ts`'s `tickCitationRevisions` fires on a fixed interval
   * without waiting for the previous pass, `main.ts:1985-2005`). Discarded
   * rather than acted on: no suspend, no enqueue, no restore-to-current
   * write. The newer edit gets its own evaluation, and its own verdict, on a
   * later pass.
   */
  readonly staleResultDiscarded: number;
  /**
   * `[D-366]`: how many Q&A/cloze instruments THIS PASS found self-contained
   * — no `sourceProvenance` recorded at all — and therefore exempt from
   * tracking under this trigger altogether. Counted, never tracked, never
   * baselined, never sent to the judge: her own self-contained card follows
   * her own edit with no automatic suspension. See `isTrackedForRevision`'s
   * own doc for exactly what this can and cannot tell apart. MCQ never
   * contributes to this count — an exempt MCQ is counted separately, by
   * `authorshipUnverified` below, since the underlying signal is not yet as
   * reliable for that format.
   */
  readonly exemptSelfContained: number;
  /**
   * `[D-398]`: how many MCQ instruments THIS PASS exempted from tracking on
   * the same absent-`sourceProvenance` signal `exemptSelfContained` uses for
   * Q&A/cloze — counted separately because that signal is not yet fully
   * verified for MCQ. `materialize-card.ts`'s own `[D-366]` Class B fix
   * makes a Q&A/cloze card's generation pipeline always write a citation
   * sidecar, self-referential at minimum, so an absent `sourceProvenance`
   * reliably means hand-authored for that format. MCQ's own generation path
   * (`materialize-mcq.ts`) still writes its citation sidecar only when
   * `input.sourceCitation` is supplied, so an absent `sourceProvenance`
   * cannot yet rule out "generated, but the pipeline's own defensive
   * no-matching-unit fallback fired" (`materialize-card.ts`'s own doc on
   * `pipeline.ts`'s `sourceCitation`: that fallback "SHOULD NOT HAPPEN",
   * never a designed outcome, given a real generated question is always
   * grounded against a retrieved unit first). `[D-398]` rules: exempt this
   * MCQ anyway rather than keep every one tracked against a defensive-only
   * theoretical risk, but count it here so that risk stays observable
   * rather than silently accepted — never acted on further by this file;
   * see this bead's hand-back notes for the follow-up that would close the
   * gap (writing a self-referential MCQ citation the same way
   * `materialize-card.ts` already does for Q&A/cloze).
   */
  readonly authorshipUnverified: number;
  /**
   * `[D-400]`: how many tracked instruments THIS PASS found with a real,
   * still-unresolved difference whose one permitted automatic retry has
   * already fired and also gone unanswered — never a further automatic
   * dispatch for these. See this module's own `[D-400]` doc section: the
   * wording, registered term and any served shape for showing this to her
   * are not built here; this count is the hook a presentation-side lane can
   * read.
   */
  readonly retryExhausted: number;
  /**
   * `[D-446]` option (a) (`ol-egov.141.89.5.32`), passage grain: how many passage-tracked
   * instruments THIS PASS could not settle because the same text stands in two or more places, or
   * more than one segment resembles an edited passage. Withheld with the reason
   * `passage-ambiguous`; no judge call, no change claimed (row 45).
   */
  readonly passageAmbiguous: number;
  /**
   * The anchor's segmentation rule version is no longer registered and the passage could not be
   * re-found cleanly under the current one. Withheld as `passage-rule-unsupported`.
   */
  readonly passageRuleUnsupported: number;
  /**
   * A citation carried a passage digest that could not be resolved to exactly one passage at first
   * sighting (ambiguous, absent, or an unsupported rule); the instrument fell back to the legacy
   * whole-note baseline rather than guessing a passage.
   */
  readonly passageSeedUnresolved: number;
  /**
   * `ol-egov.141.89.5.77`: a confirmed rewrite (the judge's answer already acted on) whose suspend
   * or enqueue kept failing and was given up on after `SUCCESSOR_RETRY_BOUND` attempts. Counted
   * here and logged once; the question stays withheld ([D-508]), never restored. No user-visible
   * surface.
   */
  readonly successorEnqueueFailed: number;
  /**
   * `ol-egov.141.89.5.73` ([D-515]): a question whose cited source is a non-markdown file whose
   * current bytes no longer match the sidecar's `sourceRevision` (or that could not be checked),
   * withheld with {@link SOURCE_REVISION_REASON}.
   */
  readonly sourceBytesChanged: number;
}

/**
 * `ol-egov.141.89.5.73` ([D-515]): the pending-fact reason written for a non-markdown source whose
 * bytes differ from the recorded `sourceRevision`, or that cannot be checked. A string outside
 * `PendingReason`: `[D-473]`'s tolerant reader keeps it and the hold stands. A new reason value is
 * a contract-level choice, flagged for review.
 */
export const SOURCE_REVISION_REASON = 'source-revision-changed';

/**
 * `ol-egov.141.89.5.77`: how many times in all (the first attempt included) a confirmed rewrite's
 * suspend-then-enqueue step is tried across passes before the failure is recorded and given up.
 */
const SUCCESSOR_RETRY_BOUND = 5;

/** A confirmed rewrite whose suspend or enqueue failed, remembered (in memory) so later passes retry it with no judge call. */
interface ConfirmedRewrite {
  readonly judgedContentHash: string;
  readonly conceptIds: readonly string[];
  readonly predecessorInstrumentId: string;
  readonly successorEnqueueInput: EnqueueInput;
  attempts: number;
  gaveUp: boolean;
}

/** What the tick needs to act on outcomes — supplied per call, since both need a real, freshly-built `vault`/`deviceId` the same way `main.ts`'s other periodic ticks build their own rather than closing over `onload`'s. */
export interface CitationRevisionActions {
  /** Admits the successor draft into the SAME `IngestionQueueEngine` the F3.3 sweep already drains — `[D-133]`'s confirmation-queue admission. Errors are caught by `tick`, never thrown into the interval. */
  readonly enqueue: (input: EnqueueInput) => Promise<unknown>;
  /** Writes the predecessor's `kind: 'suspend'` review-log record (existing suspend kind, no new field — `review-log/write.ts`'s `appendSuspendRecord`). */
  readonly suspend: (instrumentId: string, conceptIds: readonly string[]) => Promise<void>;
  /**
   * Best-effort notice that a re-bind needs her confirmation
   * (`'relocation-proposed'`) — `[D-093]` forbids healing this silently, but
   * *surfacing* it is the structural-proposal registry's own admission path
   * (`features/F3-learn-from-anything.md`'s `core/accept/*` cluster), a
   * different lane's `owns`. Never awaited, never thrown into the tick.
   */
  readonly onRelocationProposed?: (instrumentId: string, candidate: RelocationCandidate) => void;
}

export interface CitationRevisionTriggerDeps {
  readonly store: CitationHashStore;
  readonly judge: RevisionJudgePort | null;
  readonly clock: Clock;
  /**
   * See this module's own "AN OUTAGE NEVER SPENDS THE `[D-400]` BUDGET" doc
   * section above. Defaults to `() => true` (always reachable) — the same
   * permissive default `ingestion/process-now.ts`'s own `isOnline` takes —
   * so every existing caller and test that supplies no value keeps today's
   * behaviour unchanged.
   */
  readonly isOnline?: () => boolean;
  /**
   * The passage segmentation rules this trigger can read (`olea-core`'s `PASSAGE_RULES`, the
   * production registry, when omitted). Injectable so a test can prove what a rule change does.
   */
  readonly passageRules?: readonly PassageRule[];
}

/** Same rule `process-now.ts`'s own private `isMarkdownPath` uses; duplicated rather than imported since that module doesn't export it and this one has no other reason to depend on `ingestion/process-now.ts`. */
function isMarkdownVaultPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** `[D-515]`: true when the instrument's citation names a non-markdown file other than its own note. */
function citesBinarySource(record: VaultInstrumentRecord): boolean {
  const sourcePath = record.sourceProvenance?.sourcePath;
  return (
    sourcePath !== undefined && sourcePath !== record.notePath && !isMarkdownVaultPath(sourcePath)
  );
}

/**
 * The file whose raw text is "the cited passage" for one instrument — see
 * this module's own doc, "THE CITED PASSAGE," for the exception this
 * implements. `sourceProvenance` is `undefined` for a hand-authored
 * instrument (nothing mints a citation sidecar for those) and for a
 * generated one no sidecar-writer has cited yet — both fall through to the
 * pre-existing `notePath` rule, unchanged. Instrument-type-agnostic since
 * `[D-366]` (`sourceProvenance` lives on `VaultInstrumentCommon`, shared by
 * every instrument type — `session/types.ts`).
 */
export function citedPassagePath(record: VaultInstrumentRecord): VaultPath {
  const sourcePath = record.sourceProvenance?.sourcePath;
  if (
    sourcePath !== undefined &&
    sourcePath !== record.notePath &&
    isMarkdownVaultPath(sourcePath)
  ) {
    return sourcePath;
  }
  return record.notePath;
}

/**
 * `[D-366]`/`[D-398]` — whether an instrument is tracked under `[D-093]`'s
 * passage-change auto-suspension at all. See this module's own "`[D-366]`/
 * `[D-398]`" doc section above for the full ruling and its limits; this is
 * that rule, in code, uniform across every instrument type.
 *
 * Tracked whenever `sourceProvenance` is recorded at all — a generation
 * pipeline minted it (`enumerate.ts`'s own doc: nothing mints one for a
 * hand-authored instrument), so the item is not learner-authored and stays
 * tracked REGARDLESS of what it names: {@link citedPassagePath}'s
 * `sourcePath === notePath` fallback decides only which text to diff for a
 * tracked instrument, never whether it is tracked. This is the fix
 * `[D-398]` names: the old test used `citedPassagePath(record) !==
 * record.notePath` as the tracking decision itself, which wrongly exempted
 * a generated instrument whose citation happened to name its own note (a
 * self-referential citation, or a same-note passage) — a file-location
 * proxy, not an authorship signal.
 *
 * Exempt only when `sourceProvenance` is entirely absent — `[D-366]`'s
 * "self-contained, learner-authored" case. For Q&A/cloze this is a reliable
 * signal: `materialize-card.ts`'s own `[D-366]` Class B fix makes that
 * format's generation pipeline always write a citation sidecar, self-
 * referential at minimum, so absence there really does mean hand-authored.
 * **Not yet fully verified for MCQ**: `materialize-mcq.ts`'s own citation
 * write stays conditional on `input.sourceCitation` being supplied, so an
 * absent `sourceProvenance` cannot yet rule out a generated MCQ that hit
 * the pipeline's own defensive "no matching unit" fallback (per
 * `materialize-card.ts`'s own doc on `pipeline.ts`'s `sourceCitation`: that
 * "SHOULD NOT HAPPEN", never a designed outcome). `[D-398]` rules to exempt
 * an MCQ on this signal anyway — the alternative is keeping every MCQ
 * tracked against a purely theoretical, defensive-only risk, which is
 * exactly the file-location-shaped default this bead exists to remove —
 * but `tick` counts every such MCQ into `report.authorshipUnverified`
 * rather than folding it into `report.exemptSelfContained` silently, so the
 * residual risk stays observable. This function itself does not need to
 * know the instrument type to decide tracked-or-not; `tick` reads
 * `instrumentType` only to route the count.
 */
function isTrackedForRevision(record: VaultInstrumentRecord): boolean {
  return record.sourceProvenance !== undefined;
}

/** A path with a hidden (dot-prefixed) segment — Obsidian's own folders, the trash, Olea's own layer: never a note her passage moved into. */
export const HIDDEN_PATH_SEGMENT = /(^|\/)\./;

/** Mutable per-tick counters, threaded through `applyOutcome` rather than returned and merged — one pass, one report. */
interface MutableTickReport {
  tracked: number;
  revised: number;
  refreshed: number;
  relocated: number;
  relocationProposed: number;
  stranded: number;
  judgeUnavailable: number;
  newlyBaselined: number;
  formattingOnly: number;
  staleResultDiscarded: number;
  exemptSelfContained: number;
  authorshipUnverified: number;
  retryExhausted: number;
  passageAmbiguous: number;
  passageRuleUnsupported: number;
  passageSeedUnresolved: number;
  successorEnqueueFailed: number;
  sourceBytesChanged: number;
}

/** Where a passage-grain anchor's passage now stands, and under which rule — threaded from the read to every write that advances the anchor. */
interface PassageContext {
  readonly sourcePath: VaultPath;
  readonly rule: PassageRule;
}

/** The three withholding reasons this build knows, and so may clear on finding the passage again. */
function isKnownPassageReason(reason: string | undefined): reason is PendingReason {
  return (
    reason === 'passage-missing' ||
    reason === 'passage-ambiguous' ||
    reason === 'passage-rule-unsupported'
  );
}

/**
 * The pending fact an anchor may keep across a write: one awaiting the judge stays; one raised for
 * a passage reason this build knows is cleared by the pass that finds the passage again. A reason
 * this build does not recognise is kept (`[D-473]`, `ol-egov.141.89.5.52`): only a build that
 * knows the reason may decide it is resolved.
 */
function carriedPending(
  previous: CitationAnchorRecord,
): Pick<CitationAnchorRecord, 'pendingRevalidation'> {
  const pending = previous.pendingRevalidation;
  return pending !== undefined && !isKnownPassageReason(pending.reason)
    ? { pendingRevalidation: pending }
    : {};
}

function digestVersionOf(record: CitationAnchorRecord): number | undefined {
  return record.passageDigest === undefined
    ? undefined
    : (parsePassageDigest(record.passageDigest)?.version ?? undefined);
}

async function passageFields(
  passage: PassageContext | undefined,
  text: string,
): Promise<Pick<CitationAnchorRecord, 'passageDigest'>> {
  return passage === undefined ? {} : { passageDigest: await digestPassage(text, passage.rule) };
}

export class CitationRevisionTrigger {
  /**
   * `ol-egov.141.89.5.77`: confirmed rewrites whose suspend or enqueue failed, by instrument id. Held
   * in memory only (a persisted field would be a schema change); a restart forgets it and the
   * ordinary `[D-400]` budget then governs, which keeps the question withheld, never restored.
   */
  private readonly confirmedRewrites = new Map<string, ConfirmedRewrite>();

  constructor(private readonly deps: CitationRevisionTriggerDeps) {}

  /**
   * One whole-vault batch pass — see this module's own doc for why per-tick,
   * not per-modify-event.
   */
  async tick(
    vault: VaultSource,
    actions: CitationRevisionActions,
  ): Promise<CitationRevisionTickReport> {
    const report: MutableTickReport = {
      tracked: 0,
      revised: 0,
      refreshed: 0,
      relocated: 0,
      relocationProposed: 0,
      stranded: 0,
      judgeUnavailable: 0,
      newlyBaselined: 0,
      formattingOnly: 0,
      staleResultDiscarded: 0,
      exemptSelfContained: 0,
      authorshipUnverified: 0,
      retryExhausted: 0,
      passageAmbiguous: 0,
      passageRuleUnsupported: 0,
      passageSeedUnresolved: 0,
      successorEnqueueFailed: 0,
      sourceBytesChanged: 0,
    };
    const rules = this.deps.passageRules ?? PASSAGE_RULES;

    // See this module's own "AN OUTAGE NEVER SPENDS THE `[D-400]` BUDGET"
    // doc section: read once per pass, not per instrument — reachability
    // cannot meaningfully change within one synchronous batch pass, and a
    // single snapshot keeps every instrument this pass touches consistent.
    const online = (this.deps.isOnline ?? (() => true))();

    // `[D-351]`: the moment `evaluateCitedPassageRevision` confirms a real
    // difference, it calls this BEFORE any judge call, so the pending fact
    // is durable even while the judge is delayed or unavailable. Built once
    // per tick, stateless across iterations — closes only over `this.deps`.
    const pendingRecorder: PendingRevalidationRecorder = {
      recordPending: ({ instrumentId, sourceContentHash }) =>
        this.deps.store.setPendingRevalidation(
          instrumentId,
          sourceContentHash,
          this.deps.clock.now(),
        ),
    };

    // `[D-357]`: the permanent concept key on every record this walk hands on.
    const enumeration = await enumerateVaultInstruments(vault, {
      concepts: { stampConceptKeys: true },
    });
    // `[D-366]`/`[D-398]`: exempt instruments of EVERY format (self-
    // contained by authorship — see `isTrackedForRevision`'s own doc) are
    // counted here, once, and then never touched again this pass: excluded
    // from `trackedRecords` below, so they are never baselined, never
    // diffed, never sent to the judge. Q&A/cloze and MCQ are split into two
    // counters — see `CitationRevisionTickReport`'s own doc on
    // `authorshipUnverified` for why the underlying signal is reliable for
    // one and not yet for the other.
    const exemptRecords = enumeration.records.filter((record) => !isTrackedForRevision(record));
    report.exemptSelfContained = exemptRecords.filter(
      (record) => record.instrumentType !== 'mcq',
    ).length;
    report.authorshipUnverified = exemptRecords.filter(
      (record) => record.instrumentType === 'mcq',
    ).length;
    const trackedRecords = enumeration.records.filter(isTrackedForRevision);
    const currentAllByInstrumentId = new Map(
      enumeration.records.map((record) => [record.instrumentId, record] as const),
    );

    // Every instrument's own span, of every type, in the note it lives in —
    // what `stripInstrumentSpans` removes to get at "the material," per
    // this module's own doc.
    const spansByPath = new Map<VaultPath, { start: number; end: number }[]>();
    for (const record of enumeration.records) {
      const span = record.instrumentType === 'mcq' ? record.mcq.span : record.card.span;
      const bucket = spansByPath.get(record.notePath);
      if (bucket === undefined) spansByPath.set(record.notePath, [span]);
      else bucket.push(span);
    }

    const materialCache = new Map<VaultPath, string>();
    const materialFor = async (notePath: VaultPath): Promise<string> => {
      const cached = materialCache.get(notePath);
      if (cached !== undefined) return cached;
      const source = await vault.read(notePath);
      const material = stripInstrumentSpans(source, spansByPath.get(notePath) ?? []);
      materialCache.set(notePath, material);
      return material;
    };

    // `[D-446]`: the passage-grain reader's view of the vault — the SAME per-pass cached material
    // reads, plus the one vault-wide listing it needs when a passage is not where it was. Lazy: a
    // pass with no passage-grain instrument (or none whose passage moved) never lists the vault.
    let markdownPathsOnce: Promise<readonly VaultPath[]> | undefined;
    const passageNotes: PassageNotes = {
      exists: (path) => vault.exists(path),
      material: materialFor,
      markdownPaths: () => {
        markdownPathsOnce ??= vault
          .list({ extensions: ['md'] })
          .then((paths) => paths.filter((path) => !HIDDEN_PATH_SEGMENT.test(path)));
        return markdownPathsOnce;
      },
    };

    const currentByInstrumentId = new Map(
      trackedRecords.map((record) => [record.instrumentId, record] as const),
    );
    const stored = await this.deps.store.loadAll();
    report.tracked = stored.size;

    // `ol-egov.141.89.2.14` (C5.3 as amended by `[D-396]`): an instrument standing REJECTED is
    // skipped before any judge call or write this pass touches — the same shared fold every
    // other reader of rejection standing reads (`session-builder/provider.ts`,
    // `review/open-session.ts`'s `projectInstrumentValidity(entries).provenInvalid`), so her
    // restore (an `accepted` verdict naming the rejection in `restores`) lifts it here exactly as
    // it does there. Only the `'rejected'` reason is read: a suspension recorded as `'defect'`
    // (the fold's other `provenInvalid` reason) is left to this trigger's pre-existing behaviour,
    // unchanged — this fix is about a standing rejection, never about defect suspension. A
    // review-log read failure degrades to "nothing proven invalid" rather than blocking this
    // whole batch pass, the same permissive posture every other read in this file already takes
    // on failure.
    let rejectedInstrumentIds: ReadonlySet<string>;
    try {
      const { entries } = await readReviewLogHistory(vault);
      const provenInvalid = projectInstrumentValidity(entries).provenInvalid;
      rejectedInstrumentIds = new Set(
        [...provenInvalid]
          .filter(([, fact]) => fact.reason === 'rejected')
          .map(([instrumentId]) => instrumentId),
      );
    } catch (error) {
      console.error(
        'Olea: citation-revision could not read the review log for rejection standing',
        error,
      );
      rejectedInstrumentIds = new Set();
    }

    const judgeCalls: Array<() => Promise<void>> = [];
    for (const [instrumentId, previous] of stored) {
      // `ol-egov.141.89.2.14`: a standing rejection wins over every other check this loop makes
      // — no current-passage read, no judge dispatch, no store write, no suspend, no enqueue.
      // Left tracked as-is: once she restores it, the ordinary revision check resumes from the
      // same baseline, exactly as if this pass had never run for it.
      if (rejectedInstrumentIds.has(instrumentId)) continue;
      // `[D-366]`: an id that WAS tracked but, under the current rule, no
      // longer is — e.g. a rule change since it was last baselined, since
      // `sourceProvenance` is write-once and cannot itself change underneath
      // a still-existing record. Retire silently: this is a real, present
      // instrument, never `'stranded'` (nothing this module decides alone)
      // and never a relocation search (nothing has moved).
      const currentAny = currentAllByInstrumentId.get(instrumentId);
      if (currentAny !== undefined && !isTrackedForRevision(currentAny)) {
        try {
          await this.deps.store.remove(instrumentId);
        } catch (error) {
          console.error('Olea: citation-revision exempt-retire write failed', error);
        }
        continue;
      }

      const currentRecord = currentByInstrumentId.get(instrumentId);
      // `ol-egov.141.89.5.73` ([D-515]): a non-markdown source is never diffed as text, so its
      // bytes are compared with the sidecar's `sourceRevision` instead, and the question is
      // withheld here, before any judge call is awaited ([D-514] b).
      if (
        currentRecord !== undefined &&
        (await this.withholdIfSourceBytesChanged(vault, currentRecord, report))
      ) {
        continue;
      }
      let current: CurrentPassageState;
      // `[D-446]`: set only for a passage-grain anchor whose passage was found in a note this pass.
      let passage: PassageContext | undefined;
      // `ol-egov.141.89.5.76`: the ladder's own verdict that the passage stands unchanged in
      // everything but whitespace and line breaks (`via: 'exact'`, a [D-446] normalised match).
      let reformattedByLadder = false;
      try {
        if (currentRecord !== undefined && previous.passageDigest !== undefined) {
          // Passage grain: ask WHERE the anchored passage stands now, by the shared rule. Only a
          // passage found in place (unchanged, reformatted, or edited-and-unmistakable) continues
          // into the ordinary compare-and-judge below; a moved, missing or ambiguous passage is
          // settled here, with no judge call.
          const resolution = await resolveAnchoredPassage(
            {
              text: previous.text,
              passageDigest: previous.passageDigest,
              anchorPath: previous.sourcePath,
              citedPath: citedPassagePath(currentRecord),
            },
            passageNotes,
            rules,
          );
          if (resolution.kind !== 'present') {
            await this.applyPassageResolution(
              instrumentId,
              previous,
              currentRecord,
              resolution,
              passageNotes,
              actions,
              report,
            );
            continue;
          }
          current = { kind: 'found-at-anchor', text: resolution.text };
          passage = { sourcePath: resolution.sourcePath, rule: resolution.rule };
          reformattedByLadder = resolution.via === 'exact';
        } else if (currentRecord !== undefined) {
          current = {
            kind: 'found-at-anchor',
            text: await materialFor(citedPassagePath(currentRecord)),
          };
        } else if (previous.passageDigest !== undefined) {
          // The instrument itself is gone: there is no passage to judge, and relocating a
          // passage-grain anchor among whole notes would compare the wrong grain.
          report.stranded += 1;
          continue;
        } else {
          current = {
            kind: 'not-found',
            relocationCandidates: await buildRelocationCandidates(trackedRecords, materialFor),
          };
        }
      } catch (error) {
        console.error('Olea: citation-revision tick could not read a tracked note', error);
        continue;
      }

      // Defect 5 (`ol-egov.141.89.5.7`): the exact-equivalence exits row
      // 1.4's file-level trigger already has (raw hash equal, canonical hash
      // equal) apply at the citation grain too — chg.md sec 2's target names
      // both explicitly, and `[D-093]`'s "no distance gate, similarity score
      // or edit-size heuristic" forbids only a THRESHOLD-based skip, never an
      // equality check (this file's own `[D-093]` doc, above). Checked here,
      // before `evaluateCitedPassageRevision` (whose own 'unchanged' arm only
      // ever compares raw hashes — `packages/core/src/concept/revision/
      // material-change.ts`, not this lane's `owns`), so a pure reformat of
      // the cited passage never reaches the judge.
      if (
        currentRecord !== undefined &&
        current.kind === 'found-at-anchor' &&
        current.text !== previous.text &&
        (reformattedByLadder ||
          canonicalizeForMateriality(current.text) === canonicalizeForMateriality(previous.text))
      ) {
        report.formattingOnly += 1;
        try {
          await this.deps.store.save(instrumentId, {
            sourcePath: passage?.sourcePath ?? citedPassagePath(currentRecord),
            text: current.text,
            // [D-351]: a formatting-only edit is not a resolution — carry
            // over whatever pending-revalidation fact was already recorded
            // (from an earlier, still-unresolved real difference) rather
            // than silently clearing it via this unrelated write. (A fact
            // raised for a passage reason is the one exception: finding the
            // passage again is its resolution — `carriedPending`.)
            ...carriedPending(previous),
            ...(await passageFields(passage, current.text)),
            conceptIds: currentRecord.conceptIds,
          });
        } catch (error) {
          console.error('Olea: citation-revision formatting-only refresh write failed', error);
        }
        continue;
      }

      // `ol-egov.141.89.5.77`: an answer already acted on, whose suspend or enqueue failed, is
      // retried here with NO judge call and no `[D-400]` budget, for the same difference only.
      const confirmed = this.confirmedRewrites.get(instrumentId);
      if (confirmed !== undefined) {
        if (
          currentRecord !== undefined &&
          current.kind === 'found-at-anchor' &&
          (await hashText(current.text)) === confirmed.judgedContentHash
        ) {
          if (!confirmed.gaveUp) {
            await this.suspendAndEnqueueSuccessor(
              instrumentId,
              currentRecord.conceptIds,
              confirmed.judgedContentHash,
              confirmed.predecessorInstrumentId,
              confirmed.successorEnqueueInput,
              actions,
              report,
            );
          }
          continue;
        }
        // The passage moved on since the answer: it no longer applies.
        this.confirmedRewrites.delete(instrumentId);
      }

      // `ol-egov.141.89.5.71` ([D-514] item b): a judge call is never awaited inside this walk. The
      // walk records every affected instrument's pending fact (and dispatch) first; the calls
      // follow in `judgeCalls`, so a slow or silent judge cannot delay a later instrument's fact.
      let judgeWillBeCalled = false;
      let outcome: CitedPassageRevisionOutcome | undefined;
      try {
        // `[D-400]`: past the formatting-only exit above, reaching here with
        // `current.text !== previous.text` means a REAL, unresolved
        // difference (the only other outcome of that check is `current.text
        // === previous.text`, i.e. genuinely unchanged, which needs no
        // gating — `evaluateCitedPassageRevision` below reports `'unchanged'`
        // for that on its own, with no dispatch). Gate the JUDGE DISPATCH
        // itself here; `evaluateCitedPassageRevision`'s own pending-fact
        // recording stays unconditional per `[D-351]` either way. Inside the
        // SAME `try` as the evaluation below — never swallowed, same posture
        // `[D-351]`'s own `pendingRecorder` call takes — so this tick never
        // dispatches without having durably recorded that it did, and a
        // failed dispatch-tracking write is simply retried next tick like
        // any other evaluation failure. See this module's own `[D-400]` doc
        // section above for the full reasoning, including why no age/timeout
        // check is needed.
        if (
          currentRecord !== undefined &&
          current.kind === 'found-at-anchor' &&
          current.text !== previous.text &&
          this.deps.judge !== null
        ) {
          const newContentHash = await hashText(current.text);
          const pending = previous.pendingRevalidation;
          const priorForThisDifference =
            pending !== undefined && pending.sinceContentHash === newContentHash
              ? pending
              : undefined;
          if (priorForThisDifference?.retriedAt !== undefined) {
            // The one permitted automatic retry already fired for this
            // exact difference and it is STILL unresolved — never retry
            // again, no matter how many further restarts or provider
            // failures happen. Unaffected by `online`: a genuinely spent
            // budget stays spent regardless of reachability right now.
            report.retryExhausted += 1;
            continue;
          }
          // The original check when nothing has been dispatched yet for
          // this exact difference; the one permitted automatic retry when a
          // dispatch is already recorded and still unresolved (lost to a
          // restart, a provider failure this same `catch` swallowed, or a
          // genuine answer whose resolving write itself failed). Gated on
          // `online`: a flatly unreachable Worker never gets to spend this —
          // see this module's own "AN OUTAGE NEVER SPENDS THE `[D-400]`
          // BUDGET" doc section.
          if (online) {
            await this.deps.store.recordDispatch(
              instrumentId,
              newContentHash,
              this.deps.clock.now(),
              priorForThisDifference?.dispatchedAt !== undefined,
            );
          }
        }

        const previousContentHash = await hashText(previous.text);
        const evaluate = (
          recorder: PendingRevalidationRecorder,
        ): Promise<CitedPassageRevisionOutcome> =>
          evaluateCitedPassageRevision(
            { instrumentId, previousText: previous.text, previousContentHash, current },
            // While unreachable, take the SAME `'judge-unavailable'` path a
            // `judge === null` caller already gets — no call, no spend, the
            // pending fact still recorded per `[D-351]`. See this module's own
            // "AN OUTAGE NEVER SPENDS THE `[D-400]` BUDGET" doc section.
            online ? this.deps.judge : null,
            this.deps.clock,
            recorder,
          );
        judgeWillBeCalled =
          online &&
          this.deps.judge !== null &&
          current.kind === 'found-at-anchor' &&
          (await hashText(current.text)) !== previousContentHash;
        if (judgeWillBeCalled && current.kind === 'found-at-anchor') {
          // The fact first (`[D-351]`), for every affected instrument, before any call is awaited.
          await pendingRecorder.recordPending({
            instrumentId,
            sourceContentHash: await hashText(current.text),
          });
          const settled = current;
          judgeCalls.push(async () => {
            let judged: CitedPassageRevisionOutcome;
            try {
              // The fact was written in the first phase; the call does not write it a second time.
              judged = await evaluate({ recordPending: async () => undefined });
            } catch (error) {
              console.error('Olea: citation-revision evaluation failed', error);
              return;
            }
            await this.applyOutcome(
              instrumentId,
              previous,
              currentRecord,
              settled,
              judged,
              actions,
              report,
              passage,
            );
          });
        } else {
          outcome = await evaluate(pendingRecorder);
        }
      } catch (error) {
        console.error('Olea: citation-revision evaluation failed', error);
        continue;
      }

      if (judgeWillBeCalled || outcome === undefined) continue;
      await this.applyOutcome(
        instrumentId,
        previous,
        currentRecord,
        current,
        outcome,
        actions,
        report,
        passage,
      );
    }

    for (const call of judgeCalls) await call();

    // Baseline every TRACKED instrument this pass found that the store has
    // never recorded — every MCQ, plus a Q&A/cloze that names a genuine
    // separate citation (`[D-366]`; a self-contained one was already
    // counted into `report.exemptSelfContained` above and never reaches
    // `trackedRecords`) — the first-sighting case, same posture
    // `ObsidianMaterialityHashStore`'s `record === null` branch takes: record
    // now, nothing to diff against yet.
    for (const [instrumentId, record] of currentByInstrumentId) {
      if (stored.has(instrumentId)) continue;
      // `ol-egov.141.89.2.14`: a rejected instrument never gets a first baseline either — no
      // write at all while it stands rejected (see the `rejectedInstrumentIds` doc above).
      if (rejectedInstrumentIds.has(instrumentId)) continue;
      try {
        const path = citedPassagePath(record);
        // `[D-446]`: an instrument whose citation carries a passage digest that resolves to exactly
        // one passage is baselined AT that passage. Anything less (no digest, an ambiguous or absent
        // one, a rule this build does not carry) keeps today's whole-note baseline — never a guessed
        // passage.
        const seeded = await seedPassageAnchor(vault, instrumentId, path, materialFor, rules);
        if (seeded !== undefined && 'withheld' in seeded) {
          // `ol-egov.141.89.5.71` ([D-514] item a): the cited passage cannot be found at first
          // sighting, so there is no passage to baseline and the edited note is never adopted in
          // its place. The anchor holds no passage text (empty), only the citation's digest, and
          // carries the pending fact that sets the question aside as could-not-check.
          report.passageSeedUnresolved += 1;
          await this.deps.store.save(instrumentId, {
            sourcePath: path,
            text: '',
            passageDigest: seeded.digest,
            conceptIds: record.conceptIds,
          });
          await this.deps.store.setPendingRevalidation(
            instrumentId,
            await hashText(`${seeded.withheld}\n${await materialFor(path)}`),
            this.deps.clock.now(),
            seeded.withheld,
          );
          continue;
        }
        if (seeded !== undefined) {
          await this.deps.store.save(instrumentId, {
            sourcePath: path,
            text: seeded.text,
            passageDigest: seeded.digest,
            conceptIds: record.conceptIds,
          });
          report.newlyBaselined += 1;
          continue;
        }
        const text = await materialFor(path);
        await this.deps.store.save(instrumentId, {
          sourcePath: path,
          text,
          conceptIds: record.conceptIds,
        });
        report.newlyBaselined += 1;
      } catch (error) {
        console.error('Olea: citation-revision baseline write failed', error);
      }
      // `ol-egov.141.89.5.73`: a fresh anchor on a changed non-markdown source is withheld too.
      if (citesBinarySource(record) && (await this.storeHas(instrumentId))) {
        await this.withholdIfSourceBytesChanged(vault, record, report);
      }
    }

    return report;
  }

  /**
   * `[D-446]` option (a): the outcomes of the passage-grain read that are settled WITHOUT a judge
   * call. `present` never arrives here (the caller carries it into the ordinary compare-and-judge).
   *
   *  - `relocated`: the passage stands, exactly, in another note — heal the anchor there silently
   *    (`[D-093]`), clearing any fact raised for a passage reason.
   *  - `proposal`, `unresolved`: the passage cannot be located. The instrument is WITHHELD before
   *    its next presentation (`[D-343]`) with the actual reason recorded on the pending fact
   *    (`passage-missing`, `passage-ambiguous`, `passage-rule-unsupported`) — protective, and
   *    never a claim that a material change was established (row 45). No baseline is adopted, no
   *    judge is called, nothing is suspended or regenerated.
   */
  private async applyPassageResolution(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord,
    resolution: Exclude<PassageResolution, { kind: 'present' }>,
    notes: PassageNotes,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<void> {
    if (resolution.kind === 'relocated') {
      report.relocated += 1;
      try {
        await this.deps.store.save(instrumentId, {
          sourcePath: resolution.sourcePath,
          text: resolution.text,
          passageDigest: await digestPassage(resolution.text, resolution.rule),
          ...carriedPending(previous),
          conceptIds: currentRecord.conceptIds,
        });
      } catch (error) {
        console.error('Olea: citation-revision passage relocation-heal write failed', error);
      }
      return;
    }

    let reason: PendingReason;
    if (resolution.kind === 'proposal') {
      report.relocationProposed += 1;
      reason = 'passage-missing';
      try {
        actions.onRelocationProposed?.(instrumentId, resolution.candidate);
      } catch (error) {
        console.error('Olea: citation-revision relocation-proposed hook failed', error);
      }
    } else if (resolution.reason === 'missing') {
      report.stranded += 1;
      reason = 'passage-missing';
    } else if (resolution.reason === 'ambiguous') {
      report.passageAmbiguous += 1;
      reason = 'passage-ambiguous';
    } else {
      report.passageRuleUnsupported += 1;
      reason = 'passage-rule-unsupported';
    }

    try {
      // Keyed to the state being checked ([D-351]): the reason plus what the anchor's own note
      // says now, so a further edit to that note raises a fresh fact rather than resting on a
      // stale one, while an unchanged state re-records as a no-op every pass.
      let observed = '';
      try {
        if (await notes.exists(previous.sourcePath))
          observed = await notes.material(previous.sourcePath);
      } catch {
        observed = '';
      }
      await this.deps.store.setPendingRevalidation(
        instrumentId,
        await hashText(`${reason}\n${observed}`),
        this.deps.clock.now(),
        reason,
      );
    } catch (error) {
      console.error('Olea: citation-revision passage withhold write failed', error);
    }
  }

  private async storeHas(instrumentId: string): Promise<boolean> {
    return (await this.deps.store.loadAll()).has(instrumentId);
  }

  /**
   * `ol-egov.141.89.5.73` ([D-515], part 4): for a question citing a non-markdown source, hash the
   * file's current bytes and compare with the sidecar's `sourceRevision`. Equal: nothing changes
   * (returns false). A mismatch, a missing `sourceRevision`, an unreadable sidecar or file: record
   * the pending-revalidation fact with {@link SOURCE_REVISION_REASON} (keyed to the observed bytes)
   * and return true, so the caller skips the judge path.
   *
   * [D-508] routes a changed cited source to a rewrite, but a binary source has no passage text to
   * judge or to draft from, and the revision job's drafting reads retrieval that may still hold the
   * old file's chunks; nothing is suspended or enqueued here. The question stays withheld until a
   * successor can honestly be drafted from the new bytes (reported, not built).
   */
  private async withholdIfSourceBytesChanged(
    vault: VaultSource,
    record: VaultInstrumentRecord,
    report: MutableTickReport,
  ): Promise<boolean> {
    const sourcePath = record.sourceProvenance?.sourcePath;
    if (sourcePath === undefined || !citesBinarySource(record)) return false;
    let observed: string;
    try {
      const citation = await readInstrumentCitation(vault, record.instrumentId);
      const bytes = await vault.readBinary(citation?.sourcePath ?? sourcePath);
      const now = await hashContent(bytes);
      if (citation?.sourceRevision !== undefined && citation.sourceRevision === now) return false;
      observed = now;
    } catch {
      observed = 'unreadable';
    }
    report.sourceBytesChanged += 1;
    try {
      await this.deps.store.setPendingRevalidation(
        record.instrumentId,
        await hashText(`${SOURCE_REVISION_REASON}\n${observed}`),
        this.deps.clock.now(),
        SOURCE_REVISION_REASON as PendingReason,
      );
    } catch (error) {
      console.error('Olea: citation-revision source-bytes withhold write failed', error);
    }
    return true;
  }

  private async applyOutcome(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord | undefined,
    current: CurrentPassageState,
    outcome: CitedPassageRevisionOutcome,
    actions: CitationRevisionActions,
    report: MutableTickReport,
    passage?: PassageContext,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'unchanged':
        // `[D-446]`: a passage-grain anchor withheld for a passage reason (missing, ambiguous, rule)
        // that now stands unchanged is resolved: clear the fact. A pending fact awaiting the judge
        // is never touched here, exactly as before. Likewise an anchor whose digest names a retired
        // rule, re-found cleanly under the current one, is re-seated on it.
        if (
          passage !== undefined &&
          (isKnownPassageReason(previous.pendingRevalidation?.reason) ||
            digestVersionOf(previous) !== passage.rule.version) &&
          currentRecord !== undefined &&
          current.kind === 'found-at-anchor'
        ) {
          try {
            await this.deps.store.save(instrumentId, {
              sourcePath: passage.sourcePath,
              text: current.text,
              conceptIds: currentRecord.conceptIds,
              // `[D-473]`: an unrecognised reason's hold survives the re-seat.
              ...carriedPending(previous),
              ...(await passageFields(passage, current.text)),
            });
          } catch (error) {
            console.error('Olea: citation-revision passage-resolved clear write failed', error);
          }
        }
        return;
      case 'judge-unavailable':
        // Grey-out, never advance state on an unanswered check — the same
        // posture `MaterialityTrigger.evaluate`'s own `call-judge` branch
        // takes when `judge === null`: leave the stored baseline exactly as
        // it was, so the SAME delta is retried once a judge is configured.
        report.judgeUnavailable += 1;
        return;
      case 'stranded':
        // `material-change.ts`'s own doc: "nothing this module decides
        // alone" — no relocation candidate at all, exact or near. Left
        // tracked as-is; harmless to retry next pass.
        report.stranded += 1;
        return;
      case 'relocation-proposed':
        // Never re-point on Olea's own authority (`[D-093]`) — surfaced via
        // the best-effort hook, never healed or dropped here.
        report.relocationProposed += 1;
        try {
          actions.onRelocationProposed?.(instrumentId, outcome.candidate);
        } catch (error) {
          console.error('Olea: citation-revision relocation-proposed hook failed', error);
        }
        return;
      case 'relocated':
        // Exact whitespace-normalised match found elsewhere — heals
        // silently, no judge call happens for this arm, no event. This is a
        // different question from a text change at the anchor (`[D-351]`'s
        // pending fact is never raised on this branch — see
        // `evaluateCitedPassageRevision`'s own doc), so whatever pending
        // fact was already recorded carries over unresolved rather than
        // being silently cleared by this unrelated write.
        report.relocated += 1;
        try {
          await this.deps.store.save(instrumentId, {
            sourcePath: outcome.candidate.anchor.sourcePath,
            text: outcome.candidate.text,
            ...(previous.pendingRevalidation !== undefined
              ? { pendingRevalidation: previous.pendingRevalidation }
              : {}),
            conceptIds: previous.conceptIds,
          });
        } catch (error) {
          console.error('Olea: citation-revision relocation-heal write failed', error);
        }
        return;
      case 'refreshed': {
        // [D-508] (ol-egov.141.89.5.61): an immaterial verdict on an item's OWN
        // cited passage never restores the question. This arm is reached only
        // after the code's free exits (identical text, formatting-only under the
        // canonical normaliser, the [D-446] move/reformat rules) have already
        // settled without a judge call, so a real difference remains: the
        // question stays withheld until a re-check against the current passage
        // passes or it is rewritten. No re-check exists yet, so it takes the
        // rewrite path, exactly like a material verdict. The judge's answer is
        // still counted and routes the work; it just cannot certify the old text.
        report.refreshed += 1;
        if (currentRecord === undefined || current.kind !== 'found-at-anchor') {
          return;
        }
        await this.suspendAndEnqueueSuccessor(
          instrumentId,
          currentRecord?.conceptIds ?? previous.conceptIds,
          outcome.event.newContentHash,
          outcome.event.instrumentId,
          buildSuccessorRevisionEnqueueInput(outcome.event, current.text),
          actions,
          report,
        );
        return;
      }
      case 'revised': {
        report.revised += 1;
        await this.suspendAndEnqueueSuccessor(
          instrumentId,
          currentRecord?.conceptIds ?? previous.conceptIds,
          outcome.event.newContentHash,
          outcome.predecessorInstrumentId,
          outcome.successorEnqueueInput,
          actions,
          report,
        );
        return;
      }
    }
  }

  /**
   * Shared by the `'revised'` and, per [D-508], the `'refreshed'` verdict on a cited passage:
   * suspend the predecessor, enqueue a successor drafted from the current passage, retire
   * tracking. Guarded against a late reply ([D-351] `isPendingRevalidationCurrent`); a failed
   * suspend or enqueue leaves the anchor and its pending fact in place, so the question stays
   * withheld and the same outcome is retried next pass.
   */
  private async suspendAndEnqueueSuccessor(
    instrumentId: string,
    conceptIds: readonly string[],
    judgedContentHash: string,
    predecessorInstrumentId: string,
    successorEnqueueInput: EnqueueInput,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<void> {
    try {
      const pendingStillCurrent = await this.deps.store.isPendingRevalidationCurrent(
        instrumentId,
        judgedContentHash,
      );
      if (!pendingStillCurrent) {
        report.staleResultDiscarded += 1;
        this.confirmedRewrites.delete(instrumentId);
        return;
      }
      await actions.suspend(predecessorInstrumentId, conceptIds);
      await actions.enqueue(successorEnqueueInput);
      // Retire tracking only after both succeeded; a failure leaves the entry tracked
      // (pending fact intact) and the SAME outcome is retried next pass, at-least-once.
      await this.deps.store.remove(instrumentId);
      this.confirmedRewrites.delete(instrumentId);
    } catch (error) {
      // `ol-egov.141.89.5.77`: remember the confirmed outcome so later passes retry this step
      // without asking the judge again; bounded, then recorded.
      const entry: ConfirmedRewrite = this.confirmedRewrites.get(instrumentId) ?? {
        judgedContentHash,
        conceptIds,
        predecessorInstrumentId,
        successorEnqueueInput,
        attempts: 0,
        gaveUp: false,
      };
      entry.attempts += 1;
      this.confirmedRewrites.set(instrumentId, entry);
      if (entry.attempts >= SUCCESSOR_RETRY_BOUND) {
        entry.gaveUp = true;
        report.successorEnqueueFailed += 1;
        console.error(
          'Olea: citation-revision successor enqueue gave up after repeated failures; the question stays withheld',
          error,
        );
        return;
      }
      console.error(
        'Olea: citation-revision suspend/enqueue failed; predecessor stays tracked for retry',
        error,
      );
    }
  }
}

/**
 * `[D-446]`: the passage a citation's digest names, when it resolves to exactly one segment of
 * `path`'s material — the text and digest a passage-grain anchor is first saved with. `undefined`
 * when the citation carries no digest (the legacy grain: nothing to say); a withheld reason when it
 * carries one that does not resolve to exactly one passage (ambiguous, absent, unsupported rule,
 * malformed) — counted by the caller, which then WITHHOLDS the question (`[D-514]`): no passage is
 * baselined.
 */
async function seedPassageAnchor(
  vault: VaultSource,
  instrumentId: string,
  path: VaultPath,
  materialFor: (path: VaultPath) => Promise<string>,
  rules: readonly PassageRule[],
): Promise<
  | { readonly text: string; readonly digest: string }
  | { readonly withheld: PendingReason; readonly digest: string }
  | undefined
> {
  const citation = await readInstrumentCitation(vault, instrumentId);
  const digest = citation?.passageDigest;
  if (digest === undefined) return undefined;
  if (!isMarkdownVaultPath(path)) return { withheld: 'passage-missing', digest };
  const located = await locatePassageByDigest(await materialFor(path), digest, rules);
  if (located.status === 'unique') return { text: located.segment.text, digest };
  const withheld: PendingReason =
    located.status === 'ambiguous'
      ? 'passage-ambiguous'
      : located.status === 'absent'
        ? 'passage-missing'
        : 'passage-rule-unsupported';
  return { withheld, digest };
}

/**
 * Every currently-TRACKED instrument's material, one `RelocationCandidate`
 * each — `location` is a placeholder whole-text range, the same "never read
 * past `embeddedIn.notePath`/`sourcePath`" posture `main.ts`'s
 * `triggerAuthoredNoteGenerationIfObserved` already uses for a synthesised
 * `Provenance`: `classifyRelocation` only ever reads `candidate.text` and
 * `candidate.anchor.sourcePath`. Deduped and read by `citedPassagePath`, not
 * raw `notePath` — the same substitution `tick`'s tracked-instrument loop
 * makes, so a relocation search for a split-home-note instrument (`ol-0r92.46`)
 * looks at candidates' real source text too, not their empty home-note stubs.
 * Drawn from `trackedRecords` (`[D-366]`/`[D-398]`), not every enumerated
 * instrument — an exempt, self-contained instrument's own note, of any
 * format including MCQ since `[D-398]`, is never offered as somewhere a
 * DIFFERENT, tracked instrument's citation relocated to.
 */
async function buildRelocationCandidates(
  trackedRecords: readonly VaultInstrumentRecord[],
  materialFor: (path: VaultPath) => Promise<string>,
): Promise<RelocationCandidate[]> {
  const seen = new Set<VaultPath>();
  const candidates: RelocationCandidate[] = [];
  for (const record of trackedRecords) {
    const path = citedPassagePath(record);
    if (seen.has(path)) continue;
    seen.add(path);
    const text = await materialFor(path);
    candidates.push({
      anchor: {
        sourcePath: path,
        location: { page: 1, charRange: { start: 0, end: text.length } },
      },
      text,
    });
  }
  return candidates;
}

export interface CitationRevisionWiringDeps {
  readonly store: CitationHashStore;
  readonly judge: RevisionJudgePort | null;
  readonly clock: Clock;
  /** See `CitationRevisionTriggerDeps.isOnline`'s own doc. */
  readonly isOnline?: () => boolean;
  /** See `CitationRevisionTriggerDeps.passageRules`'s own doc. */
  readonly passageRules?: readonly PassageRule[];
}

export function buildCitationRevisionWiring(
  deps: CitationRevisionWiringDeps,
): CitationRevisionTrigger {
  return new CitationRevisionTrigger(deps);
}
