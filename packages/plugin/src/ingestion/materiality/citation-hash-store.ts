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

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

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
}

export interface CitationHashStore {
  loadAll(): Promise<ReadonlyMap<string, CitationAnchorRecord>>;
  save(instrumentId: string, record: CitationAnchorRecord): Promise<void>;
  /** Drops tracking for an instrument whose predecessor has just been suspended (`'revised'`) — its own material no longer needs watching. */
  remove(instrumentId: string): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob — distinct from `MATERIALITY_HASH_STORAGE_KEY`, same blob, same read-modify-write discipline. */
export const CITATION_ANCHOR_STORAGE_KEY = 'citationRevisionAnchors';

function isCitationAnchorRecord(value: unknown): value is CitationAnchorRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sourcePath === 'string' &&
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.conceptIds) &&
    candidate.conceptIds.every((id) => typeof id === 'string')
  );
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

  async save(instrumentId: string, record: CitationAnchorRecord): Promise<void> {
    // Read-modify-write, not a cached blob from construction time — same
    // reason `ObsidianMaterialityHashStore.save` gives: another part of the
    // plugin may have written to `data.json` since this store last loaded.
    const existing = await this.host.loadData();
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
    await this.host.saveData(blob);
  }

  async remove(instrumentId: string): Promise<void> {
    const existing = await this.host.loadData();
    if (typeof existing !== 'object' || existing === null) return;
    const existingTable = (existing as Record<string, unknown>)[CITATION_ANCHOR_STORAGE_KEY];
    if (typeof existingTable !== 'object' || existingTable === null) return;
    const blob: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
    const table: Record<string, unknown> = { ...(existingTable as Record<string, unknown>) };
    delete table[instrumentId];
    blob[CITATION_ANCHOR_STORAGE_KEY] = table;
    await this.host.saveData(blob);
  }
}
