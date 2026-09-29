/**
 * `ObsidianCitationHashStore` — the persisted "what did this instrument's
 * cited passage last look like" table `[CORP-3b]` (`ol-2zfj.35`) needs to run
 * `evaluateCitedPassageRevision` (`concept/revision/material-change.ts`, olea-
 * core) for real, across restarts.
 *
 * **Same idiom as `hash-store.ts`'s `ObsidianMaterialityHashStore`, one level
 * finer.** Row 1.4's file-level store is keyed by vault path because its
 * question is "what did this FILE last look like." This store is keyed by
 * `instrumentId` because `[D-093]`'s question is narrower: "what did THIS
 * instrument's cited passage last look like" — a file can change in ten
 * places while nine of its instruments' own citations sit untouched, and a
 * path-keyed store cannot tell those nine from the tenth.
 *
 * **What "the cited passage" means for this caller — a Class B call, named
 * so it is revisable rather than load-bearing by accident.** Nothing in the
 * vault today persists, for any instrument, a pointer to a specific passage
 * location distinct from the instrument's own text (`material-change.ts`'s
 * own doc: the citation anchor is "the caller's projection," never searched
 * for or stored by `olea-core`). Building a new persisted per-instrument
 * source-passage pointer is either a new field written at DRAFT time
 * (`packages/plugin/src/generation/`, outside this bead's `owns`) or a new
 * vault-persisted schema (Class C, needs a decision bead) — neither of which
 * this lane may do unprompted. So this store records, per MCQ instrument,
 * its HOME NOTE's own material — the note's text with every instrument
 * block's own span stripped out (`citation-material.ts`) — which is real,
 * requires no new persistence anywhere else, and keeps the instrument's own
 * block physically untouched in the vault while its surrounding material
 * changes underneath it (so a `'revised'` outcome's suspend-the-predecessor
 * step suspends a real, still-present instrument, not one whose bytes the
 * judge call itself just rewrote). The known limitation this narrows away:
 * every MCQ sharing one note reacts to the SAME material delta rather than
 * to its own individually-nearest passage — `material-change.ts`'s own
 * module doc names this exact gap ("a file's own materiality verdict cannot
 * tell a caller WHICH span moved") as one this lane's caller narrows but does
 * not fully close. A future bead that gives drafting a real per-instrument
 * source-location field can replace this store's `text` with that pointer
 * without changing its shape.
 *
 * `text` is stored, not only a hash, so the judge call has a real
 * `previousText` to read even on the very first evaluation after a plugin
 * restart — unlike `PreviousTextTracker` (session-scoped only, by design,
 * because row 1.4's `previousText` is a whole file), a stripped-material
 * block is small enough that persisting it costs nothing worth naming.
 *
 * **Update, `ol-0r92.46`: the per-instrument source-passage pointer this doc
 * once called out of reach now exists — `[D-181]`'s citation sidecar
 * (`../../../../core/src/instrument/citation-store.ts`), read back onto
 * `VaultInstrumentRecord.sourceProvenance` by `enumerate.ts` — and this
 * store's caller (`citation-revision-wiring.ts`'s `citedPassagePath`) prefers
 * it over the home-note-minus-spans text whenever it names a markdown note
 * distinct from the instrument's own `notePath`.** That is exactly the
 * `[D-179]`/`[D-214]` split-home-note shape: `sourcePath` on a record this
 * store holds is then that OTHER note — her authored note, or whatever note
 * held the material at draft time — never the home note, which in that shape
 * carries no material to diff at all. The home-note-minus-spans rule above is
 * still what runs whenever no such pointer exists (a hand-authored
 * instrument, or a generated one no sidecar-writer has cited) or it names a
 * non-markdown source (a bare PDF/PPTX/DOCX/image this store cannot diff as
 * text) — this file's own shape (`sourcePath` + `text`) is unchanged either
 * way; only which file the caller reads before saving here has changed.
 */

