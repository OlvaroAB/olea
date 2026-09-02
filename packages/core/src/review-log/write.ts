/**
 * The D7.1 review-log writer (C5.2, P2-T03, INV-4).
 *
 * This is the cornerstone INV-4 exists to protect: the record cannot be
 * backfilled, so every append here (a) stamps the fields the schema reserves
 * for the writer (`schemaVersion`, `eventId`, and — since D-020 — `kind` for
 * review records; contracts' review-log.ts doc), (b) validates the *whole*
 * record against its own frozen schema before a single byte reaches the vault,
 * and (c) only ever adds bytes to the target file, never rewrites any that were
 * already there (INV-2).
 *
 * **Two writers, one append path (D-020).** `appendReviewLogRecord` writes
 * review events and `appendSuspendRecord` writes suspend/unsuspend events, into
 * the same daily file, through the same `appendEntryLine` below. They differ
 * only in which schema validates them and which fields are stamped versus
 * supplied; the durability discipline described here is shared, not copied.
 *
 * **Why (c) needs care beyond "read then write the concatenation":** if a
 * previous append was interrupted mid-write (crash, killed app), the file on
 * disk can end without its terminating `\n` — the last line is a partial
 * JSON fragment. Concatenating this append's line directly onto that would
 * weld a well-formed record onto garbage, corrupting the *new* line too and
 * making it unrecoverable along with the old one. Instead, exactly one `\n`
 * is added first to close the corrupt line off as its own (still-corrupt,
 * still fully present) line — the same "extend, never rewrite" technique
 * `../uid/stamp.ts`'s `appendEmptyEntry` uses for an unterminated frontmatter
 * entry, for the identical reason: every pre-existing byte survives,
 * unmodified, as a literal prefix of the new content. `../review-log/parse.ts`
 * is what makes that corrupt line harmless: it fails schema validation and
 * is reported, not thrown, while every record before and after it is intact.
 */

import {
  type DisputeLogRecord,
  disputeLogRecord,
  type ExplainBackOfferLogRecord,
  explainBackOfferLogRecord,
  REVIEW_LOG_SCHEMA_VERSION,
  type RetrospectiveOfferLogRecord,
  type ReviewLogEntry,
  type ReviewLogRecord,
  retrospectiveOfferLogRecord,
  reviewLogRecord,
  type SuccessionLogRecord,
  type SuspendLogRecord,
  successionLogRecord,
  suspendLogRecord,
  type VerdictLogRecord,
  verdictLogRecord,
} from 'olea-contracts';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { DisputeLogRecordInput } from './contest-record.js';
import { reviewLogPath } from './path.js';

export type { DisputeLogRecordInput } from './contest-record.js';

/**
 * Every `ReviewLogRecord` field the caller supplies; the writer stamps the
 * rest. `kind` is stamped, not asked for: `appendReviewLogRecord` writes review
 * events and only review events, so letting a caller pass `kind` would only
 * ever create the possibility of it passing the wrong one.
 */
export type ReviewLogRecordInput = Omit<ReviewLogRecord, 'schemaVersion' | 'eventId' | 'kind'>;

/**
 * Every `SuspendLogRecord` field the caller supplies (D-020, F2.6).
 *
 * `kind` **is** part of the input here, unlike above — it is the caller's
 * actual decision, `'suspend'` or `'unsuspend'`, not a constant the writer
 * knows. Unsuspending is a second appended event, never a retraction of the
 * first, so both directions go through this same call.
 */
export type SuspendLogRecordInput = Omit<SuspendLogRecord, 'schemaVersion' | 'eventId'>;

/**
 * Every `VerdictLogRecord` field the caller supplies; the writer stamps the
 * rest (`ol-548w`, INV-6). `kind` is stamped, not asked for — the same reason
 * `ReviewLogRecordInput` stamps it: this writer produces verdict events and
 * only verdict events.
 */
