/**
 * `materializeAcceptedDraft` — the accept step's write-to-vault half (F3.4,
 * F2.15, INV-6, `ol-p3t07a`).
 *
 * No caller in `packages/plugin` composed `insertMcqBlock` + `stampMcqId`
 * before this file: `acceptGeneratedMcq` (`olea-core`) turns a generated
 * candidate into `McqFields`, but nothing wired that into an actual vault
 * write from the plugin (`mcq-generated.ts`'s own module doc names this as
 * "P3-T07b's accept step, still open" — this is that step, for the one
 * generative task, `quiz.generate.v1`, this bead's pipeline drafts). Reuses
 * every piece of the existing identity machinery unmodified — `insertMcqBlock`,
 * `stampMcqId`, `parseMcqBlocks`, `acceptGeneratedMcq` — and adds nothing new
 * to it.
 *
 * **Where it writes.** A draft's `sourcePath` is always the NOTE that
 * embedded the material it was drafted from (`pipeline.ts` only drafts for
 * units carrying `provenance.embeddedIn` — see that file's module doc for
 * why a bare, unembedded source drop is out of this round's scope), so this
 * always has a real markdown note to insert into. The block is inserted at
 * the top of that note's CONTENT — generated quiz items are not anchored to
 * one block the way an inline Q&A card is (C1.4 anchoring is a
 * hand-authoring concept; F3.4's generated items have no single sentence
 * they were "written beside").
 *
 * **"Top of the note" means after its frontmatter, not byte offset zero**
 * (`ol-p3t07b`). `insertMcqBlock`'s own `afterBlockIndex: -1` means "insert
 * at the literal start of the document" — it has no opinion about
 * frontmatter, because most of its callers never need one. Passing `-1`
 * unconditionally on a course note (which almost always opens with a
 * `topic:`/`course:` frontmatter block, per `enumerate.ts`'s binding rule)
 * pushes that frontmatter down past the freshly-inserted code fence, so the
 * note no longer *opens* with frontmatter and `enumerateVaultInstruments`
 * — which requires the frontmatter block to be first — silently stops
 * binding the note's concept at all. The freshly-materialized instrument
 * then enumerates as **unbound** and never reaches `composeQueue`: written
 * to the vault, invisible to the queue. Caught by `accept.spec.ts`'s
 * `buildReviewSession` round-trip test, which is exactly why that test
 * composes a real queue instead of only inspecting the write.
 *
 * The fix: insert after block 0 when it is a `frontmatter` block, and only
 * fall back to `-1` (literal top) when the note has none.
 *
 * **Locating the inserted block.** `insertMcqBlock` returns the char range it
 * inserted (`insertedSpan`, which includes the leading/trailing whitespace it
 * added), not the code block's own span. This re-parses the resulting
 * content and finds the one `McqInstrument` whose own span falls inside
 * `insertedSpan` — there is exactly one, since nothing else changed.
 *
 * ## The `[D-133]` succession hookup (`ol-w00s` / `ol-2zfj.37`)
 *
 * When `input.predecessorInstrumentId` is supplied, this successor is being
 * materialized FROM a revision proposal (`concept/revision/`'s `'revised'`
 * outcome — see that module's doc for the sequence that leads here). Two
 * more things happen, after the ordinary id-stamp above and in the same
 * write: the successor's block gets a `predecessor:` field naming the old
 * instrument, and a `succession` review-log record is appended naming both
 * ids and when.
 *
 * **Composed, not reimplemented.** The block field is stamped by
 * `instrument-blocks/predecessor.ts`'s `stampPredecessorField` — the
 * block-agnostic write `[D-133]`'s first durable home already built,
 * deliberately independent of this module's own `olea-mcq` knowledge — and
 * the event is shaped by `olea-core`'s `buildSuccessionEvent` before
 * `appendSuccessionRecord` (also `olea-core`) validates and appends it.
 * Nothing here re-derives either mechanic.
 *
 * **One vault write, not two.** The predecessor field is spliced into
 * `stamped.content` (the same in-memory string the id was just stamped
 * into) before that content ever reaches `vault.write` — so a successor
 * instrument's id and its predecessor field always land in the same byte
 * range write, never as two separate mutations of the note.
 *
 * **Reachability (`[D-072]`'s escape hatch, most of the way closed —
 * `ol-2zfj.39`).** `accept.ts`'s `DraftAcceptPort.accept` now forwards
 * `record.predecessorInstrumentId` here whenever it is set, and
 * `revision-job-runner.ts`'s `runInstrumentRevisionJob` is what sets it: a
 * drained `'instrument-revision'` job (`concept/revision/enqueue.ts`'s
 * payload) resolves the predecessor's concept/course binding from a vault
 * walk, drafts a successor, and caches a `DraftRecord` naming the
 * predecessor. That closes the id's path from job payload through to this
 * parameter. **What is still not closed:** `revision-job-runner.ts`'s
 * `createRevisionAwareJobRunner` is not yet composed into the actual
 * `JobRunner` `IngestionQueueEngine` drains in production
 * (`packages/plugin/src/ingestion/wiring.ts`'s `buildIngestionRunner`,
 * outside `ol-2zfj.39`'s `owns` — see that module's own doc for the exact
 * two-line diff needed), and nothing yet calls
 * `evaluateCitedPassageRevision`/`buildSuccessorRevisionEnqueueInput` to
 * produce a real `'instrument-revision'` job in the first place
 * (`concept/revision/material-change.ts`'s own doc: "a vault-reading
 * caller, plugin-side, unbuilt"). This function is unit-tested directly
 * (`materialize-mcq.spec.ts`) and, as of `ol-2zfj.39`, also exercised
 * through its real caller (`accept.spec.ts`'s `[D-133] predecessor
 * threading` suite) — both remaining gaps are one layer further upstream,
 * at the job-composition and revision-detection boundary, not in this
 * function's own call chain.
 *
 * ## The `[D-181]` citation sidecar (`ol-2zfj.52`)
 *
 * Immediately after `stampMcqId` mints the frozen instrument id, and before
 * either write branch above, this writes `input.sourceCitation` — when
 * supplied — to the citation sidecar (`writeInstrumentCitation`,
 * `olea-core`'s `instrument/citation-store.ts`) keyed by that same id. This
 * is the one write neither branch above needs to know about: it never
 * touches `stamped.content`, never lands in her note (`[D-181]`'s own
 * ruling — the sidecar, never text written into her notes), and happens
 * exactly once regardless of which branch runs next. `accept.ts` forwards
 * `DraftRecord.sourceCitation` here verbatim; omitted (never fabricated)
 * when the pipeline had none to record — see that field's own doc
 * (`generation/types.ts`) for why that can happen.
 */

