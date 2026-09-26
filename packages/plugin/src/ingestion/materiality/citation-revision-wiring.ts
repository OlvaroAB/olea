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
 * `[D-366]` — Q&A/CLOZE ARE TRACKED TOO, EXCEPT WHEN SELF-CONTAINED
 * ===========================================================================
 * MCQ is unchanged: every MCQ instrument is tracked, exactly as before this
 * bead (`ol-v7r5.68`). A Q&A or cloze instrument is now tracked as well —
 * `evaluateCitedPassageRevision`, `buildSuccessorRevisionEnqueueInput` and
 * `InstrumentRevisionJobPayload` never assumed MCQ (they key everything by
 * `instrumentId` and plain text) — **except** when it is exempt under
 * `[D-366]` (David, 2026-09-25, ruled on `ol-v7r5.83`): "editing a
 * self-contained, learner-authored card should update that card without
 * automatic suspension... use actual source dependencies and authorship,
 * never file location."
 *
 * `isTrackedForRevision` below is that rule. It is **not** the same test as
 * "does it happen to live alone in its note": it asks whether
 * `citedPassagePath` resolves to a note DIFFERENT from the instrument's own
 * `notePath` — a genuine, actual dependency on separate material, wherever
 * the block physically sits. An authored card that quotes a separate source
 * note is tracked (its dependency's change can still suspend it); a
 * generated card materialized into the very note its source text lives in
 * is, by this file's own available signals, indistinguishable from a
 * hand-authored one — see that function's doc for exactly what is known,
 * what is not, and why the untellable case defaults to exempt rather than a
 * guess. The `[D-133]` predecessor/successor chain a `'revised'` outcome
 * enqueues stays enqueue-only here for every instrument type — this file
 * never generates a successor, only asks the existing ingestion queue to
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
 * material delta rather than to its own individually-nearest passage — MCQ
 * always, and a Q&A/cloze instrument only when it is tracked at all (see the
 * `[D-366]` section above: a self-contained one is exempt, so this
 * shared-note cost never reaches it).
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
 */

import {
  type CitedPassageRevisionOutcome,
  type Clock,
  type CurrentPassageState,
  type EnqueueInput,
  enumerateVaultInstruments,
  evaluateCitedPassageRevision,
  hashText,
  type PendingRevalidationRecorder,
  type RelocationCandidate,
  type RevisionJudgeInput,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';
import type { CitationAnchorRecord, CitationHashStore } from './citation-hash-store.js';
import { stripInstrumentSpans } from './citation-material.js';
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
   * by citation — no `sourceProvenance` naming a real, separate note — and
   * therefore exempt from tracking under this trigger altogether. Counted,
   * never tracked, never baselined, never sent to the judge: her own
   * self-contained card follows her own edit with no automatic suspension.
   * See `isTrackedForRevision`'s own doc for exactly what this can and
   * cannot tell apart. MCQ never contributes to this count (unchanged
   * scope).
   */
  readonly exemptSelfContained: number;
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
}

/** Same rule `process-now.ts`'s own private `isMarkdownPath` uses; duplicated rather than imported since that module doesn't export it and this one has no other reason to depend on `ingestion/process-now.ts`. */
function isMarkdownVaultPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
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
function citedPassagePath(record: VaultInstrumentRecord): VaultPath {
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
 * `[D-366]` — whether an instrument is tracked under `[D-093]`'s
 * passage-change auto-suspension at all. See this module's own "`[D-366]` —
 * Q&A/CLOZE ARE TRACKED TOO" doc section for the full ruling and its limits;
 * this is that rule, in code.
 *
 * MCQ: always tracked, unchanged — this bead does not touch that path.
 *
 * Q&A/cloze: tracked only when {@link citedPassagePath} resolves to a note
 * DIFFERENT from the instrument's own `notePath` — a real, actual citation
 * naming separate material, never inferred from where the block sits.
 * Falling back to the instrument's own note (no `sourceProvenance` at all,
 * one naming a non-markdown source, or one naming the note itself) is
 * exempt: `[D-366]`'s "self-contained, learner-authored" case, or — where
 * this module genuinely cannot tell the two apart, see `citedPassagePath`'s
 * own doc — the safe default for the case it cannot tell.
 */
function isTrackedForRevision(record: VaultInstrumentRecord): boolean {
  if (record.instrumentType === 'mcq') return true;
  return citedPassagePath(record) !== record.notePath;
}

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
}

