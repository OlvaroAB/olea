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
 * with every question block's span stripped out, bound to a course or not
 * (`citation-material.ts`'s `stripQuestionBlocks`, `ol-egov.141.89.5.113`: the
 * same blocks the session's presentation check strips) — never the instrument's
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
 *
 * ===========================================================================
 * `[D-473]` — A HOLD THIS BUILD DOES NOT RESOLVE IS LEFT EXACTLY AS IT IS
 * (`ol-egov.141.89.5.43`)
 * ===========================================================================
 * `[D-467]` withholds an instrument whose slide claim a lecturer's correction invalidates, though
 * its cited file is unchanged, and `[D-473]` stores that as a reason on this anchor: "unknown
 * reasons must preserve the hold." Carrying the reason through the pass's own advance writes
 * (`carriedPending`) was not enough: every NEW fact this pass raises (a passage gone missing, a
 * binary source's bytes, a difference sent to the judge) replaced it, and the next pass then lifted
 * the replacement, so the instrument was served again with its grounding still unreconciled. An
 * anchor whose pending reason is not one this build raises for a source change itself
 * ({@link isReasonThisBuildResolves}) is therefore skipped by the pass altogether: no read, no
 * judge call, no write, no suspension, no successor. Only a build that knows the reason resolves it.
 *
 * ===========================================================================
 * `ol-egov.141.89.5.43` — LECTURE TRANSCRIPTS AT PART GRAIN, OR WHOLE (`[D-567]`)
 * ===========================================================================
 * With `deps.transcriptPartGrain` (on in production since `ol-egov.141.89.5.97`, `main.ts`), an
 * instrument whose citation names a lecture transcript (a `.txt`/`.vtt`/`.srt` file, or Markdown
 * that declares itself one) is followed by its passage's spoken text (`transcript-grain.ts`;
 * PERSISTENCE.md 2.2, 2.5, 2.6, 2.9), seeded only from the version the citation was drafted from
 * (its `sourceRevision`). Which grain is C5.3's "Which part" (`[D-567]`): a citation names a part
 * only when its question was drafted from a single passage that names it, and it then carries a
 * passage digest; one that names none carries no digest, and the whole transcript is protected as
 * a note is under `[D-543]` (the same representation: no passage digest, whole grain). The anchor
 * keeps the citation's digest at part grain and none at whole grain, so every later pass and the
 * session's presentation check read the same grain.
 *  - PART: every pass looks for the passage's text in the transcript at the anchor's path. Found
 *    once and unchanged: valid, no judge. One changed region: that region alone goes to the judge
 *    against the old passage (`[D-293]`), and the existing rewrite path applies. Twice, or two
 *    resembling regions: `passage-ambiguous`. Gone: `passage-missing`. Both withhold before the
 *    next presentation and are never guessed.
 *  - WHOLE: the anchor holds the whole transcript's spoken text. The same text again (a re-cut or
 *    re-timed export with the same words included) is unchanged; one that differs only in
 *    formatting exits free; any other content change goes to the judge as the whole old and new
 *    text and down the `[D-508]` route, so the question is withheld before its next presentation.
 * No other file is ever searched: continuity across paths comes only from {@link
 * CitationRevisionTrigger.onSourceRenamed}, a rename Olea saw (`main.ts` calls it from the vault's
 * rename event). A lecture link, a shared stem or folder, a part label, and equal text elsewhere
 * are never lineage. The binary-bytes path (`[D-515]`/`[D-518]`) is skipped for these
 * instruments: its rewrite reads the cited page by its number, which is a label, not identity,
 * once the file has changed. A rewrite's successor job carries the version its passage was read
 * from (`ol-egov.141.89.5.104`), so the successor is seeded and presented in turn. The rewritten
 * question's anchor is kept, so a rename seen before its successor is drafted moves it too, and the
 * runner drafts the successor where the transcript, or a changed file's landed text, stands then
 * (`ol-egov.141.89.5.107`, {@link citedSourceNowFrom}).
 *
 * Omitted (tests only), these instruments keep the bytes handling above.
 *
 * ===========================================================================
 * `[D-626]`/`[D-628]` — EVERY NOTE A DRAFTED ITEM WAS DRAWN FROM (`ol-egov.141.89.2.39`)
 * ===========================================================================
 * A drafted item's citation record lists its input notes, each with the fingerprint of the material
 * supplied when it was drafted (`generation/input-notes.ts`). The anchor above follows one note (the
 * cited note, or the home note for a binary source); every OTHER input note is read here on every
 * pass and compared by fingerprint. A change to any of them past the code's free exits (a
 * formatting-only edit and a question block added leave the fingerprint equal), or a note gone, is
 * routed as a change to the cited note is at whole-note grain (C5.3): the question is withheld (a
 * pending fact, rule `input-note-changed`) and rewritten from its cited note as it stands (the same
 * enqueue-then-suspend {@link CitationRevisionTrigger.suspendAndEnqueueSuccessor}, decided by rule
 * `input-note-rewrite`). There is no judge call: the anchor holds no old text for those notes, and
 * C5.3 rewrites a change past the free exits whatever the read answers. At first sighting every
 * input note is compared, the cited one included, so a change made between drafting and the first
 * pass is never adopted as the baseline — except the single-passage case's note, whose passage is
 * seeded by its digest at passage grain. An item Olea drafted through a draft record before input
 * notes were recorded is routed the same way, under rule `input-notes-unrecorded`: no such record
 * can show the material it rests on. "Olea drafted it" is read from provenance that survives a purge
 * of the draft cache: the accept or edit verdict in her review log, with the cache's accepted and
 * edited records added (`input-notes.ts`'s `draftedInstrumentIdsOf`).
 *
 * `ol-egov.141.89.2.39` (review findings): a drafted item whose citation records no page (kept
 * before every drafting path cited a note) is not tracked by the walk, yet is withheld for its input
 * notes; it is still routed here, by the first-sighting rule, so it always reaches the rewrite. A
 * frontmatter write Olea makes itself (a first-sight stamp, a home note's `topic:` growth or
 * drafted-for record) is not a change to her material, here (rule `olea-frontmatter-writes`) as in
 * the input-note fingerprint. The pass and a rename's moves run one at a time
 * ({@link CitationRevisionTrigger.tick}, {@link CitationRevisionTrigger.onSourceRenamed}), and a
 * pass reads a note a rename is still moving at its new path, so a rename alone is never routed.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildSuccessorRevisionEnqueueInput,
  type CitedPassageRevisionOutcome,
  type Clock,
  type CurrentPassageState,
  decisionFromCitedPassageRevision,
  digestPassage,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  evaluateCitedPassageRevision,
  hashContent,
  hashText,
  locatePassageByDigest,
  PASSAGE_RULES,
  type PassageRule,
  type PendingRevalidationRecorder,
  type PersistedStageProducer,
  parsePassageDigest,
  persistedModelProducer,
  projectInstrumentValidity,
  type RelocationCandidate,
  type RevisionEvent,
  type RevisionJudgeInput,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  readInstrumentCitation,
  readInstrumentCitationRecord,
  readReviewLogHistory,
  renameCitationSourcePath,
  suspendedInstrumentIds,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { createVaultDraftCacheStore } from '../../generation/cache-store.js';
import {
  changedInputNotes,
  draftedInstrumentIdsOf,
  inputNoteFingerprint,
  singlePassageNote,
} from '../../generation/input-notes.js';
import type { CitedSourceNow } from '../../generation/revision-job-runner.js';
import { stripOleaFrontmatterWrites } from '../../generation/strip-olea-frontmatter.js';
import type { DraftRecord } from '../../generation/types.js';
import { canonicalizeForMateriality } from './canonical.js';
import type {
  CitationAnchorRecord,
  CitationHashStore,
  PendingReason,
} from './citation-hash-store.js';
import { stripQuestionBlocks } from './citation-material.js';
import { LandedSourceText } from './landed-source-text.js';
import {
  type PassageNotes,
  type PassageResolution,
  resolveAnchoredPassage,
} from './passage-grain.js';
import {
  hasTranscriptExtension,
  readTranscriptVersion,
  resolveTranscriptPassage,
  seedFromCitation,
  type TranscriptRead,
  type TranscriptVersion,
  wholeTranscriptText,
} from './transcript-grain.js';
import type { MaterialityJudge } from './types.js';
import { codeRule, errorName } from './verdict-provenance.js';
import { MATERIALITY_JUDGE_TASK_ID } from './workerJudge.js';

/** `RevisionJudgePort` is `{previousText, currentText}` only; `MaterialityJudge` also requires `path`, unused inside `WorkerMaterialityJudge.judge` (see that file's own doc: "`path` never leaves this method"). Adapts explicitly rather than relying on TS's method-bivariance to paper over the shape gap. The judge's verdict is passed through as it came, its D7.3 `stamp` included (`[D-598]`: `MaterialityJudgeVerdict.stamp` mirrors `RevisionJudgeVerdict.stamp`), so core's cited-passage outcome can carry it. */
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
  /**
   * `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`): a drafted question routed to the rewrite because a
   * note it was drawn from (other than the one its anchor already follows) changed past the code's
   * free exits, or because it was drafted through a draft record before input notes were recorded.
   */
  readonly inputNotesRouted: number;
}

/**
 * `ol-egov.141.89.5.73` ([D-515]): the pending-fact reason written for a non-markdown source whose
 * bytes differ from the recorded `sourceRevision`, or that cannot be checked. A typed
 * `PendingReason` since `[D-518]` (`ol-egov.141.89.5.81`); `[D-473]`'s tolerant reader keeps it on
 * older builds.
 */
export const SOURCE_REVISION_REASON: PendingReason = 'source-revision-changed';

/**
 * `ol-egov.141.89.5.77`: how many times in all (the first attempt included) a confirmed rewrite's
 * enqueue-then-suspend step is tried across passes before the failure is recorded and given up.
 */
const SUCCESSOR_RETRY_BOUND = 5;

