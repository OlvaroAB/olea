/**
 * Persona-world seed events (`ol-3ux7.64.16` [WBX-13], consuming `ol-3ux7.64.15`
 * [WBX-14]'s contract — `eval/data/persona-synthetic/worlds/README.md`'s "The
 * file-path convention for laying `seed-events.json` into the simulator's
 * vault" section, and `docs/dev/simulator-design.md` §6).
 *
 * A persona world's private build ships `/simulator-seed-events.json`
 * alongside `/simulator-world.json`: a flat, chronological JSON array of the
 * persona's review-log records up to the world's declared `asOf`, in the
 * EXACT shape `olea-core`'s `appendReviewLogRecord`/`appendSuspendRecord`/etc.
 * persist. This module lays them into the persisted vault so Home/Today open
 * with that lived history already in place — never fabricated by this lane,
 * only relocated from the file the private build already produced.
 *
 * **Nothing here validates a record beyond "does it carry a `timestamp` we
 * can group by."** The README's own contract is that every entry already
 * matches the frozen review-log schema (`olea-core`'s `generateStream`
 * produces them, and `persona-world.mjs` writes both payloads from the same
 * generation run) — re-validating against every one of D7.1's several record
 * schemas here would duplicate that contract rather than trust it, and would
 * leave this module silently dropping a record for the wrong reason (a
 * record's `kind` this file has never heard of, say) rather than the actual
 * one this lane cares about (a JSON shape too broken to file at all).
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { reviewLogPath } from 'olea-core';

/**
 * One raw seed-event record — validated only loosely: it must be a JSON
 * object carrying a `timestamp` whose first ten characters are a calendar
 * day. Everything else is carried through byte-for-byte into the JSONL line
 * this module writes, exactly as the README's contract requires.
 */
export type SimulatorSeedEventRecord = Readonly<Record<string, unknown>> & {
  readonly timestamp: string;
};

export interface SimulatorSeedEventsLoadResult {
  readonly records: readonly SimulatorSeedEventRecord[];
  /**
   * `false` when `/simulator-seed-events.json` was missing, unreadable or
   * not a JSON array — matching `world.ts`'s `loadSimulatorWorld` fallback
   * style. This is the overwhelmingly common case (the fixture world, the
   * real world, and every persona world built before WBX-14 all ship no such
   * file), never treated as an error.
   */
  readonly available: boolean;
}

const CALENDAR_DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function isSeedEventRecord(value: unknown): value is SimulatorSeedEventRecord {
  if (typeof value !== 'object' || value === null) return false;
  const timestamp = (value as { timestamp?: unknown }).timestamp;
  return typeof timestamp === 'string' && CALENDAR_DAY_PREFIX.test(timestamp);
}

/**
 * Best-effort, never-throwing load of `/simulator-seed-events.json` — a
 * plain static GET, matching `world.ts`'s `loadSimulatorWorld` and
 * `controller.ts`'s `loadReplayCassette` (anything under `dist/` is already
 * served this way, no server change needed). A malformed entry is dropped,
 * never the whole file — one bad record earlier in this pipeline (a build
 * defect on WBX-14's side) should not silently erase every other day's
 * history.
 */
export async function loadSimulatorSeedEvents(
  fetchFn: typeof fetch,
): Promise<SimulatorSeedEventsLoadResult> {
  try {
    const response = await fetchFn('/simulator-seed-events.json');
    if (!response.ok) return { records: [], available: false };
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) return { records: [], available: false };
    return { records: raw.filter(isSeedEventRecord), available: true };
  } catch {
    return { records: [], available: false };
  }
}

/**
 * Groups `records` by `timestamp.slice(0, 10)` (the README's own grouping
 * rule) and returns, for each day, the vault path C5.2 fixes for `deviceId`
 * on that day (`reviewLogPath`, `olea-core`) paired with the file's full
 * JSONL content — one `JSON.stringify` line per record, joined with `\n`,
 * trailing `\n` included, in the array's own (chronological) order. Pure and
 * side-effect-free, so it is unit-testable without a vault.
 */
export function layOutSeedEventsByDay(
  records: readonly SimulatorSeedEventRecord[],
  deviceId: string,
): ReadonlyMap<VaultPath, string> {
  const linesByDay = new Map<string, string[]>();
  for (const record of records) {
    const day = record.timestamp.slice(0, 10);
    const lines = linesByDay.get(day) ?? [];
    lines.push(JSON.stringify(record));
    linesByDay.set(day, lines);
  }
  const result = new Map<VaultPath, string>();
  for (const [day, lines] of linesByDay) {
    result.set(reviewLogPath(day, deviceId), `${lines.join('\n')}\n`);
  }
  return result;
}

/**
 * Writes every {@link layOutSeedEventsByDay} entry into `vault` — one
 * `vault.write` per day file, each write landing in the persisted overlay
 * exactly like a real device's own append would (`PersistentVaultSource`
 * never inspects a path to decide what to persist — see that file's own
 * doc). Returns the number of day-files written, for the caller's own
 * idempotency bookkeeping and for tests. Called once, before the plugin's
 * first mount, from `SimulatorController` (`create()` and `reset()`) — never
 * from an ordinary remount, so a persona's lived history is planted exactly
 * once per fresh vault.
 */
export async function writeSeedEventsIntoVault(
  vault: Pick<VaultSource, 'write'>,
  records: readonly SimulatorSeedEventRecord[],
  deviceId: string,
): Promise<number> {
  const byPath = layOutSeedEventsByDay(records, deviceId);
  for (const [path, content] of byPath) {
    await vault.write(path, content);
  }
  return byPath.size;
}

/**
 * Defensive extraction of `descriptor.streamSpec.deviceId` — `world.ts`'s
 * `SimulatorWorldDescriptor.streamSpec` is deliberately untyped (this lane
 * never constructs one; see that file's own doc), so this is the one place
 * that reaches into it, and it never throws on a missing or malformed shape.
 */
export function personaDeviceId(streamSpec: unknown): string | undefined {
  if (typeof streamSpec !== 'object' || streamSpec === null) return undefined;
  const deviceId = (streamSpec as { deviceId?: unknown }).deviceId;
  return typeof deviceId === 'string' && deviceId.length > 0 ? deviceId : undefined;
}
