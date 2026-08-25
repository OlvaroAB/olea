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
  REVIEW_LOG_SCHEMA_VERSION,
  type ReviewLogEntry,
  type ReviewLogRecord,
  reviewLogRecord,
  type SuspendLogRecord,
  suspendLogRecord,
  type VerdictLogRecord,
  verdictLogRecord,
} from 'olea-contracts';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { reviewLogPath } from './path.js';

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
 * **Reachability.** This function has no production caller yet — emitting a
 * verdict event from the accept/reject UI is the ask-modal lane's job, not
 * this one's (see the bead this function's `ol-548w` reference points at).
 * Same posture as `appendSuspendRecord` above: the recording discipline is
 * built *before* the UI that will call it, deliberately, so the day that UI
 * lands there is already somewhere correct for its verdict to go.
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
