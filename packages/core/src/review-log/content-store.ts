/**
 * `[D-077]` / C6.2a — Olea's content store: durable, immutable, Olea-authored
 * (`ol-2jod.8`, `ol-0r92.1` / `ol-0r92.10`).
 *
 * The daily review-log file (`./write.ts`) keeps the verdict and its depth
 * only. Her explanation text, the grader's feedback and misconception detail
 * — the evidence a verdict was computed FROM — live here instead, as
 * immutable per-event files referenced from the review event by id
 * (`explainBackGrade.contentRef`, `contracts/review-log.ts:723`). This is
 * what makes R9's replay-and-show promise honourable: recomputing a verdict
 * under a changed rubric needs the input, and this is where the input still
 * is.
 *
 * ===========================================================================
 * THE THIRD CATEGORY (C6.1/C6.2 owed answer) IS ALREADY LANDED
 * ===========================================================================
 * `ol-0r92.10`'s brief flags a pending Class C stop here — "C6.1/C6.2 must
 * say which half this store sits in, and neither existing category fits."
 * That stop is **already discharged**: `docs/Olea_alpha_functional_scope.md`
 * carries **C6.2a** ("Olea's content store, inside the vault (durable,
 * immutable, Olea-authored)"), added by commit `8bc05fc` ("four rulings land
 * `[D-077]` ...") citing `[D-077]` inline, before this module was written.
 * Nothing here amends the contract further — this module implements the
 * shape C6.2a already names, and cites it rather than restating it.
 *
 * ===========================================================================
 * WHY A NEW FOLDER, NOT `./path.ts`'s DAILY-BATCH SHAPE
 * ===========================================================================
 * `.olea/reviews/<date>.<deviceId>.jsonl` batches every event for one device
 * on one day into a single append-only file — right for a log that is read
 * as a whole and grows by appending lines. C6.2a's own words are different:
 * "written per record as separate files." A content record is read by a
 * single known id (the review event's `contentRef`), never enumerated or
 * streamed, so there is nothing to batch and no reason to share `path.ts`'s
 * file-naming module. `packages/plugin/src/generation/cache-store.ts`'s
 * `.olea/drafts/<draftId>.json` is the closer precedent: per-record files
 * under a dot-prefixed Olea folder, addressed by id.
 *
 * Unlike the draft cache, this module carries **no index file**. The draft
 * cache needs one because `list()`/`listPending()` have to discover drafts
 * without knowing their ids first; nothing here ever needs to enumerate the
 * content store — every reader already holds the exact `contentRef` off a
 * review event before it asks. Building a discovery index this module has no
 * caller for would be exactly the un-reachable-capability shape `[D-072]`
 * warns against.
 *
 * ===========================================================================
 * IMMUTABLE MEANS WRITE-ONCE, NOT "OVERWRITE IS FINE, NOTHING CHANGED"
 * ===========================================================================
 * `writeContentRecord` refuses a second write under an id that already has a
 * file — the file that already exists is untouched, and the caller's error is
 * "mint a new id" rather than "your update landed." This is stricter than
 * `DraftCacheStore.put`, which upserts by design (a draft's status changes in
 * place); content-store records never change once minted, matching C6.2a's
 * own word for them.
 *
 * ===========================================================================
 * TWO DEVICES NEVER CONFLICT
 * ===========================================================================
 * The default id generator folds the caller's `deviceId` into the minted id
 * (mirroring `./path.ts`'s `<date>.<deviceId>.jsonl` convention for the same
 * reason), so two devices grading at the same instant mint different ids and
 * write different files — there is no shared file either device could race
 * on, the same conflict-avoidance-by-shape C6.2's own doc states for
 * per-record files generally.
 *
 * ===========================================================================
 * INV-2 DOES NOT GOVERN THIS DIRECTORY
 * ===========================================================================
 * C6.2a says so explicitly: "INV-2 is untouched — the byte-identical
 * round-trip guarantee governs her notes, and this directory holds none of
 * them." The round-trip test below (write, then read back the same values) is
 * ordinary storage-correctness hygiene, not an INV-2 obligation — it would be
 * wrong to cite INV-2 for it.
 *
 * ===========================================================================
 * REFERENTIAL INTEGRITY: A MISSING REFERENT IS A DEFINED OUTCOME
 * ===========================================================================
 * `ContentReadResult` is the encoding of C6.2a's own rule: "an event pointing
 * at content that is gone still reads... nothing treats absence as a
 * different verdict or as an error." `readContentRecord` never throws for a
 * missing or corrupt file — both come back as `{ status: 'missing' }`, on
 * purpose indistinguishable to a caller, because a display built on this type
 * cannot accidentally report "corrupt" as if it were a different, more
 * alarming case than "never written" or "deleted." A verdict reader (review
 * event -> `explainBackGrade.contentRef` -> this store) always has something
 * to show: the verdict from the event, plus either the evidence or a plain
 * "no longer held" notice — never a thrown error, never a fabricated verdict.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, matching `.olea/reviews/` and `.olea/drafts/`. */