export type VerdictLogRecordInput = Omit<VerdictLogRecord, 'schemaVersion' | 'eventId' | 'kind'>;

/**
 * Every `SuccessionLogRecord` field the caller supplies (`[D-133]`); the
 * writer stamps the rest. `kind` is stamped, not asked for — the same
 * reason `VerdictLogRecordInput` stamps it: this writer produces succession
 * events and only succession events.
 */
export type SuccessionLogRecordInput = Omit<
  SuccessionLogRecord,
  'schemaVersion' | 'eventId' | 'kind'
>;

export interface AppendReviewLogOptions {
  /**
   * Stable per-install identifier. Becomes part of the file name (C5.2: one
   * file per day per device) — never written into the record itself, since
   * the schema doesn't carry a device field and doesn't need one: `eventId`
   * alone is what makes a two-device merge idempotent (contracts' doc).
   */
  readonly deviceId: string;
  /** Event id generator, injectable for deterministic tests. Defaults to `crypto.randomUUID()`. */
  readonly generateEventId?: () => string;
}

export interface AppendReviewLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: ReviewLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

export interface AppendSuspendLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: SuspendLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

export interface AppendVerdictLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: VerdictLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

export interface AppendSuccessionLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: SuccessionLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

export interface AppendDisputeLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: DisputeLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

/**
 * Every `RetrospectiveOfferLogRecord` field the caller supplies (`[D-134]`
 * Q5); the writer stamps the rest. `kind` **is** part of the input, unlike
 * `ReviewLogRecordInput`/`VerdictLogRecordInput`/`SuccessionLogRecordInput` —
 * the same reason `SuspendLogRecordInput` carries it: which of the three
 * (`retrospective-offered`/`-opened`/`-dismissed`) happened is the caller's
 * actual decision, not a constant this writer knows.
 */
export type RetrospectiveOfferLogRecordInput = Omit<
  RetrospectiveOfferLogRecord,
  'schemaVersion' | 'eventId'
>;

export interface AppendRetrospectiveOfferLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: RetrospectiveOfferLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

/**
 * Every `ExplainBackOfferLogRecord` field the caller supplies (`[D-178 /
 * LOG-3]` item 2); the writer stamps the rest. `kind` **is** part of the
 * input, unlike `ReviewLogRecordInput`/`VerdictLogRecordInput` — the same
 * reason `SuspendLogRecordInput`/`RetrospectiveOfferLogRecordInput` carry it:
 * which of `'explain-back-offered'`/`'explain-back-declined'` happened is the
 * caller's actual decision, not a constant this writer knows.
 */
export type ExplainBackOfferLogRecordInput = Omit<
  ExplainBackOfferLogRecord,
  'schemaVersion' | 'eventId'
>;

export interface AppendExplainBackOfferLogResult {
  /** The full, validated record actually written (schemaVersion and eventId included). */
  readonly record: ExplainBackOfferLogRecord;
  /** The vault path it was appended to. */
  readonly path: VaultPath;
}

function defaultGenerateEventId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The calendar day a record belongs to, taken verbatim from its own
 * timestamp's date portion — never recomputed via `../dates.ts`'s UTC
 * normalisation, which exists for scheduling arithmetic (FSRS due-dates),
 * not for "which local day did this happen". The schema requires an offset
 * on every timestamp precisely so this is a straight substring, not a
 * timezone calculation.
 */
function localDateOf(timestamp: string): string {
  const t = timestamp.indexOf('T');
  // Unreachable once `timestamp` has passed `reviewLogRecord`'s zod
  // validation (`z.string().datetime({ offset: true })` always produces a
  // `T` separator) — guarded anyway rather than trusting that invariant
  // silently across a future schema change.
  if (t === -1) {
    throw new Error(
      `review-log append: not a valid ISO-8601 timestamp: ${JSON.stringify(timestamp)}`,
    );
  }
  return timestamp.slice(0, t);
}