import type { VaultPath } from 'olea-core';
import { rearmSpentRetry } from '../../registry/deferred-recheck-retry.js';
import { hasReadModifyWrite } from '../../retrieval/serializing-data-host.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * `[D-351]` (ruled 2026-09-25): one instrument's pending-revalidation fact,
 * kept as a sub-field on {@link CitationAnchorRecord} rather than a new
 * store — David's own ruling. Set the moment `tick()` observes a raw-hash
 * mismatch against this record's own `text` (before any judge call resolves
 * it), cleared once resolved (an `immaterial` verdict restores to current;
 * `material`/`uncertain`/an unavailable verdict confirm the change, and
 * `citation-revision-wiring.ts` retires the whole record via `remove` in
 * that case, so no separate clearing write applies there).
 *
 * **Keyed to the particular source revision being checked** — David's own
 * clarification: "a late result for an earlier edit must not clear a newer
 * pending state." `sinceContentHash` is that key: the content hash (the same
 * `hashText` value space `evaluateCitedPassageRevision`, olea-core, already
 * uses for `previousContentHash`/`newContentHash`) of the passage text that
 * RAISED this pending state. A resolution is only ever applied when it was
 * computed against this exact hash — see `CitationHashStore.isPendingRevalidationCurrent`
 * and its callers in `citation-revision-wiring.ts`'s `applyOutcome`.
 *
 * **`[D-400]` (ruled 2026-09-27), extending the same record: recovering a
 * check lost to an app restart, bounded to one automatic retry.** A call
 * dispatched to the judge and never resolved — the process closed mid-await,
 * or a provider failure this trigger's own catch swallowed — left this
 * pending fact stuck forever under `[D-351]` alone, retried on every single
 * tick with no bound (`material-change.ts`'s own recording call fires
 * unconditionally for as long as the difference is unresolved). `[D-400]`
 * supersedes `[D-343]`'s "unavailable counts as confirmed changed" for
 * exactly this case: instead of resolving the pending fact to confirmed
 * changed, an exhausted retry leaves it pending and reports a recoverable
 * deferred state (see `citation-revision-wiring.ts`'s `retryExhausted`
 * count) — `[D-343]` is otherwise unchanged (a genuine `material`/
 * `uncertain`/judge-returned-unavailable verdict still confirms changed
 * exactly as before). `dispatchedAt`/`retriedAt` below are the persisted
 * facts that bound it: never a fresh allowance just because the app
 * restarted again. The wording, registered term and any student-facing
 * shape for SHOWING that deferred state are not settled by `[D-400]` and are
 * not built here — see this bead's hand-back notes.
 */
export interface PendingRevalidation {
  /** The content hash this pending state was raised against — [D-351]'s "the particular source revision being checked." */
  readonly sinceContentHash: string;
  /** Epoch ms this pending state was first recorded — reporting only, never gating logic (the key above is what gates). */
  readonly since: number;
  /**
   * `[D-400]` (ruled 2026-09-27): epoch ms the check for THIS
   * `sinceContentHash` was last actually dispatched to the judge — the
   * original check when {@link retriedAt} is absent, the one permitted
   * retry's own dispatch time once it is present. Absent means nothing has
   * been dispatched yet for this difference (e.g. no judge configured at
   * all — `citation-revision-wiring.ts`'s existing unlimited-wait posture
   * for that case is untouched by this field). Set by
   * `CitationHashStore.recordDispatch`, never by `setPendingRevalidation`
   * itself, which leaves it (and {@link retriedAt}) exactly as they were
   * whenever the observed difference is the SAME one already pending —
   * see that method's own doc.
   */
  readonly dispatchedAt?: number;
  /**
   * `[D-400]`: epoch ms the one additional automatic retry this pending
   * state is ever granted was dispatched. Present means that retry's budget
   * is already spent for `sinceContentHash` — a later restart, or a further
   * provider failure, must never grant another one; the caller reports a
   * recoverable deferred state instead (`citation-revision-wiring.ts`'s
   * `retryExhausted` count). Absent means the retry has not fired yet.
   */
  readonly retriedAt?: number;
  /**
   * `[D-446]` option (a) / row 45 (`ol-egov.141.89.5.32`): WHY this instrument is withheld, when
   * the reason is not "a difference at its passage is awaiting the judge". Absent (every record
   * written before this field, and every judge-pending fact) means exactly that: a real difference
   * was seen and the check has not completed. Present means the passage-grain reader could not
   * settle where the passage stands, and withholds protectively without claiming any change was
   * established:
   *  - `passage-missing`: the passage is not where the anchor saw it and nothing exact or
   *    resembling was found (or only a re-bind proposal was);
   *  - `passage-ambiguous`: the same text stands in two or more places, or more than one segment
   *    resembles an edited passage, so which one was cited cannot be told;
   *  - `passage-rule-unsupported`: the anchor's segmentation rule is no longer registered and the
   *    passage could not be re-found cleanly under the current one.
   * A withheld-for-a-reason fact is cleared by the reader the pass the passage is found again; it
   * never enters the judge's dispatch budget, and it is never read as a confirmed change.
   */
  readonly reason?: PendingReason;
}