export const CONTENT_STORE_FOLDER: VaultPath = '.olea/content';

const CONTENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `contentId` is non-empty and safe to use verbatim as a file name. */
export function isValidContentId(contentId: string): boolean {
  return CONTENT_ID_RE.test(contentId);
}

/**
 * The vault path for one content record. Throws on a malformed id — a bad
 * path here is a bug at the call site, matching `reviewLogPath`'s own
 * validation posture (`./path.ts`).
 */
export function contentStorePath(contentId: string): VaultPath {
  if (!isValidContentId(contentId)) {
    throw new Error(`contentStorePath: not a valid content id: ${JSON.stringify(contentId)}`);
  }
  return `${CONTENT_STORE_FOLDER}/${contentId}.json`;
}

/**
 * What one content record holds — C6.2a's own list: the text she wrote when
 * explaining a concept back, the grader's feedback on it, and misconception
 * detail (optional: not every graded attempt surfaces a misconception).
 *
 * Never logged, never quoted in a bead or a report (D-005) — this type
 * exists to be written to and read from the vault, nothing else.
 */
export interface ContentStoreRecord {
  readonly contentId: string;
  readonly studentAnswer: string;
  readonly feedback: string;
  readonly misconceptionDetail?: string;
}

function isContentStoreRecord(value: unknown): value is ContentStoreRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.contentId !== 'string' || v.contentId.length === 0) return false;
  if (typeof v.studentAnswer !== 'string') return false;
  if (typeof v.feedback !== 'string') return false;
  if (v.misconceptionDetail !== undefined && typeof v.misconceptionDetail !== 'string') {
    return false;
  }
  return true;
}

export interface WriteContentOptions {
  /** Folded into the minted id by default — see the module header's "two devices never conflict". */
  readonly deviceId: string;
  /** Content id generator, injectable for deterministic tests. Defaults to `<deviceId>.<uuid>`. */
  readonly generateContentId?: () => string;
}

export interface WriteContentResult {
  /** The id minted for this record — this is the value a `contentRef` field carries. */
  readonly contentId: string;
  readonly path: VaultPath;
}

function defaultGenerateContentId(deviceId: string): string {
  return `${deviceId}.${globalThis.crypto.randomUUID()}`;
}

/**
 * Writes one content record, write-once. Throws — before touching the vault
 * a second time — if a record already exists under the generated id, and
 * never rewrites the file that already exists. `contentId` in `input` is
 * ignored if present; the id is always the one this call mints or is given,
 * never a value threaded through the payload (there is exactly one place a
 * content id is decided).
 */
export async function writeContentRecord(
  vault: VaultSource,
  input: Omit<ContentStoreRecord, 'contentId'>,
  options: WriteContentOptions,
): Promise<WriteContentResult> {
  const generateContentId =
    options.generateContentId ?? (() => defaultGenerateContentId(options.deviceId));
  const contentId = generateContentId();
  const path = contentStorePath(contentId);

  if (await vault.exists(path)) {
    throw new Error(
      `writeContentRecord: content id "${contentId}" already has a file — refusing to overwrite an immutable record`,
    );
  }

  const record: ContentStoreRecord = { contentId, ...input };
  await vault.write(path, `${JSON.stringify(record, null, 2)}\n`);

  return { contentId, path };
}

/** The defined outcome of reading a content record — see the module header's referential-integrity section. */
export type ContentReadResult =
  | { readonly status: 'found'; readonly record: ContentStoreRecord }
  | { readonly status: 'missing'; readonly contentId: string };

/**
 * Reads one content record by id. Never throws: an absent file, an unreadable
 * file and a corrupt/malformed file all come back as `{ status: 'missing' }`
 * — see the module header for why these are deliberately indistinguishable
 * to the caller.
 */
export async function readContentRecord(
  vault: VaultSource,
  contentId: string,
): Promise<ContentReadResult> {
  if (!isValidContentId(contentId)) {
    return { status: 'missing', contentId };
  }
  const path = contentStorePath(contentId);
  if (!(await vault.exists(path))) {
    return { status: 'missing', contentId };
  }
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isContentStoreRecord(parsed) && parsed.contentId === contentId) {
      return { status: 'found', record: parsed };
    }
    return { status: 'missing', contentId };
  } catch {
    return { status: 'missing', contentId };
  }
}

/**
 * Convenience for the review-log side of C6.2a: given the `contentRef` off an
 * `explainBackGrade` (`contracts/review-log.ts:723`), reads its evidence. A
 * verdict display composes this with the event's own `soloLevel` — the
 * verdict always comes from the event, this only ever supplies (or plainly
 * fails to supply) the evidence behind it, matching the module header's "a
 * verdict reader always has something to show."
 */
export async function readContentForGrade(
  vault: VaultSource,
  grade: { readonly contentRef: string },
): Promise<ContentReadResult> {
  return readContentRecord(vault, grade.contentRef);
}