/**
 * The single append path, shared by every kind of review-log event.
 *
 * Both public writers below reduce to this: the whole append/idempotency
 * discipline documented at the top of this file — one file per day per device,
 * the crash-safe `\n` separator, extend-never-rewrite — exists exactly once, so
 * a suspend event cannot acquire subtly different durability properties from a
 * review event by having its own copy of the logic. The record is already
 * validated by the time it arrives here.
 *
 * Takes `ReviewLogEntry` alone (not `ReviewLogEntry | DisputeLogRecord` as
 * before `ol-qs72`) — `disputeLogRecordV5` is now a member of the contracts
 * union, so every kind this file writes already fits the one type.
 */
async function appendEntryLine(
  vault: VaultSource,
  entry: ReviewLogEntry,
  deviceId: string,
): Promise<VaultPath> {
  const path = reviewLogPath(localDateOf(entry.timestamp), deviceId);
  const line = `${JSON.stringify(entry)}\n`;

  const existing = (await vault.exists(path)) ? await vault.read(path) : '';
  const needsSeparator = existing.length > 0 && !existing.endsWith('\n');
  const prefix = needsSeparator ? `${existing}\n` : existing;
  await vault.write(path, prefix + line);

  return path;
}

/**
 * Validates, stamps, and append-only-writes one review-log record.
 *
 * Throws — before any write — if the fully-stamped record fails the frozen
 * schema. This is the one guard standing between a future caller bug (a
 * dropped field, a wrong type, an *omitted* nullable key where D7.1 requires
 * an explicit `null` — see contracts' review-log.ts doc on why omission and
 * `null` are not interchangeable here) and a permanently corrupt semester of
 * history.
 */
