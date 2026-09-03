/**
 * The distractor-provenance sidecar (`[D-220 / DIST-3]`, `ol-egov.109`, `ol-0r92.52`, F3.3).
 *
 * `[D-202]`'s misconception-observed event (`ol-0r92.44`, `packages/plugin/src/review/session.ts`'s
 * `mcqNext`) needs the chosen distractor's `believes`/`source_says` inline, but that data
 * (`DraftQuestion.distractorGrounding`, `packages/plugin/src/generation/types.ts`) was explicitly
 * in-memory/cache-scoped only: `materialize-mcq.ts` wrote just the option TEXT into the vault's
 * persisted MCQ block (`McqInstrument.distractors` stays a bare `string[]` — `[D-202]`'s own HELD
 * note), and nothing carried the rest forward. `[D-220]` ruled the fix is an additive sidecar in
 * Olea's own layer, keyed by the `[D-177]`-frozen instrument id, beside the existing passage-
 * citation sidecar (`./citation-store.js`) — this module is that sidecar's read/write half.
 *
 * ===========================================================================
 * SHAPE: MIRRORS `citation-store.ts`, RIGHT DOWN TO THE FAILURE POSTURE
 * ===========================================================================
 * Same dot-prefixed `.olea/` folder, same schema-versioned record, same hand-rolled runtime guard,
 * same whole-file JSON, same `VaultSource`-parameterised, no `obsidian` import (INV-1). Same
 * addressing, too: an instrument id is never resolved by matching here — `materializeAcceptedDraft`
 * already holds the exact, frozen `instrumentId` it just minted before it ever calls this module,
 * so there is no listing function and no anchor-matching seam, only `read`/`write` by id.
 *
 * `readDistractorProvenance` never throws: an absent file, an unreadable file, a corrupt/malformed
 * file, and a file whose `instrumentId` doesn't match the one asked for all come back as
 * `undefined`. **A missing or unreadable sidecar means absent provenance and no
 * misconception-observed event — never a fabricated one** (`[D-220]`'s own ruling, and
 * `session.ts`'s `mcqNext` already reads `McqOption.believes`/`source_says` this defensively — see
 * that file's `deriveMisconception`-shaped helper).
 *
 * ===========================================================================
 * WHY THE RECORD IS A LIST OF ENTRIES, NOT AN INDEX-ALIGNED ARRAY
 * ===========================================================================
 * `DraftQuestion.distractorGrounding[i]` describes `distractors[i]` at DRAFT time, and
 * `materializeAcceptedDraft` writes that same order into `McqInstrument.distractors` (F3.4,
 * `acceptGeneratedMcq` — verified byte-for-byte, no reorder). But F2.15 (`mcq-present.ts`) samples
 * up to `PRESENTED_DISTRACTORS` of the pool and shuffles positions on EVERY showing, so by the time
 * `queue-adapter.ts` composes a presentation, index alignment to the persisted block is already
 * gone — only the option's own TEXT survives the sample-and-shuffle. So each entry below carries
 * its own `text`, and the read side matches by text against the sampled `McqPresentationOption`,
 * never by position.
 *
 * ===========================================================================
 * NEVER A CORRECT-OPTION ENTRY
 * ===========================================================================
 * `McqOption.believes`/`source_says` are documented as "`undefined` for a correct option always"
 * (`packages/plugin/src/review/types.ts`). This sidecar only ever holds distractor entries —
 * `materialize-mcq.ts` builds `entries` from `DraftQuestion.distractors` paired with
 * `distractorGrounding`, never from `correctAnswer`. `isDistractorProvenanceRecord` does not (and
 * cannot) enforce this — it has no way to know which text was the correct answer — so the
 * discipline lives entirely in the write side; see that module's own doc.
 *
 * ===========================================================================
 * OMIT, NEVER FABRICATE — AT TWO GRAINS
 * ===========================================================================
 * A whole draft can have no grounding at all (`distractorGrounding` absent — the pre-`[D-195]`
 * bare-string generation shape), in which case `materialize-mcq.ts` skips the sidecar write
 * entirely, exactly like the citation sidecar's own `undefined`-means-skip convention. A draft can
 * also have SOME distractors grounded and others not (`distractorGrounding[i]` is `null` at one
 * index while its siblings parsed) — that draft's sidecar carries only the entries that exist, and
 * the read side's per-option text match simply finds nothing for the ungrounded ones. Neither case
 * is a defect this module reports; both are "no believer behind it", which is the honest reading.
 *
 * ===========================================================================
 * WRITE-ONCE, LIKE THE CITATION SIDECAR
 * ===========================================================================
 * A distractor's provenance is fixed at the moment its instrument is materialized and never
 * legitimately changes afterwards (there is no re-grounding event). `writeDistractorProvenance`
 * therefore refuses to overwrite an existing record for the same instrument id, matching
 * `citation-store.ts`'s immutability discipline.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/citations/`. */
