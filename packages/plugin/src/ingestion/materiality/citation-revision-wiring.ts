/**
 * `CitationRevisionTrigger` / `buildCitationRevisionWiring` — `[CORP-3b]`'s
 * (`ol-2zfj.35`) production caller: the plugin-side reader
 * `packages/core/src/concept/revision/material-change.ts`'s own module doc
 * names as unbuilt ("a vault-reading caller, plugin-side, unbuilt — see this
 * bead's close notes for the exact hook").
 *
 * ===========================================================================
 * SCOPE: MCQ INSTRUMENTS ONLY, ONE BATCH PASS PER TICK — READ BEFORE EXTENDING
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
 * Scoped to MCQ instruments (`McqInstrumentRecord`) only, not Q&A/cloze: the
 * `[D-133]` predecessor/successor chain this outcome's `'revised'` arm feeds
 * (`predecessor:` field, `InstrumentRevisionJobPayload`,
 * `revision-job-runner.ts`) is MCQ-only today — `McqInstrument.predecessor`
 * has no Q&A/cloze counterpart. Widening to hand-authored cards is a
 * follow-on, not silently assumed here.
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
 * the cost of every MCQ sharing one note reacting to the same material delta
 * rather than to its own individually-nearest passage.
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
  type McqInstrumentRecord,
  type RelocationCandidate,
  type RevisionJudgeInput,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
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

function isMcqRecord(record: VaultInstrumentRecord): record is McqInstrumentRecord {
  return record.instrumentType === 'mcq';
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
 * pre-existing `notePath` rule, unchanged.
 */
function citedPassagePath(record: McqInstrumentRecord): VaultPath {
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
    };

    const enumeration = await enumerateVaultInstruments(vault);
    const mcqRecords = enumeration.records.filter(isMcqRecord);

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
      mcqRecords.map((record) => [record.instrumentId, record] as const),
    );
    const stored = await this.deps.store.loadAll();
    report.tracked = stored.size;

    for (const [instrumentId, previous] of stored) {
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
            relocationCandidates: await buildRelocationCandidates(mcqRecords, materialFor),
          };
        }
      } catch (error) {
        console.error('Olea: citation-revision tick could not read a tracked note', error);
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

    // Baseline every MCQ instrument this pass found that the store has never
    // recorded — the first-sighting case, same posture
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
    currentRecord: McqInstrumentRecord | undefined,
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
        // silently, no judge call happens for this arm, no event.
        report.relocated += 1;
        try {
          await this.deps.store.save(instrumentId, {
            sourcePath: outcome.candidate.anchor.sourcePath,
            text: outcome.candidate.text,
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
            await this.deps.store.save(instrumentId, {
              sourcePath: citedPassagePath(currentRecord),
              text: current.text,
              conceptIds: currentRecord.conceptIds,
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
 * Every currently-enumerated note's material, one `RelocationCandidate` each
 * — `location` is a placeholder whole-text range, the same "never read past
 * `embeddedIn.notePath`/`sourcePath`" posture `main.ts`'s
 * `triggerAuthoredNoteGenerationIfObserved` already uses for a synthesised
 * `Provenance`: `classifyRelocation` only ever reads `candidate.text` and
 * `candidate.anchor.sourcePath`. Deduped and read by `citedPassagePath`, not
 * raw `notePath` — the same substitution `tick`'s tracked-instrument loop
 * makes, so a relocation search for a split-home-note instrument (`ol-0r92.46`)
 * looks at candidates' real source text too, not their empty home-note stubs.
 */
async function buildRelocationCandidates(
  mcqRecords: readonly McqInstrumentRecord[],
  materialFor: (path: VaultPath) => Promise<string>,
): Promise<RelocationCandidate[]> {
  const seen = new Set<VaultPath>();
  const candidates: RelocationCandidate[] = [];
  for (const record of mcqRecords) {
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
