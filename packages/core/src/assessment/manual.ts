/**
 * Manual assessment entry (F1.2, ol-egov.141.8.10) — the fallback source `./resolve.ts`'s
 * `resolveAssessments` reads from **only** where no readable Assignments Base exists. F1.2's own
 * words: "Manual course/date entry only as a fallback where no base exists — never the default
 * path." This module is the storage half; `./resolve.ts` is the choice of which source wins.
 *
 * **Same sidecar-record shape every other `.olea/` node type already uses** — one small JSON file
 * per record, under a dot-prefixed Olea folder, written and read through the injected
 * `VaultSource` port, following `../concept/key-store.ts` ([D-174]) and `../outcome/store.ts`'s
 * already-ratified pattern rather than inventing a second persistence convention. **This is not
 * cache** (C6.2): a manual entry is the only record of an assessment she typed by hand, so nothing
 * here is disposable or silently rebuildable — no clear-cache path may ever touch this folder.
 *
 * **Never her authored notes** (INV-6 Part one has no carve-out to concern itself with, because
 * `.olea/` is Olea's own layer — the same argument `key-store.ts`'s module doc makes). Registering
 * this folder with `packages/plugin/src/privacy/log-discovery.ts`'s `OLEA_LAYER_FOLDERS` (role
 * `'record'`, the same role `CONCEPT_KEY_STORE_FOLDER`/`OUTCOME_STORE_FOLDER` carry) is that
 * module's to do — it sits outside this bead's `owns` and its own coverage guard
 * (`test/privacy/olea-layer-coverage.spec.ts`) will fail until it is; see this bead's report for
 * the exact line.
 *
 * **Round-trip byte-identical (INV-2).** `serialize` is the one function that turns a record into
 * bytes; every write goes through it, and every read parses exactly what a previous write
 * produced — the same discipline `../outcome/store.ts`'s own `serialize` follows.
 *
 * **Parsed into exactly the shape `./read.ts` produces** — `manualAssessmentRecordToAssessmentRecord`
 * runs weight through the SAME `[D-143]` normalization (`./weight.ts`) the base reader applies at
 * read time, so a manual `weight` and a Base `weight` are never on two different bases. `scope`
 * (F1.7) is not collected here — the entry surface's five fields are exactly F1.1's five required
 * fields, no more — so every manual record's `scope` is `undefined`, degrading to the ordinary
 * ranking exactly as F1.7 already describes for a Base row that states no scope.
 *
 * **Always a fresh mint, never a mint-or-lookup seam.** Unlike `resolveConceptKey`/`resolveOutcome`
 * (which match an existing record before minting, because two extraction passes over the same
 * anchor must converge on one identity), a manual entry has no anchor to match against — each call
 * to `addManualAssessmentEntry` is a new row she is deliberately adding, so it always mints and
 * always writes, exactly once per call.
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { AssessmentRecord } from './types.js';
import { normalizeAssessmentWeight } from './weight.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/concepts/` and `.olea/outcomes/`. */
export const MANUAL_ASSESSMENT_STORE_FOLDER: VaultPath = '.olea/assessments';

/** Bumped only on a breaking change to the record shape. */
export const MANUAL_ASSESSMENT_RECORD_SCHEMA_VERSION = 1;

/** Marks every id minted by this module — greppable, and distinct from the other `.olea/` node types' own prefixes (`concept-key1:`, `outcome-key1:`). */
export const MANUAL_ASSESSMENT_ID_PREFIX = 'manual-assessment1';

/**
 * One hand-entered assessment, exactly as she typed it — F1.1's five required fields
 * (course/type/weight/due/status), never `scope` (module doc). `weightRaw` is kept verbatim, the
 * same "never a fabricated default, never a silently reinterpreted value" discipline
 * `AssessmentRecord.weightRaw` already follows; normalization happens at READ time
 * (`manualAssessmentRecordToAssessmentRecord`), not at write time, so this stored record is a
 * faithful transcript of what she entered rather than a derived value.
 */
export interface ManualAssessmentRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly course: string;
  readonly type: string;
  readonly weightRaw?: string;
  readonly due?: string;
  readonly status?: string;
  /** `YYYY-MM-DD`, when this entry was added — used only to order the settings-pane list; never read as a due date or an assessment fact. */
  readonly enteredAt: string;
}

/** Every field a caller supplies when adding one entry; the writer stamps `schemaVersion`, `id` and `enteredAt`. */
export interface ManualAssessmentEntryInput {
  readonly course: string;
  readonly type: string;
  readonly weightRaw?: string;
  readonly due?: string;
  readonly status?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** Runtime validation, matching `../outcome/store.ts`'s hand-rolled-guard style (no schema library in this package). */
export function isManualAssessmentRecord(value: unknown): value is ManualAssessmentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.schemaVersion !== 'number') return false;
  if (!isNonEmptyString(v.id)) return false;
  if (typeof v.course !== 'string') return false;
  if (typeof v.type !== 'string') return false;
  if (!isOptionalString(v.weightRaw)) return false;
  if (!isOptionalString(v.due)) return false;
  if (!isOptionalString(v.status)) return false;
  if (!isNonEmptyString(v.enteredAt)) return false;
  return true;
}

/**
 * The vault path for one manual entry's record. `encodeURIComponent`, the same injective, total
 * choice `../concept/key-store.ts`/`../outcome/store.ts` make: the id is opaque by construction
 * (see `mintManualAssessmentId`), but the naming function stays the one and only place that
 * assembles a path.
 */
export function manualAssessmentRecordPath(id: string): VaultPath {
  return `${MANUAL_ASSESSMENT_STORE_FOLDER}/${encodeURIComponent(id)}.json`;
}

