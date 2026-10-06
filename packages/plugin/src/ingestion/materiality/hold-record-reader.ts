/**
 * The `[D-500]` hold-record reader and the consumer hold check: the reader floor's second piece
 * (`[D-502]`; `ol-egov.141.89.104.33`). The first piece, the `[D-473]` tolerant anchor reader, is
 * `citation-hash-store.ts`.
 *
 * ===========================================================================
 * WHAT A HOLD IS
 * ===========================================================================
 * `[D-500]` adopts `VALIDATION-FREEZE.md` §3.1 (service repo, `docs/direction/papers/knowledge-graph/`):
 * a newer build that withdraws something (a correction, a withdrawn proposition, lost support)
 * writes the precise fact to its own record family, and beside it one coarse, durable, write-once
 * HOLD per covered passage, carrying a reason value and the fact's id. A floor build cannot read the
 * precise fact. It reads the holds, and withholds everything that cites a held passage. On the floor,
 * over-withholding is the accepted cost; under-withholding is never allowed.
 *
 * ===========================================================================
 * THIS MODULE READS. IT WRITES NOTHING.
 * ===========================================================================
 * No hold, no anchor, no reason value. Every function here is pure over its inputs (§4.10: no read
 * and no release writes to stored holds or anchors; M11). It knows the one reason value `[D-500]`
 * adds, `newer-fact`, only to report it as recognised; it never writes it. It releases nothing: a
 * floor build cannot positively resolve any reason (§3.1 invariant 4 is the aware reader's, and
 * needs the precise fact), so every hold it can read holds.
 *
 * ===========================================================================
 * WHAT IS RULED, AND WHAT IS HELD HERE AS PROVISIONAL
 * ===========================================================================
 * Ruled (`[D-500]`; §3.1 invariant 3; §4.9 O2, O3, O5; §4.10's floor column):
 *  - every hold this build can read is a hold, and a reason value it does not know keeps the hold;
 *  - bytes that do not parse as a hold are not a hold: they are left where they are and reported
 *    (M2: before a republished hold arrives, an unreadable hold is not one this device knows);
 *  - new fields are ignored; withdrawal never rides in an optional field.
 *
 * Not ruled, so provisional and named here:
 *  - WHERE the record lives, and its stored layout. `[D-497]` gives both to the hub as persistence
 *    owner, after the device facts (`ol-egov.141.89.104.6`). So this module has no source of its
 *    own: {@link readHoldText} decodes one newline-delimited text, {@link mergeHoldReads} combines
 *    several, and the caller supplies the text once a location is ruled.
 *  - The field names {@link classifyHoldRecord} decodes: `id`, `factId`, `reason`, and `passage`
 *    with `sourcePath` and `passageDigest` (the names the instrument citation already uses). They
 *    are the floor's reading of the meaning, not an adopted layout. Whoever adopts the layout
 *    either adopts these names or changes that one function before a floor build ships: a floor
 *    that reads names no writer uses would under-withhold, silently.
 *
 * Three readings this module takes where the ruling's letter is silent, each in the
 * over-withholding direction only (Class B, for review):
 *  1. A record whose PASSAGE reads is a hold even when its id, fact id or reason is missing or
 *     malformed. §3.1 calls the envelope (id, fact id, passage); the floor needs only the passage
 *     to withhold, and dropping such a record would under-withhold.
 *  2. A hold store that exists but cannot be read (`unavailable`) holds every artifact that cites
 *     a passage. An unreadable store is never read as "no holds" (compatibility obligation 3:
 *     a consumer's "no record" default must not be permissive). A store that does not exist
 *     (`absent`) holds nothing: nothing was published to it.
 *  3. Passage matching ({@link holdCoversPassage}): two digests under the same passage rule match
 *     when equal, whatever the source path (so a renamed or moved source still matches); when the
 *     digests cannot be compared (either absent, malformed, or under different rule versions), the
 *     hold covers every citation of the same source path.
 */

import { parsePassageDigest } from 'olea-core';

/** The one reason value `[D-500]` adds. Recognised here so it can be reported; never written here. */
export const NEWER_FACT_HOLD_REASON = 'newer-fact';
export type KnownHoldReason = typeof NEWER_FACT_HOLD_REASON;
/**
 * A reason value this build does not know: kept as the raw string, and it holds exactly as a known
 * one does (`[D-473]`, §3.1 invariant 3). Branded so a literal is never mistaken for a known reason.
 */
export type UnrecognisedHoldReason = string & { readonly __unrecognisedHoldReason?: never };
export type HoldReason = KnownHoldReason | UnrecognisedHoldReason;

