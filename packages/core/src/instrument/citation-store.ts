/**
 * The instrument passage-citation sidecar (`[D-181 / CITE-2]`, `ol-2zfj.52`, C3.4).
 *
 * `[D-181]` ruled option (b): a passage citation for a generated instrument (`McqInstrument`,
 * `CardInstrument`) persists in a sidecar under `.olea`, keyed by the frozen instrument id
 * (`[D-177]`) — **never as text written into her notes.** This module is that sidecar's
 * read/write half. It closes F8.4's uneven provenance grain: `ol-2zfj.48`/`.49` already thread
 * passage-grain `Provenance` onto `ConceptRecord`, but a generated instrument had nowhere to
 * durably keep the PDF/PPTX page or section its draft was cited from, so
 * `VaultInstrumentRecord.sourceProvenance` (`session/types.ts`) could never be populated for an
 * instrument — only for the concepts it practises.
 *
 * ===========================================================================
 * SHAPE: MIRRORS `key-store.ts`, ADDRESSES LIKE `content-store.ts`
 * ===========================================================================
 * Structurally this is `../concept/key-store.ts`'s pattern — a dot-prefixed `.olea/` folder, a
 * schema-versioned record type, a hand-rolled runtime guard, whole-file JSON, `VaultSource`-
 * parameterised, no `obsidian` import (INV-1). But its *addressing* follows
 * `../review-log/content-store.ts` instead of `key-store.ts`'s own scan-and-match: an instrument
 * id is never an anchor that has to be resolved by matching — `enumerate.ts`'s vault walk (and,
 * once wired, the generation pipeline's accept step) always already holds the exact,
 * `[D-177]`-frozen `instrumentId` before it asks this module anything. So there is no listing
 * function here and no anchor-matching seam: `readInstrumentCitation`/`writeInstrumentCitation`
 * both take the id directly, exactly like `readContentRecord`/`writeContentRecord` do for a
 * `contentRef`.
 *
 * ===========================================================================
 * THE GRAIN IS DELIBERATELY SMALLER THAN `SourceLocation`
 * ===========================================================================
 * `[D-181]`'s own text: "sourcePath plus page/section, mirroring `SourceLocation`" — not
 * reusing `../extract/types.js`'s `Provenance`/`SourceLocation` verbatim. `InstrumentCitation`
 * carries `sourcePath`, `page?` and `section?` only, never a `charRange`: the sidecar is written
 * long after the extraction pass that produced a `charRange` is over, and this module has no
 * cached passage text a character offset could index into. Inventing one would be exactly the
 * fabrication `SourceLocation.section`'s own doc comment (and this decision's "omit-never-
 * fabricate") warns against — a citation store that doesn't have passage-quoting precision says
 * so by never claiming a char range, not by guessing one.
 *
 * **This leaves a real, named type gap at the read side, not silently absorbed:**
 * `VaultInstrumentRecord.sourceProvenance` (`../session/types.js`) is typed `Provenance`, which
 * reuses `SourceLocation` and therefore requires `location.charRange` and `location.page` as
 * non-optional. `./enumerate.js`'s own doc comment on `citationToSourceProvenance` records the
 * exact accommodation it makes (never a silently-invented `page`, and a documented, unread
 * placeholder for `charRange`) and calls out the honest fix — widening `SourceLocation.charRange`
 * to optional — as a follow-up outside this bead's owned files (that field ripples into
 * `../tier3-evidence/build.ts`'s sort comparator, which reads `.charRange.start` directly).
 *
 * ===========================================================================
 * NEVER PDF DOCUMENT METADATA
 * ===========================================================================
 * `InstrumentCitation` has exactly three fields: `sourcePath`, `page`, `section`. There is no
 * `author`, `title`, `producer` or `keywords` field, and none should ever be added here —
 * `ol-pdfmeta`'s standing warning applies verbatim: PDF document metadata is content, not a
 * citation grain, and this module's callers (the generation pipeline, at draft time) must never
 * surface it through this store. `citation-store.spec.ts` guards the shape directly.
 *
 * ===========================================================================
 * WRITE-ONCE, LIKE THE CONTENT STORE — NOT UPSERT, LIKE THE KEY STORE
 * ===========================================================================
 * A citation is fixed at the moment an instrument is materialized into the vault (`[D-181]`'s own
 * words: "the source passage location the generation pipeline already has at draft time") and
 * never legitimately changes afterwards — there is no re-citation event, no rename to reconcile
 * (unlike `key-store.ts`'s anchor, which drifts when she renames a bound note).
 * `writeInstrumentCitation` therefore refuses to overwrite an existing record for the same
 * instrument id, matching `content-store.ts`'s immutability discipline rather than `key-store.ts`'s
 * upsert-on-drift one.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/concepts/` and `.olea/content/`. */
