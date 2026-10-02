/**
 * `[D-427]` (ruled 2026-10-02, `ol-egov.141.89.5.31`): the pending record for a file-level
 * materiality check that has not settled yet, kept in the plugin's local `data.json` so a restart
 * can finish it.
 *
 * Before this, every piece of an unfinished file-level check lived in memory only: a small or
 * debounced edit waiting in `MaterialityTrigger`'s `pendingSmallEdit`/`pendingDebounced` maps, and
 * the previous text a judge call in flight was comparing against. A restart lost both, so the
 * change was never decided (gate case "restart with an escalation pending"). The ruling chose a
 * temporary record per file holding the earlier text, the version identity, the retry state and
 * what `[D-311]` needs to reject a stale answer; the earlier text may sit in local storage while
 * the check is unfinished, and is removed when the check settles or becomes stale.
 *
 * **Bounded.** At most one record per vault path, holding exactly one text (the last settled
 * version, the judge's `previousText`), never a history of intermediate saves: every write
 * replaces the path's record. It exists only while that path has an unfinished check, and is
 * removed when the check settles (an answer is committed, or it resolves as judge-unavailable),
 * when the check is found stale (the materiality record's `[D-311]` revision moved on), when the
 * file is gone, or when the file turns out to match its settled version again. Nothing in this
 * record leaves the device: `data.json` is local, inside her vault (C6 draws its line at storage on
 * the server, not here), and this is the same kind of local projection state the citation grain's
 * `CitationAnchorRecord` already keeps passage text in (`[D-400]`).
 *
 * **Its own top-level key**, not a field on `MaterialityRecord`: that record stays a bookkeeping
 * record of hashes and lengths (`types.ts`), is read by other consumers (the relation freshness
 * gate reads its hash), and has no row at all for a note whose first check is still in flight. A
 * separate key means the commit and the clear are two writes; the order makes that safe: the
 * record is committed first, so a crash in between leaves a pending record whose `revision` no
 * longer matches, which the next reconciliation clears as stale without a judge call.
 */

import { hasReadModifyWrite } from '../../retrieval/serializing-data-host.js';
import type { ObsidianDataHost } from './hash-store.js';

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const MATERIALITY_PENDING_STORAGE_KEY = 'materialityPendingChecks';

/**
 * What an unfinished check is waiting on: a small edit held by the minimum-edit-size floor, a
 * save inside the debounce window, or a judge call that was dispatched and has not been answered.
 */
export type MaterialityPendingWait = 'below-floor' | 'debounced' | 'judge';

/** One path's unfinished file-level check. See this module's doc. */
export interface MaterialityPendingCheck {
  readonly path: string;
  /**
   * The text of the last version this path settled at: the judge's `previousText`. Her words,
   * kept only while the check is unfinished (`[D-427]`).
   */
  readonly baselineText: string;
  /**
   * `[D-311]`: the materiality record's revision this check would settle. When the record's
   * revision is anything else, a newer answer has already been committed for this path and this
   * check is stale: it is cleared, never judged.
   */
  readonly revision: number;
  /** Epoch ms the change was first held back or dispatched. A deferred edit's drain timing reads it. */
  readonly since: number;
  readonly waiting: MaterialityPendingWait;
  /**
   * Raw content hash of the text the judge was asked about: the version identity the retry
   * budget is keyed to. A different current text is a different check (her further edit), with
   * its own original call; the same text is the same check. Present when `waiting` is `'judge'`.
   */
  readonly dispatchedHash?: string;
  /** Epoch ms the latest call for this check was dispatched (the original, or the retry once {@link retriedAt} is set). */
  readonly dispatchedAt?: number;
  /**
   * `[D-400]` condition 1, applied to the file grain: epoch ms the one automatic retry was
   * dispatched. Present means the retry is spent for this check: no later restart grants
   * another, and an unanswered retry resolves the check as judge-unavailable.
   */
  readonly retriedAt?: number;
}

/** Persistence port for {@link MaterialityPendingCheck}s, one per vault path. */
export interface MaterialityPendingStore {
  load(path: string): Promise<MaterialityPendingCheck | null>;
  /** Every well-formed record, in no particular order. */
  list(): Promise<readonly MaterialityPendingCheck[]>;
  /**
   * Atomic read-modify-write of one path's record: `next` receives the current record (or `null`)
   * and returns its replacement, or `null` to remove it. A malformed stored entry reaches `next`
   * as `null`.
   */
  update(
    path: string,
    next: (current: MaterialityPendingCheck | null) => MaterialityPendingCheck | null,
  ): Promise<void>;
}

const WAITS: ReadonlySet<string> = new Set<MaterialityPendingWait>([
  'below-floor',
  'debounced',
  'judge',
]);

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

export function isMaterialityPendingCheck(value: unknown): value is MaterialityPendingCheck {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.path !== 'string') return false;
  if (typeof c.baselineText !== 'string') return false;
  if (typeof c.revision !== 'number') return false;
  if (typeof c.since !== 'number') return false;
  if (typeof c.waiting !== 'string' || !WAITS.has(c.waiting)) return false;
  if (c.dispatchedHash !== undefined && typeof c.dispatchedHash !== 'string') return false;
  return isOptionalNumber(c.dispatchedAt) && isOptionalNumber(c.retriedAt);
}

function tableOf(blob: unknown): Record<string, unknown> | null {
  if (typeof blob !== 'object' || blob === null) return null;
  const table = (blob as Record<string, unknown>)[MATERIALITY_PENDING_STORAGE_KEY];
  return typeof table === 'object' && table !== null ? (table as Record<string, unknown>) : null;
}

/**
 * `ObsidianMaterialityPendingStore` — the same read-modify-write-a-single-key pattern
 * `hash-store.ts`'s `ObsidianMaterialityHashStore` uses, over its own key. A corrupted entry is
 * read as absent (never thrown), the same posture every store in this directory takes.
 */
export class ObsidianMaterialityPendingStore implements MaterialityPendingStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(path: string): Promise<MaterialityPendingCheck | null> {
    const candidate = tableOf(await this.host.loadData())?.[path];
    return isMaterialityPendingCheck(candidate) && candidate.path === path ? candidate : null;
  }

  async list(): Promise<readonly MaterialityPendingCheck[]> {
    const table = tableOf(await this.host.loadData());
    if (table === null) return [];
    return Object.entries(table)
      .map(([, value]) => value)
      .filter(isMaterialityPendingCheck);
  }

  /**
   * Read-modify-write over this store's own key, atomic when the host supports it (the same
   * `readModifyWrite` path `hash-store.ts` documents). `next` must be pure: it is asked once on a
   * plain read first, and when it hands back the very record it was given (or `null` for `null`)
   * nothing is written — a clear of an absent record, or of a newer call's record, costs no write.
   */
  async update(
    path: string,
    next: (current: MaterialityPendingCheck | null) => MaterialityPendingCheck | null,
  ): Promise<void> {
    const before = await this.load(path);
    if (next(before) === before) return;
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const table: Record<string, unknown> = { ...(tableOf(blob) ?? {}) };
      const stored = table[path];
      const current = isMaterialityPendingCheck(stored) && stored.path === path ? stored : null;
      const replacement = next(current);
      if (replacement === null) {
        delete table[path];
      } else {
        table[path] = { ...replacement, path };
      }
      if (Object.keys(table).length === 0) {
        delete blob[MATERIALITY_PENDING_STORAGE_KEY];
      } else {
        blob[MATERIALITY_PENDING_STORAGE_KEY] = table;
      }
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }
}
