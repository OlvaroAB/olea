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
 * Ruled (`[D-539]`, David 2026-10-06, on this module's own questions):
 *  - READ-TIME CHECKING. The floor checks holds when an artifact is read ({@link checkHolds}) and
 *    sets no anchor reason of its own: there is no anchor writer here, and none is to be added.
 *  - LEGACY CITATIONS MATCH BY PATH. A citation with no passage digest is matched by its source
 *    path, so a hold on any passage of that source holds it (functional scope C5.3, as amended by
 *    `[D-539]`; {@link holdCoversPassage}).
 *  - A WHOLE STORE THAT CANNOT BE READ IS ITS OWN STATE, `unavailable`, never "no holds" and never
 *    "held". Its passage-citing artifacts are still kept from presentation (an unreadable store may
 *    hold anything), but the result says unavailable all the way to the consumer, so it can be shown
 *    as such ({@link HoldCheck}, {@link HoldEffect}); withholding for it never reads as weak
 *    knowledge, because that evidence is neither counted nor removed ({@link HoldWithholding}); and a
 *    failed read is never kept as the answer: {@link HoldStoreReader} reads again on the next tick or
 *    the next load of a view, without restarting Olea. Single unreadable records stay as M2 has them.
 *
 * Not ruled, so provisional and named here:
 *  - WHERE the record lives, and its stored layout. `[D-497]` gives both to the hub as persistence
 *    owner, after the device facts (`ol-egov.141.89.104.6`), and `[D-539]` settles them with that
 *    owner before any install. So this module has no source of its own: the caller supplies a
 *    {@link HoldStoreSource} listing the store's parts once a location is ruled, {@link readHoldText}
 *    decodes one newline-delimited text, and {@link mergeHoldReads} combines several.
 *  - The field names {@link classifyHoldRecord} decodes: `id`, `factId`, `reason`, and `passage`
 *    with `sourcePath` and `passageDigest` (the names the instrument citation already uses). They
 *    are the floor's reading of the meaning, not an adopted layout. Whoever adopts the layout
 *    either adopts these names or changes that one function before a floor build ships: a floor
 *    that reads names no writer uses would under-withhold, silently.
 *  - Any wording for the unavailable state. A surface she sees needs its clause and its registry
 *    entry first; this module only makes the state impossible to mistake for another.
 *
 * Two readings this module takes where the rulings' letter is silent, each in the
 * over-withholding direction only (Class B, for review):
 *  1. A record whose PASSAGE reads is a hold even when its id, fact id or reason is missing or
 *     malformed. §3.1 calls the envelope (id, fact id, passage); the floor needs only the passage
 *     to withhold, and dropping such a record would under-withhold.
 *  2. Passage matching beyond the legacy case ({@link holdCoversPassage}): two digests under the
 *     same passage rule match when equal, whatever the source path (so a renamed or moved source
 *     still matches); when the digests cannot be compared (absent, malformed, or under different
 *     rule versions), the hold covers every citation of the same source path. A store that does not
 *     exist (`absent`) holds nothing: nothing was published to it.
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
 *  - `unavailable`: a store exists but could not be read as a whole, or one of its parts could not
 *    be: its holds are unknown and could name any passage. Never "no holds", and never "held"
 *    either (`[D-539]`): it is carried as its own state to every consumer.
 *  - `read`: the holds it could read, and every unreadable stretch, reported. A store that reads is
 *    never `unavailable` because of what it holds: a corrupt record is reported, not escalated (M2).
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

/**
 * Reads one part's text: one file, or one device's log, whichever layout is ruled. Throws when the
 * part cannot be read, including when it has gone since it was listed: a listed part that vanishes
 * is a failed read this time, never "no holds" (the next read lists again).
 */
export type HoldStorePart = () => Promise<string>;

/**
 * Where the hold store is, supplied by the caller once the persistence owner rules a location
 * (`ol-egov.141.89.104.6`). This module reads; the source only lists and fetches.
 */
export interface HoldStoreSource {
  /**
   * The store's parts. An empty list is no store (`absent`). Throws when the store exists but
   * cannot be listed.
   */
  listParts(): Promise<readonly HoldStorePart[]>;
}

/**
 * One read of the whole store. Never throws: a store that cannot be listed, or any part that cannot
 * be read, makes the whole `unavailable` ({@link mergeHoldReads}); what the parts hold is decoded by
 * {@link readHoldText}, where an unreadable record is reported and never escalated (M2).
 */
export async function readHoldStore(source: HoldStoreSource): Promise<HoldStoreRead> {
  let parts: readonly HoldStorePart[];
  try {
    parts = await source.listParts();
  } catch {
    return { status: 'unavailable' };
  }
  if (parts.length === 0) return { status: 'absent' };
  const reads = await Promise.all(
    parts.map(async (part): Promise<HoldStoreRead> => {
      try {
        return readHoldText(await part());
      } catch {
        return { status: 'unavailable' };
      }
    }),
  );
  return mergeHoldReads(reads);
}

/**
 * The hold store as last read, with what a consumer needs to show the unavailable state and to clear
 * it. Counts and times only: never a path, an error message or a record (D-005).
 */
export interface HoldStoreState {
  readonly read: HoldStoreRead;
  /** Epoch ms when this read finished. */
  readonly readAt: number;
  /** Only while unavailable: epoch ms when the current run of failed reads began. */
  readonly unavailableSince?: number;
  /** Failed reads in a row, this one included; 0 once a read succeeds. */
  readonly failedReads: number;
  /**
   * Only on the first read that succeeds after a run of failed ones: the run it ends, so a consumer
   * showing the unavailable state can clear it and compose again.
   */
  readonly recovered?: { readonly unavailableSince: number; readonly failedReads: number };
}

/**
 * The recovery path for a store that cannot be read (`[D-539]`). It keeps no failed read as the
 * answer: every {@link read} goes to the store again, so the next load of a view reads afresh, and
 * the plugin's interval tick calls {@link readIfUnavailable}, which re-reads only while the last
 * read was unavailable. Either clears the unavailable state as soon as the store reads, without
 * restarting Olea. Reads started while one is in flight share it. It writes nothing.
 */
export class HoldStoreReader {
  private last: HoldStoreState | undefined;
  private inFlight: Promise<HoldStoreState> | undefined;

  constructor(
    private readonly source: HoldStoreSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** The last read, or `undefined` before the first: a consumer with none reads first. */
  get current(): HoldStoreState | undefined {
    return this.last;
  }

  /** Reads the store now: the call a consumer makes when it loads, before presentation. */
  read(): Promise<HoldStoreState> {
    if (this.inFlight !== undefined) return this.inFlight;
    const pending = this.readOnce().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = pending;
    return pending;
  }

  /** The tick's call: reads again only when there is no read yet or the last was unavailable. */
  readIfUnavailable(): Promise<HoldStoreState> {
    const last = this.last;
    if (last !== undefined && last.read.status !== 'unavailable') return Promise.resolve(last);
    return this.read();
  }

  private async readOnce(): Promise<HoldStoreState> {
    const read = await readHoldStore(this.source);
    const readAt = this.now();
    const previous = this.last;
    const failing =
      previous !== undefined && previous.read.status === 'unavailable' ? previous : undefined;
    const runStart = failing?.unavailableSince ?? failing?.readAt;
    const state: HoldStoreState =
      read.status === 'unavailable'
        ? {
            read,
            readAt,
            unavailableSince: runStart ?? readAt,
            failedReads: (failing?.failedReads ?? 0) + 1,
          }
        : {
            read,
            readAt,
            failedReads: 0,
            ...(failing !== undefined && runStart !== undefined
              ? { recovered: { unavailableSince: runStart, failedReads: failing.failedReads } }
              : {}),
          };
    this.last = state;
    return state;
  }
}

/**
 * Does this hold's passage cover this cited passage? A legacy citation with no digest is matched by
 * its source path (C5.3 as amended by `[D-539]`); the rest is reading 2 in the module doc.
 */
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
 * The hold check for one artifact, from the passages it cites, made when the artifact is read
 * (`[D-539]`: read-time checking; nothing is written).
 *  - `clear`: no hold applies. Other withholding (the anchor's own pending reasons, source change)
 *    still decides as before; this check only ever adds one.
 *  - `held`: one or more readable holds cover a cited passage.
 *  - `unavailable`: the store could not be read, and the artifact cites a passage. Not a hold and
 *    not clear: the consumer keeps the artifact from presentation and says the check could not be
 *    made, never that something was withdrawn.
 */
export type HoldCheck =
  | { readonly status: 'clear' }
  | { readonly status: 'held'; readonly reasons: readonly HoldReasonEntry[] }
  | { readonly status: 'unavailable' };

export function checkHolds(read: HoldStoreRead, cited: readonly CitedPassage[]): HoldCheck {
  // An artifact that cites no passage is not a passage-citing artifact: no hold reaches it.
  if (cited.length === 0) return { status: 'clear' };
  if (read.status === 'absent') return { status: 'clear' };
  if (read.status === 'unavailable') return { status: 'unavailable' };
  const covering = read.holds.filter((hold) =>
    cited.some((passage) => holdCoversPassage(hold.passage, passage)),
  );
  if (covering.length === 0) return { status: 'clear' };
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
  return { status: 'held', reasons };
}

/** The two kinds of passage-citing artifact §4.10 names. */
export type PassageCitingArtifactKind = 'instrument' | 'explanation-claim';

/**
 * What the hold check does to one artifact.
 *  - `held` (§4.10: "held"): an instrument is not shown; an explanation claim is shown withdrawn.
 *    Its evidence is removed from the current reading, as evidence that does not stand now.
 *  - `unavailable` (`[D-539]`): the artifact is kept from presentation and is not reviewable, but
 *    it is never shown withdrawn: in its place the consumer shows that the check could not be made.
 *    Its evidence is neither counted as standing (a hold it cannot see may have withdrawn it) nor
 *    removed (that would read as weak knowledge): a reading it bears on is reported unavailable.
 */
export type HoldEffect =
  | {
      readonly status: 'held';
      readonly display: 'not-shown' | 'shown-withdrawn';
      readonly supportUse: false;
      readonly reviewEligible: false;
    }
  | {
      readonly status: 'unavailable';
      readonly display: 'unavailable';
      readonly supportUse: 'unknown';
      readonly reviewEligible: false;
    };

/** `null` when the check is clear: the artifact is then decided exactly as before. */
export function holdEffect(kind: PassageCitingArtifactKind, check: HoldCheck): HoldEffect | null {
  if (check.status === 'clear') return null;
  if (check.status === 'unavailable') {
    return {
      status: 'unavailable',
      display: 'unavailable',
      supportUse: 'unknown',
      reviewEligible: false,
    };
  }
  return {
    status: 'held',
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
 * What the hold check does to a set of instruments, split by the use a consumer makes of it, so
 * presentation and the knowledge reading cannot be fed the same set by mistake.
 */
export interface HoldWithholding {
  /** The store's state behind this result: `unavailable` is shown once, store-wide, by the consumer. */
  readonly store: HoldStoreRead['status'];
  /**
   * Kept from presentation and not reviewable, held and unavailable alike: union this with the
   * anchor's own pending set (`session-builder/provider.ts`'s `resolveCitationPendingRevalidation`)
   * before presentation.
   */
  readonly notPresented: ReadonlySet<string>;
  /** Held by a readable hold: their evidence is removed from the current reading. */
  readonly evidenceWithdrawn: ReadonlySet<string>;
  /**
   * The store could not be read: their evidence is neither counted nor removed, and a reading it
   * bears on is reported unavailable, never lower. Never add these to a reading's exclusion set.
   */
  readonly evidenceUnknown: ReadonlySet<string>;
}

export function resolveHoldWithholding(
  read: HoldStoreRead,
  instruments: Iterable<{ readonly instrumentId: string; readonly cited: readonly CitedPassage[] }>,
): HoldWithholding {
  const notPresented = new Set<string>();
  const evidenceWithdrawn = new Set<string>();
  const evidenceUnknown = new Set<string>();
  for (const instrument of instruments) {
    const check = checkHolds(read, instrument.cited);
    if (check.status === 'clear') continue;
    notPresented.add(instrument.instrumentId);
    if (check.status === 'held') evidenceWithdrawn.add(instrument.instrumentId);
    else evidenceUnknown.add(instrument.instrumentId);
  }
  return { store: read.status, notPresented, evidenceWithdrawn, evidenceUnknown };
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
