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
 * **The read-side type gap this used to leave is closed.** `VaultInstrumentRecord.sourceProvenance`
 * (`../session/types.js`) is typed `Provenance`, which reuses `SourceLocation`
 * (`../extract/types.js`); `location.page` stays non-optional but `location.charRange` is now
 * optional (`ol-2zfj.54`), so `./enumerate.js`'s `citationToSourceProvenance` builds a `location`
 * with `page`/`section` only, `charRange` simply absent, rather than the `{ start: 0, end: 0 }`
 * sentinel this comment used to describe. `../tier3-evidence/build.ts`'s sort comparator was the
 * one other reader that dereferenced `.charRange.start` directly; it now sorts absent ranges
 * after present ones.
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

/**
 * Bumped only on a breaking change to the record shape. `2` since `[D-292]`
 * (`ol-egov.141.89.2.7`, closed): a record written from here on carries
 * `passageDigest`/`sourceRevision` (still each independently optional — see
 * those fields' own doc); a `1`-vintage record on disk never had them and is
 * never rewritten to add them (write-once, unchanged). Nothing here reads
 * this constant to decide freshness — {@link classifyCitationFreshness} reads
 * `passageDigest`'s presence directly, which is the same fact this version
 * bump records, so a corrupt or hand-edited `schemaVersion` on an old file
 * can never desync the two.
 */
export const CITATION_RECORD_SCHEMA_VERSION = 2;

/**
 * A generated instrument's passage citation, at `[D-181]`'s grain — `sourcePath` plus optional
 * `page`/`section`, mirroring `../extract/types.js`'s `SourceLocation` fields of the same name
 * (never its `charRange`). `page` and `section` are each independently optional, matching
 * `SourceLocation.section`'s own "absent means this source has no such structure, not that the
 * lookup failed" convention — never fabricated when the generation pipeline's own citation lacked
 * one.
 *
 * `[D-292]` (`ol-egov.141.89.2.7`, closed) adds two more fields, both written once, at the same
 * moment as everything else here — never patched onto an existing record (write-once, unchanged):
 * `passageDigest` and `sourceRevision`. Both independently optional, the same "absent means
 * unavailable, never fabricated" convention `page`/`section` already use — a `1`-vintage record
 * predating `[D-292]` has neither, and {@link classifyCitationFreshness} reads that absence as
 * `'unknown'`, never as fresh (this bead's own evidence, `ol-2zfj.154`: "a never-tracked instrument
 * is silently baselined against its current state, i.e. treated as fresh" — review-response.md
 * section 1 row 10).
 */
export interface InstrumentCitation {
  readonly sourcePath: VaultPath;
  readonly page?: number;
  readonly section?: string;
  /**
   * `[D-292]`: a digest of the cited passage's own text, taken at the moment the instrument was
   * drafted — the value {@link classifyCitationFreshness} compares a later observation against.
   * This module never computes it (no vault I/O, no passage text cached here — see the module
   * doc's "THE GRAIN IS DELIBERATELY SMALLER THAN `SourceLocation`" section); the caller that
   * already holds the drafted passage text at generation time is the one that can honestly mint
   * this value. Absent on every record written before `[D-292]` landed.
   */
  readonly passageDigest?: string;
  /**
   * `[D-292]`: the source's own content-hash revision the citation was drafted against
   * ("materialisation already checks the source's content hash" — the decision's own text).
   * Distinct from `passageDigest`: this identifies the whole source file's state, that one the
   * exact cited passage's text. Absent on every record written before `[D-292]` landed.
   */
  readonly sourceRevision?: string;
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
  // `[D-292]`: each independently optional, same "absent is fine, wrong-typed is not" rule
  // `page`/`section` already get — a `1`-vintage record simply lacks them.
  if (v.passageDigest !== undefined && !isNonEmptyString(v.passageDigest)) return false;
  if (v.sourceRevision !== undefined && !isNonEmptyString(v.sourceRevision)) return false;
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
    ...(record.passageDigest !== undefined ? { passageDigest: record.passageDigest } : {}),
    ...(record.sourceRevision !== undefined ? { sourceRevision: record.sourceRevision } : {}),
  };
}

/**
 * `[D-292]`'s three read states for one citation's freshness (`ol-2zfj.154`'s own acceptance
 * criteria): `'fresh'` when an observed passage digest matches what was recorded at creation,
 * `'stale'` when it does not, and `'unknown'` for a `1`-vintage record with no `passageDigest`
 * to compare, OR when the caller has no current observation to compare against. Never a fourth,
 * silent "treat as fresh" outcome — the exact gap this bead's own evidence names (review-
 * response.md section 1 row 10).
 */
export type CitationFreshnessState = 'fresh' | 'stale' | 'unknown';

/**
 * Classify one citation's freshness — pure, no vault I/O (this module never reads the vault
 * itself; see the module doc). `currentPassageDigest` is the caller's own fresh observation of
 * the same passage, in the same digest space `passageDigest` was minted in; this function only
 * compares, it never computes one.
 *
 * `'unknown'` is a genuine third answer, not "assume fresh" wearing a different name: a legacy
 * record (no `passageDigest`) and a record the caller could not get a current observation for
 * both read `'unknown'`, and `../study-session/compose.js`'s consumer treats both identically
 * ("serve with a re-check queued") — see that module's `citationFreshness` doc.
 */
export function classifyCitationFreshness(
  citation: InstrumentCitation,
  currentPassageDigest: string | undefined,
): CitationFreshnessState {
  if (citation.passageDigest === undefined) return 'unknown';
  if (currentPassageDigest === undefined) return 'unknown';
  return citation.passageDigest === currentPassageDigest ? 'fresh' : 'stale';
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