export class CitationRevisionTrigger {
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
    };

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
    // `[D-366]`: exempt Q&A/cloze instruments (self-contained by citation —
    // see `isTrackedForRevision`'s own doc) are counted here, once, and then
    // never touched again this pass: excluded from `trackedRecords` below,
    // so they are never baselined, never diffed, never sent to the judge.
    report.exemptSelfContained = enumeration.records.filter(
      (record) => record.instrumentType !== 'mcq' && !isTrackedForRevision(record),
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

    const currentByInstrumentId = new Map(
      trackedRecords.map((record) => [record.instrumentId, record] as const),
    );
    const stored = await this.deps.store.loadAll();
    report.tracked = stored.size;

    for (const [instrumentId, previous] of stored) {
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
      let current: CurrentPassageState;
      try {
        if (currentRecord !== undefined) {
          current = {
            kind: 'found-at-anchor',
            text: await materialFor(citedPassagePath(currentRecord)),
          };
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
        canonicalizeForMateriality(current.text) === canonicalizeForMateriality(previous.text)
      ) {
        report.formattingOnly += 1;
        try {
          await this.deps.store.save(instrumentId, {
            sourcePath: citedPassagePath(currentRecord),
            text: current.text,
            // [D-351]: a formatting-only edit is not a resolution — carry
            // over whatever pending-revalidation fact was already recorded
            // (from an earlier, still-unresolved real difference) rather
            // than silently clearing it via this unrelated write.
            ...(previous.pendingRevalidation !== undefined
              ? { pendingRevalidation: previous.pendingRevalidation }
              : {}),
            conceptIds: currentRecord.conceptIds,
          });
        } catch (error) {
          console.error('Olea: citation-revision formatting-only refresh write failed', error);
        }
        continue;
      }

      let outcome: CitedPassageRevisionOutcome;
      try {
        outcome = await evaluateCitedPassageRevision(
          {
            instrumentId,
            previousText: previous.text,
            previousContentHash: await hashText(previous.text),
            current,
          },
          this.deps.judge,
          this.deps.clock,
          pendingRecorder,
        );
      } catch (error) {
        console.error('Olea: citation-revision evaluation failed', error);
        continue;
      }

      await this.applyOutcome(
        instrumentId,
        previous,
        currentRecord,
        current,
        outcome,
        actions,
        report,
      );
    }

    // Baseline every TRACKED instrument this pass found that the store has
    // never recorded — every MCQ, plus a Q&A/cloze that names a genuine
    // separate citation (`[D-366]`; a self-contained one was already
    // counted into `report.exemptSelfContained` above and never reaches
    // `trackedRecords`) — the first-sighting case, same posture
    // `ObsidianMaterialityHashStore`'s `record === null` branch takes: record
    // now, nothing to diff against yet.
    for (const [instrumentId, record] of currentByInstrumentId) {
      if (stored.has(instrumentId)) continue;
      try {
        const path = citedPassagePath(record);
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
    }

    return report;
  }

  private async applyOutcome(
    instrumentId: string,
    previous: CitationAnchorRecord,
    currentRecord: VaultInstrumentRecord | undefined,
    current: CurrentPassageState,
    outcome: CitedPassageRevisionOutcome,
    actions: CitationRevisionActions,
    report: MutableTickReport,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'unchanged':
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
      case 'refreshed':
        // Same claim — advance the stored baseline so this delta is not
        // re-flagged next pass. Nothing is written to the vault: under this
        // caller's scoping (see this module's own doc) the changed material
        // is already on disk; there is no separate instrument wording left
        // stale by it.
        report.refreshed += 1;
        if (currentRecord !== undefined && current.kind === 'found-at-anchor') {
          try {
            // [D-351]: this verdict was computed against
            // `outcome.event.newContentHash`. Only restore to current
            // (clearing the pending fact — the write below omits it) when
            // the PERSISTED pending hash still matches: a mismatch means a
            // newer edit has already raised its own pending state, and this
            // is a late result for an earlier edit that must not clear it.
            const pendingStillCurrent = await this.deps.store.isPendingRevalidationCurrent(
              instrumentId,
              outcome.event.newContentHash,
            );
            if (!pendingStillCurrent) {
              report.staleResultDiscarded += 1;
              return;
            }
            await this.deps.store.save(instrumentId, {
              sourcePath: citedPassagePath(currentRecord),
              text: current.text,
              conceptIds: currentRecord.conceptIds,
              // pendingRevalidation omitted -- restored to current [D-351].
            });
          } catch (error) {
            console.error('Olea: citation-revision refresh write failed', error);
          }
        }
        return;
      case 'revised': {
        report.revised += 1;
        const conceptIds = currentRecord?.conceptIds ?? previous.conceptIds;
        try {
          // [D-351]: same guard as `refreshed` above, before acting on the
          // verdict at all — a stale 'revised' verdict must not suspend the
          // predecessor or enqueue a successor against content a newer edit
          // has already superseded.
          const pendingStillCurrent = await this.deps.store.isPendingRevalidationCurrent(
            instrumentId,
            outcome.event.newContentHash,
          );
          if (!pendingStillCurrent) {
            report.staleResultDiscarded += 1;
            return;
          }
          await actions.suspend(outcome.predecessorInstrumentId, conceptIds);
          await actions.enqueue(outcome.successorEnqueueInput);
          // Retire tracking: the predecessor is suspended, so further
          // changes to this material no longer need watching under this id.
          // A failure above leaves this line unreached, so the entry stays
          // tracked and the SAME 'revised' outcome is retried next pass —
          // an acceptable, rare, at-least-once cost rather than a silent
          // drop (a duplicate suspend/enqueue attempt is at worst a second,
          // idempotent-by-content-hash `enqueue` and one extra append-only
          // suspend event, never a second successor drafted twice).
          await this.deps.store.remove(instrumentId);
        } catch (error) {
          console.error(
            'Olea: citation-revision suspend/enqueue failed; predecessor stays tracked for retry',
            error,
          );
        }
        return;
      }
    }
  }
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
 * Drawn from `trackedRecords` (`[D-366]`), not every enumerated instrument —
 * an exempt, self-contained Q&A/cloze instrument's own note is never offered
 * as somewhere a DIFFERENT, tracked instrument's citation relocated to;
 * MCQ's population is unchanged (it was already every MCQ).
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
}

export function buildCitationRevisionWiring(
  deps: CitationRevisionWiringDeps,
): CitationRevisionTrigger {
  return new CitationRevisionTrigger(deps);
}
