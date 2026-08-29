/**
 * Review-log reader (C5.2, P2-T03, INV-4).
 *
 * The counterpart to `./write.ts`'s append discipline: a device can crash or
 * lose power mid-append, leaving the log's last physical line incomplete
 * (half a JSON object, no trailing newline). That must never take the rest
 * of the day's — or the semester's — history down with it. `parseReviewLog`
 * therefore treats every line independently: a line that fails to parse as
 * JSON, or parses but fails the frozen schema for its own declared version, is
 * reported in `invalidLines` and skipped, never thrown, and never affects any
 * other line. This is what "tolerates a partially-written trailing line" means
 * in this bead's acceptance criteria — recovery of everything before the crash,
 * with the crash itself visible for diagnostics rather than silently eaten.
 *
 * **Version first, never guess (D-020, `ol-t3sd`, `ol-g6zg`, `ol-tka5`).** A
 * line's `schemaVersion` is read before any shape is assumed: `1` validates
 * against the frozen `reviewLogRecordV1` and is then routed through core's
 * `upgradeV1`, `upgradeV2` and `upgradeV3` in turn; `2` validates against the
 * frozen `reviewLogEntryV2` union and is routed through `upgradeV2` then
 * `upgradeV3`; `3` validates against the frozen `reviewLogEntryV3` union and
 * is routed through `upgradeV3`; `5` validates against `reviewLogEntry`, the
 * current discriminated union of review, suspension and verdict events.
 * Anything else — including a missing or non-numeric version, a version newer
 * than this build understands, **and `4`** — takes the ordinary invalid-line
 * path with a reason saying so. `4` joins that set deliberately, not by
 * omission: `[D-109]` (`ol-tka5`) rules review-log v5 a migrate-in-place bump
 * because no real v4 record exists anywhere to stay readable for, so a v4
 * line is exactly as unreadable to this build as a version it has never heard
 * of — there is nothing to distinguish it from. The general case is worth
 * stating out loud regardless: a newer device writing v6 into a synced vault
 * must not have its records silently reinterpreted as v5 by an older build.
 * Every caller therefore sees only current-shape entries.
 */

import {
  REVIEW_LOG_READABLE_VERSIONS,
  type ReviewLogEntry,
  reviewLogEntry,
  reviewLogEntryV2,
  reviewLogEntryV3,
  reviewLogRecordV1,
} from 'olea-contracts';
import type { DisputeLogRecord } from './contest-record.js';
import { upgradeV1, upgradeV2, upgradeV3 } from './upgrade.js';

export interface InvalidReviewLogLine {
  /** 1-based line number within the file, matching what an editor would show. */
  readonly lineNumber: number;
  /** The raw line text, exactly as read (no trimming), for diagnostics. */
  readonly raw: string;
  readonly reason: string;
}

export interface ParseReviewLogResult {
  /**
   * Every valid line, in file order, at the **current** schema version —
   * review events and suspension events interleaved, discriminated by `kind`.
   * v1 records appear here already upgraded (see `./upgrade.ts`); nothing
   * downstream ever sees a v1 shape.
   */
  readonly records: readonly ReviewLogEntry[];
  /**
   * Lines that did not yield a valid record — bad JSON or schema failure.
   * Always populated instead of thrown, so one bad line (most often a
   * crash-truncated final line) never costs the caller the records around
   * it.
   */
  readonly invalidLines: readonly InvalidReviewLogLine[];
  /**
   * Dispute events (`[D-046]` clause 4 / `[D-095]`, `ol-fgba` [DISP-1]), in
   * file order — the record that makes a contest more than a dismiss button.
   *
   * **A separate field rather than a member of `records`, deliberately, and
   * still true now that `disputeLogRecordV5` IS a member of `olea-contracts`'
   * `reviewLogEntry` union (`ol-qs72` moved the schema; this separation did
   * not move with it — see this module's own doc above for why).** Keeping
   * disputes out of `records` means no consumer that switches exhaustively
   * over `ReviewLogEntry['kind']` has to grow a `'dispute'` arm it has
   * nothing to say about — "every review event" and "every dispute about a
   * claim" stay different questions, the same reasoning `./contest-record.
   * ts`'s header carries in full.
   */
  readonly disputes: readonly DisputeLogRecord[];
}