import {
  acceptGeneratedMcq,
  appendSuccessionRecord,
  buildSuccessionEvent,
  type InstrumentCitation,
  insertMcqBlock,
  parseDocument,
  parseMcqBlocks,
  stampMcqId,
  type VaultPath,
  type VaultSource,
  writeInstrumentCitation,
} from 'olea-core';
import { stampPredecessorField } from '../instrument-blocks/predecessor.js';
import { isoWithLocalOffset } from '../review/ports.js';
import type { DraftQuestion } from './types.js';

export interface MaterializeAcceptedDraftInput {
  readonly sourcePath: VaultPath;
  readonly question: DraftQuestion;
  /**
   * `[D-133]`: the id of the instrument this successor supersedes, when this
   * draft was materializing a revision's successor rather than an ordinary
   * new item. `undefined` for every draft today — see the module doc's
   * reachability note.
   */
  readonly predecessorInstrumentId?: string;
  /**
   * `[D-181]`/`ol-2zfj.52`: the passage this draft was generated from
   * (`DraftRecord.sourceCitation`, `generation/types.ts`) — written to the
   * citation sidecar keyed by the frozen instrument id this call mints. See
   * the module doc's own section. `undefined` when the pipeline had none —
   * the sidecar write is skipped entirely rather than guessing one.
   */
  readonly sourceCitation?: InstrumentCitation;
}