/** See {@link PendingRevalidation.reason}. */
export type PendingReason = 'passage-missing' | 'passage-ambiguous' | 'passage-rule-unsupported';

const PENDING_REASONS: ReadonlySet<string> = new Set<PendingReason>([
  'passage-missing',
  'passage-ambiguous',
  'passage-rule-unsupported',
]);

/** One instrument's last-observed citation anchor. */
export interface CitationAnchorRecord {
  /**
   * The note this instrument's material was last observed in — its own
   * `notePath` (home-note-minus-spans reading), or, per this module's
   * `ol-0r92.46` update, a distinct source note named by
   * `sourceProvenance.sourcePath` when the two have split.
   */
  readonly sourcePath: VaultPath;
  /** That note's material text as last observed — instrument blocks stripped when `sourcePath` is the instrument's own `notePath`; raw when it is a split-off source note (nothing there to strip). */
  readonly text: string;
  /** The instrument's own concept bindings at last observation — carried so a later `'revised'` suspend write has them without a second vault walk. */
  readonly conceptIds: readonly string[];
  /**
   * `[D-351]`: set the moment a raw digest mismatch is observed against
   * `text` above, cleared once resolved. Optional so an existing persisted
   * record with no such field still reads correctly (INV-2) — absent means
   * "current," never treated as an error or migrated on read.
   */
  readonly pendingRevalidation?: PendingRevalidation;
  /**
   * `[D-446]` option (a) (`ol-egov.141.89.5.32`): present exactly when this anchor tracks ONE PASSAGE
   * of the source rather than the whole note — the versioned digest (`olea-core`'s
   * `source/passage-identity.ts`, `p<version>:<sha-256 hex>`) of `text` under the segmentation rule
   * that found it. Then {@link text} is that passage's own text, and the reader re-finds it by the
   * shared rule on every pass. Absent (every record written before this field, and every
   * instrument whose citation carries no digest) means the legacy whole-note grain, read exactly as
   * before. Local projection state, like the rest of this record: nothing is added to the vault's
   * citation sidecar, and no note text beyond what `text` already held is stored.
   */
  readonly passageDigest?: string;
}