export const DISTRACTOR_PROVENANCE_STORE_FOLDER: VaultPath = '.olea/distractor-provenance';

/** Bumped only on a breaking change to the record shape. */
export const DISTRACTOR_PROVENANCE_RECORD_SCHEMA_VERSION = 1;

/**
 * One distractor's provenance, keyed by its own presented TEXT rather than a position — see the
 * module doc's "why the record is a list of entries" section. Mirrors `DraftDistractorGrounding`
 * (`packages/plugin/src/generation/types.ts`) field-for-field, plus the `text` it is paired with.
 */
export interface DistractorProvenanceEntry {
  readonly text: string;
  readonly believes: string;
  readonly source_says: string;
}

/** One instrument's distractor provenance — every grounded distractor it has, never the correct option. */
export interface DistractorProvenance {
  readonly entries: readonly DistractorProvenanceEntry[];
}

/** One record under `.olea/distractor-provenance/` — `DistractorProvenance` plus its key and schema version. */
export interface DistractorProvenanceRecord extends DistractorProvenance {
  readonly instrumentId: string;
  readonly schemaVersion: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDistractorProvenanceEntry(value: unknown): value is DistractorProvenanceEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.text) && isNonEmptyString(v.believes) && isNonEmptyString(v.source_says)
  );
}

/** Runtime validation, matching `citation-store.ts`'s hand-rolled-guard style (no schema library in this package). */
export function isDistractorProvenanceRecord(value: unknown): value is DistractorProvenanceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (!Array.isArray(v.entries) || !v.entries.every(isDistractorProvenanceEntry)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/**
 * The vault path for one instrument's distractor-provenance record. `encodeURIComponent` for the
 * same reason `citation-store.ts`'s `citationStorePath` gives — an instrument id (`[D-177]`'s
 * scheme) is not necessarily filesystem-safe unescaped.
 */
export function distractorProvenanceStorePath(instrumentId: string): VaultPath {
  return `${DISTRACTOR_PROVENANCE_STORE_FOLDER}/${encodeURIComponent(instrumentId)}.json`;
}

function serialize(record: DistractorProvenanceRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Strips `instrumentId`/`schemaVersion` back down to the shape callers ask for. */
function toDistractorProvenance(record: DistractorProvenanceRecord): DistractorProvenance {
  return { entries: record.entries };
}

/**
 * Writes one instrument's distractor provenance, write-once — see the module doc's "write-once"
 * section. Throws, before touching the vault a second time, if a record already exists under
 * `instrumentId`; the file that already exists is left untouched. Callers should skip calling this
 * at all when there is nothing to write (an empty `entries` list) — see `materialize-mcq.ts`'s own
 * doc for why "no sidecar" and "an empty sidecar" are meant to be the same observable state, and
 * this module does not enforce the choice either way.
 */
export async function writeDistractorProvenance(
  vault: VaultSource,
  instrumentId: string,
  provenance: DistractorProvenance,
): Promise<void> {
  const path = distractorProvenanceStorePath(instrumentId);
  if (await vault.exists(path)) {
    throw new Error(
      `writeDistractorProvenance: instrument id ${JSON.stringify(instrumentId)} already has a distractor-provenance record — refusing to overwrite an immutable record`,
    );
  }
  const record: DistractorProvenanceRecord = {
    entries: provenance.entries,
    instrumentId,
    schemaVersion: DISTRACTOR_PROVENANCE_RECORD_SCHEMA_VERSION,
  };
  await vault.write(path, serialize(record));
}

/**
 * Reads one instrument's distractor provenance by id. Never throws — see the module doc's
 * "mirrors citation-store.ts" section for the full failure-posture list. `undefined` is exactly
 * the signal `queue-adapter.ts` reads as "no provenance for this instrument" — this module never
 * distinguishes "no sidecar" from "unreadable sidecar", same as `citation-store.ts`.
 */
export async function readDistractorProvenance(
  vault: VaultSource,
  instrumentId: string,
): Promise<DistractorProvenance | undefined> {
  if (instrumentId.length === 0) return undefined;
  const path = distractorProvenanceStorePath(instrumentId);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isDistractorProvenanceRecord(parsed) && parsed.instrumentId === instrumentId) {
      return toDistractorProvenance(parsed);
    }
    return undefined;
  } catch {
    return undefined;
  }
}