/**
 * Only consulted when `predecessorInstrumentId` is supplied — see the module
 * doc. `deviceId` is required in that case (the review-log's C5.2 daily-file
 * path is keyed on it, same as every other append) and this function throws
 * rather than guess one.
 */
export interface MaterializeAcceptedDraftDeps {
  readonly deviceId?: string;
  /** Injectable clock for the succession event's timestamp; defaults to the real one. */
  readonly now?: () => Date;
  /** Injectable for deterministic tests; defaults to `crypto.randomUUID()`, same as `appendSuccessionRecord` itself. */
  readonly generateEventId?: () => string;
}

export interface MaterializeAcceptedDraftResult {
  readonly instrumentId: string;
}

export async function materializeAcceptedDraft(
  vault: VaultSource,
  input: MaterializeAcceptedDraftInput,
  deps: MaterializeAcceptedDraftDeps = {},
): Promise<MaterializeAcceptedDraftResult> {
  const source = await vault.read(input.sourcePath);

  const fields = acceptGeneratedMcq(
    {
      stem: input.question.stem,
      correctAnswer: input.question.correctAnswer,
      distractors: input.question.distractors,
      feedback: input.question.feedback,
    },
    null,
  );

  // "Top of the note" skips a leading frontmatter block rather than landing
  // above it — see the module doc's `ol-p3t07b` note for why inserting at
  // literal offset zero silently unbinds the note's concept.
  const firstBlock = parseDocument(source).blocks[0];
  const afterBlockIndex = firstBlock?.kind === 'frontmatter' ? 0 : -1;

  const { content, insertedSpan } = insertMcqBlock({
    source,
    afterBlockIndex,
    fields,
  });

  const { instruments } = parseMcqBlocks(content);
  const inserted = instruments.find(
    (instrument) =>
      instrument.span.start >= insertedSpan.start && instrument.span.end <= insertedSpan.end,
  );
  if (inserted === undefined) {
    throw new Error(
      'materializeAcceptedDraft: could not locate the freshly-inserted MCQ block after insertMcqBlock',
    );
  }

  const stamped = stampMcqId(content, inserted.span);

  // `[D-181]`: the sidecar, never text written into her notes — see the
  // module doc's own section. Skipped, not fabricated, when the pipeline
  // had no citation to record for this draft.
  if (input.sourceCitation !== undefined) {
    await writeInstrumentCitation(vault, stamped.id, input.sourceCitation);
  }

  if (input.predecessorInstrumentId === undefined) {
    await vault.write(input.sourcePath, stamped.content);
    return { instrumentId: stamped.id };
  }

  if (deps.deviceId === undefined) {
    throw new Error(
      'materializeAcceptedDraft: deps.deviceId is required when predecessorInstrumentId is supplied (the succession record needs it for its C5.2 daily-file path)',
    );
  }

  // Re-locate the just-stamped block: `stampMcqId`'s own span (`inserted.span`)
  // is stale once its content has grown by the inserted `id:` line.
  const { instruments: withId } = parseMcqBlocks(stamped.content);
  const successor = withId.find((instrument) => instrument.id === stamped.id);
  if (successor === undefined) {
    throw new Error(
      'materializeAcceptedDraft: could not locate the freshly id-stamped MCQ block before stamping its predecessor field',
    );
  }

  const predecessorStamp = stampPredecessorField(
    stamped.content,
    successor.span,
    input.predecessorInstrumentId,
  );
  await vault.write(input.sourcePath, predecessorStamp.content);

  const now = deps.now ?? (() => new Date());
  const event = buildSuccessionEvent(input.predecessorInstrumentId, stamped.id, {
    now: () => now().getTime(),
  });
  await appendSuccessionRecord(
    vault,
    {
      timestamp: isoWithLocalOffset(new Date(event.at)),
      predecessorInstrumentId: event.predecessorInstrumentId,
      successorInstrumentId: event.successorInstrumentId,
    },
    {
      deviceId: deps.deviceId,
      ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
    },
  );

  return { instrumentId: stamped.id };
}