/** The passage a hold names: as much of the passage reference (IF1) as the floor reads. */
export interface HoldPassage {
  readonly sourcePath?: string;
  readonly passageDigest?: string;
  /** A `passageDigest` field was present but not a usable string: the source still matches. */
  readonly digestUnreadable?: true;
}

/** One hold, as the floor reads it. */
export interface HoldRecord {
  /** `hash("hold", fact id, passage)` as written; absent when missing or malformed (the hold still applies). */
  readonly id?: string;
  readonly factId?: string;
  readonly passage: HoldPassage;
  /** Absent when missing or not a string: the hold still applies. */
  readonly reason?: HoldReason;
  /** True only for a reason value this build knows. Reporting only; never a release. */
  readonly reasonRecognised: boolean;
  /** True when id, fact id, a string reason, a source path and a readable digest field are all present. Reporting only. */
  readonly envelopeComplete: boolean;
}

/**
 * Why a stretch of the hold text is not a hold.
 *  - `torn`: an unterminated final line that does not parse, or a fragment that an interrupted
 *    write left in front of a later record on the same line;
 *  - `not-json`: a terminated line that does not parse;
 *  - `not-a-hold`: it parses, but names no passage this build can read.
 */
export type UnreadableHoldKind = 'torn' | 'not-json' | 'not-a-hold';

/** One unreadable stretch, reported by position and length only: never its bytes, which may name her files (D-005). */
export interface UnreadableHoldEntry {
  /** 1-based line number within the text it came from. */
  readonly line: number;
  readonly kind: UnreadableHoldKind;
  /** Characters in the unreadable stretch. */
  readonly length: number;
}

/**
 * What a read of the hold store found.
 *  - `absent`: no hold store exists, so nothing was published to it: no holds.
 *  - `unavailable`: a store exists but could not be read: never "no holds" (reading 2 above).
 *  - `read`: the holds it could read, and every unreadable stretch, reported.
 */
export type HoldStoreRead =
  | { readonly status: 'absent' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'read';
      readonly holds: readonly HoldRecord[];
      readonly unreadable: readonly UnreadableHoldEntry[];
    };

/** A passage an artifact cites. An instrument's citation sidecar and its citation anchor both fit this shape. */
export interface CitedPassage {
  readonly sourcePath: string;
  readonly passageDigest?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readPassage(value: unknown): HoldPassage | null {
  if (!isPlainObject(value)) return null;
  const sourcePath = nonEmptyString(value.sourcePath);
  const passageDigest = nonEmptyString(value.passageDigest);
  const digestUnreadable = value.passageDigest !== undefined && passageDigest === undefined;
  // A passage is named only by a source path or a digest. Neither: nothing to withhold.
  if (sourcePath === undefined && passageDigest === undefined) return null;
  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(passageDigest !== undefined ? { passageDigest } : {}),
    ...(digestUnreadable ? { digestUnreadable: true as const } : {}),
  };
}

/**
 * One decoded record → a hold, or `null` when it names no passage this build can read (§3.1
 * invariant 3: not a hold). Unknown fields, including any version marker, are ignored: a record in
 * a version this build does not know still holds when its passage reads (O3; compatibility
 * obligation 1 forbids renaming a field).
 */
export function classifyHoldRecord(value: unknown): HoldRecord | null {
  if (!isPlainObject(value)) return null;
  const passage = readPassage(value.passage);
  if (passage === null) return null;
  const id = nonEmptyString(value.id);
  const factId = nonEmptyString(value.factId);
  const reason: HoldReason | undefined = nonEmptyString(value.reason);
  return {
    ...(id !== undefined ? { id } : {}),
    ...(factId !== undefined ? { factId } : {}),
    passage,
    ...(reason !== undefined ? { reason } : {}),
    reasonRecognised: reason === NEWER_FACT_HOLD_REASON,
    envelopeComplete:
      id !== undefined &&
      factId !== undefined &&
      reason !== undefined &&
      passage.sourcePath !== undefined &&
      passage.digestUnreadable !== true,
  };
}

/** A repeated publication is byte-identical (§3.1), so equal content is one hold (M10). */
function holdKey(hold: HoldRecord): string {
  return JSON.stringify([
    hold.id ?? null,
    hold.factId ?? null,
    hold.passage.sourcePath ?? null,
    hold.passage.passageDigest ?? null,
    hold.passage.digestUnreadable ?? false,
    hold.reason ?? null,
  ]);
}

function dedupe(holds: readonly HoldRecord[]): HoldRecord[] {
  const seen = new Set<string>();
  const result: HoldRecord[] = [];
  for (const hold of holds) {
    const key = holdKey(hold);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hold);
  }
  return result;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Splits `text` into back-to-back top-level JSON objects (`{...}{...}`), each of which must parse;
 * `null` when it is not exactly that. Brace depth is tracked outside strings only.
 */
