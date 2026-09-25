/**
 * Edge dispositions as events — `[D-119]`'s second crossing (`ol-2zfj.14`), ONT-R8
 * (`ol-2zfj.87`), C7.10/KM §5. Design authority: `olea-service`
 * `docs/dev/relation-landing-design.md` §6, §7.1.
 *
 * **The rule, exactly as ruled.** "Her own dispositions on it (an accept, a decline, a
 * correction at the triage surface, F8.4a) are events, keyed to a proposition identity (the
 * pair of opaque endpoint keys, the relation type, and its direction) rather than to two names,
 * so a later recomputation cannot inherit a disposition meant for a different proposition."
 * `[D-119]`'s own ratified text: "her dispositions of an edge (accepted/declined/expired)
 * persist as append-only events in the read-time-resolution shape `[D-097]` ruled for
 * instrument rejection, because a decline is a hard labelled negative a cache rebuild must not
 * erase."
 *
 * **Vocabulary: `accepted` / `declined` / `expired` — `[D-097]`'s own three words, not a new
 * three.** The design doc is explicit that this is the SAME vocabulary instrument rejection
 * uses ("the same read-time-resolution shape `[D-097]` ruled for instrument rejection"), and
 * `[D-097]`'s own text (`docs/dev/relation-landing-design.md` line 61) names the three states as
 * "accepted, declined, expired." A different three-word set naming similar states was floated in
 * this lane's own brief; this module follows the ratified contract text instead, because the
 * brief itself points at ONT-R8/`[D-119]` as authority and the two vocabularies are not
 * reconcilable as a single choice — see this module's own commit for the note. "Patch by
 * default" is a property of the CACHE's maintenance mode (`./relation-cache.ts`'s
 * `RelationCacheWriteMode`), not of a disposition kind; nothing here calls a disposition "patch."
 *
 * **Append-only, and this is the whole shape.** `appendEdgeDisposition` never rewrites or
 * removes an existing event — a decline recorded once stays in the record even if a later event
 * changes what is CURRENT, because "expired and declined are distinct facts in the record"
 * (`[D-097]`) applies to accept/decline/expire identically. `currentDisposition` reads the
 * latest event; nothing here ever mutates history to make an old fact agree with a new one.
 *
 * **Read-time exclusion on reject, per INV-6.** A `'declined'` or `'expired'` disposition is a
 * hard labelled negative or a lapsed candidate — "candidates are never served" is `[D-093]`'s
 * abstention rule for stale evidence, and this module extends the same posture to a
 * disposition: `isExcludedAtReadTime` names the two kinds that must never reach a served reader,
 * and `excludedPropositionKeys`/`excludeDisposedRelationCacheRecords` are the composable seam
 * `./relation-cache.ts`'s `relationCacheRecordsAsConceptRelations` accepts, so exclusion happens
 * once, at the boundary between the persisted cache and the in-memory fold, rather than being
 * re-implemented by every reader.
 *
 * **Never the vault's central review-log event stream.** This is a dedicated append-only
 * sidecar, one file per proposition, under `.olea/relation-dispositions/` — Olea-owned,
 * dot-prefixed, INV-6-compliant exactly like every sibling sidecar in this directory. The
 * design doc's "append-only event, same shape as `[D-097]`" is a claim about DISCIPLINE
 * (append-only, keyed to a stable identity, read-time-resolved), not about sharing the C5.2
 * daily-file mechanism a captured review event uses — an edge disposition is Olea's own
 * judgement about her material, not something she did, so it does not belong in the log the
 * architecture boundary reserves for her acts (relation-landing-design.md §2, §6).
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { RelationType } from './relation.js';
import type { RelationCacheRecord } from './relation-cache.js';
import { propositionKey } from './relation-cache.js';

/** The vault folder this module owns. */
export const EDGE_DISPOSITION_FOLDER: VaultPath = '.olea/relation-dispositions';

export const EDGE_DISPOSITION_LOG_SCHEMA_VERSION = 1;

/** `[D-097]`'s own three words — see module doc. */
export type EdgeDispositionKind = 'accepted' | 'declined' | 'expired';

export interface EdgeDispositionEvent {
  readonly kind: EdgeDispositionKind;
  readonly at: string;
}

/** One proposition's full disposition history, append-only, oldest first. */
export interface EdgeDispositionLog {
  readonly propositionKey: string;
  readonly events: readonly EdgeDispositionEvent[];
  readonly schemaVersion: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDispositionEvent(value: unknown): value is EdgeDispositionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'accepted' && v.kind !== 'declined' && v.kind !== 'expired') return false;
  return isNonEmptyString(v.at);
}

