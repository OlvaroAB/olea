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
 *
 * ## The `[D-220 / DIST-3]` distractor-provenance sidecar (`ol-egov.109`, `ol-0r92.52`)
 *
 * Right beside the citation-sidecar write above (same spot, same "before either write branch"
 * timing, same frozen id), this builds one `DistractorProvenanceEntry` per distractor that
 * survived generation with grounding — pairing `input.question.distractors[i]` with
 * `input.question.distractorGrounding[i]` wherever the latter is a non-null object — and writes
 * them to `writeDistractorProvenance` (`olea-core`'s `instrument/distractor-provenance-store.ts`)
 * keyed by `stamped.id`. **Skipped entirely (never written as an empty sidecar) when there is
 * nothing grounded to record** — `distractorGrounding` absent (the pre-`[D-195]` bare-string
 * generation shape) or every entry `null` — the same "no sidecar means no provenance, never a
 * fabricated one" posture `[D-220]`'s ruling states, and the same shape as the citation sidecar's
 * own `undefined`-means-skip. This never touches `stamped.content` and never lands in her note
 * (INV-6) — the vault's `McqInstrument.distractors` stays the bare `string[]` `[D-202]` left it
 * as; only `input.question.distractors`' TEXT reaches the block, exactly as before this bead.
 *
 * ## The `[ol-0r92.87]` stale-input guard
 *
 * F3.3's passive accept happens at first presentation, which can be minutes or days after
 * `pipeline.ts` drafted the question against a snapshot of `sourcePath`'s note. If that note
 * changed in between — her own edit, a sync from another device, a later sweep's own write —
 * accepting the draft against whatever the note now contains would insert a block she never
 * reviewed and record a verdict about a passage that no longer exists, silently. This function
 * refuses instead: when `input.expectedSourceContentHash` is supplied, the note is re-hashed
 * (`hashText`, `olea-core`, the same SHA-256-hex algorithm `ingestion/hash.ts` uses everywhere
 * else in this codebase for "did the bytes change") immediately after the read above, and a
 * mismatch throws `StaleSourceRevisionError` **before** `insertMcqBlock`/`vault.write` ever run
 * — nothing is written to her vault on this path, matching the existing "a refusal writes
 * nothing" posture the blank-feedback check just below already has. `accept.ts` is the one
 * caller that supplies this hash (from `DraftRecord.sourceContentHash`, `generation/types.ts`)
 * and is responsible for the bookkeeping once this throws: flipping the cached record off
 * `pending` and appending a `rejected` verdict, so a retry does not re-materialize. `undefined`
 * (the pre-`ol-0r92.87` default, and every draft cached before this field existed) skips the
 * check entirely — no snapshot to compare against means no gate, the same "no signal" posture
 * `sourceCitation`/`predecessorInstrumentId` below already use.
 *
 * ## The retry-orphan fix (`ol-egov.141.89.2.8`)
 *
 * Found by the practice-authoring code-case executor (`.olea-harness/ilb-pra/dev-r1/
 * retry-orphan-sidecar.md`, no content — evidence lives there). `stampMcqId`'s default id is
 * random (`crypto.getRandomValues`), minted fresh on every call. When attempt 1 writes the
 * citation sidecar below and is then interrupted before `vault.write` runs, nothing durable
 * records which id attempt 1 used — the note itself was never written, so a retry re-reads the
 * same unchanged note (the stale-input guard above passes), re-inserts the block from scratch,
 * and used to mint a SECOND, different random id. Attempt 1's citation record is then orphaned:
 * keyed by an id no instrument in the vault ever carries.
 *
 * Fixed by deriving the id deterministically from the accepted draft (`deriveInstrumentId`
 * below) rather than persisting a pre-write id in the caller. Persisting-before-first-write was
 * the other option the bead named, but it would require `accept.ts`/`cache-store.ts` (this
 * bead's `owns` is this file only) to write `DraftRecord.instrumentId` — a field currently
 * populated only on resolution, after materialization succeeds — ahead of the vault write, which
 * is a caller-side sequencing change this file cannot make. Deterministic derivation needs no
 * such change: `stampMcqId`'s `generateId` seam (`olea-core`) already exists exactly for this
 * (its own doc: "Injectable for deterministic tests"), and this module already hashes note
 * content for the stale-input guard above, so hashing the draft's own fields for its id reuses
 * the same primitive rather than adding a new one.
 *
 * **The id is per DRAFT, not per question text.** The first cut of this fix hashed only
 * `sourcePath`/`question`/`predecessorInstrumentId` — everything a retry of the SAME draft
 * always resupplies identically. But two DIFFERENT accepted drafts can legitimately carry
 * identical question text (a regenerated duplicate, two sweeps producing the same item), and
 * random ids kept those distinct where content-only hashing would not have: two distinct drafts
 * would derive the SAME instrument id, which breaks the write-once sidecar guards below (the
 * second accept would see the first's sidecar and skip writing its own) and the assumption that
 * an instrument id is unique per instrument. So `input.draftId` — `DraftRecord.draftId`
 * (`generation/types.ts`), stable across every retry of the SAME draft and unique per draft
 * (`cache-store.ts`'s file name) — is folded into the hash too when supplied. Two calls with the
 * same `draftId` (any retry of one draft, this bead's whole scenario) still converge on the same
 * id; two calls with different `draftId`s (two distinct drafts, however similar their question
 * text) now always diverge. `undefined` only for a caller with no draft identity to supply —
 * none exists in this package today; `accept.ts` always has one — which falls back to the
 * pre-draftId hash rather than refusing, matching every other optional field's "no signal, skip
 * the input" convention in this module.
 *
 * With `draftId` supplied, two calls to `materializeAcceptedDraft` for the same draft — exactly
 * what a retry of the same cached `DraftRecord` supplies — now always converge on the same id, so
 * a retry after any write boundary re-derives the SAME id attempt 1 used: the sidecar attempt 1
 * wrote stops being orphaned, and no persisted record shape changes (the id is still just a
 * `mcq-` string wherever it lands). This never reads the note's own prose into the id — only the
 * drafted question's fields and the draft's own opaque id, already in memory before this function
 * is ever called — so nothing about her content becomes newly derivable from an instrument id
 * that could not be already.
 *
 * **The two sidecar writes below are also made retry-safe, not just id-stable.** Both
 * `writeInstrumentCitation` and `writeDistractorProvenance` are write-once stores that THROW if
 * a record already exists under the id they're given (their own module docs, `olea-core`) — with
 * the id now converging across attempts, a retry that reached the citation write on attempt 1
 * would otherwise hit that throw on attempt 2 instead of completing. Each write below is now
 * guarded by a `vault.exists` check on that sidecar's own path first, so a sidecar a prior
 * interrupted attempt already wrote is left untouched (still correctly keyed, since the id
 * matches) and a retry only writes what it did not yet write, before writing the note itself.
 */

import {
  acceptGeneratedMcq,
  appendSuccessionRecord,
  buildSuccessionEvent,
  citationStorePath,
  type DistractorProvenanceEntry,
  distractorProvenanceStorePath,
  hashText,
  type InstrumentCitation,
  insertMcqBlock,
  parseDocument,
  parseMcqBlocks,
  stampMcqId,
  type VaultPath,
  type VaultSource,
  writeDistractorProvenance,
  writeInstrumentCitation,
} from 'olea-core';
import { stampPredecessorField } from '../instrument-blocks/predecessor.js';
import { isoWithLocalOffset } from '../review/ports.js';
import type { DraftQuestion } from './types.js';

export interface MaterializeAcceptedDraftInput {
  readonly sourcePath: VaultPath;
  readonly question: DraftQuestion;
  /**
   * `DraftRecord.draftId` (`generation/types.ts`) — this draft's own stable, unique-per-draft
   * identity, stable across every retry of the same draft. Folded into the instrument id this
   * call derives (`deriveInstrumentId` below, the module doc's "retry-orphan fix" section) so
   * two distinct drafts with identical question text still derive distinct instrument ids, while
   * a retry of the SAME draft still converges. `undefined` only for a caller with no draft
   * identity to supply — none exists in this package today.
   */
  readonly draftId?: string;
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
  /**
   * `ol-0r92.87`'s stale-input guard — see the module doc's own section.
   * `DraftRecord.sourceContentHash` (`generation/types.ts`), forwarded
   * verbatim by `accept.ts`. `undefined` skips the check entirely.
   */
  readonly expectedSourceContentHash?: string;
}

/**
 * Thrown by `materializeAcceptedDraft` when `expectedSourceContentHash` is supplied and disagrees
 * with a fresh hash of `sourcePath`'s current content — see the module doc's stale-input section.
 * Thrown before anything is written, so a caller catching this knows the vault is untouched.
 * `accept.ts` is the one caller that catches it today, to do the reject bookkeeping.
 */
export class StaleSourceRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleSourceRevisionError';
  }
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

/**
 * Derives a stable instrument id from exactly what identifies this one accepted draft — never
 * from the note's own prose — so a retry of `materializeAcceptedDraft` after an interrupted
 * write converges on the SAME id instead of `stampMcqId`'s default random mint producing a new
 * one each call. See the module doc's "retry-orphan fix" section for why this lives here rather
 * than as a pre-write persisted id in the caller.
 *
 * `sourcePath` and every `question` field a retry always supplies identically (the same cached
 * `DraftRecord`, re-forwarded verbatim by `accept.ts`) are hashed together; `predecessorInstrumentId`
 * is folded in too so an ordinary draft and a `[D-133]` successor never derive the same id from
 * otherwise-matching question text. `input.draftId` — `DraftRecord.draftId`, unique per draft and
 * stable across every retry of that same draft — is folded in ahead of everything else: it is
 * what keeps two DIFFERENT drafts with identical question text from deriving the SAME instrument
 * id (the module doc's "the id is per draft" section), while still letting a retry of the SAME
 * draft converge. `hashText` is the same SHA-256-hex primitive the stale-input guard above
 * already uses on note content — this call hashes the draft's own identity and fields instead.
 */
async function deriveInstrumentId(input: MaterializeAcceptedDraftInput): Promise<string> {
  const canonical = JSON.stringify({
    draftId: input.draftId ?? null,
    sourcePath: input.sourcePath,
    stem: input.question.stem,
    correctAnswer: input.question.correctAnswer,
    distractors: input.question.distractors,
    feedback: input.question.feedback,
    predecessorInstrumentId: input.predecessorInstrumentId ?? null,
  });
  const digest = await hashText(canonical);
  return `mcq-${digest.slice(0, 16)}`;
}

/**
 * Pairs `question.distractors[i]` with `question.distractorGrounding[i]` wherever the latter is a
 * non-null, populated grounding — see the module doc's `[D-220]` section for why an empty result
 * here means "skip the write entirely", never "write an empty sidecar". Never includes
 * `question.correctAnswer` (that option carries no `believes`/`source_says` — `McqOption`'s own
 * doc, `packages/plugin/src/review/types.ts`).
 */
function groundedDistractorEntries(question: DraftQuestion): readonly DistractorProvenanceEntry[] {
  const grounding = question.distractorGrounding;
  if (grounding === undefined) return [];
  const entries: DistractorProvenanceEntry[] = [];
  for (let i = 0; i < question.distractors.length; i++) {
    const text = question.distractors[i];
    const g = grounding[i];
    if (text === undefined || g === undefined || g === null) continue;
    entries.push({ text, believes: g.believes, source_says: g.source_says });
  }
  return entries;
}

export async function materializeAcceptedDraft(
  vault: VaultSource,
  input: MaterializeAcceptedDraftInput,
  deps: MaterializeAcceptedDraftDeps = {},
): Promise<MaterializeAcceptedDraftResult> {
  const source = await vault.read(input.sourcePath);

  // `ol-0r92.87`'s stale-input guard — see the module doc's own section.
  // Checked before anything else so a mismatch never reaches `insertMcqBlock`
  // or `vault.write`: nothing is written to her vault on this path.
  if (input.expectedSourceContentHash !== undefined) {
    const currentHash = await hashText(source);
    if (currentHash !== input.expectedSourceContentHash) {
      throw new StaleSourceRevisionError(
        `materializeAcceptedDraft: ${input.sourcePath} changed since this draft was cached — refusing to accept against content that was never reviewed (F3.3)`,
      );
    }
  }

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

  // Deterministic, not `stampMcqId`'s default random mint — see the module doc's
  // "retry-orphan fix" section: a retry against the same unchanged note must re-derive the same
  // id a prior, interrupted attempt already minted and sidecar-wrote, never a fresh one.
  const derivedId = await deriveInstrumentId(input);
  const stamped = stampMcqId(content, inserted.span, { generateId: () => derivedId });

  // `[D-181]`: the sidecar, never text written into her notes — see the
  // module doc's own section. Skipped, not fabricated, when the pipeline
  // had no citation to record for this draft. Also skipped — rather than
  // calling the write-once store and taking its "already has a record"
  // throw — when a prior, interrupted attempt already wrote this exact
  // sidecar under the SAME derived id (the module doc's "retry-orphan fix"
  // section): a retry must converge cleanly, not fail on the half of the
  // work an earlier attempt already finished.
  if (input.sourceCitation !== undefined) {
    if (!(await vault.exists(citationStorePath(stamped.id)))) {
      await writeInstrumentCitation(vault, stamped.id, input.sourceCitation);
    }
  }

  // `[D-220 / DIST-3]`: the distractor-provenance sidecar — see the module doc's own section.
  // Skipped (never an empty sidecar) when nothing survived generation with grounding, and
  // likewise skipped (not re-thrown-into) when a prior interrupted attempt already wrote it
  // under this same derived id — see the citation-sidecar comment just above.
  const distractorProvenanceEntries = groundedDistractorEntries(input.question);
  if (distractorProvenanceEntries.length > 0) {
    if (!(await vault.exists(distractorProvenanceStorePath(stamped.id)))) {
      await writeDistractorProvenance(vault, stamped.id, { entries: distractorProvenanceEntries });
    }
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
