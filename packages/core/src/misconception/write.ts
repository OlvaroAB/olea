/**
 * The misconception-log writer — append-only, crash-safe, one file per day
 * per device. Mirrors `../review-log/write.js`'s discipline exactly (same
 * INV-2 "extend, never rewrite" technique, same reason: a previous append
 * interrupted mid-write can leave a partial trailing line, and concatenating
 * onto it directly would weld a well-formed record onto garbage). Kept as a
 * near-duplicate rather than a shared helper because the two logs are
 * deliberately separate streams (`./types.js`'s module doc) with different
 * event shapes; factoring out the six lines of byte-safety logic they share
 * would cost an abstraction for a coincidence, not a real one.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { misconceptionLogPath } from './path.js';
import type { MisconceptionEvent } from './types.js';

export interface AppendMisconceptionEventResult {
  readonly event: MisconceptionEvent;
  readonly path: VaultPath;
}

/**
 * The calendar day an event belongs to, taken verbatim from its own
 * timestamp's date portion — same reasoning as `../review-log/write.js`'s
 * `localDateOf`: "which local day did this happen" is a substring, not a
 * timezone calculation, once every timestamp carries an offset.
 */
function localDateOf(timestamp: string): string {
  const t = timestamp.indexOf('T');
  if (t === -1) {
    throw new Error(
      `misconception-log append: not a valid ISO-8601 timestamp: ${JSON.stringify(timestamp)}`,
    );
  }
  return timestamp.slice(0, t);
}

/**
 * Appends one already-constructed event (`./events.js` builds it) to its
 * device's daily file. Extends, never rewrites: a corrupt trailing line from
 * an interrupted previous append survives as a literal prefix, closed off by
 * its own `\n` before this event's line is added.
 */
export async function appendMisconceptionEvent(
  vault: VaultSource,
  event: MisconceptionEvent,
  deviceId: string,
): Promise<AppendMisconceptionEventResult> {
  const path = misconceptionLogPath(localDateOf(event.timestamp), deviceId);
  const line = `${JSON.stringify(event)}\n`;

  const existing = (await vault.exists(path)) ? await vault.read(path) : '';
  const needsSeparator = existing.length > 0 && !existing.endsWith('\n');
  const prefix = needsSeparator ? `${existing}\n` : existing;
  await vault.write(path, prefix + line);

  return { event, path };
}