/**
 * Reads a parsed JSON line's declared `schemaVersion` without assuming it has
 * one, or that it is even an object — a crash-truncated line can deserialise
 * to anything, including `null` or a bare number.
 */
function declaredSchemaVersion(json: unknown): number | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const version = (json as Record<string, unknown>).schemaVersion;
  return typeof version === 'number' ? version : undefined;
}

/**
 * Parses append-only review-log JSONL content (C5.2's one-record-per-line
 * format). Byte layout assumed: `\n`-terminated lines, `\r\n` tolerated
 * (a trailing `\r` is stripped before JSON parsing). Blank lines are
 * tolerated silently — never a data line, never reported as invalid.
 */
export function parseReviewLog(content: string): ParseReviewLogResult {
  const records: ReviewLogEntry[] = [];
  const invalidLines: InvalidReviewLogLine[] = [];
  const disputes: DisputeLogRecord[] = [];

  const lines = content.split('\n');
  lines.forEach((rawLine, index) => {
    // `content.split('\n')` yields one trailing '' when `content` itself
    // ends in '\n' (nothing after the last real line) — not a line at all,
    // skip it silently. Any other final element — including a genuinely
    // partial JSON fragment left by a crash mid-append — goes through the
    // exact same validation as every other line below, which is the
    // "tolerate" behaviour: it fails to parse or fails schema validation and
    // is reported in `invalidLines`, and every complete record before it is
    // returned unaffected.
    const isFinalSplitArtifact = index === lines.length - 1;
    if (isFinalSplitArtifact && rawLine === '') return;

    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      invalidLines.push({
        lineNumber: index + 1,
        raw: rawLine,
        reason: err instanceof Error ? err.message : 'invalid JSON',
      });
      return;
    }

    const version = declaredSchemaVersion(json);

    if (version === 1) {
      const parsed = reviewLogRecordV1.safeParse(json);
      if (!parsed.success) {
        invalidLines.push({ lineNumber: index + 1, raw: rawLine, reason: parsed.error.message });
        return;
      }
      records.push(upgradeV3(upgradeV2(upgradeV1(parsed.data))));
      return;
    }

    if (version === 2) {
      const parsed = reviewLogEntryV2.safeParse(json);
      if (!parsed.success) {
        invalidLines.push({ lineNumber: index + 1, raw: rawLine, reason: parsed.error.message });
        return;
      }
      records.push(upgradeV3(upgradeV2(parsed.data)));
      return;
    }

    if (version === 3) {
      const parsed = reviewLogEntryV3.safeParse(json);
      if (!parsed.success) {
        invalidLines.push({ lineNumber: index + 1, raw: rawLine, reason: parsed.error.message });
        return;
      }
      records.push(upgradeV3(parsed.data));
      return;
    }

    if (version === 5) {
      // `reviewLogEntry` (contracts) is the current union, and `disputeLogRecordV5`
      // is a member of it since `ol-qs72` moved the schema there. A dispute
      // line validates and routes through the SAME `discriminatedUnion` every
      // other v5 kind does — it is pulled OUT into `disputes` afterward, on
      // its own `kind` literal, rather than left in `records`. That split is
      // `./parse.ts`'s own choice, not a schema limitation (see
      // `ParseReviewLogResult.disputes`'s doc): it keeps a dispute line out of
      // `invalidLines` — a persisted event this build wrote and then reported
      // as corrupt would be the worst of both — while sparing every consumer
      // that switches exhaustively over `ReviewLogEntry['kind']` a `'dispute'`
      // arm it has nothing to say about.
      const parsed = reviewLogEntry.safeParse(json);
      if (!parsed.success) {
        invalidLines.push({ lineNumber: index + 1, raw: rawLine, reason: parsed.error.message });
        return;
      }
      if (parsed.data.kind === 'dispute') {
        disputes.push(parsed.data);
        return;
      }
      records.push(parsed.data);
      return;
    }

    invalidLines.push({
      lineNumber: index + 1,
      raw: rawLine,
      reason:
        version === undefined
          ? 'no readable schemaVersion — cannot choose a schema, and guessing one is forbidden'
          : `unknown review-log schemaVersion ${version} (this build reads ${[...REVIEW_LOG_READABLE_VERSIONS].sort((a, b) => a - b).join(', ')})`,
    });
  });

  return { records, invalidLines, disputes };
}