export function isEdgeDispositionLog(value: unknown): value is EdgeDispositionLog {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.propositionKey)) return false;
  if (!Array.isArray(v.events) || v.events.length === 0) return false;
  if (!v.events.every(isDispositionEvent)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

export function edgeDispositionLogPath(propositionKeyValue: string): VaultPath {
  return `${EDGE_DISPOSITION_FOLDER}/${encodeURIComponent(propositionKeyValue)}.json`;
}

function serialize(log: EdgeDispositionLog): string {
  return `${JSON.stringify(log, null, 2)}\n`;
}

/** Every valid disposition log currently persisted. A corrupt file is skipped, never thrown on. */
export async function listEdgeDispositionLogs(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly log: EdgeDispositionLog }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, EDGE_DISPOSITION_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly log: EdgeDispositionLog }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isEdgeDispositionLog(parsed)) out.push({ path, log: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — same posture as every sibling sidecar.
    }
  }
  return out;
}

async function readLog(
  vault: VaultSource,
  propositionKeyValue: string,
): Promise<EdgeDispositionLog | undefined> {
  const path = edgeDispositionLogPath(propositionKeyValue);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isEdgeDispositionLog(parsed)) return parsed;
  } catch {
    // Corrupt: treated as absent.
  }
  return undefined;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Append one disposition event to a proposition's log — creating the log on its first event.
 * Never rewrites or drops an earlier event (append-only). Idempotent against an immediately
 * repeated identical kind: appending the SAME kind as the current (latest) event writes nothing
 * new, so a caller that re-runs the same triage action twice does not pile up duplicate facts —
 * this is the one narrow exception to "every call appends," and it exists only to keep an
 * idempotent caller idempotent; two GENUINELY different moments recording the same kind (e.g.
 * declined, later re-accepted, later declined again) are three distinct, non-adjacent events and
 * all three are kept.
 */
export async function appendEdgeDisposition(
  vault: VaultSource,
  propositionKeyValue: string,
  kind: EdgeDispositionKind,
  options: { readonly now?: () => string } = {},
): Promise<EdgeDispositionLog> {
  const now = options.now ?? defaultNow;
  const existing = await readLog(vault, propositionKeyValue);
  const priorEvents = existing?.events ?? [];
  const latest = priorEvents[priorEvents.length - 1];
  if (latest !== undefined && latest.kind === kind) {
    return existing as EdgeDispositionLog;
  }

  const log: EdgeDispositionLog = {
    propositionKey: propositionKeyValue,
    events: [...priorEvents, { kind, at: now() }],
    schemaVersion: EDGE_DISPOSITION_LOG_SCHEMA_VERSION,
  };
  await vault.write(edgeDispositionLogPath(propositionKeyValue), serialize(log));
  return log;
}

/** The most recent disposition, or `undefined` for a proposition with no recorded disposition at all — the ordinary case for the vast majority of edges, which nobody has yet triaged. */
export function currentDisposition(
  log: EdgeDispositionLog | undefined,
): EdgeDispositionKind | undefined {
  if (log === undefined || log.events.length === 0) return undefined;
  return log.events[log.events.length - 1]?.kind;
}

/**
 * `'declined'` and `'expired'` are the two kinds a served reader must never see (INV-6, C7.10's
 * "candidates are never served" extended to a disposition). `'accepted'`, and no disposition at
 * all, both serve normally — an edge nobody has triaged yet is not thereby excluded; only an
 * explicit negative or lapse is.
 */
export function isExcludedAtReadTime(kind: EdgeDispositionKind | undefined): boolean {
  return kind === 'declined' || kind === 'expired';
}

/** Every proposition key currently excluded, computed once so a caller reading many records pays one pass over the logs rather than one lookup per record. */
export function excludedPropositionKeys(logs: readonly EdgeDispositionLog[]): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const log of logs) {
    if (isExcludedAtReadTime(currentDisposition(log))) excluded.add(log.propositionKey);
  }
  return excluded;
}

/**
 * The read-time exclusion applied directly to relation-cache records, ahead of
 * `./relation-cache.ts`'s own name-based fold — see that module's
 * `relationCacheRecordsAsConceptRelations`, which accepts this function's output as
 * `excludePropositionKeys`. Pure and total: never mutates a record, only filters the list.
 */
export function excludeDisposedRelationCacheRecords(
  records: readonly RelationCacheRecord[],
  logs: readonly EdgeDispositionLog[],
): readonly RelationCacheRecord[] {
  const excluded = excludedPropositionKeys(logs);
  return records.filter((record) => !excluded.has(record.propositionKey));
}

export type { RelationType };
/** Convenience re-export so a caller keying a disposition off a fresh edge's endpoints does not need a second import — see `./relation-cache.ts`'s own doc for why this identity is shared between the two modules. */
export { propositionKey };