export async function appendReviewLogRecord(
  vault: VaultSource,
  input: ReviewLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendReviewLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    kind: 'review',
    eventId: generateEventId(),
    ...input,
  };

  const parsed = reviewLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendReviewLogRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one suspend or unsuspend event
 * (D-020, F2.6's durable half).
 *
 * The sibling of `appendReviewLogRecord`, sharing its append path exactly:
 * suspension events live in the *same* daily file as reviews, in the same
 * append-only order, and are told apart on read by `kind` alone. Nothing is
 * rewritten and nothing is removed — unsuspending appends a second event, so
 * the log keeps the whole history of what she stopped and restarted studying,
 * and the suspended set stays a projection (`./suspension.ts`) rather than
 * state anyone has to keep correct.
 *
 * **This function has no production caller today (`ol-xvmx`, `ol-97u2`), and
 * that is a defect in the port above it, not in this writer.** The plugin's
 * `SuspendPort.suspend` takes an instrument id alone, while the frozen suspend
 * record requires the concept set as well — deliberately, because the
 * instrument→concept binding is not reconstructible after the fact (see the
 * record's own doc in contracts). So no implementation of that port can produce
 * a conforming record, and F2.6's durable half is unwired rather than unbuilt.
 * The plugin and workbench both stop at an honest `Notice` for this reason.
 *
 * Do not read that as an invitation to delete this. INV-4's whole claim is that
 * the recording discipline lands *before* the data it records: a suspension not
 * written while this is unwired is not a bug that can be fixed later, it is an
 * instruction she gave that left no trace. `./suspension.ts`'s projection and
 * the Today due filter already read these events; removing the only writer
 * would leave live readers of an event nothing can emit. The fix is widening
 * the port to carry `conceptIds` — an interface change within the current
 * contract version, not a schema change, and `ReviewInstrument` already carries
 * the field at the call site.
 */
export async function appendSuspendRecord(
  vault: VaultSource,
  input: SuspendLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendSuspendLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    eventId: generateEventId(),
    ...input,
  };

  const parsed = suspendLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendSuspendRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one accept/edit/reject verdict
 * (`ol-548w`, INV-6).
 *
 * The third sibling of `appendReviewLogRecord`/`appendSuspendRecord`, sharing
 * the same append path and the same durability discipline: one file per day
 * per device, crash-safe `\n` separation, and every byte validated against
 * the frozen schema before it reaches the vault.
 *
 * **Reachability.** Wired (`ol-mfn0`, wave-2 round-3): called from
 * `packages/plugin/src/generation/accept.ts`'s `DraftAcceptPort.accept`/
 * `.reject` (:106 and :137), reached from `review/session.ts`'s
 * `resolveDraftAt` (:356-366) off the real keypress/click dispatch in
 * `review/view.ts` (:257-261) — the same operation that does the
 * accept-to-vault write, never emitted ahead of it.
 */
export async function appendVerdictRecord(
  vault: VaultSource,
  input: VerdictLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendVerdictLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    kind: 'verdict',
    eventId: generateEventId(),
    ...input,
  };

  const parsed = verdictLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendVerdictRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one succession event
 * (`[D-133]`, `ol-w00s` / `ol-2zfj.37`).
 *
 * The fourth sibling of `appendReviewLogRecord`/`appendSuspendRecord`/
 * `appendVerdictRecord`, sharing the same append path and the same
 * durability discipline. Records only the fact of succession — which
 * instrument this superseded, which instrument superseded it, and when —
 * never a copy of the chain itself, which lives in the successor's own
 * `predecessor:` field (`../instrument/mcq-format.ts`'s
 * `MCQ_FIELD_PREDECESSOR`; `packages/plugin/src/instrument-blocks/
 * predecessor.ts` for the block-agnostic write).
 *
 * **Reachability.** Composed from `packages/plugin/src/generation/
 * materialize-mcq.ts`'s `materializeAcceptedDraft`, when its caller supplies
 * a `predecessorInstrumentId` — see that file's module doc for the current
 * caller state.
 */
export async function appendSuccessionRecord(
  vault: VaultSource,
  input: SuccessionLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendSuccessionLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    kind: 'succession',
    eventId: generateEventId(),
    ...input,
  };

  const parsed = successionLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendSuccessionRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one **dispute** event — the
 * "recorded either way" half of `[D-046]` clause 4, shaped by `[D-095]`
 * (`ol-fgba` [DISP-1]).
 *
 * The fifth sibling of `appendReviewLogRecord`/`appendSuspendRecord`/
 * `appendVerdictRecord`/`appendSuccessionRecord`, sharing the same append path
 * and the same durability discipline. Used for BOTH the opening dispute and
 * its later resolution: a resolution is a second record carrying `resolves`
 * and `outcome`, never an edit to the first, which is what lets the
 * compensating event name her contest as its catalyst by a durable event id.
 *
 * **The schema it validates against lives in `packages/contracts/src/
 * review-log.ts` (`disputeLogRecordV5`), moved there by `ol-qs72`** — a
 * fifth `kind` literal, additive to `reviewLogEntryV5`, no version bump.
 * `./contest-record.ts` re-exports the same names it always did, so this
 * function's own body is unchanged by the move beyond which schema
 * `disputeLogRecord` resolves to.
 *
 * **Recording is not optional garnish.** Every caller of `contestClaim`
 * appends through here; an affordance that computed an effect and wrote
 * nothing would be the dismiss button `[D-046]` clause 4 exists to rule out.
 */
export async function appendDisputeRecord(
  vault: VaultSource,
  input: DisputeLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendDisputeLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    kind: 'dispute',
    eventId: generateEventId(),
    ...input,
  };

  const parsed = disputeLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendDisputeRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one **retrospective-offer**
 * event — `offered`, `opened` or `dismissed` (`[D-134]` Q5, F8.8).
 *
 * The sixth sibling of `appendReviewLogRecord`/`appendSuspendRecord`/
 * `appendVerdictRecord`/`appendSuccessionRecord`/`appendDisputeRecord`,
 * sharing the same append path and the same durability discipline. `kind`
 * is part of `input`, not stamped — the same reason `appendSuspendRecord`
 * takes it: which of the three happened is the caller's actual decision.
 *
 * **Moved here from the interim per-install store (`ol-0r92.16`).**
 * `ol-r68l`'s round-27 build wrote these events into `packages/plugin/src/
 * retrospective/offer-store.ts`'s `data.json` because `packages/contracts/`
 * and this file sat outside that lane's ownership. `[D-134]` Q5's own words
 * — "ordinary events in the local event log... no new storage, second
 * device converges" — name exactly this file's append path; the interim
 * store is deleted by the same bead that adds this function.
 *
 * **Reachability.** Called from `packages/plugin/src/retrospective/
 * offer-events.ts`'s `createRetrospectiveOfferEventLog(...).append`, itself
 * called from `packages/plugin/src/retrospective/provider.ts`'s
 * `markOpened`/`markDismissed` and from `../home/provider.ts` /
 * `../grove/provider.ts`'s `dismiss` (both delegate to the same
 * `provider.ts` method — see that file's own module doc).
 */
export async function appendRetrospectiveOfferRecord(
  vault: VaultSource,
  input: RetrospectiveOfferLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendRetrospectiveOfferLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    eventId: generateEventId(),
    ...input,
  };

  const parsed = retrospectiveOfferLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendRetrospectiveOfferRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}

/**
 * Validates, stamps, and append-only-writes one **explain-back-offer** event —
 * `explain-back-offered` or `explain-back-declined` (`[D-178 / LOG-3]` item 2,
 * `ol-3ux7.5.6`, `ol-0r92.13`).
 *
 * The seventh sibling of `appendReviewLogRecord`/`appendSuspendRecord`/
 * `appendVerdictRecord`/`appendSuccessionRecord`/`appendDisputeRecord`/
 * `appendRetrospectiveOfferRecord`, sharing the same append path and the same
 * durability discipline. `kind` is part of `input`, not stamped — the same
 * reason `appendSuspendRecord`/`appendRetrospectiveOfferRecord` take it: which
 * of the two happened is the caller's actual decision.
 *
 * **Records that an offer happened, and — separately — that it went
 * untaken.** F2.14a rules that declining changes nothing and is not itself a
 * state; this writer does not contradict that, because an append-only event
 * is a record of something that *happened*, never a state she is in. There is
 * no `accepted` counterpart to call here — an accepted offer is evidenced by
 * the `explain-back` review record `appendReviewLogRecord` already produces —
 * and calling this function is not itself a decline: it is called once for
 * the offer and, only when the offer goes untaken, a second time with
 * `kind: 'explain-back-declined'` naming the first record's `eventId` as
 * `answers`.
 *
 * **Reachability.** No production caller yet. The banner this authorises a
 * record for renders at `packages/plugin/src/review/view.ts` and clears
 * itself on an unaccepted offer around lines 682-719 (`view.ts`'s own
 * `dismiss`/timeout handling for the F2.12 repeated-failure banner);
 * wiring that surface to call this writer is follow-up work on another lane,
 * not this one.
 */
export async function appendExplainBackOfferRecord(
  vault: VaultSource,
  input: ExplainBackOfferLogRecordInput,
  options: AppendReviewLogOptions,
): Promise<AppendExplainBackOfferLogResult> {
  const generateEventId = options.generateEventId ?? defaultGenerateEventId;

  const candidate: unknown = {
    schemaVersion: REVIEW_LOG_SCHEMA_VERSION,
    eventId: generateEventId(),
    ...input,
  };

  const parsed = explainBackOfferLogRecord.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `appendExplainBackOfferRecord: record failed schema validation: ${parsed.error.message}`,
    );
  }
  const record = parsed.data;
  const path = await appendEntryLine(vault, record, options.deviceId);

  return { record, path };
}