function splitObjects(text: string): unknown[] | null {
  const values: unknown[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
    if (index >= text.length) break;
    if (text.charAt(index) !== '{') return null;
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (; index < text.length; index += 1) {
      const char = text.charAt(index);
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end === -1) return null;
    const parsed = tryParse(text.slice(start, end));
    if (!parsed.ok) return null;
    values.push(parsed.value);
    index = end;
  }
  return values.length > 0 ? values : null;
}

/** Candidate starts tried when a line holds a fragment followed by records: bounds the work on a corrupt line. */
const MAX_RECOVERY_STARTS = 64;

/**
 * A line that does not parse whole: the records it still holds, and how many leading characters
 * are a fragment. Two shapes are recovered: records written back to back with no newline between
 * them, and a fragment left by an interrupted write followed by records appended after it.
 * `null` when no record can be recovered.
 */
function recoverLine(line: string): { values: unknown[]; fragmentLength: number } | null {
  const whole = splitObjects(line);
  if (whole !== null) return { values: whole, fragmentLength: 0 };
  let tried = 0;
  for (
    let start = line.indexOf('{', 1);
    start !== -1 && tried < MAX_RECOVERY_STARTS;
    start = line.indexOf('{', start + 1)
  ) {
    tried += 1;
    const values = splitObjects(line.slice(start));
    if (values !== null) return { values, fragmentLength: start };
  }
  return null;
}

/**
 * Decodes one newline-delimited hold text (one record per line). Blank lines are not records. A
 * byte-order mark and CR line ends are tolerated. A final line with no newline that parses is a
 * whole record (a JSON object's last character closes it, so a torn prefix never parses).
 */
export function readHoldText(text: string): Extract<HoldStoreRead, { status: 'read' }> {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const terminated = body.endsWith('\n');
  const physical = body.split('\n');
  const lines = terminated ? physical.slice(0, -1) : physical;
  const holds: HoldRecord[] = [];
  const unreadable: UnreadableHoldEntry[] = [];

  const take = (value: unknown, lineNumber: number, length: number): void => {
    const hold = classifyHoldRecord(value);
    if (hold !== null) holds.push(hold);
    else unreadable.push({ line: lineNumber, kind: 'not-a-hold', length });
  };

  lines.forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return;
    const lineNumber = index + 1;
    const parsed = tryParse(line);
    if (parsed.ok) {
      take(parsed.value, lineNumber, line.length);
      return;
    }
    const recovered = recoverLine(line);
    if (recovered !== null) {
      if (recovered.fragmentLength > 0) {
        unreadable.push({ line: lineNumber, kind: 'torn', length: recovered.fragmentLength });
      }
      const recoveredLength = line.length - recovered.fragmentLength;
      for (const value of recovered.values) take(value, lineNumber, recoveredLength);
      return;
    }
    const finalUnterminated = !terminated && index === lines.length - 1;
    unreadable.push({
      line: lineNumber,
      kind: finalUnterminated ? 'torn' : 'not-json',
      length: line.length,
    });
  });

  return { status: 'read', holds: dedupe(holds), unreadable };
}

/**
 * Combines the reads of several hold texts (several files, or several devices' logs, whichever
 * layout is ruled). Any `unavailable` read makes the whole `unavailable`: its holds are unknown,
 * and could name any passage. All `absent` (or none at all) is `absent`.
 */
export function mergeHoldReads(reads: readonly HoldStoreRead[]): HoldStoreRead {
  if (reads.some((read) => read.status === 'unavailable')) return { status: 'unavailable' };
  const found = reads.filter(
    (read): read is Extract<HoldStoreRead, { status: 'read' }> => read.status === 'read',
  );
  if (found.length === 0) return { status: 'absent' };
  return {
    status: 'read',
    holds: dedupe(found.flatMap((read) => read.holds)),
    unreadable: found.flatMap((read) => read.unreadable),
  };
}

/** Reading 3 in the module doc: does this hold's passage cover this cited passage? */
export function holdCoversPassage(hold: HoldPassage, cited: CitedPassage): boolean {
  const heldDigest =
    hold.passageDigest !== undefined ? parsePassageDigest(hold.passageDigest) : null;
  const citedDigest =
    cited.passageDigest !== undefined ? parsePassageDigest(cited.passageDigest) : null;
  if (heldDigest !== null && citedDigest !== null && heldDigest.version === citedDigest.version) {
    return heldDigest.hash === citedDigest.hash;
  }
  return hold.sourcePath !== undefined && hold.sourcePath === cited.sourcePath;
}

/** One reason on a held artifact, for reporting. */
export interface HoldReasonEntry {
  readonly reason?: HoldReason;
  readonly recognised: boolean;
  readonly factId?: string;
}

