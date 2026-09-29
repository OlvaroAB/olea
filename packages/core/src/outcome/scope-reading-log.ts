/**
 * The scope-reading log: the persistence mechanism under the three `[D-429]` stores
 * (`./scope-reading-types.ts`). Per-device append-only JSONL files, one logical clock, content-hash
 * identity, and a total order — the shape D-429 option (a) ruled ("following the relations
 * pattern"), built from the two mechanisms this repo already trusts for multi-device state: the
 * per-device daily files of the review and misconception logs (`../review-log/path.ts`,
 * `../misconception/write.ts`: one file per device, so two devices never write the same file, and a
 * torn trailing line is closed off rather than welded onto) and the review log's merge order
 * (`../review-log/merge.ts`: sort by `(instant, deviceId, eventId)`, no coordination).
 *
 * **Where the files live.** `SCOPE_READING_FOLDER`, under the outcome store's own registered folder
 * (`.olea/outcomes/`), one file per store per device: `<store>.<deviceId>.jsonl`. Nesting it there
 * rather than opening a fourth folder means F7.4's export and full delete already cover it (the
 * registry in `packages/plugin/src/privacy/log-discovery.ts` matches by folder prefix), with no edit
 * to that registry, which is not this store's file. The outcome store lists its own folder for
 * `.json` files only, so these `.jsonl` files are never read as Outcome records. A dedicated folder
 * would be a one-line registration there, if the orchestrator prefers it.
 *
 * **The logical clock.** Each event carries `clock`, one more than the highest clock in the store
 * as this device read it just before appending (a Lamport clock). It orders events by what the
 * writer had SEEN, not by a wall clock a skewed device gets wrong, so a device that read another's
 * write always sorts after it. Two devices that wrote without seeing each other share a clock value
 * and are ordered by device id, deterministically. The total order is `(clock, deviceId, eventId)`.
 *
 * **Content-hash identity.** `eventId` is the SHA-256 of the canonical JSON of `{kind, key,
 * payload}` — never of the clock, device or time — so two devices that independently compute the
 * same fact write events with the same id. An append is skipped when the key's current entry already
 * has the same id (a repeat of unchanged content, such as re-reading an unchanged document, appends
 * nothing), but A then B then A again is recorded, because at that moment A is not current.
 * Duplicate lines (a file copied by a sync conflict) are dropped by `(deviceId, clock, eventId)`.
 *
 * **Append-only, never edited.** A newer entry for a key SUPERSEDES the older one at read time
 * (`latestEntryPerKey`); nothing here rewrites or removes an earlier line, so history stays and a
 * stale reading can be told from a current one rather than vanishing.
 *
 * **Discovery.** Listing goes through `listFolder` (`../vault/list-folder.ts`), which sees a
 * dot-prefixed folder on the hosts that can list one; this device's own file is also probed by
 * exact path, so a host that cannot list a dot folder still reads what it wrote itself. Another
 * device's file on such a host stays hidden, the same limit every per-device record folder here has.
 */

import { hashText } from '../ingestion/hash.js';
import { isValidDeviceId } from '../review-log/path.js';
import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { canonicalJson } from './canonical-json.js';
import { OUTCOME_STORE_FOLDER } from './store.js';

/** The folder the three stores' files live in — nested under the outcome store's registered folder (see the module doc). */
export const SCOPE_READING_FOLDER: VaultPath = `${OUTCOME_STORE_FOLDER}/readings`;

/** The three `[D-429]` stores. Each has its own file per device. */
export const SCOPE_READING_STORES = [
  'document-state',
  'paper-structure',
  'alignment-result',
] as const;
export type ScopeReadingStoreName = (typeof SCOPE_READING_STORES)[number];

/** Bumped only on a breaking change to the line shape below. */
export const SCOPE_READING_LOG_SCHEMA_VERSION = 1;

/** One line of a log file. `deviceId` is not stored on the line: it is the file's name (as in the review log), so nothing is added to a persisted event to carry it. */
export interface ScopeReadingEvent {
  readonly schemaVersion: 1;
  /** The content hash of `{kind, key, payload}` (`scopeReadingEventId`). */
  readonly eventId: string;
  /** The Lamport clock: one more than the highest clock this device had read in the store. */
  readonly clock: number;
  /** ISO-8601, debugging and display only — ordering never reads it. */
  readonly recordedAt: string;
  /** The payload's kind within its store (a store may hold more than one, e.g. structure and part-demand). */
  readonly kind: string;
  /** The identity the newest entry supersedes by. */
  readonly key: string;
  readonly payload: unknown;
}

/** An event with the device that wrote it, as read back. */
export interface ScopeReadingLogEntry extends ScopeReadingEvent {
  readonly deviceId: string;
}

export function scopeReadingLogPath(store: ScopeReadingStoreName, deviceId: string): VaultPath {
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`scopeReadingLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${SCOPE_READING_FOLDER}/${store}.${deviceId}.jsonl`;
}

/** The content-hash identity of one fact. */
export async function scopeReadingEventId(
  kind: string,
  key: string,
  payload: unknown,
): Promise<string> {
  const digest = await hashText(canonicalJson({ kind, key, payload }));
  return `sr1-${digest.slice(0, 32)}`;
}

function isEvent(value: unknown): value is ScopeReadingEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCOPE_READING_LOG_SCHEMA_VERSION &&
    typeof v.eventId === 'string' &&
    v.eventId.length > 0 &&
    typeof v.clock === 'number' &&
    Number.isInteger(v.clock) &&
    v.clock >= 0 &&
    typeof v.recordedAt === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.key === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