/** A confirmed rewrite whose suspend or enqueue failed, remembered (in memory) so later passes retry it with no judge call. */
interface ConfirmedRewrite {
  readonly judgedContentHash: string;
  readonly conceptIds: readonly string[];
  readonly predecessorInstrumentId: string;
  readonly successorEnqueueInput: EnqueueInput;
  /** `[D-598]`: who decided this rewrite, written again on a retry only if the first write did not land. */
  readonly decidedBy: PersistedStageProducer | null;
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
   * `[D-536]` (ruled 2026-10-06, `ol-egov.141.89.9.98`): whether this predecessor already has a
   * successor from an earlier rewrite, queued or accepted. Asked only when a rewrite is about to be
   * made for a question whose review log shows her unsuspend after a suspend
   * (`ol-egov.141.89.5.94`; a rewrite whose suspend never landed is retried, not asked): a question that already
   * has a successor is then left as she set it, neither suspended nor given another successor, and
   * stays withheld by its pending fact. Omitted reads as "no successor".
   */
  readonly hasSuccessor?: (instrumentId: string) => Promise<boolean>;
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
  /**
   * `ol-egov.141.89.5.84` ([D-518]): asks the host to (re-)extract a cited non-markdown source whose
   * bytes this pass has just withheld a question for, when no extracted text for those exact bytes is
   * held (a restart forgot it, or the file changed while Obsidian was closed). Called at most once
   * per (source, bytes) per session; a failure is logged and the hold stands. Omitted: never asks.
   */
  readonly requestSourceReextraction?: (sourcePath: string) => Promise<void>;
  /**
   * `ol-egov.141.89.5.43`: follow lecture-transcript citations by their passage's text, at part or
   * whole grain (this module's doc, "LECTURE TRANSCRIPTS AT PART GRAIN, OR WHOLE"). On in
   * production (`main.ts`, `ol-egov.141.89.5.97`), together with the session's presentation-time
   * check at the same grain (`review/open-session.ts`). Omitted or false: the bytes handling.
   */
  readonly transcriptPartGrain?: boolean;
}

/** One pass's reads of transcript files, each read at most once per pass. */
interface TranscriptReads {
  read(path: VaultPath): Promise<TranscriptRead>;
}

/** Same rule `process-now.ts`'s own private `isMarkdownPath` uses; duplicated rather than imported since that module doesn't export it and this one has no other reason to depend on `ingestion/process-now.ts`. */
function isMarkdownVaultPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * `ol-egov.141.89.5.111`: whether `path` names a file a citation follows through a rename by its
 * citation (a PDF, slide deck or document): not Markdown, and not a lecture transcript, whose
 * questions are followed by their anchor instead (`CitationRevisionTrigger.onSourceRenamed`).
 */
function isCitedFilePath(path: VaultPath): boolean {
  return !isMarkdownVaultPath(path) && !hasTranscriptExtension(path);
}

/** `[D-515]`: true when the instrument's citation names a non-markdown file other than its own note. */
function citesBinarySource(record: VaultInstrumentRecord): boolean {
  const sourcePath = record.sourceProvenance?.sourcePath;
  return (
    sourcePath !== undefined && sourcePath !== record.notePath && !isMarkdownVaultPath(sourcePath)
  );
}

/**
 * `ol-egov.141.89.5.43`: the path to read a transcript-grounded instrument's transcript from — the
 * logical source's current path, which is where the anchor last saw the passage once it holds one
 * (a rename Olea saw moves it), else the path the citation names — or `undefined` when the
 * instrument does not cite a transcript. `.txt`/`.vtt`/`.srt` are transcripts by their path;
 * Markdown only when the file at that path declares itself one (an undeclared `.md` is her note).
 * A Markdown path whose file is gone cannot be told apart, and keeps the ordinary handling (the
 * presentation-time check withholds it, the file being unreadable).
 */
async function transcriptCitationPath(
  record: VaultInstrumentRecord,
  previous: CitationAnchorRecord | undefined,
  transcripts: TranscriptReads,
): Promise<VaultPath | undefined> {
  const cited = record.sourceProvenance?.sourcePath;
  if (cited === undefined || cited === record.notePath) return undefined;
  const current =
    previous !== undefined && previous.sourcePath !== record.notePath ? previous.sourcePath : cited;
  if (hasTranscriptExtension(cited)) return current;
  if (!isMarkdownVaultPath(cited)) return undefined;
  const read = await transcripts.read(current);
  return read.kind === 'read' || read.kind === 'unreadable' ? current : undefined;
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
 * `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`): the notes a citation anchor already follows for a
 * drafted question — the note it last anchored (`anchorSourcePath`), its cited note
 * ({@link citedPassagePath}) and its cited source. Each is judged by the anchor's own checks at its
 * own grain and free exits (passage grain, a transcript's part or whole, a binary's bytes), so the
 * input-note comparison leaves them out: here in the pass (`routeIfInputNotesChanged`) and at
 * presentation (`review/open-session.ts`), one rule for both.
 */