/**
 * The hold check for one artifact, from the passages it cites.
 *  - `held: false`: no hold applies. Other withholding (the anchor's own pending reasons, source
 *    change) still decides as before; this check only ever adds a hold.
 *  - `cause: 'hold'`: one or more readable holds cover a cited passage.
 *  - `cause: 'hold-store-unavailable'`: the store could not be read, and the artifact cites a passage.
 */
export type HoldCheck =
  | { readonly held: false }
  | { readonly held: true; readonly cause: 'hold'; readonly reasons: readonly HoldReasonEntry[] }
  | { readonly held: true; readonly cause: 'hold-store-unavailable' };

export function checkHolds(read: HoldStoreRead, cited: readonly CitedPassage[]): HoldCheck {
  // An artifact that cites no passage is not a passage-citing artifact: no hold reaches it.
  if (cited.length === 0) return { held: false };
  if (read.status === 'absent') return { held: false };
  if (read.status === 'unavailable') return { held: true, cause: 'hold-store-unavailable' };
  const covering = read.holds.filter((hold) =>
    cited.some((passage) => holdCoversPassage(hold.passage, passage)),
  );
  if (covering.length === 0) return { held: false };
  const seen = new Set<string>();
  const reasons: HoldReasonEntry[] = [];
  for (const hold of covering) {
    const key = JSON.stringify([hold.reason ?? null, hold.factId ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({
      ...(hold.reason !== undefined ? { reason: hold.reason } : {}),
      recognised: hold.reasonRecognised,
      ...(hold.factId !== undefined ? { factId: hold.factId } : {}),
    });
  }
  return { held: true, cause: 'hold', reasons };
}

/** The two kinds of passage-citing artifact §4.10 names. */
export type PassageCitingArtifactKind = 'instrument' | 'explanation-claim';

/** What a hold does to one artifact (§4.10: "held"). */
export interface HeldEffect {
  /** An instrument is not shown; an explanation claim is shown withdrawn. */
  readonly display: 'not-shown' | 'shown-withdrawn';
  readonly supportUse: false;
  readonly reviewEligible: false;
}

/** `null` when the check holds nothing: the artifact is then decided exactly as before. */
export function heldEffect(kind: PassageCitingArtifactKind, check: HoldCheck): HeldEffect | null {
  if (!check.held) return null;
  return {
    display: kind === 'instrument' ? 'not-shown' : 'shown-withdrawn',
    supportUse: false,
    reviewEligible: false,
  };
}

/**
 * The passages one instrument cites, for {@link checkHolds}: its citation sidecar (the passage it
 * was drafted from) and its citation anchor (where that passage stands now). Both, because a hold
 * on either is a hold on the instrument.
 */
export function citedPassagesOf(
  ...sources: readonly (CitedPassage | undefined)[]
): readonly CitedPassage[] {
  return sources.filter((source): source is CitedPassage => source !== undefined);
}

/**
 * The instruments the holds withhold, as a set to union with the anchor's own pending set
 * (`session-builder/provider.ts`'s `resolveCitationPendingRevalidation`) before presentation.
 */
export function resolveHoldWithheldInstruments(
  read: HoldStoreRead,
  instruments: Iterable<{ readonly instrumentId: string; readonly cited: readonly CitedPassage[] }>,
): ReadonlySet<string> {
  const held = new Set<string>();
  for (const instrument of instruments) {
    if (checkHolds(read, instrument.cited).held) held.add(instrument.instrumentId);
  }
  return held;
}

/** Counts only, for diagnostics and reports: no path, digest, fact id or reason text (D-005). */
export interface HoldReadSummary {
  readonly status: HoldStoreRead['status'];
  readonly holds: number;
  readonly unrecognisedReasons: number;
  readonly incompleteEnvelopes: number;
  readonly torn: number;
  readonly notJson: number;
  readonly notAHold: number;
}

export function summariseHoldRead(read: HoldStoreRead): HoldReadSummary {
  if (read.status !== 'read') {
    return {
      status: read.status,
      holds: 0,
      unrecognisedReasons: 0,
      incompleteEnvelopes: 0,
      torn: 0,
      notJson: 0,
      notAHold: 0,
    };
  }
  const count = (kind: UnreadableHoldKind) =>
    read.unreadable.filter((entry) => entry.kind === kind).length;
  return {
    status: 'read',
    holds: read.holds.length,
    unrecognisedReasons: read.holds.filter((hold) => !hold.reasonRecognised).length,
    incompleteEnvelopes: read.holds.filter((hold) => !hold.envelopeComplete).length,
    torn: count('torn'),
    notJson: count('not-json'),
    notAHold: count('not-a-hold'),
  };
}