export const CITATION_STORE_FOLDER: VaultPath = '.olea/citations';

/** Bumped only on a breaking change to the record shape. */
export const CITATION_RECORD_SCHEMA_VERSION = 1;

/**
 * A generated instrument's passage citation, at `[D-181]`'s grain — `sourcePath` plus optional
 * `page`/`section`, mirroring `../extract/types.js`'s `SourceLocation` fields of the same name
 * (never its `charRange`). `page` and `section` are each independently optional, matching
 * `SourceLocation.section`'s own "absent means this source has no such structure, not that the
 * lookup failed" convention — never fabricated when the generation pipeline's own citation lacked
 * one.
 */
export interface InstrumentCitation {
  readonly sourcePath: VaultPath;
  readonly page?: number;
  readonly section?: string;
}

/** One citation record under `.olea/citations/` — `InstrumentCitation` plus its key and schema version. */
export interface CitationRecord extends InstrumentCitation {
  readonly instrumentId: string;
  readonly schemaVersion: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation, matching `key-store.ts`/`content-store.ts`'s hand-rolled-guard style (no schema library in this package). */
export function isCitationRecord(value: unknown): value is CitationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (!isNonEmptyString(v.sourcePath)) return false;
  if (v.page !== undefined && typeof v.page !== 'number') return false;
  if (v.section !== undefined && !isNonEmptyString(v.section)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/**
 * The vault path for one instrument's citation record. `encodeURIComponent` for the same reason
 * `key-store.ts`'s `conceptKeyRecordPath` gives — an instrument id (`[D-177]`'s scheme) is not
 * necessarily filesystem-safe unescaped, and percent-encoding is a pure, total, injective
 * function on it, so two distinct ids never collide and the encoded name stays legible for the
 * common case.
 */
export function citationStorePath(instrumentId: string): VaultPath {
  return `${CITATION_STORE_FOLDER}/${encodeURIComponent(instrumentId)}.json`;
}

function serialize(record: CitationRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Strips `instrumentId`/`schemaVersion` back down to the citation shape callers ask for. */
function toCitation(record: CitationRecord): InstrumentCitation {
  return {
    sourcePath: record.sourcePath,
    ...(record.page !== undefined ? { page: record.page } : {}),
    ...(record.section !== undefined ? { section: record.section } : {}),
  };
}

/**
 * Writes one instrument's citation, write-once — see the module doc's "write-once, like the
 * content store" section. Throws, before touching the vault a second time, if a record already
 * exists under `instrumentId`; the file that already exists is left untouched.
 */
export async function writeInstrumentCitation(
  vault: VaultSource,
  instrumentId: string,
  citation: InstrumentCitation,
): Promise<void> {
  const path = citationStorePath(instrumentId);
  if (await vault.exists(path)) {
    throw new Error(
      `writeInstrumentCitation: instrument id ${JSON.stringify(instrumentId)} already has a citation record — refusing to overwrite an immutable record`,
    );
  }
  const record: CitationRecord = {
    ...citation,
    instrumentId,
    schemaVersion: CITATION_RECORD_SCHEMA_VERSION,
  };
  await vault.write(path, serialize(record));
}

/**
 * Reads one instrument's citation by id. Never throws: an absent file, an unreadable file, a
 * corrupt/malformed file, and a file whose `instrumentId` doesn't match the one asked for all
 * come back as `undefined` — the same referential-integrity posture `content-store.ts`'s
 * `readContentRecord` takes, so a single corrupt sidecar file never takes down enumeration for
 * every other instrument. `undefined` is exactly the signal `./enumerate.js` reads as "leave
 * `sourceProvenance` absent" — this module never distinguishes "no sidecar" from "unreadable
 * sidecar" for the same reason `content-store.ts` doesn't distinguish "never written" from
 * "deleted" or "corrupt".
 */
export async function readInstrumentCitation(
  vault: VaultSource,
  instrumentId: string,
): Promise<InstrumentCitation | undefined> {
  if (instrumentId.length === 0) return undefined;
  const path = citationStorePath(instrumentId);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isCitationRecord(parsed) && parsed.instrumentId === instrumentId) {
      return toCitation(parsed);
    }
    return undefined;
  } catch {
    return undefined;
  }
}