/** A source of randomness for `mintManualAssessmentId`. Injectable for deterministic tests, the same shape `../outcome/store.ts`'s `OpaqueIdNonceSource` uses. */
export type ManualAssessmentIdNonceSource = () => string;

function defaultNonceSource(): string {
  return globalThis.crypto.randomUUID();
}

/** Mints a durable, opaque id for one manual entry — a random nonce, never a transform of any field she typed. */
export function mintManualAssessmentId(
  nonceSource: ManualAssessmentIdNonceSource = defaultNonceSource,
): string {
  return `${MANUAL_ASSESSMENT_ID_PREFIX}:${nonceSource()}`;
}

function serialize(record: ManualAssessmentRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface AddManualAssessmentOptions {
  /** Injectable clock for `enteredAt`. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
  /** Injectable nonce source for `mintManualAssessmentId`. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: ManualAssessmentIdNonceSource;
}

/**
 * Mints and writes one manual assessment entry. Always a fresh file (module doc): there is no
 * existing entry to match against, so this never overwrites another entry's record.
 *
 * A blank `course` or `type` is refused before any byte is written — the settings-pane form
 * (`packages/plugin/src/settings/manual-assessment-entry-form.ts`) already enforces this, but a
 * second caller (a future command, a test) must not be able to write a record `./read.ts`'s own
 * reader would treat as an honest field rather than a caller bug.
 */
export async function addManualAssessmentEntry(
  vault: VaultSource,
  input: ManualAssessmentEntryInput,
  options: AddManualAssessmentOptions = {},
): Promise<{ readonly record: ManualAssessmentRecord; readonly path: VaultPath }> {
  const course = input.course.trim();
  const type = input.type.trim();
  if (course === '' || type === '') {
    throw new Error('addManualAssessmentEntry: course and type must both be non-blank');
  }

  const now = options.now ?? defaultToday;
  const id = mintManualAssessmentId(options.generateId);
  const weightRaw = input.weightRaw?.trim();
  const due = input.due?.trim();
  const status = input.status?.trim();

  const record: ManualAssessmentRecord = {
    schemaVersion: MANUAL_ASSESSMENT_RECORD_SCHEMA_VERSION,
    id,
    course,
    type,
    ...(weightRaw !== undefined && weightRaw !== '' ? { weightRaw } : {}),
    ...(due !== undefined && due !== '' ? { due } : {}),
    ...(status !== undefined && status !== '' ? { status } : {}),
    enteredAt: now(),
  };

  const path = manualAssessmentRecordPath(id);
  await vault.write(path, serialize(record));
  return { record, path };
}

/**
 * Every valid `ManualAssessmentRecord` currently under `.olea/assessments/`, alongside its path,
 * sorted by `enteredAt` then `id` (the order she added them in — there is no other natural order,
 * unlike the Base reader's sorted note paths). A file that fails to parse or fails validation is
 * skipped rather than thrown on, the same referential-integrity posture
 * `../outcome/store.ts`'s `listStoredOutcomeRecords` takes: one corrupt sidecar must never take
 * down a read of every other entry.
 */
export async function listManualAssessmentRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: ManualAssessmentRecord }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, MANUAL_ASSESSMENT_STORE_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: ManualAssessmentRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isManualAssessmentRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — see the doc above.
    }
  }
  return [...out].sort((a, b) => {
    if (a.record.enteredAt !== b.record.enteredAt) {
      return a.record.enteredAt < b.record.enteredAt ? -1 : 1;
    }
    return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
  });
}

/**
 * Removes one manual entry. Mirrors `VaultSource.delete`'s own documented posture: a host without
 * the optional method fails loudly rather than silently doing nothing (the same check F7.4's
 * privacy code makes), because a caller asking to remove one row must be able to tell "removed"
 * from "this host cannot remove anything" — reachable in the settings pane only where
 * `ObsidianSource`/`FolderSource` are the host, both of which implement `delete`.
 */
export async function removeManualAssessmentEntry(
  vault: VaultSource,
  path: VaultPath,
): Promise<void> {
  if (vault.delete === undefined) {
    throw new Error('removeManualAssessmentEntry: this VaultSource cannot delete files');
  }
  await vault.delete(path);
}

/**
 * One stored `ManualAssessmentRecord` through the SAME `[D-143]` weight normalization `./read.ts`
 * applies at read time (module doc) — the shape `./resolve.ts` and every downstream consumer
 * (`oracle/rank.ts`, `study-session/build.ts`, ...) already knows how to read.
 */
export function manualAssessmentRecordToAssessmentRecord(
  record: ManualAssessmentRecord,
  path: VaultPath,
): AssessmentRecord {
  const normalizedWeight = normalizeAssessmentWeight(
    record.weightRaw === undefined ? undefined : Number(record.weightRaw),
  );
  return {
    path,
    course: record.course,
    type: record.type,
    weight: normalizedWeight.value,
    weightBasis: normalizedWeight.basis,
    weightRaw: record.weightRaw,
    due: record.due,
    status: record.status,
    scope: undefined,
  };
}

/**
 * Every manual entry, as `AssessmentRecord`s in the same shape `./read.ts`'s `readAssessments`
 * produces — the convenience form for a caller that only wants records, not the full report (the
 * same split `./read.ts`'s own `.records` vs. the full `AssessmentReadReport` offers). `./resolve.ts`
 * builds the full report itself, via `listManualAssessmentRecords`, so it can report
 * `sourceFolders`/`notesScanned` honestly instead of going through this function.
 */
export async function readManualAssessments(
  vault: VaultSource,
): Promise<readonly AssessmentRecord[]> {
  const stored = await listManualAssessmentRecords(vault);
  return stored.map(({ path, record }) => manualAssessmentRecordToAssessmentRecord(record, path));
}