export interface CitationHashStore {
  loadAll(): Promise<ReadonlyMap<string, CitationAnchorRecord>>;
  save(instrumentId: string, record: CitationAnchorRecord): Promise<void>;
  /** Drops tracking for an instrument whose predecessor has just been suspended (`'revised'`) — its own material no longer needs watching. */
  remove(instrumentId: string): Promise<void>;
  /**
   * `[D-351]`: set THIS instrument's pending-revalidation fact, read-modify-
   * write against the freshest persisted record. A no-op (returns without
   * writing) when nothing is tracked yet for `instrumentId` — this method
   * attaches a fact to an existing record, it never fabricates one with no
   * `sourcePath`/`text`; `save`'s own baseline write is what creates the
   * entry in the first place, and `tick()` never calls this before that
   * baseline exists. Overwriting an already-pending record with a fresher
   * hash is correct and expected: the SETTING half always wins with the
   * newest known real difference (only the RESOLVING half below needs the
   * compare-and-check guard, because resolving acts on a verdict computed
   * earlier, against a specific hash, which may since have gone stale).
   */
  setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
    reason?: PendingReason,
  ): Promise<void>;
  /**
   * `[D-351]`: true when this instrument's PERSISTED `pendingRevalidation`
   * fact still carries `expectedSourceContentHash` — read fresh, never
   * against a snapshot the caller took earlier in its own pass (e.g. at the
   * top of `tick()`). `false` means either nothing is pending for this
   * instrument, or a newer edit has already moved the pending hash on: a
   * late result for an earlier edit, which the caller must then discard
   * rather than act on — see `citation-revision-wiring.ts`'s `applyOutcome`.
   */
  isPendingRevalidationCurrent(
    instrumentId: string,
    expectedSourceContentHash: string,
  ): Promise<boolean>;
  /**
   * `[D-400]`: records that a check was just dispatched to the judge for
   * THIS instrument's pending difference (`sourceContentHash`) — the
   * original check when `retry` is `false`, the one permitted automatic
   * retry when `retry` is `true` (sets {@link PendingRevalidation.retriedAt}
   * to `dispatchedAt` in that case, in addition to
   * {@link PendingRevalidation.dispatchedAt} itself).
   *
   * Creates the pending-revalidation fact when none is persisted yet for
   * `instrumentId` at all (the very first dispatch this store has seen for
   * a difference it has not yet recorded as pending — `setPendingRevalidation`
   * has not necessarily run first; a caller may dispatch and record pending
   * in either order). Supersedes — fresh `since`, no carried-over retry
   * state — a persisted fact for a DIFFERENT, older `sinceContentHash`,
   * exactly as `setPendingRevalidation` already does: a newer edit gets its
   * own retry budget. Read back, keyed to the given hash, by the caller
   * BEFORE deciding whether to dispatch at all — this method only ever
   * records that a dispatch happened, it never decides on its own whether
   * one should.
   *
   * A no-op when nothing is tracked at all yet for `instrumentId` — same
   * posture as `setPendingRevalidation`.
   */
  recordDispatch(
    instrumentId: string,
    sourceContentHash: string,
    dispatchedAt: number,
    retry: boolean,
  ): Promise<void>;
  /**
   * `[D-420]`: the store-side half of `DeferredRecheckRearmPort`
   * (`../../registry/deferred-recheck-retry.ts`) — a compare-and-set that re-arms a spent
   * `[D-400]` retry for `instrumentId`'s CURRENT persisted source revision only. Optional so
   * every existing fake/mock implementing this interface still compiles (same additive posture
   * `pendingRevalidation` itself took on {@link CitationAnchorRecord}); `undefined` reads as "not
   * wired" the same way `main.ts` reports no `deferredRecheckRearm` today.
   *
   * `true` when the persisted fact for `instrumentId` still named `expectedSourceContentHash`
   * with a spent retry and the mark was lifted (see `rearmSpentRetry`, the pure half of this
   * compare-and-set); `false` (nothing written) when there is nothing tracked, the revision
   * differs, or the retry is not yet spent.
   */
  grantExplicitRetry?(instrumentId: string, expectedSourceContentHash: string): Promise<boolean>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob — distinct from `MATERIALITY_HASH_STORAGE_KEY`, same blob, same read-modify-write discipline. */
export const CITATION_ANCHOR_STORAGE_KEY = 'citationRevisionAnchors';

function isPendingRevalidation(value: unknown): value is PendingRevalidation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sinceContentHash !== 'string' || typeof candidate.since !== 'number') {
    return false;
  }
  // [D-400]: both optional, same "predates this field, still reads" INV-2
  // posture the rest of this record already takes for pendingRevalidation
  // itself — but if present, well-formed.
  if (candidate.dispatchedAt !== undefined && typeof candidate.dispatchedAt !== 'number') {
    return false;
  }
  if (candidate.retriedAt !== undefined && typeof candidate.retriedAt !== 'number') {
    return false;
  }
  // `[D-446]`: optional, and if present one of the known reasons.
  if (
    candidate.reason !== undefined &&
    !(typeof candidate.reason === 'string' && PENDING_REASONS.has(candidate.reason))
  ) {
    return false;
  }
  return true;
}

function isCitationAnchorRecord(value: unknown): value is CitationAnchorRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !(
      typeof candidate.sourcePath === 'string' &&
      typeof candidate.text === 'string' &&
      Array.isArray(candidate.conceptIds) &&
      candidate.conceptIds.every((id) => typeof id === 'string')
    )
  ) {
    return false;
  }
  // [D-351]: optional, so a record predating this field (INV-2) still
  // reads — but if present, it must be well-formed, same "corrupted or
  // unrecognised entries are dropped" posture this validator already takes
  // for the record as a whole.
  if (
    candidate.pendingRevalidation !== undefined &&
    !isPendingRevalidation(candidate.pendingRevalidation)
  ) {
    return false;
  }
  // `[D-446]`: optional; present only for a passage-grain anchor.
  if (candidate.passageDigest !== undefined && typeof candidate.passageDigest !== 'string') {
    return false;
  }
  return true;
}