export function notesFollowedByAnchor(
  anchorSourcePath: VaultPath,
  record: VaultInstrumentRecord,
): ReadonlySet<string> {
  const followed = new Set<string>([anchorSourcePath, citedPassagePath(record)]);
  const cited = record.sourceProvenance?.sourcePath;
  if (cited !== undefined) followed.add(cited);
  return followed;
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
 *
 * Exported for `../../attainment/passage-changes.ts` (`ol-egov.141.89.9.98`): when the store cannot
 * be read, an instrument this rule does not track is the one kind that can carry no pending fact.
 */
export function isTrackedForRevision(record: VaultInstrumentRecord): boolean {
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
  inputNotesRouted: number;
}

/** A zeroed report. */
function blankTickReport(): MutableTickReport {
  return {
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
    inputNotesRouted: 0,
  };
}

/** What {@link CitationRevisionTrigger.onSourceUnitsLanded} did: questions rewritten, and questions left held because the cited page has no text. Counts only. */
export interface SourceLandingResult {
  readonly rewritten: number;
  readonly heldNoText: number;
}

/**
 * Where a passage-grain anchor's passage now stands, and under which rule — threaded from the read
 * to every write that advances the anchor. A transcript passage (`ol-egov.141.89.5.43`) has no
 * rule: it is found by its text, and its anchor keeps the citation's digest only to say it is held
 * at part grain (`transcriptDigest`, `[D-567]`).
 */
interface PassageContext {
  readonly sourcePath: VaultPath;
  readonly rule?: PassageRule;
  /**
   * `ol-egov.141.89.5.97` ([D-567]): a part-grain transcript anchor's digest, carried unchanged by
   * every write that advances the anchor so it stays at part grain. Absent for a whole-transcript
   * anchor, which carries none.
   */
  readonly transcriptDigest?: string;
  /**
   * `ol-egov.141.89.5.104` ([D-567], [D-508]): a transcript passage only, the bytes hash of the
   * version this pass read it from. A successor drafted from it carries this on its job
   * (`InstrumentRevisionJobPayload.sourceRevision`, an existing field), so its citation records the
   * version it was drafted from and it is presented, not withheld at first sighting. Memory only.
   */
  readonly sourceRevision?: string;
}

/**
 * The successor's job for a rewrite: as `evaluateCitedPassageRevision` built it, except that a
 * transcript passage's version travels with it (`PassageContext.sourceRevision`).
 */
function successorInputFor(
  event: RevisionEvent,
  currentText: string,
  passage: PassageContext | undefined,
  built?: EnqueueInput,
): EnqueueInput {
  if (passage?.sourceRevision !== undefined) {
    return buildSuccessorRevisionEnqueueInput(event, currentText, passage.sourceRevision);
  }
  return built ?? buildSuccessorRevisionEnqueueInput(event, currentText);
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
 * `[D-473]` (`ol-egov.141.89.5.43`): the pending reasons this build raises for a source change and
 * may therefore resolve itself — none (a difference awaiting the judge), the three passage reasons,
 * and the changed bytes of a non-markdown source. Any other reason (one a newer build wrote, such
 * as the withholding `[D-467]` requires for a lecturer's correction) is a hold the pass leaves
 * exactly as it is: see this module's `[D-473]` doc section.
 */
function isReasonThisBuildResolves(reason: string | undefined): boolean {
  return reason === undefined || isKnownPassageReason(reason) || reason === SOURCE_REVISION_REASON;
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
  if (passage?.rule === undefined) {
    return passage?.transcriptDigest === undefined
      ? {}
      : { passageDigest: passage.transcriptDigest };
  }
  return { passageDigest: await digestPassage(text, passage.rule) };
}

export class CitationRevisionTrigger {
  /**
   * `ol-egov.141.89.5.77`: confirmed rewrites whose suspend or enqueue failed, by instrument id. Held
   * in memory only (a persisted field would be a schema change); a restart forgets it and the
   * ordinary `[D-400]` budget then governs, which keeps the question withheld, never restored.
   */
  private readonly confirmedRewrites = new Map<string, ConfirmedRewrite>();
  /**
   * `ol-egov.141.89.5.94`: instruments whose review log shows an `unsuspend` after an earlier
   * `suspend`, refreshed from the log at the start of each pass that can read it. Only these are
   * asked `hasSuccessor`: an unsuspend after a suspend is her undoing of the rewrite's suspend.
   * A rewrite whose suspend never landed (a failure, then a restart) leaves no such record, so its
   * suspend is retried instead of being read as hers. An unreadable log leaves the set empty.
   */
  private unsuspendedAfterSuspend: ReadonlySet<string> = new Set();

  /**
   * `ol-egov.141.89.5.81` ([D-518]): the re-extracted page texts of each source some tracked
   * question cites, by source path, with the byte hash they were extracted from. Memory only, like
   * {@link confirmedRewrites}: a restart forgets it, the hold stands, and the next extraction of the
   * file lands again. `ol-egov.141.89.7.82`: deliveries of one version are merged by the pages each
   * covered, never replacing the file's text; see `landed-source-text.ts` for the rules.
   */
  private readonly landedSources = new LandedSourceText();

  /** `ol-egov.141.89.5.84`: `sourcePath\n bytes hash` pairs this session already asked a re-extraction for. Memory only. */
  private readonly reextractionAsked = new Set<string>();

  /**
   * `ol-egov.141.89.2.39` (finding F; `[D-576]`, `[D-628]`): the renames Olea saw whose moves
   * ({@link onSourceRenamed}) have not finished yet, oldest first. The vault already has the file at
   * its new path while its records still name the old one, so a pass running meanwhile, and the
   * session's presentation check (`renamedPathOf`, wired by `main.ts`), read a recorded path through
   * this list: a rename alone never reads as a note gone. Memory only; each entry leaves the list
   * once its moves are written.
   */
  private readonly renamesInFlight: { readonly from: VaultPath; readonly to: VaultPath }[] = [];

  /**
   * `ol-egov.141.89.2.39` (finding F): the tail of the one queue the batch pass ({@link tick}) and a
   * rename's moves ({@link onSourceRenamed}) run on, one at a time, so a pass never reads records a
   * rename is half-way through moving and the two never write the same anchor at once.
   */
  private exclusive: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CitationRevisionTriggerDeps) {}

  /** Runs `task` after every pass and rename move queued before it — see {@link exclusive}. */
  private serialised<T>(task: () => Promise<T>): Promise<T> {
    const run = this.exclusive.then(task, task);
    this.exclusive = run.catch(() => undefined);
    return run;
  }

  /**
   * `ol-egov.141.89.2.39` (finding F): where `path` stands now, following every rename Olea saw
   * whose moves are still being written ({@link renamesInFlight}); `path` itself when none is.
   * Read by the pass for an input note's fingerprint and by the session's presentation check, so a
   * note a rename is moving is read at its new path. A rename alone never changes a fingerprint.
   */
  renamedPathOf(path: VaultPath): VaultPath {
    let current = path;
    for (let hop = 0; hop < this.renamesInFlight.length; hop += 1) {
      const next = this.renamesInFlight.find((rename) => rename.from === current);
      if (next === undefined) break;
      current = next.to;
    }
    return current;
  }

  /**
   * One whole-vault batch pass — see this module's own doc for why per-tick,
   * not per-modify-event. `ol-egov.141.89.2.39` (finding F): queued behind any rename's moves
   * still being written, and they behind it ({@link serialised}).
   */
  tick(vault: VaultSource, actions: CitationRevisionActions): Promise<CitationRevisionTickReport> {
    return this.serialised(() => this.runTick(vault, actions));
  }

  private async runTick(
    vault: VaultSource,
    actions: CitationRevisionActions,
  ): Promise<CitationRevisionTickReport> {
    const report = blankTickReport();
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
          undefined,
          // `[D-598]`: the hold for a real difference is raised by the hash comparison.
          codeRule('cited-text-differs'),
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

    // "The material," per this module's own doc: the note minus every question block in it.
    // `ol-egov.141.89.5.113` (C5.3 as amended by [D-543]): every block the instrument parsers find,
    // bound to a course or not, exactly as the session's presentation check strips them
    // (`stripQuestionBlocks`). Before, only the blocks the vault walk enumerates (those bound to a
    // course) were stripped, so a cited note holding a block bound to no course never read the same
    // on both sides, and its question was set aside at every presentation.
    const materialCache = new Map<VaultPath, string>();
    const materialFor = async (notePath: VaultPath): Promise<string> => {
      const cached = materialCache.get(notePath);
      if (cached !== undefined) return cached;
      const material = stripQuestionBlocks(await vault.read(notePath));
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

    // `ol-egov.141.89.5.43`: each transcript file read at most once per pass, and only when part
    // grain is on.
    const transcriptGrain = this.deps.transcriptPartGrain === true;
    const transcriptReadCache = new Map<VaultPath, Promise<TranscriptRead>>();
    const transcripts: TranscriptReads = {
      read: (path) => {
        let read = transcriptReadCache.get(path);
        if (read === undefined) {
          read = readTranscriptVersion(vault, path);
          transcriptReadCache.set(path, read);
        }
        return read;
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
    let suspendedIds: ReadonlySet<string> = new Set();
    let suspensionKnown = false;
    // `ol-egov.141.89.2.39` (finding E): the log, kept for the drafted-item provenance below.
    let reviewEntries: readonly ReviewLogEntry[] = [];
    try {
      const { entries } = await readReviewLogHistory(vault);
      reviewEntries = entries;
      // `ol-egov.141.89.5.81` ([D-518]): a SUSPENDED instrument (her own, or this trigger's rewrite of
      // it) is left alone by the pass, read from the same log by the shared fold the presentation
      // path uses, so an `unsuspend` lifts it here too.
      suspendedIds = suspendedInstrumentIds(entries);
      this.unsuspendedAfterSuspend = unsuspendedAfterSuspendIds(entries);
      suspensionKnown = true;
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

    // `[D-628]` (`ol-egov.141.89.2.39`): the kept items Olea drafted through a draft record, by
    // provenance that survives a purge of the draft cache: the accept or edit verdict her review log
    // holds for each (`draftedInstrumentIdsOf`, finding E), with the cache's accepted and edited
    // records added. A cache that cannot be read leaves the log's answer; a log that cannot be read
    // leaves the cache's.
    let cachedDrafts: readonly DraftRecord[] = [];
    try {
      cachedDrafts = await createVaultDraftCacheStore(vault).list();
    } catch (error) {
      console.error(
        'Olea: citation-revision could not read the draft cache',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    const draftedInstrumentIds = draftedInstrumentIdsOf(reviewEntries, cachedDrafts);

    // `[D-628]`: each input note's fingerprint read at most once per pass, however many items share it.
    const fingerprints = new Map<VaultPath, Promise<string | undefined>>();
    // `ol-egov.141.89.2.39` (finding F): a note a rename in flight is moving is read at its new path.
    const fingerprintOf = (recordedPath: VaultPath): Promise<string | undefined> => {
      const path = this.renamedPathOf(recordedPath);
      let fingerprint = fingerprints.get(path);
      if (fingerprint === undefined) {
        fingerprint = inputNoteFingerprint(vault, path);
        fingerprints.set(path, fingerprint);
      }
      return fingerprint;
    };

    const judgeCalls: Array<() => Promise<void>> = [];
    for (const [instrumentId, previous] of stored) {
      // `ol-egov.141.89.2.14`: a standing rejection wins over every other check this loop makes
      // — no current-passage read, no judge dispatch, no store write, no suspend, no enqueue.
      // Left tracked as-is: once she restores it, the ordinary revision check resumes from the
      // same baseline, exactly as if this pass had never run for it.
      if (rejectedInstrumentIds.has(instrumentId)) continue;
      // `ol-egov.141.89.9.98` ([D-522], [D-536]): a suspended question with a check owed (a pending
      // fact) is left alone — no read, no judge call, no write, no suspend, no enqueue — until she
      // unsuspends it. A completed rewrite leaves exactly this state (the old question suspended,
      // its entry and fact kept as the exclusion of its evidence), so it is never judged or
      // rewritten again; her own suspension of a question with a check owed waits the same way.
      // A log that cannot be read leaves such an anchor waiting too: an unknown suspension is
      // never taken for none.
      if (
        previous.pendingRevalidation !== undefined &&
        (!suspensionKnown || suspendedIds.has(instrumentId))
      ) {
        continue;
      }
      // `[D-473]` (`ol-egov.141.89.5.43`): a hold for a reason this build does not raise itself is
      // left exactly as it is — no read, no judge call, no write — so no fact this pass raises can
      // replace it and no later pass can lift the replacement. See this module's `[D-473]` section.
      if (
        previous.pendingRevalidation !== undefined &&
        !isReasonThisBuildResolves(previous.pendingRevalidation.reason)
      ) {
        continue;
      }
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
      // `[D-626]`/`[D-628]`: every input note the anchor does not already follow, before anything
      // else reads the item — see this module's section.
      if (
        currentRecord !== undefined &&
        (await this.routeIfInputNotesChanged(
          vault,
          currentRecord,
          previous,
          draftedInstrumentIds,
          materialFor,
          fingerprintOf,
          actions,
          report,
        ))
      ) {
        continue;
      }
      // `ol-egov.141.89.5.43`: a transcript-grounded instrument is followed at part grain, by its
      // passage's text, when that grain is on; the bytes path below never sees it.
      const transcriptPath =
        transcriptGrain && currentRecord !== undefined
          ? await transcriptCitationPath(currentRecord, previous, transcripts)
          : undefined;
      // `ol-egov.141.89.5.73` ([D-515]): a non-markdown source is never diffed as text, so its
      // bytes are compared with the sidecar's `sourceRevision` instead, and the question is
      // withheld here, before any judge call is awaited ([D-514] b).
      if (
        transcriptPath === undefined &&
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
      // `ol-egov.141.89.5.113`: a whole-note anchor saved before every question block was stripped,
      // whose note is otherwise unchanged (set in the whole-note branch below).
      let restrippedBaseline = false;
      // `ol-egov.141.89.2.39` (finding D): a whole cited note that differs from its anchor only by
      // frontmatter Olea wrote itself (set in the whole-note branch below).
      let oleaWritesOnly = false;
      try {
        if (transcriptPath !== undefined && currentRecord !== undefined) {
          // `ol-egov.141.89.5.43`: unchanged, withheld or (re-)seeded is settled there; a passage
          // found unchanged, or one changed region, continues into the compare-and-judge below.
          const located = await this.locateTranscriptPassage(
            vault,
            instrumentId,
            previous,
            currentRecord,
            transcriptPath,
            transcripts,
            passageNotes,
            actions,
            report,
          );
          if (located === undefined) continue;
          current = { kind: 'found-at-anchor', text: located };
          const version = await transcripts.read(previous.sourcePath);
          passage = {
            sourcePath: previous.sourcePath,
            ...(version.kind === 'read' ? { sourceRevision: version.version.bytesHash } : {}),
            ...(previous.passageDigest !== undefined
              ? { transcriptDigest: previous.passageDigest }
              : {}),
          };
        } else if (currentRecord !== undefined && previous.passageDigest !== undefined) {
          // Passage grain: ask WHERE the anchored passage stands now, by the shared rule. Only a
          // passage found in place (unchanged, reformatted, or edited-and-unmistakable) continues
          // into the ordinary compare-and-judge below; a moved, missing or ambiguous passage is
          // settled here, with no judge call.
          // `ol-egov.141.89.5.78`: an anchor withheld at first sighting (no text, only the
          // citation's digest) is re-tried by that digest before the text-based read, which has
          // nothing to compare.
          if (
            await this.retryWithheldFirstSighting(
              instrumentId,
              previous,
              currentRecord,
              passageNotes,
              rules,
              actions,
              report,
            )
          ) {
            continue;
          }
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
          const wholeNote = await materialFor(citedPassagePath(currentRecord));
          if (canonicalizeForMateriality(wholeNote).length === 0) {
            // `ol-egov.141.89.5.95` (C5.3 as amended by [D-508], [D-543]): a whole cited note with
            // no groundable content has no current passage to rewrite from. Withheld exactly as
            // a missing passage is at passage grain: no judge call, nothing suspended, no
            // successor, no baseline adopted, so refilled content takes the ordinary route.
            await this.applyPassageResolution(
              instrumentId,
              previous,
              currentRecord,
              { kind: 'unresolved', reason: 'missing' },
              passageNotes,
              actions,
              report,
            );
            continue;
          }
          current = { kind: 'found-at-anchor', text: wholeNote };
          // `ol-egov.141.89.5.113`: an anchor an earlier build saved with a block bound to no course
          // left in holds the same material when that text, stripped by the current rule, reads as
          // the note does now: a free exit like a reformat, no judge call (the free exit below).
          restrippedBaseline =
            canonicalizeForMateriality(stripQuestionBlocks(previous.text)) ===
            canonicalizeForMateriality(wholeNote);
          // `ol-egov.141.89.2.39` (finding D; `[D-626]`): the frontmatter writes Olea makes itself
          // (a first-sight stamp, a home note's `topic:` growth or drafted-for record) are not a
          // change to her material, here as in the input-note fingerprint (one rule,
          // `stripOleaFrontmatterWrites`). Both sides are stripped at comparison, so an anchor saved
          // before keeps reading.
          oleaWritesOnly =
            canonicalizeForMateriality(stripOleaFrontmatterWrites(previous.text)) ===
            canonicalizeForMateriality(stripOleaFrontmatterWrites(wholeNote));
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
          restrippedBaseline ||
          oleaWritesOnly ||
          canonicalizeForMateriality(current.text) === canonicalizeForMateriality(previous.text))
      ) {
        report.formattingOnly += 1;
        // `[D-598]`: the narrowest of the three exit rules above that settles it. A whitespace-only
        // match by the passage ladder is the reformat; otherwise equal canonical text is
        // formatting-only; only an anchor that needed the current strip to read the same is the
        // restrip. (Order matters: an already-stripped anchor always passes the restrip test too,
        // so testing it first would name the restrip for every formatting-only edit.)
        const settledBy = codeRule(
          reformattedByLadder
            ? 'passage-reformatted'
            : canonicalizeForMateriality(current.text) === canonicalizeForMateriality(previous.text)
              ? 'formatting-only'
              : restrippedBaseline
                ? 'question-blocks-restripped'
                : 'olea-frontmatter-writes',
        );
        try {
          await this.deps.store.save(instrumentId, {
            sourcePath: passage?.sourcePath ?? citedPassagePath(currentRecord),
            text: current.text,
            settledBy,
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
              confirmed.decidedBy,
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
              // `[D-598]`: stored only when this dispatch is the one that raises the fact.
              codeRule('cited-text-differs'),
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

    // `[D-518]`: units that landed before this pass saw the new bytes (or a rewrite whose enqueue
    // failed) are acted on here, with no judge call.
    await this.rewriteHeldFromLandedSources(vault, actions, report);

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
      // `ol-egov.141.89.5.81`: nor is a suspended one (re-seeding a question with no record, such
      // as one rewritten before `ol-egov.141.89.9.98` kept the record, would re-raise a hold and
      // suspend it again every pass).
      if (suspendedIds.has(instrumentId)) continue;
      // `[D-626]`/`[D-628]`: at first sighting every input note is compared, the cited one included,
      // so a change made since drafting is routed rather than adopted as the baseline.
      if (
        await this.routeIfInputNotesChanged(
          vault,
          record,
          undefined,
          draftedInstrumentIds,
          materialFor,
          fingerprintOf,
          actions,
          report,
        )
      ) {
        continue;
      }
      try {
        // `ol-egov.141.89.5.43`: a transcript-grounded instrument is seeded at its cited part, and
        // only from the version its citation was drafted from (PERSISTENCE 2.9); never by the
        // bytes path below.
        const transcriptPath = transcriptGrain
          ? await transcriptCitationPath(record, undefined, transcripts)
          : undefined;
        if (transcriptPath !== undefined) {
          await this.seedTranscriptAnchor(
            vault,
            instrumentId,
            record,
            transcriptPath,
            transcripts,
            report,
            undefined,
          );
          continue;
        }
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
            settledBy: codeRule('first-sighting'),
          });
          await this.deps.store.setPendingRevalidation(
            instrumentId,
            await hashText(`${seeded.withheld}\n${await materialFor(path)}`),
            this.deps.clock.now(),
            seeded.withheld,
            codeRule('passage-seed-unresolved'),
          );
          continue;
        }
        if (seeded !== undefined) {
          await this.deps.store.save(instrumentId, {
            sourcePath: path,
            text: seeded.text,
            passageDigest: seeded.digest,
            conceptIds: record.conceptIds,
            settledBy: codeRule('first-sighting'),
          });
          report.newlyBaselined += 1;
          continue;
        }
        const text = await materialFor(path);
        await this.deps.store.save(instrumentId, {
          sourcePath: path,
          text,
          conceptIds: record.conceptIds,
          settledBy: codeRule('first-sighting'),
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

    // `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`, finding C): a drafted question whose citation
    // records no page (an item kept before every drafting path cited a note: the heading offer's,
    // a generation job's) carries no source the walk can follow, so it is not tracked above, yet the
    // session withholds it for a changed input note or for recording none. It is routed here by the
    // same rule as a first sighting, so every item withheld for its input notes reaches the rewrite.
    // Nothing is baselined for it: an untracked question has no anchor to keep.
    for (const record of exemptRecords) {
      const instrumentId = record.instrumentId;
      if (!draftedInstrumentIds.has(instrumentId)) continue;
      if (stored.has(instrumentId)) continue;
      if (rejectedInstrumentIds.has(instrumentId)) continue;
      // An unknown suspension is never taken for none: an unreadable log routes nothing here.
      if (!suspensionKnown || suspendedIds.has(instrumentId)) continue;
      await this.routeIfInputNotesChanged(
        vault,
        record,
        undefined,
        draftedInstrumentIds,
        materialFor,
        fingerprintOf,
        actions,
        report,
      );
    }

    return report;
  }

  /**
   * `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`): routes one drafted question whose input notes no
   * longer support it — see this module's section. `previous` is its anchor, or `undefined` at first
   * sighting. With an anchor, the notes it already follows (its own path, the cited note, the cited
   * source) are left to it; at first sighting every input note is compared. Returns `true` when the
   * question was routed (the caller then leaves it for this pass), `false` when nothing applies.
   *
   * Routed means: an anchor is saved for it if it has none (its cited note's material as it stands,
   * first-sighting rule) so the hold has a record to attach to; the hold is raised (rule
   * `input-note-changed`, or `input-notes-unrecorded` for an item drafted before input notes were),
   * keyed to the changed notes and the cited material; and the rewrite is enqueued, then the question
   * suspended, through the shared {@link suspendAndEnqueueSuccessor}, its successor drafted from the
   * cited note as it stands. A failure is logged and the question stays withheld by its hold.
   */
  private async routeIfInputNotesChanged(
    vault: VaultSource,
    record: VaultInstrumentRecord,
    previous: CitationAnchorRecord | undefined,
    draftedInstrumentIds: ReadonlySet<string>,
    materialFor: (path: VaultPath) => Promise<string>,
    fingerprintOf: (path: VaultPath) => Promise<string | undefined>,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<boolean> {
    const instrumentId = record.instrumentId;
    let rule: 'input-note-changed' | 'input-notes-unrecorded';
    let changedKey: string;
    try {
      const citation = await readInstrumentCitationRecord(vault, instrumentId);
      const notes = citation?.inputNotes;
      if (notes === undefined) {
        if (!draftedInstrumentIds.has(instrumentId)) return false;
        rule = 'input-notes-unrecorded';
        changedKey = 'unrecorded';
      } else {
        // With an anchor, the notes it follows are its own to judge. At first sighting every note
        // is compared, except the single-passage case's note: its passage is seeded by its digest
        // below (`seedPassageAnchor`), at passage grain, never by a whole-note fingerprint
        // (`ol-egov.141.89.2.39`, finding B).
        const passageNote = singlePassageNote(citation, notes);
        const followed: ReadonlySet<string> =
          previous !== undefined
            ? notesFollowedByAnchor(previous.sourcePath, record)
            : new Set(passageNote === undefined ? [] : [passageNote]);
        const changed = await changedInputNotes(vault, notes, followed, fingerprintOf);
        if (changed.length === 0) return false;
        rule = 'input-note-changed';
        changedKey = changed.map((note) => note.path).join('\n');
      }
    } catch (error) {
      console.error('Olea: citation-revision input-note read failed', errorName(error));
      return false;
    }

    report.inputNotesRouted += 1;
    try {
      const citedPath = citedPassagePath(record);
      let text = '';
      try {
        text = await materialFor(citedPath);
      } catch {
        // The cited note cannot be read: the question is still withheld, and its successor is
        // drafted from whatever the rewrite job finds there.
      }
      if (previous === undefined) {
        await this.deps.store.save(instrumentId, {
          sourcePath: citedPath,
          text,
          conceptIds: record.conceptIds,
          settledBy: codeRule('first-sighting'),
        });
      }
      const judgedContentHash = await hashText(`${rule}\n${changedKey}\n${text}`);
      await this.deps.store.setPendingRevalidation(
        instrumentId,
        judgedContentHash,
        this.deps.clock.now(),
        undefined,
        codeRule(rule),
      );
      const event: RevisionEvent = {
        instrumentId,
        at: this.deps.clock.now(),
        oldContentHash: await hashText(previous?.text ?? ''),
        newContentHash: judgedContentHash,
        change: rule,
      };
      await this.suspendAndEnqueueSuccessor(
        instrumentId,
        record.conceptIds,
        judgedContentHash,
        instrumentId,
        buildSuccessorRevisionEnqueueInput(event, text),
        actions,
        report,
        codeRule('input-note-rewrite'),
      );
    } catch (error) {
      console.error('Olea: citation-revision input-note route failed', errorName(error));
    }
    return true;
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
   * Returns the hash the withholding fact is keyed to (undefined when nothing was withheld or the
   * write failed), so a caller that goes on to rewrite the question can guard on that same fact.
   */
  private async applyPassageResolution(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord,
    resolution: Exclude<PassageResolution, { kind: 'present' }>,
    notes: PassageNotes,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<string | undefined> {
    if (resolution.kind === 'relocated') {
      report.relocated += 1;
      try {
        await this.deps.store.save(instrumentId, {
          sourcePath: resolution.sourcePath,
          text: resolution.text,
          passageDigest: await digestPassage(resolution.text, resolution.rule),
          ...carriedPending(previous),
          conceptIds: currentRecord.conceptIds,
          settledBy: codeRule('passage-relocated'),
        });
      } catch (error) {
        console.error('Olea: citation-revision passage relocation-heal write failed', error);
      }
      return undefined;
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
      const sinceContentHash = await hashText(`${reason}\n${observed}`);
      await this.deps.store.setPendingRevalidation(
        instrumentId,
        sinceContentHash,
        this.deps.clock.now(),
        reason,
        codeRule('passage-unresolved'),
      );
      return sinceContentHash;
    } catch (error) {
      console.error('Olea: citation-revision passage withhold write failed', error);
      return undefined;
    }
  }

  /**
   * `ol-egov.141.89.5.78` ([D-514] item a, [D-508]): an anchor saved withheld at first sighting
   * (empty text, the citation's digest, a pending fact with a passage reason) is re-tried by its
   * stored digest, with the SAME locator first sighting uses. A digest match is identical text, so
   * a unique match in the cited note, or (when the note holds none) exactly one in another note,
   * seeds the anchor and clears the fact with no judge call. Ambiguous and unsupported-rule
   * outcomes keep their reason and the hold. Returns true when the pass settled the instrument
   * here; false leaves it to the ordinary read (a passage that is still absent stays withheld as
   * a tracked missing passage does). A non-markdown source never takes this path.
   */
  private async retryWithheldFirstSighting(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord,
    notes: PassageNotes,
    rules: readonly PassageRule[],
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<boolean> {
    const digest = previous.passageDigest;
    if (
      digest === undefined ||
      previous.text !== '' ||
      !isKnownPassageReason(previous.pendingRevalidation?.reason)
    ) {
      return false;
    }
    const ownPath = citedPassagePath(currentRecord);
    if (!isMarkdownVaultPath(ownPath)) return false;
    try {
      const own = await locatePassageByDigest(await notes.material(ownPath), digest, rules);
      if (own.status === 'unique') {
        await this.deps.store.save(instrumentId, {
          sourcePath: ownPath,
          text: own.segment.text,
          passageDigest: digest,
          conceptIds: currentRecord.conceptIds,
          settledBy: codeRule('first-sighting'),
        });
        report.newlyBaselined += 1;
        return true;
      }
      if (own.status !== 'absent') {
        await this.applyPassageResolution(
          instrumentId,
          previous,
          currentRecord,
          {
            kind: 'unresolved',
            reason: own.status === 'ambiguous' ? 'ambiguous' : 'rule-unsupported',
          },
          notes,
          actions,
          report,
        );
        return true;
      }
      // Absent from its own note: the relocation heal, by digest, over every other note.
      const found: { path: VaultPath; text: string }[] = [];
      let ambiguous = false;
      for (const path of await notes.markdownPaths()) {
        if (path === ownPath) continue;
        let located: Awaited<ReturnType<typeof locatePassageByDigest>>;
        try {
          located = await locatePassageByDigest(await notes.material(path), digest, rules);
        } catch {
          continue;
        }
        if (located.status === 'unique') found.push({ path, text: located.segment.text });
        else if (located.status === 'ambiguous') ambiguous = true;
      }
      const only = found[0];
      if (found.length === 1 && only !== undefined && !ambiguous) {
        const version = parsePassageDigest(digest)?.version;
        const rule = rules.find((candidate) => candidate.version === version);
        if (rule !== undefined) {
          await this.applyPassageResolution(
            instrumentId,
            previous,
            currentRecord,
            { kind: 'relocated', sourcePath: only.path, text: only.text, rule },
            notes,
            actions,
            report,
          );
          return true;
        }
      }
      if (found.length > 1 || ambiguous) {
        await this.applyPassageResolution(
          instrumentId,
          previous,
          currentRecord,
          { kind: 'unresolved', reason: 'ambiguous' },
          notes,
          actions,
          report,
        );
        return true;
      }
    } catch (error) {
      console.error('Olea: citation-revision withheld-anchor digest retry failed', error);
    }
    return false;
  }

  /**
   * `ol-egov.141.89.5.43` (module doc, "LECTURE TRANSCRIPTS AT PART GRAIN, OR WHOLE"): where a
   * transcript-grounded instrument's cited passage stands now. Returns the text to carry into the
   * compare-and-judge (the anchor's own text when the passage stands unchanged, so the pass reads
   * `unchanged`; the one changed region otherwise; at whole grain, the whole transcript's spoken
   * text now, `[D-567]`), or `undefined` when settled here:
   *  - an anchor that does not yet hold a transcript passage (first seen before part grain applied,
   *    so it holds the home note; or withheld at first sighting, so it holds no text) is seeded
   *    again by the first-sighting rule;
   *  - a transcript that is gone, or no longer reads as one, withholds as `passage-missing`;
   *  - at part grain, the passage standing twice, or two resembling regions, withholds as
   *    `passage-ambiguous`.
   * Only the anchor's own path is read: no other file is searched.
   */
  private async locateTranscriptPassage(
    vault: VaultSource,
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord,
    transcriptPath: VaultPath,
    transcripts: TranscriptReads,
    notes: PassageNotes,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<string | undefined> {
    if (previous.sourcePath === currentRecord.notePath || previous.text === '') {
      await this.seedTranscriptAnchor(
        vault,
        instrumentId,
        currentRecord,
        transcriptPath,
        transcripts,
        report,
        previous,
      );
      return undefined;
    }
    const read = await transcripts.read(previous.sourcePath);
    // `ol-egov.141.89.5.97` ([D-567], [D-543]): an anchor with no digest holds the whole transcript.
    // Its text now goes to the compare-and-judge as it is: the same words are unchanged, anything
    // else is a change to the cited material.
    if (previous.passageDigest === undefined && read.kind === 'read') {
      return wholeTranscriptText(read.version);
    }
    const resolution =
      read.kind === 'read'
        ? resolveTranscriptPassage(previous.text, read.version.words)
        : ({ kind: 'unresolved', reason: 'missing' } as const);
    if (resolution.kind === 'unresolved') {
      const heldBy = await this.applyPassageResolution(
        instrumentId,
        previous,
        currentRecord,
        { kind: 'unresolved', reason: resolution.reason },
        notes,
        actions,
        report,
      );
      // `ol-egov.141.89.5.119` ([D-578], C5.3 Relocation): a part that cannot be relocated in a
      // version that reads (no candidate, or more than one) is not held indefinitely. Withheld
      // above, the question goes down the whole-transcript route: a successor is drafted from the
      // current version and the old question is suspended. No materiality read is asked: nothing
      // of the cited part is known to judge, and no answer could certify the old question.
      if (read.kind === 'read' && heldBy !== undefined) {
        await this.rewriteUnrelocatablePart(
          instrumentId,
          previous,
          currentRecord,
          read.version,
          heldBy,
          actions,
          report,
        );
      }
      return undefined;
    }
    return resolution.kind === 'present' ? previous.text : resolution.text;
  }

  /**
   * `ol-egov.141.89.5.119` ([D-578]): the rewrite of a part-named transcript question whose part
   * cannot be relocated. The successor is drafted from the transcript as it reads now (all its
   * spoken words, the grain of a whole-transcript question, `[D-567]`), carrying that version's
   * bytes hash so it is presented in turn (`ol-egov.141.89.5.104`); the predecessor is then
   * suspended, guarded on the hold just recorded. Enqueue first, so an orphan cannot arise
   * ({@link suspendAndEnqueueSuccessor}); a failure leaves the hold standing and the next pass
   * repeats it (a duplicate enqueue is reported as such, not an error). Uses only what the
   * existing anchor and hold already carry: no new persisted field.
   */
  private async rewriteUnrelocatablePart(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord,
    version: TranscriptVersion,
    heldBy: string,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<void> {
    try {
      const event: RevisionEvent = {
        instrumentId,
        at: this.deps.clock.now(),
        oldContentHash: await hashText(previous.text),
        // Per question, so two questions on one transcript are never collapsed by the queue's own idempotency.
        newContentHash: await hashText(`${version.bytesHash}\n${instrumentId}`),
        change: 'transcript-part-not-relocated',
      };
      await this.suspendAndEnqueueSuccessor(
        instrumentId,
        currentRecord.conceptIds,
        heldBy,
        instrumentId,
        buildSuccessorRevisionEnqueueInput(event, wholeTranscriptText(version), version.bytesHash),
        actions,
        report,
        codeRule('transcript-part-unrelocatable'),
      );
    } catch (error) {
      console.error('Olea: citation-revision unrelocatable-part rewrite failed', error);
    }
  }

  /**
   * `ol-egov.141.89.5.43` (PERSISTENCE 2.9), `ol-egov.141.89.5.97` (`[D-567]`): seeds a transcript
   * anchor only in the version the citation was drafted from (`seedFromCitation`): at the part its
   * passage digest names, keeping that digest so the anchor stays at part grain, or, for a citation
   * that names no part, with the whole transcript and no digest. Otherwise the anchor holds no text
   * and the question is withheld with the reason, keyed to the bytes observed, so a later pass that
   * finds the drafted version again seeds it. A seeded anchor replaces whatever the record held (a
   * home-note anchor from before part grain applied, and its hold): the cited material is then
   * exactly as drafted.
   */
  private async seedTranscriptAnchor(
    vault: VaultSource,
    instrumentId: string,
    record: VaultInstrumentRecord,
    transcriptPath: VaultPath,
    transcripts: TranscriptReads,
    report: MutableTickReport,
    previous: CitationAnchorRecord | undefined,
  ): Promise<void> {
    try {
      const citation = await readInstrumentCitation(vault, instrumentId);
      const read = await transcripts.read(transcriptPath);
      const seed = await seedFromCitation(
        read.kind === 'read' ? read.version : undefined,
        citation,
        this.deps.passageRules ?? PASSAGE_RULES,
      );
      if (seed.kind === 'seeded') {
        await this.deps.store.save(instrumentId, {
          sourcePath: transcriptPath,
          text: seed.text,
          ...(seed.passageDigest !== undefined ? { passageDigest: seed.passageDigest } : {}),
          conceptIds: record.conceptIds,
          settledBy: codeRule('first-sighting'),
        });
        report.newlyBaselined += 1;
        return;
      }
      report.passageSeedUnresolved += 1;
      if (
        previous === undefined ||
        previous.text !== '' ||
        previous.sourcePath !== transcriptPath
      ) {
        await this.deps.store.save(instrumentId, {
          sourcePath: transcriptPath,
          text: '',
          conceptIds: record.conceptIds,
          settledBy: codeRule('first-sighting'),
        });
      }
      await this.deps.store.setPendingRevalidation(
        instrumentId,
        await hashText(`${seed.reason}\n${seed.observed}`),
        this.deps.clock.now(),
        seed.reason,
        codeRule('transcript-seed-unresolved'),
      );
    } catch (error) {
      console.error('Olea: citation-revision transcript seed failed', error);
    }
  }

  /**
   * `ol-egov.141.89.5.43` (PERSISTENCE 2.2, lineage L2): a rename Olea saw while running is
   * lineage, so every anchor that last saw its passage at `oldPath` follows it to `newPath`, its
   * pending fact (any reason) kept as it was. Only when transcript part grain is on and the file at
   * `newPath` reads as a transcript; a markdown note has its own relocation ladder. A rename Olea
   * did not see (made while it was closed, or on another device) arrives as a delete and a create:
   * nothing calls this, the anchor finds its path gone and the question is withheld. Returns how many
   * anchors and citations moved. Its production caller is `main.ts`'s vault rename handler
   * (`ol-egov.141.89.5.97`).
   *
   * `ol-egov.141.89.5.111` ([D-576]; C5.3: a rename is lineage): a non-markdown source that is not a
   * transcript (a PDF, slide deck or document) is followed the same way. Its questions are anchored
   * at their own note and name the file only in their citation, so it is the citation record's path
   * that moves, through the citation store's own path-only call ({@link moveCitedFile}); the text
   * this session extracted from the file moves with it. Followed only when both paths are such files
   * and the file stands at `newPath`; a file that becomes a note or a transcript by its new name is
   * not the same kind of source, and its questions are withheld as before.
   *
   * `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`): whatever the file's kind, every drafted question
   * and pending draft whose input notes name `oldPath` follows it too ({@link moveInputNotes}), so a
   * rename alone never withholds an item drawn from that note.
   */
  async onSourceRenamed(
    vault: VaultSource,
    oldPath: VaultPath,
    newPath: VaultPath,
  ): Promise<number> {
    if (oldPath === newPath) return 0;
    // `ol-egov.141.89.2.39` (finding F): recorded at once, before the moves wait their turn, so a
    // pass already running reads the old path at the new one; the moves then run between passes.
    const rename = { from: oldPath, to: newPath };
    this.renamesInFlight.push(rename);
    try {
      return await this.serialised(async () => {
        const moved = await this.followRenameByKind(vault, oldPath, newPath);
        return moved + (await this.moveInputNotes(vault, oldPath, newPath));
      });
    } finally {
      const at = this.renamesInFlight.indexOf(rename);
      if (at !== -1) this.renamesInFlight.splice(at, 1);
    }
  }

  /**
   * `[D-626]`/`[D-628]`, `[D-576]` (`ol-egov.141.89.2.39`): a rename Olea saw of a note some drafted
   * item was drawn from. Each citation record whose input notes name `oldPath` has that entry, and
   * its cited path if that is `oldPath` too, moved to `newPath` through the citation store's path-only
   * call (`renameCitationSourcePath`, fingerprints and every other field kept), and its anchor follows
   * when it last saw the note at `oldPath`. Each pending draft whose input notes name it has the same
   * done through the draft cache's `put` (input-note paths, and its cited path when that is
   * `oldPath`; nothing else on the record touched). Nothing is read from the note itself: the
   * fingerprint describes its content, which a rename does not change. A rename that changes the
   * file's kind (by its extension) is not followed, as `[D-576]` rules for a cited file. Returns how
   * many records moved; a failure is logged and leaves the rest as they were.
   */
  private async moveInputNotes(
    vault: VaultSource,
    oldPath: VaultPath,
    newPath: VaultPath,
  ): Promise<number> {
    // `[D-576]`: a file that becomes another kind of source by its new name (a slide deck renamed
    // to a note, a note to a transcript) is not the same source, and is not followed.
    if (
      isMarkdownVaultPath(oldPath) !== isMarkdownVaultPath(newPath) ||
      hasTranscriptExtension(oldPath) !== hasTranscriptExtension(newPath)
    ) {
      return 0;
    }
    let moved = 0;
    try {
      const { records } = await enumerateVaultInstruments(vault);
      const anchors = await this.deps.store.loadAll();
      for (const record of records) {
        const citation = await readInstrumentCitationRecord(vault, record.instrumentId);
        if (citation?.inputNotes?.some((note) => note.path === oldPath) !== true) continue;
        if (!(await renameCitationSourcePath(vault, record.instrumentId, oldPath, newPath)))
          continue;
        moved += 1;
        const anchor = anchors.get(record.instrumentId);
        if (anchor !== undefined && anchor.sourcePath === oldPath) {
          await this.deps.store.save(record.instrumentId, { ...anchor, sourcePath: newPath });
        }
      }
      const cache = createVaultDraftCacheStore(vault);
      for (const draft of await cache.listPending()) {
        const notes = draft.inputNotes;
        if (notes?.some((note) => note.path === oldPath) !== true) continue;
        const citation = draft.sourceCitation;
        await cache.put({
          ...draft,
          inputNotes: notes.map((note) =>
            note.path === oldPath ? { ...note, path: newPath } : note,
          ),
          ...(citation !== undefined && citation.sourcePath === oldPath
            ? { sourceCitation: { ...citation, sourcePath: newPath } }
            : {}),
        });
        moved += 1;
      }
    } catch (error) {
      console.error('Olea: citation-revision input-note rename write failed', errorName(error));
    }
    return moved;
  }

  /** `onSourceRenamed`'s moves by the file's kind, as they stood before `[D-628]` — see its doc. */
  private async followRenameByKind(
    vault: VaultSource,
    oldPath: VaultPath,
    newPath: VaultPath,
  ): Promise<number> {
    if (isCitedFilePath(oldPath) && isCitedFilePath(newPath)) {
      return (await vault.exists(newPath)) ? this.moveCitedFile(vault, oldPath, newPath) : 0;
    }
    if (this.deps.transcriptPartGrain !== true) return 0;
    if ((await readTranscriptVersion(vault, newPath)).kind !== 'read') return 0;
    let moved = 0;
    try {
      for (const [instrumentId, anchor] of await this.deps.store.loadAll()) {
        if (anchor.sourcePath !== oldPath) continue;
        await this.deps.store.save(instrumentId, { ...anchor, sourcePath: newPath });
        moved += 1;
      }
    } catch (error) {
      console.error('Olea: citation-revision transcript rename write failed', error);
    }
    return moved;
  }

  /**
   * `ol-egov.141.89.5.111` ([D-576]): a rename Olea saw of a file checked by its bytes. Every
   * question whose citation names `oldPath`, anchored or not yet, has that citation's path changed
   * to `newPath` by `renameCitationSourcePath` (path only; the store refuses any record that does not
   * still name `oldPath`), and the text this session extracted from the file is kept under its new
   * path. Returns how many citations moved; a failure is logged and leaves the rest as they were.
   */
  private async moveCitedFile(
    vault: VaultSource,
    oldPath: VaultPath,
    newPath: VaultPath,
  ): Promise<number> {
    let moved = 0;
    try {
      const { records } = await enumerateVaultInstruments(vault);
      for (const record of records) {
        if (!citesBinarySource(record) || record.sourceProvenance?.sourcePath !== oldPath) continue;
        if (await renameCitationSourcePath(vault, record.instrumentId, oldPath, newPath)) {
          moved += 1;
        }
      }
    } catch (error) {
      console.error(
        'Olea: citation-revision file rename write failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    this.landedSources.rename(oldPath, newPath);
    return moved + (await this.movePendingDrafts(vault, oldPath, newPath));
  }

  /**
   * `ol-egov.141.89.5.122` ([D-576]): a pending first draft that cites the renamed file has no
   * citation record yet, so {@link moveCitedFile}'s store call cannot reach it, and accepting it
   * later would write the old path. Its own cited source path (`sourceCitation.sourcePath`) is
   * changed to `newPath` through the draft cache's existing `put`, nothing else on the record
   * touched; a draft that is not `pending` (accepted, edited or rejected) is left as it was. No new
   * field, no new record shape. Returns how many drafts moved; a failure is logged and leaves the
   * rest as they were.
   */
  private async movePendingDrafts(
    vault: VaultSource,
    oldPath: VaultPath,
    newPath: VaultPath,
  ): Promise<number> {
    let moved = 0;
    try {
      const cache = createVaultDraftCacheStore(vault);
      for (const draft of await cache.listPending()) {
        const citation = draft.sourceCitation;
        if (citation === undefined || citation.sourcePath !== oldPath) continue;
        await cache.put({ ...draft, sourceCitation: { ...citation, sourcePath: newPath } });
        moved += 1;
      }
    } catch (error) {
      console.error(
        'Olea: citation-revision draft rename write failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    return moved;
  }

  /**
   * `ol-egov.141.89.5.107`: where this pass last saw `instrumentId`'s cited passage (its anchor's
   * path), or `undefined` when the store holds no anchor for it or cannot be read. A rewritten
   * question keeps its anchor (`[D-522]`) and a rename Olea saw moves a transcript anchor
   * ({@link onSourceRenamed}), so for a lecture transcript this is where the file stands when the
   * question's successor is drafted (`revision-job-runner.ts`). Reads only.
   */
  async anchoredSourcePath(instrumentId: string): Promise<VaultPath | undefined> {
    try {
      return (await this.deps.store.loadAll()).get(instrumentId)?.sourcePath;
    } catch {
      return undefined;
    }
  }

  /**
   * `ol-egov.141.89.5.107` ([D-518]): the text this session extracted from `path` when its bytes
   * hashed to `bytesHash` (the landed text {@link rewriteHeldFromLandedSources} drafts from):
   * `page`'s, or every landed page's when `page` is `undefined`, trimmed. `undefined` when none is
   * held for those bytes: not landed yet, forgotten by a restart, or a page with no text. Reads
   * memory only and asks for no extraction.
   */
  landedSourceText(
    path: VaultPath,
    bytesHash: string,
    page: number | undefined,
  ): string | undefined {
    const landed = this.landedSources.current(path);
    if (landed === undefined || landed.hash !== bytesHash) return undefined;
    const text = (page === undefined ? landed.wholeText() : landed.pageText(page)).trim();
    return text.length === 0 ? undefined : text;
  }

  /**
   * `ol-egov.141.89.5.109` ([D-518]): the catch-up extraction of `path` for the bytes `bytesHash`,
   * asked by a rewritten question's successor job that waits for that file's landed text
   * (`revision-job-runner.ts`), whose suspended predecessor this pass skips. The same request under
   * the same rule as this pass's own ({@link requestReextractionOnce}): once per file and bytes per
   * run of Olea, shared with this pass, and never when text for those bytes has landed. Never throws.
   */
  async requestSourceText(path: VaultPath, bytesHash: string): Promise<void> {
    await this.requestReextractionOnce(path, bytesHash);
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
    let citedPath = sourcePath;
    try {
      const citation = await readInstrumentCitation(vault, record.instrumentId);
      citedPath = citation?.sourcePath ?? sourcePath;
      const bytes = await vault.readBinary(citedPath);
      const now = await hashContent(bytes);
      if (citation?.sourceRevision !== undefined && citation.sourceRevision === now) {
        // `[D-518]`: the bytes equal the recorded revision again, so a hold this check raised
        // lifts, by identical bytes alone (a code exit, no judge call).
        await this.liftSourceHold(record);
        return false;
      }
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
        SOURCE_REVISION_REASON,
        codeRule('source-bytes-changed'),
      );
    } catch (error) {
      console.error('Olea: citation-revision source-bytes withhold write failed', error);
    }
    if (observed !== 'unreadable') await this.requestReextractionOnce(citedPath, observed);
    return true;
  }

  /**
   * `ol-egov.141.89.5.84`: once per session per (source, bytes), when no landed text is held for
   * those bytes, asks the host to extract the file. The hold stands whatever happens.
   */
  private async requestReextractionOnce(citedPath: string, observed: string): Promise<void> {
    const request = this.deps.requestSourceReextraction;
    if (request === undefined) return;
    if (this.landedSources.current(citedPath)?.hash === observed) return;
    const key = `${citedPath}\n${observed}`;
    if (this.reextractionAsked.has(key)) return;
    this.reextractionAsked.add(key);
    try {
      await request(citedPath);
    } catch (error) {
      console.error(
        'Olea: citation-revision source re-extraction request failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
  }

  /** `[D-518]`: clears a pending fact whose reason is {@link SOURCE_REVISION_REASON}; any other fact (or none) is left alone. */
  private async liftSourceHold(record: VaultInstrumentRecord): Promise<void> {
    try {
      const anchor = (await this.deps.store.loadAll()).get(record.instrumentId);
      if (anchor?.pendingRevalidation?.reason !== SOURCE_REVISION_REASON) return;
      const { pendingRevalidation: _lifted, ...rest } = anchor;
      await this.deps.store.save(record.instrumentId, rest);
    } catch (error) {
      console.error('Olea: citation-revision source-hold lift write failed', error);
    }
  }

  /**
   * `ol-egov.141.89.5.81` ([D-518], [D-508]): a changed non-markdown source's re-extracted units
   * have landed (`sourceRevisions` is core's `sourcePath -> byte hash` map from that extraction).
   * Remembers, in memory only, the text of each page of every source some tracked question cites,
   * then rewrites every question held for that source ({@link rewriteHeldFromLandedSources}). No
   * judge call; nothing is persisted beyond the existing store.
   *
   * `ol-egov.141.89.7.82`: a delivery adds to or replaces only the pages it covers of its own
   * version (`landed-source-text.ts`), so a page read from its image, delivered alone with the
   * vision runner's digest, never replaces the text pages of the same bytes.
   */
  async onSourceUnitsLanded(
    vault: VaultSource,
    actions: CitationRevisionActions,
    units: readonly ExtractedUnit[],
    sourceRevisions: ReadonlyMap<string, string>,
  ): Promise<SourceLandingResult> {
    const report = blankTickReport();
    try {
      // The anchor's own path is the home note for a binary citation; the cited file is named by the sidecar.
      const cited = new Set<string>();
      if (sourceRevisions.size > 0) {
        for (const instrumentId of (await this.deps.store.loadAll()).keys()) {
          const citation = await readInstrumentCitation(vault, instrumentId);
          if (citation !== undefined) cited.add(citation.sourcePath);
        }
      }
      for (const [path, hash] of sourceRevisions) {
        if (!cited.has(path)) continue;
        const pages = new Map<number, string[]>();
        for (const unit of units) {
          if (unit.provenance.sourcePath !== path) continue;
          const bucket = pages.get(unit.provenance.location.page);
          if (bucket === undefined) pages.set(unit.provenance.location.page, [unit.text]);
          else bucket.push(unit.text);
        }
        this.landedSources.record(
          path,
          hash,
          new Map([...pages].map(([page, texts]) => [page, texts.join('\n\n')] as const)),
        );
      }
    } catch (error) {
      console.error('Olea: citation-revision could not record landed source units', error);
    }
    return this.rewriteHeldFromLandedSources(vault, actions, report);
  }

  /**
   * For each question held with {@link SOURCE_REVISION_REASON} whose cited source's landed bytes are
   * the ones the hold was raised for: suspend the predecessor and enqueue a successor drafted from
   * the cited page's new text (the same shared step the passage path uses, so the late-reply guard
   * and the bounded retry apply unchanged). A cited page with no text leaves the question held; the
   * outcome is counted and logged once per pass (a count only, never content).
   */
  private async rewriteHeldFromLandedSources(
    vault: VaultSource,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<SourceLandingResult> {
    const result = { rewritten: 0, heldNoText: 0 };
    if (this.landedSources.size === 0) return result;
    let stored: ReadonlyMap<string, CitationAnchorRecord>;
    try {
      stored = await this.deps.store.loadAll();
    } catch (error) {
      console.error('Olea: citation-revision could not read the store for source rewrites', error);
      return result;
    }
    let suspendedIds: ReadonlySet<string>;
    try {
      const { entries } = await readReviewLogHistory(vault);
      suspendedIds = suspendedInstrumentIds(entries);
      this.unsuspendedAfterSuspend = unsuspendedAfterSuspendIds(entries);
    } catch (error) {
      // `ol-egov.141.89.9.98`: a rewritten question keeps its entry and hold, so an unknown
      // suspension is never taken for none; the rewrite waits for a pass that can read the log.
      console.error('Olea: citation-revision could not read the review log for suspension', error);
      return result;
    }
    for (const [instrumentId, anchor] of stored) {
      const pending = anchor.pendingRevalidation;
      if (pending?.reason !== SOURCE_REVISION_REASON) continue;
      // `ol-egov.141.89.5.81`: a suspended instrument is never rewritten again.
      if (suspendedIds.has(instrumentId) && !this.confirmedRewrites.has(instrumentId)) continue;
      try {
        const citation = await readInstrumentCitation(vault, instrumentId);
        // `ol-egov.141.89.5.43`: with transcript part grain on, a transcript citation is never
        // rewritten from "the page with its number": once the file changed, that number names a
        // different passage. The part-grain pass follows it by its text instead.
        if (
          this.deps.transcriptPartGrain === true &&
          citation !== undefined &&
          hasTranscriptExtension(citation.sourcePath)
        ) {
          continue;
        }
        const landed =
          citation === undefined ? undefined : this.landedSources.current(citation.sourcePath);
        if (citation === undefined || landed === undefined) continue;
        // The hold must be the one raised for these very bytes.
        if (
          pending.sinceContentHash !== (await hashText(`${SOURCE_REVISION_REASON}\n${landed.hash}`))
        ) {
          continue;
        }
        // Every page of this version landed so far, merged (`ol-egov.141.89.7.82`). A page-less
        // citation is never held here (core `session/enumerate.ts` gives it no source), so the
        // whole-file branch is defensive only.
        const text = (
          citation.page === undefined ? landed.wholeText() : landed.pageText(citation.page)
        ).trim();
        if (text.length === 0) {
          result.heldNoText += 1;
          continue;
        }
        const confirmed = this.confirmedRewrites.get(instrumentId);
        if (confirmed !== undefined && confirmed.judgedContentHash !== pending.sinceContentHash) {
          this.confirmedRewrites.delete(instrumentId);
        } else if (confirmed?.gaveUp === true) {
          continue;
        }
        const event: RevisionEvent = {
          instrumentId,
          at: this.deps.clock.now(),
          oldContentHash: citation.sourceRevision ?? '',
          // Per question, so two questions on one file are never collapsed by the queue's own idempotency.
          newContentHash: await hashText(`${landed.hash}\n${instrumentId}\n${citation.page ?? ''}`),
          change: SOURCE_REVISION_REASON,
        };
        const before = report.successorEnqueueFailed + report.staleResultDiscarded;
        await this.suspendAndEnqueueSuccessor(
          instrumentId,
          anchor.conceptIds,
          pending.sinceContentHash,
          instrumentId,
          buildSuccessorRevisionEnqueueInput(event, text, landed.hash),
          actions,
          report,
          codeRule('landed-source-rewrite'),
        );
        if (
          report.successorEnqueueFailed + report.staleResultDiscarded === before &&
          !this.confirmedRewrites.has(instrumentId)
        ) {
          result.rewritten += 1;
        }
      } catch (error) {
        console.error('Olea: citation-revision source rewrite failed', error);
      }
    }
    if (result.heldNoText > 0) {
      console.info(
        `Olea: citation-revision left ${result.heldNoText} question(s) held: the cited page of a changed source has no text`,
      );
    }
    return result;
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
            (passage.rule !== undefined && digestVersionOf(previous) !== passage.rule.version)) &&
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
              settledBy: codeRule('passage-found-again'),
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
            settledBy: codeRule('relocated-exact'),
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
          successorInputFor(outcome.event, current.text, passage),
          actions,
          report,
          judgeDecidedBy(outcome),
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
          current.kind === 'found-at-anchor'
            ? successorInputFor(outcome.event, current.text, passage, outcome.successorEnqueueInput)
            : outcome.successorEnqueueInput,
          actions,
          report,
          judgeDecidedBy(outcome),
        );
        return;
      }
    }
  }

  /**
   * Shared by the `'revised'` and, per [D-508], the `'refreshed'` verdict on a cited passage, and by
   * the binary-source rewrite: enqueue the successor, THEN suspend the predecessor. Guarded against
   * a late reply ([D-351] `isPendingRevalidationCurrent`).
   *
   * `ol-egov.141.89.9.98` ([D-522], [D-536]): the predecessor's entry and its pending fact are KEPT
   * once both steps succeed. The fact is the persisted exclusion of the old question's evidence
   * from current readings, and it ends only with a successful revalidation, never because this
   * step (or the queue entry it made) is done, and never because the successor is accepted. The
   * pass then leaves the suspended predecessor alone (the suspended-with-a-check-owed skip in
   * `tick`), so it is not judged, suspended or rewritten again; the registry's "Being checked"
   * list does not show it (`registry/provider.ts`).
   *
   * `ol-egov.141.89.5.88` ([D-508]): the order is enqueue-first so an orphan (a suspended
   * predecessor with no successor) cannot arise. The suspend record carries no author, so a
   * restart cannot tell this step's suspension from one the student made herself, and the
   * suspended skip must stay absolute. Enqueue fails: nothing is suspended, the anchor and its
   * pending fact stay, the question stays withheld, the step is retried in the session, and after a
   * restart the hold still stands so the next landing (or the [D-518] catch-up extraction) rewrites
   * it. Enqueue succeeds and suspend fails: the retry re-enqueues the same input, which the work
   * queue reports as status 'duplicate' without throwing (`IngestionEngine.enqueue` dedupes on
   * `contentHash`), then suspends; throughout, the predecessor stays withheld by its pending
   * fact, so predecessor and successor are never shown together. A bounded number of failed
   * attempts is recorded and given up on.
   *
   * `ol-egov.141.89.5.94`: the same state after a RESTART (the successor queued, no suspend
   * record, the in-session retry memory gone) is retried too: the next pass judges once more,
   * re-enqueues (reported as a duplicate) and suspends. The question that she unsuspended after
   * the rewrite's suspend is told apart by the review log, not by the queued successor.
   */
  private async suspendAndEnqueueSuccessor(
    instrumentId: string,
    conceptIds: readonly string[],
    judgedContentHash: string,
    predecessorInstrumentId: string,
    successorEnqueueInput: EnqueueInput,
    actions: CitationRevisionActions,
    report: MutableTickReport,
    /** `[D-598]`: who decided this rewrite; `null` writes nothing (the field then reads unknown). */
    decidedBy: PersistedStageProducer | null,
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
      // `[D-536]`: she unsuspended an already-rewritten question. Her action stands: no second
      // suspend record, no second successor, even if the passage changed again. The question
      // stays withheld by its pending fact (kept here), with its old reviews excluded until a
      // successful revalidation clears it. That case is told by the review log (an unsuspend after
      // a suspend), never by a queued successor alone: a rewrite whose enqueue landed but whose
      // suspend failed, then a restart, has a successor and no suspend record, and its suspend is
      // retried (`ol-egov.141.89.5.94`). A retry of this very rewrite in the session
      // (`confirmedRewrites`) is not that case either.
      if (
        !this.confirmedRewrites.has(instrumentId) &&
        this.unsuspendedAfterSuspend.has(predecessorInstrumentId) &&
        (await actions.hasSuccessor?.(predecessorInstrumentId)) === true
      ) {
        return;
      }
      // `[D-598]`: who decided the rewrite is written beside the decision, before the steps that
      // carry it out. Never changes what follows: see `recordRewriteDecision`.
      await this.recordRewriteDecision(instrumentId, judgedContentHash, decidedBy);
      await actions.enqueue(successorEnqueueInput);
      await actions.suspend(predecessorInstrumentId, conceptIds);
      // The entry and its pending fact stay ([D-522], [D-536]): see this method's doc. A failure
      // above leaves the same state unsuspended, and the SAME outcome is retried next pass.
      this.confirmedRewrites.delete(instrumentId);
    } catch (error) {
      // `ol-egov.141.89.5.77`: remember the confirmed outcome so later passes retry this step
      // without asking the judge again; bounded, then recorded.
      const entry: ConfirmedRewrite = this.confirmedRewrites.get(instrumentId) ?? {
        judgedContentHash,
        conceptIds,
        predecessorInstrumentId,
        successorEnqueueInput,
        decidedBy,
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

  /**
   * `[D-598]` (`ol-egov.141.89.5.135`): records who decided a rewrite on the pending fact it
   * resolves, through the store's compare-and-set (`CitationHashStore.recordDecision`): only while
   * the fact still names `judgedContentHash`, and only the first value for that difference. A
   * provenance write never changes behaviour: a store without the method, or a write that fails,
   * leaves the field unknown, is logged by error name only (D-005), and the rewrite proceeds
   * exactly as it would without it.
   */
  private async recordRewriteDecision(
    instrumentId: string,
    judgedContentHash: string,
    decidedBy: PersistedStageProducer | null,
  ): Promise<void> {
    if (decidedBy === null) return;
    try {
      await this.deps.store.recordDecision?.(instrumentId, judgedContentHash, decidedBy);
    } catch (error) {
      console.error(
        `Olea: citation-revision could not record who decided a rewrite; the rewrite proceeds (${errorName(error)})`,
      );
    }
  }
}

/**
 * `[D-598]`: the judge's producer for a judged cited-passage outcome, read through `olea-core`'s
 * Decision adapter (`decisionFromCitedPassageRevision`) with the stamp the judge's answer carried
 * (`judgeStamp`, `null` when none), in the same seat and task the file-level judge is stamped with.
 */
function judgeDecidedBy(
  outcome: Extract<CitedPassageRevisionOutcome, { kind: 'refreshed' | 'revised' }>,
): PersistedStageProducer | null {
  const decision = decisionFromCitedPassageRevision(outcome, {
    seat: 'candidate',
    taskId: MATERIALITY_JUDGE_TASK_ID,
    stamp: outcome.judgeStamp,
    evidenceDigests: [],
  });
  return decision === null ? null : persistedModelProducer(decision.provenance.producer);
}

/**
 * `ol-egov.141.89.5.94`: the instruments whose latest suspension event is an `unsuspend` that
 * follows a `suspend`, ordered as `suspendedInstrumentIds` orders them (timestamp, then event id).
 */
function unsuspendedAfterSuspendIds(entries: readonly ReviewLogEntry[]): ReadonlySet<string> {
  const events = entries
    .filter(
      (e): e is Extract<ReviewLogEntry, { kind: 'suspend' | 'unsuspend' }> =>
        e.kind === 'suspend' || e.kind === 'unsuspend',
    )
    .sort((a, b) => {
      const d = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return d !== 0 ? d : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });
  const sawSuspend = new Set<string>();
  const result = new Set<string>();
  for (const e of events) {
    if (e.kind === 'suspend') {
      sawSuspend.add(e.instrumentId);
      result.delete(e.instrumentId);
    } else if (sawSuspend.has(e.instrumentId)) {
      result.add(e.instrumentId);
    }
  }
  return result;
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
  /** See `CitationRevisionTriggerDeps.requestSourceReextraction`'s own doc. */
  readonly requestSourceReextraction?: (sourcePath: string) => Promise<void>;
  /** See `CitationRevisionTriggerDeps.passageRules`'s own doc. */
  readonly passageRules?: readonly PassageRule[];
  /** See `CitationRevisionTriggerDeps.transcriptPartGrain`'s own doc. */
  readonly transcriptPartGrain?: boolean;
}

export function buildCitationRevisionWiring(
  deps: CitationRevisionWiringDeps,
): CitationRevisionTrigger {
  return new CitationRevisionTrigger(deps);
}

/**
 * `ol-egov.141.89.5.107`: the revision job runner's view of what this pass knows about a rewritten
 * question's cited source (`CitedSourceNow`, `revision-job-runner.ts`): where its anchor stands and
 * the text landed for a file's bytes, and (`ol-egov.141.89.5.109`) its catch-up extraction request.
 * Reads whichever trigger `trigger()` returns when a job runs, since `main.ts` builds the runner
 * before the trigger; with none, it knows nothing (no anchor, no landed text) and asks for nothing,
 * and the runner keeps its behaviour without a citation pass.
 */
export function citedSourceNowFrom(trigger: () => CitationRevisionTrigger | null): CitedSourceNow {
  return {
    anchoredPath: async (instrumentId) => trigger()?.anchoredSourcePath(instrumentId),
    landedText: async (path, bytesHash, page) => trigger()?.landedSourceText(path, bytesHash, page),
    requestText: async (path, bytesHash) => trigger()?.requestSourceText(path, bytesHash),
  };
}