function parseLines(text: string): ScopeReadingEvent[] {
  const out: ScopeReadingEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEvent(parsed)) out.push(parsed);
    } catch {
      // A torn or corrupt line is skipped, never thrown on: earlier records stay readable.
    }
  }
  return out;
}

/** The device a `<store>.<deviceId>.jsonl` path belongs to, or `null` for a path that is not one of this store's files. */
function deviceOfPath(store: ScopeReadingStoreName, path: VaultPath): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const prefix = `${store}.`;
  if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) return null;
  const deviceId = name.slice(prefix.length, name.length - '.jsonl'.length);
  return isValidDeviceId(deviceId) ? deviceId : null;
}

/** The total order `(clock, deviceId, eventId)`, ascending: the same input set gives the same array whatever order it arrives in. */
export function orderScopeReadingEntries(
  entries: readonly ScopeReadingLogEntry[],
): readonly ScopeReadingLogEntry[] {
  return [...entries].sort((a, b) => {
    if (a.clock !== b.clock) return a.clock - b.clock;
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
}

/** The newest entry per key, in the total order: a newer entry supersedes an older one, and nothing is removed. */
export function latestEntryPerKey(
  entries: readonly ScopeReadingLogEntry[],
): ReadonlyMap<string, ScopeReadingLogEntry> {
  const latest = new Map<string, ScopeReadingLogEntry>();
  for (const entry of orderScopeReadingEntries(entries)) latest.set(entry.key, entry);
  return latest;
}

export interface ReadScopeReadingLogOptions {
  /** This device: its own file is probed by exact path even on a host that cannot list a dot folder. */
  readonly deviceId: string;
}

/**
 * Every valid entry of one store, across every device whose file can be found, in the total order,
 * with exact duplicate lines dropped. Corrupt, wrong-shape and blank lines are skipped. An empty or
 * missing store reads as `[]`.
 */
export async function readScopeReadingLog(
  vault: VaultSource,
  store: ScopeReadingStoreName,
  options: ReadScopeReadingLogOptions,
): Promise<readonly ScopeReadingLogEntry[]> {
  const paths = new Set<VaultPath>();
  try {
    for (const path of await listFolder(vault, SCOPE_READING_FOLDER, { extensions: ['jsonl'] })) {
      if (deviceOfPath(store, path) !== null) paths.add(path);
    }
  } catch {
    // A listing that fails reads as no other devices; this device's own file is still probed below.
  }
  const own = scopeReadingLogPath(store, options.deviceId);
  if (await vault.exists(own)) paths.add(own);

  const seen = new Set<string>();
  const entries: ScopeReadingLogEntry[] = [];
  for (const path of [...paths].sort()) {
    const deviceId = deviceOfPath(store, path);
    if (deviceId === null) continue;
    let text: string;
    try {
      text = await vault.read(path);
    } catch {
      continue;
    }
    for (const event of parseLines(text)) {
      const identity = `${deviceId}\u0000${event.clock}\u0000${event.eventId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push({ ...event, deviceId });
    }
  }
  return orderScopeReadingEntries(entries);
}

export interface ScopeReadingDraft {
  readonly kind: string;
  readonly key: string;
  readonly payload: unknown;
}

export interface AppendScopeReadingOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
}

export interface AppendScopeReadingResult {
  readonly entry: ScopeReadingLogEntry;
  /** `false` when the key's current entry already had this content, so nothing was written for it. */
  readonly appended: boolean;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Appends a batch to this device's file for `store`, reading the store ONCE for the clock and the
 * per-key current entries, then writing once. A draft whose content is already the current entry
 * for its key (in the store or earlier in the same batch) is skipped and reported `appended: false`
 * with the entry it matched. Extends the file, never rewrites it: a torn trailing line survives as
 * a literal prefix closed off by its own newline.
 */
export async function appendScopeReadingEvents(
  vault: VaultSource,
  store: ScopeReadingStoreName,
  deviceId: string,
  drafts: readonly ScopeReadingDraft[],
  options: AppendScopeReadingOptions = {},
): Promise<readonly AppendScopeReadingResult[]> {
  const path = scopeReadingLogPath(store, deviceId);
  const now = options.now ?? defaultNow;
  const existing = await readScopeReadingLog(vault, store, { deviceId });
  const current = new Map(latestEntryPerKey(existing));
  let clock = existing.reduce((max, entry) => Math.max(max, entry.clock), 0);

  const results: AppendScopeReadingResult[] = [];
  const lines: string[] = [];
  for (const draft of drafts) {
    const eventId = await scopeReadingEventId(draft.kind, draft.key, draft.payload);
    const held = current.get(draft.key);
    if (held !== undefined && held.eventId === eventId) {
      results.push({ entry: held, appended: false });
      continue;
    }
    clock += 1;
    const event: ScopeReadingEvent = {
      schemaVersion: SCOPE_READING_LOG_SCHEMA_VERSION,
      eventId,
      clock,
      recordedAt: now(),
      kind: draft.kind,
      key: draft.key,
      payload: draft.payload,
    };
    const entry: ScopeReadingLogEntry = { ...event, deviceId };
    current.set(draft.key, entry);
    lines.push(`${JSON.stringify(event)}\n`);
    results.push({ entry, appended: true });
  }
  if (lines.length === 0) return results;

  const previous = (await vault.exists(path)) ? await vault.read(path) : '';
  const prefix = previous.length > 0 && !previous.endsWith('\n') ? `${previous}\n` : previous;
  await vault.write(path, prefix + lines.join(''));
  return results;
}