export class ObsidianCitationHashStore implements CitationHashStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async loadAll(): Promise<ReadonlyMap<string, CitationAnchorRecord>> {
    const blob = await this.host.loadData();
    const result = new Map<string, CitationAnchorRecord>();
    if (typeof blob !== 'object' || blob === null) return result;
    const table = (blob as Record<string, unknown>)[CITATION_ANCHOR_STORAGE_KEY];
    if (typeof table !== 'object' || table === null) return result;
    for (const [instrumentId, candidate] of Object.entries(table as Record<string, unknown>)) {
      // Corrupted or unrecognised entries are dropped rather than thrown —
      // same "treat as never seen" posture `ObsidianMaterialityHashStore`
      // takes for the same reason.
      if (isCitationAnchorRecord(candidate)) result.set(instrumentId, candidate);
    }
    return result;
  }

  /**
   * Read-modify-write, not a cached blob from construction time — same
   * reason `ObsidianMaterialityHashStore.save` gives: another part of the
   * plugin may have written to `data.json` since this store last loaded.
   * Atomic (`readModifyWrite`) when `this.host` supports it — see
   * `../../retrieval/serializing-data-host.ts`'s module doc — falling back
   * to a plain, non-atomic pair for a bare `ObsidianDataHost` (every
   * existing test here).
   */
  async save(instrumentId: string, record: CitationAnchorRecord): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const existingTable = blob[CITATION_ANCHOR_STORAGE_KEY];
      const table: Record<string, unknown> =
        typeof existingTable === 'object' && existingTable !== null
          ? { ...(existingTable as Record<string, unknown>) }
          : {};
      table[instrumentId] = record;
      blob[CITATION_ANCHOR_STORAGE_KEY] = table;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }

  /**
   * Atomic (`readModifyWrite`) when `this.host` supports it, falling back
   * to a plain, non-atomic `loadData()`-then-`saveData()` pair otherwise —
   * same reasoning as `save` above. The mutate step returns the input
   * unchanged (no-op, still atomic against the queue) when there is nothing
   * to remove, matching this method's original "nothing to do" early
   * returns for a bare `ObsidianDataHost`.
   */
  async remove(instrumentId: string): Promise<void> {
    const mutate = (existing: unknown): unknown => {
      if (typeof existing !== 'object' || existing === null) return existing;
      const existingTable = (existing as Record<string, unknown>)[CITATION_ANCHOR_STORAGE_KEY];
      if (typeof existingTable !== 'object' || existingTable === null) return existing;
      const blob: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
      const table: Record<string, unknown> = { ...(existingTable as Record<string, unknown>) };
      delete table[instrumentId];
      blob[CITATION_ANCHOR_STORAGE_KEY] = table;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(mutate);
      return;
    }
    const existing = await this.host.loadData();
    if (typeof existing !== 'object' || existing === null) return;
    const existingTable = (existing as Record<string, unknown>)[CITATION_ANCHOR_STORAGE_KEY];
    if (typeof existingTable !== 'object' || existingTable === null) return;
    await this.host.saveData(mutate(existing));
  }

  /**
   * `[D-351]`. Read-modify-write, same reason `save`/`remove` above give.
   * A no-op when `instrumentId` has no persisted record yet — see this
   * method's own interface doc.
   */
  async setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
    reason?: PendingReason,
  ): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const existingTable = blob[CITATION_ANCHOR_STORAGE_KEY];
      const table: Record<string, unknown> =
        typeof existingTable === 'object' && existingTable !== null
          ? { ...(existingTable as Record<string, unknown>) }
          : {};
      const currentEntry = table[instrumentId];
      if (!isCitationAnchorRecord(currentEntry)) {
        // Nothing tracked for this instrument yet to attach a pending fact
        // to — a no-op, per this method's own interface doc.
        return blob;
      }
      const existingPending = currentEntry.pendingRevalidation;
      // [D-400]: recordPending fires unconditionally, every tick, for as
      // long as a real difference is unresolved (`material-change.ts`'s own
      // doc) — including on ticks this trigger's own [D-400] dispatch gate
      // deliberately does not re-dispatch for. If the observed difference
      // is the SAME one already pending, this write must be a true no-op on
      // dispatch/retry state, or every such tick would silently erase the
      // retry budget this record exists to bound. Only a genuinely NEW
      // difference (a different hash) gets a fresh pending fact with no
      // carried-over dispatch/retry state — the same "SETTING half always
      // wins with the newest known real difference" rule this method's own
      // interface doc already gives for `sinceContentHash`/`since`.
      const pendingRevalidation: PendingRevalidation =
        existingPending?.sinceContentHash === sourceContentHash
          ? existingPending
          : {
              sinceContentHash: sourceContentHash,
              since,
              ...(reason !== undefined ? { reason } : {}),
            };
      table[instrumentId] = { ...currentEntry, pendingRevalidation };
      blob[CITATION_ANCHOR_STORAGE_KEY] = table;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }

  /**
   * `[D-400]`. Read-modify-write, same reason `save`/`setPendingRevalidation`
   * above give. Creates the pending-revalidation fact if none is persisted
   * yet (a dispatch may be recorded before or after `setPendingRevalidation`
   * itself runs for the same difference — see this method's own interface
   * doc); supersedes a fact for a different, older hash the same way
   * `setPendingRevalidation` does. A no-op when nothing is tracked at all
   * for `instrumentId`.
   */
  async recordDispatch(
    instrumentId: string,
    sourceContentHash: string,
    dispatchedAt: number,
    retry: boolean,
  ): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const existingTable = blob[CITATION_ANCHOR_STORAGE_KEY];
      const table: Record<string, unknown> =
        typeof existingTable === 'object' && existingTable !== null
          ? { ...(existingTable as Record<string, unknown>) }
          : {};
      const currentEntry = table[instrumentId];
      if (!isCitationAnchorRecord(currentEntry)) {
        // Nothing tracked for this instrument at all yet — a no-op, same
        // posture as `setPendingRevalidation`.
        return blob;
      }
      const existingPending = currentEntry.pendingRevalidation;
      const forSameDifference = existingPending?.sinceContentHash === sourceContentHash;
      const since = forSameDifference ? existingPending.since : dispatchedAt;
      const carriedRetriedAt = forSameDifference ? existingPending.retriedAt : undefined;
      table[instrumentId] = {
        ...currentEntry,
        pendingRevalidation: {
          sinceContentHash: sourceContentHash,
          since,
          dispatchedAt,
          ...(retry
            ? { retriedAt: dispatchedAt }
            : carriedRetriedAt !== undefined
              ? { retriedAt: carriedRetriedAt }
              : {}),
        },
      };
      blob[CITATION_ANCHOR_STORAGE_KEY] = table;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }

  /**
   * `[D-420]`. Read-modify-write, same reason `save`/`recordDispatch` above give. The store-side
   * half of `DeferredRecheckRearmPort` (`../../registry/deferred-recheck-retry.ts`) — applies the
   * pure {@link rearmSpentRetry} compare-and-set to the freshest persisted record, never a
   * snapshot: a no-op (returns `false`, nothing written) when there is nothing tracked for
   * `instrumentId`, the persisted fact names a different source revision, or its retry is not yet
   * spent.
   */
  async grantExplicitRetry(
    instrumentId: string,
    expectedSourceContentHash: string,
  ): Promise<boolean> {
    let granted = false;
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const existingTable = blob[CITATION_ANCHOR_STORAGE_KEY];
      const table: Record<string, unknown> =
        typeof existingTable === 'object' && existingTable !== null
          ? { ...(existingTable as Record<string, unknown>) }
          : {};
      const currentEntry = table[instrumentId];
      if (!isCitationAnchorRecord(currentEntry)) return blob;
      const rearmed = rearmSpentRetry(currentEntry.pendingRevalidation, expectedSourceContentHash);
      if (rearmed === null) return blob;
      table[instrumentId] = { ...currentEntry, pendingRevalidation: rearmed };
      blob[CITATION_ANCHOR_STORAGE_KEY] = table;
      granted = true;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return granted;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
    return granted;
  }

  /**
   * `[D-351]`. Reads the freshest persisted record via `loadAll` — never a
   * snapshot the caller took earlier in its own pass — so a concurrent
   * overlapping tick's own `setPendingRevalidation` write for the SAME
   * instrument is always seen by a resolution that runs after it.
   */
  async isPendingRevalidationCurrent(
    instrumentId: string,
    expectedSourceContentHash: string,
  ): Promise<boolean> {
    const all = await this.loadAll();
    return (
      all.get(instrumentId)?.pendingRevalidation?.sinceContentHash === expectedSourceContentHash
    );
  }
}
