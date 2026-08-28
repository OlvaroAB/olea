/**
 * `ObsidianRetrospectiveOfferStore` — the INTERIM persistence for F8.8's
 * offer/open/dismiss memory (`[D-134]` Q5 and Q7).
 *
 * **This is a deliberate, named deviation from D-134's own mechanism, and
 * why.** The ruling's own words: offer/open/dismiss are "ordinary events in
 * the local event log... no new storage, second device converges" — meaning
 * a new `EventKind` added to `packages/contracts/src/review-log.ts`'s v5
 * union, appended the same way an ordinary review event is. That file, and
 * `packages/core/src/review-log/` (the writer/reader for that log), both
 * sit outside `ol-r68l`'s owned paths. Rather than touch a shared contracts
 * schema this bead does not own, this store follows the EXACT pattern
 * `today/term-window-store.ts` and `today/material-arrival-store.ts` already
 * use for local, per-install state that is not her authored content: one key
 * inside the plugin's own `data.json` (Obsidian's `loadData`/`saveData`),
 * read-modify-write, versioned.
 *
 * **What this costs, honestly.** `data.json` lives under
 * `.obsidian/plugins/<id>/` inside her vault folder, so it travels with
 * whatever syncs her vault (Obsidian Sync, iCloud, git) — but it is NOT the
 * append-only, mergeable event log D-134 asked for, and two devices editing
 * it concurrently could clobber each other's dismiss/open the way a plain
 * JSON blob always can (`plan/settings-store.ts`'s own read-modify-write has
 * the identical property). The proper fix is the contracts `EventKind`
 * addition named above — a follow-up bead with `packages/contracts`
 * ownership. Nothing here blocks that migration: `RetrospectiveOfferEvent`
 * (`olea-core`) is the same shape either persistence would carry.
 *
 * **Never her authored content (INV-6).** `data.json` is plugin
 * configuration, not a vault note — this store never touches anything INV-6
 * governs.
 */

import type { RetrospectiveOfferEvent } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export const RETROSPECTIVE_OFFERS_STORAGE_KEY = 'retrospectiveOffers';

export interface PersistedRetrospectiveOffers {
  readonly version: 1;
  readonly events: readonly RetrospectiveOfferEvent[];
}

export const EMPTY_RETROSPECTIVE_OFFERS: PersistedRetrospectiveOffers = { version: 1, events: [] };

function isRetrospectiveOfferEvent(value: unknown): value is RetrospectiveOfferEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === 'retrospective-offered' ||
      candidate.kind === 'retrospective-opened' ||
      candidate.kind === 'retrospective-dismissed') &&
    typeof candidate.assessmentPath === 'string' &&
    typeof candidate.timestamp === 'string'
  );
}

function isPersistedRetrospectiveOffers(value: unknown): value is PersistedRetrospectiveOffers {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.events) &&
    candidate.events.every(isRetrospectiveOfferEvent)
  );
}

export class ObsidianRetrospectiveOfferStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Every recorded offer/open/dismiss event, oldest first is not guaranteed — callers filter by `assessmentPath`, never by position. */
  async load(): Promise<readonly RetrospectiveOfferEvent[]> {
    const blob = await this.host.loadData();
    const candidate =
      typeof blob === 'object' && blob !== null
        ? (blob as Record<string, unknown>)[RETROSPECTIVE_OFFERS_STORAGE_KEY]
        : undefined;
    const persisted = isPersistedRetrospectiveOffers(candidate)
      ? candidate
      : EMPTY_RETROSPECTIVE_OFFERS;
    return persisted.events;
  }

  /** Appends one event and persists the whole set — read-modify-write, same as every other store here. Never drops an existing event. */
  async append(event: RetrospectiveOfferEvent): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const currentCandidate = blob[RETROSPECTIVE_OFFERS_STORAGE_KEY];
    const current = isPersistedRetrospectiveOffers(currentCandidate)
      ? currentCandidate
      : EMPTY_RETROSPECTIVE_OFFERS;
    blob[RETROSPECTIVE_OFFERS_STORAGE_KEY] = {
      version: 1,
      events: [...current.events, event],
    } satisfies PersistedRetrospectiveOffers;
    await this.host.saveData(blob);
  }
}
