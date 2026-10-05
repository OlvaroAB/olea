/**
 * Persistence for `[D-402]` binding condition 3's merge-audit proposals — the durable half
 * `./merge-audit.ts`'s own module doc names as "a follow-up for the caller that wires this in"
 * (`ol-egov.141.89.3.19`, discovered from `ol-egov.141.89.3.18`).
 *
 * **Why a separate file, rather than adding writes to `./merge-audit.ts` itself.** That module's
 * own doc is explicit: "nothing here reads or writes a `VaultSource`... this module owns
 * detection and the propose/confirm/decline state transitions only." This file is the vault-side
 * seam that gives those pure transitions a durable record, mirroring exactly the split
 * `./same-as.ts` already draws between "propose/confirm/decline, persisted" (that file) and the
 * evidential read that decides which to call (a caller). Every write below goes through
 * `./merge-audit.ts`'s own pure functions for the status transition itself — this file only adds
 * the timestamp, the enclosing record shape, and the vault read/write.
 *
 * **Two stores, two folders, dot-prefixed and sibling to `.olea/concepts/`/`.olea/same-as/`**:
 * `.olea/merge-audit/<key>.json` for the audit judgement ("is this wording's cross-course
 * evidence a genuine recurrence, or a mistake?"), and `.olea/merge-audit-repair/<key>.json` for
 * the repair proposal a declined audit judgement may produce. One file per concept key in each
 * store — `[D-402]` acceptance's "each affected identity produces exactly one proposal she can
 * answer" (audit side) and `proposeMergeRepair`'s own "produced only from a declined... proposal
 * for the SAME finding" (repair side, at most one per key).
 *
 * **Never re-proposes and never overwrites a decision.** `proposeAndPersistMergeAudits` writes a
 * fresh `'proposed'` record only for a key with no existing merge-audit record at all; a key that
 * already has one (proposed, confirmed or declined) is left exactly as it is. This is a one-time
 * historical audit over a fixed, already-shipped defect (`ol-egov.141.89.3.15` closed the bug that
 * produced this shape going forward) — unlike `./same-as.ts`'s live collision signal, there is no
 * `[D-093]` "evidence changed" reopening rule here, because nothing keeps producing new instances
 * of this specific old shape for a changed-evidence event to matter for.
 *
 * **The repair proposal carries its own copy of the audit's display context** (`wording`,
 * `anchorCourse`, `anchorPaths`) rather than requiring a second lookup back into the audit record
 * — it is written once, from the audit record that was declined, and is never re-derived from it
 * again.
 *
 * **Repair proposals are data only, matching `./merge-audit.ts`'s own module doc: "Confirming this
 * proposal records intent; execution is a later bead's job."** Nothing in this file, or reachable
 * from it, moves a path, mints a key, or rewrites the audited record — `confirmMergeRepairProposalRecord`
 * only ever flips a status and stamps a timestamp.
 *
 * **One writer per record file at a time (`ol-egov.141.89.104.2`).** Every writer below reads and
 * writes one record as one task on that file's queue (`../vault/path-queue.ts`), so a confirm and a
 * decline that overlap on one install are applied in the order they were made, the later one to
 * the record the earlier one left.
 */

import { listFolder } from '../vault/list-folder.js';
import { withPathQueue } from '../vault/path-queue.js';
import { readStoreRecordForWrite, skipUnreadableStoreRecord } from '../vault/store-record.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { courseFromPath, DEFAULT_COURSES_FOLDER } from './course.js';
import { type ConceptKeyRecord, listConceptKeyRecords } from './key-store.js';
import {
  confirmMergeAuditProposal,
  confirmMergeRepairProposal,
  declineMergeAuditProposal,
  declineMergeRepairProposal,
  findMergeAuditFindings,
  type MergeAuditCourseEvidence,
  type MergeAuditProposal,
  type MergeAuditProposalStatus,
  type MergeAuditRepairEscalation,
  type MergeRepairProposalStatus,
  proposeMergeAudits,
  proposeMergeRepair,
} from './merge-audit.js';
import { listSameAsLinkRecords, type SameAsLinkRecord } from './same-as.js';

export const MERGE_AUDIT_PROPOSAL_FOLDER: VaultPath = '.olea/merge-audit';
export const MERGE_REPAIR_PROPOSAL_FOLDER: VaultPath = '.olea/merge-audit-repair';
export const MERGE_AUDIT_PROPOSAL_RECORD_SCHEMA_VERSION = 1;
export const MERGE_REPAIR_PROPOSAL_RECORD_SCHEMA_VERSION = 1;

/** `./merge-audit.ts`'s `MergeAuditProposal`, persisted: adds the timestamps every triage record
 * carries (`./same-as.ts`'s own shape) plus the evidence context (`anchorPaths`,
 * `misattributedCourses` with their paths, not just course codes) the registry's read side needs
 * to show a passage without a second vault-wide scan. */
export interface MergeAuditProposalRecord {
  readonly key: string;
  readonly wording: string;
  readonly anchorCourse: string;
  /** This identity's own introducing paths under `anchorCourse` — sorted, may be empty on a
   * record whose anchor evidence has since been edited away. */
  readonly anchorPaths: readonly VaultPath[];
  readonly misattributedCourses: readonly MergeAuditCourseEvidence[];
  readonly status: MergeAuditProposalStatus;
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  readonly schemaVersion: number;
}

/** `./merge-audit.ts`'s `MergeRepairProposal`, persisted, plus the display context copied from
 * the audit record it was produced from (see module doc). */
export interface MergeRepairProposalRecord {
  readonly key: string;
  readonly wording: string;
  readonly anchorCourse: string;
  readonly anchorPaths: readonly VaultPath[];
  readonly course: string;
  readonly paths: readonly VaultPath[];
  readonly status: MergeRepairProposalStatus;
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  readonly schemaVersion: number;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function serialize(record: unknown): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Projects the persisted shape down to `./merge-audit.ts`'s pure `MergeAuditProposal` — the two
 * differ only in `misattributedCourses` (paths + course) vs. `misattributedCourseCodes` (course
 * only); the pure transition functions never read paths, so this loses nothing they need. */
function asMergeAuditProposal(record: MergeAuditProposalRecord): MergeAuditProposal {
  return {
    key: record.key,
    wording: record.wording,
    anchorCourse: record.anchorCourse,
    misattributedCourseCodes: record.misattributedCourses.map((evidence) => evidence.course),
    status: record.status,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isCourseEvidenceArray(value: unknown): value is readonly MergeAuditCourseEvidence[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      isNonEmptyString((entry as Record<string, unknown>).course) &&
      isStringArray((entry as Record<string, unknown>).paths),
  );
}

function isMergeAuditProposalStatus(value: unknown): value is MergeAuditProposalStatus {
  return value === 'proposed' || value === 'confirmed' || value === 'declined';
}

export function isMergeAuditProposalRecord(value: unknown): value is MergeAuditProposalRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.key) || !isNonEmptyString(v.wording) || !isNonEmptyString(v.anchorCourse))
    return false;
  if (!isStringArray(v.anchorPaths) || !isCourseEvidenceArray(v.misattributedCourses)) return false;
  if (!isMergeAuditProposalStatus(v.status)) return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

export function isMergeRepairProposalRecord(value: unknown): value is MergeRepairProposalRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    !isNonEmptyString(v.key) ||
    !isNonEmptyString(v.wording) ||
    !isNonEmptyString(v.anchorCourse) ||
    !isNonEmptyString(v.course)
  )
    return false;
  if (!isStringArray(v.anchorPaths) || !isStringArray(v.paths)) return false;
  if (v.status !== 'proposed' && v.status !== 'confirmed' && v.status !== 'declined') return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

export function mergeAuditProposalRecordPath(key: string): VaultPath {
  return `${MERGE_AUDIT_PROPOSAL_FOLDER}/${encodeURIComponent(key)}.json`;
}

export function mergeRepairProposalRecordPath(key: string): VaultPath {
  return `${MERGE_REPAIR_PROPOSAL_FOLDER}/${encodeURIComponent(key)}.json`;
}

/** `listFolder`, not `vault.list`: both stores are dot-prefixed, and `ObsidianSource.list()` never
 * sees a dot folder (`ol-egov.141.89.10.52`/`.56`) — same discipline `./same-as.ts`'s
 * `listSameAsLinkRecords` already documents. */
export async function listMergeAuditProposalRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: MergeAuditProposalRecord }[]> {
  const paths = await listFolder(vault, MERGE_AUDIT_PROPOSAL_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: MergeAuditProposalRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isMergeAuditProposalRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — same posture as every sibling sidecar.
    }
  }
  return out;
}

export async function listMergeRepairProposalRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: MergeRepairProposalRecord }[]> {
  const paths = await listFolder(vault, MERGE_REPAIR_PROPOSAL_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: MergeRepairProposalRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isMergeRepairProposalRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown.
    }
  }
  return out;
}

async function findMergeAuditProposalRecordEntry(
  vault: VaultSource,
  key: string,
): Promise<{ readonly path: VaultPath; readonly record: MergeAuditProposalRecord } | undefined> {
  const path = mergeAuditProposalRecordPath(key);
  // Unreadable is not absent: it throws `UnreadableStoreRecordError`, so nothing is written over a
  // decision this build cannot read (T12, `ol-egov.141.89.104.2`).
  const record = await readStoreRecordForWrite(vault, path, isMergeAuditProposalRecord);
  return record === undefined ? undefined : { path, record };
}

async function findMergeRepairProposalRecordEntry(
  vault: VaultSource,
  key: string,
): Promise<{ readonly path: VaultPath; readonly record: MergeRepairProposalRecord } | undefined> {
  const path = mergeRepairProposalRecordPath(key);
  // Unreadable is not absent (T12, as above).
  const record = await readStoreRecordForWrite(vault, path, isMergeRepairProposalRecord);
  return record === undefined ? undefined : { path, record };
}

export interface ProposeAndPersistMergeAuditsOptions {
  readonly now?: () => string;
  readonly coursesFolder?: VaultPath;
}

/**
 * The production seam `./merge-audit.ts`'s own module doc names as missing: runs
 * `findMergeAuditFindings`/`proposeMergeAudits` over `records` (a caller's own
 * `listConceptKeyRecords(vault)` pass — this never re-lists the vault itself) and writes a fresh
 * `'proposed'` `MergeAuditProposalRecord` for every finding with **no existing record at all**.
 * A key that already has a record — `'proposed'`, `'confirmed'` or `'declined'` — is returned
 * unchanged and nothing is written for it (module doc: "never re-proposes and never overwrites a
 * decision"). Safe to call on every ingestion tick: idempotent, and cheap once every affected
 * identity has a record (`findMergeAuditFindings` still runs, but nothing new is written).
 */
export async function proposeAndPersistMergeAudits(
  vault: VaultSource,
  records: readonly { readonly record: ConceptKeyRecord }[],
  options: ProposeAndPersistMergeAuditsOptions = {},
): Promise<readonly MergeAuditProposalRecord[]> {
  const now = options.now ?? defaultNow;
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const findings = findMergeAuditFindings(
    records.map(({ record }) => record),
    [],
    { coursesFolder },
  );
  const byKey = new Map(records.map(({ record }) => [record.key, record]));
  const proposals = proposeMergeAudits(findings);

  const written: MergeAuditProposalRecord[] = [];
  for (const proposal of proposals) {
    const path = mergeAuditProposalRecordPath(proposal.key);
    let record: MergeAuditProposalRecord;
    try {
      record = await withPathQueue(path, async () => {
        const existing = await findMergeAuditProposalRecordEntry(vault, proposal.key);
        if (existing !== undefined) return existing.record;
        const finding = findings.find((f) => f.key === proposal.key);
        const sourceRecord = byKey.get(proposal.key);
        const anchorPaths =
          finding === undefined ||
          sourceRecord === undefined ||
          sourceRecord.anchor.kind !== 'topic'
            ? []
            : [...new Set(sourceRecord.anchor.introducingPaths ?? [])]
                .filter((p) => courseFromPath(p, coursesFolder) === proposal.anchorCourse)
                .sort();

        const proposed: MergeAuditProposalRecord = {
          key: proposal.key,
          wording: proposal.wording,
          anchorCourse: proposal.anchorCourse,
          anchorPaths,
          misattributedCourses: finding?.misattributedCourses ?? [],
          status: 'proposed',
          proposedAt: now(),
          schemaVersion: MERGE_AUDIT_PROPOSAL_RECORD_SCHEMA_VERSION,
        };
        await vault.write(path, serialize(proposed));
        return proposed;
      });
    } catch (error) {
      // A key whose record cannot be read is left exactly as it is and skipped (T12); the rest
      // of the batch is still proposed.
      skipUnreadableStoreRecord(error);
      continue;
    }
    written.push(record);
  }
  return written;
}

/**
 * The evidential read landing as "yes, a genuine recurrence" — persisted. Calls
 * `./merge-audit.ts`'s own `confirmMergeAuditProposal` for the status transition (idempotent,
 * reachable from `'declined'` too) and stamps `confirmedAt` only when the status actually
 * changes. Throws when there is no persisted proposal for this key — mirroring `./same-as.ts`'s
 * `confirmSameAsLink` discipline: never mints a proposal on its own.
 */
export async function confirmMergeAuditProposalRecord(
  vault: VaultSource,
  key: string,
  options: { readonly now?: () => string } = {},
): Promise<MergeAuditProposalRecord> {
  const now = options.now ?? defaultNow;
  return withPathQueue(mergeAuditProposalRecordPath(key), async () => {
    const existing = await findMergeAuditProposalRecordEntry(vault, key);
    if (existing === undefined) {
      throw new Error(
        `confirmMergeAuditProposalRecord: no persisted merge-audit proposal for key ${JSON.stringify(key)} — a caller must propose before confirming ([D-402]).`,
      );
    }
    const transitioned = confirmMergeAuditProposal(asMergeAuditProposal(existing.record));
    if (transitioned.status === existing.record.status) return existing.record;
    const written: MergeAuditProposalRecord = {
      ...existing.record,
      status: 'confirmed',
      confirmedAt: now(),
    };
    await vault.write(existing.path, serialize(written));
    return written;
  });
}

/**
 * The evidential read landing as "a known mistake" — persisted. Same shape as
 * `confirmMergeAuditProposalRecord` above, calling `declineMergeAuditProposal` for the
 * transition. Declining does not itself propose a repair — a caller (the registry's decline
 * handler) calls `proposeAndPersistMergeRepair` afterward, exactly as `./merge-audit.ts`'s own
 * module doc requires ("produced only from a declined... proposal").
 */
export async function declineMergeAuditProposalRecord(
  vault: VaultSource,
  key: string,
  options: { readonly now?: () => string } = {},
): Promise<MergeAuditProposalRecord> {
  const now = options.now ?? defaultNow;
  return withPathQueue(mergeAuditProposalRecordPath(key), async () => {
    const existing = await findMergeAuditProposalRecordEntry(vault, key);
    if (existing === undefined) {
      throw new Error(
        `declineMergeAuditProposalRecord: no persisted merge-audit proposal for key ${JSON.stringify(key)} — a caller must propose before declining ([D-402]).`,
      );
    }
    const transitioned = declineMergeAuditProposal(asMergeAuditProposal(existing.record));
    if (transitioned.status === existing.record.status) return existing.record;
    const written: MergeAuditProposalRecord = {
      ...existing.record,
      status: 'declined',
      declinedAt: now(),
    };
    await vault.write(existing.path, serialize(written));
    return written;
  });
}

export type MergeAuditRepairAttemptOutcome =
  | { readonly kind: 'repair-proposal'; readonly proposal: MergeRepairProposalRecord }
  | { readonly kind: 'needs-decision'; readonly escalation: MergeAuditRepairEscalation }
  /** The audit proposal for `key` is not (yet, or no longer) `'declined'` — nothing to repair. */
  | { readonly kind: 'not-declined' };

export interface ProposeAndPersistMergeRepairOptions {
  readonly now?: () => string;
  readonly coursesFolder?: VaultPath;
  /** A caller already holding this tick's own listing hands it in, exactly as
   * `proposeAndPersistMergeAudits` accepts. Read from the vault when omitted. */
  readonly records?: readonly { readonly record: ConceptKeyRecord }[];
  /** Same reasoning as `records` — read from the vault when omitted. */
  readonly sameAsLinks?: readonly SameAsLinkRecord[];
}

/**
 * The repair half of `[D-402]` binding condition 3 (`./merge-audit.ts`'s `proposeMergeRepair`),
 * persisted. Only ever runs for a key whose `MergeAuditProposalRecord` is currently `'declined'`
 * (`{ kind: 'not-declined' }` otherwise — a caller error guard, never a silent no-op that looks
 * like success). Idempotent: a key that already has a persisted `MergeRepairProposalRecord`
 * returns it unchanged rather than re-deriving (the repair record's own status — proposed,
 * confirmed or declined — is never touched here again).
 *
 * **Re-reads the current same-as state before deciding**, rather than trusting whatever
 * `confirmedSameAsPartners` the ORIGINAL audit finding carried — a same-as link may have been
 * confirmed since the audit was first proposed, and `proposeMergeRepair`'s entangled-identity
 * escalation must see that. `{ kind: 'needs-decision' }` on either escalation
 * `proposeMergeRepair` names (an entangled confirmed same-as link, or more than one misattributed
 * course) writes nothing — the caller's job is to raise that as a decision bead
 * (`./merge-audit.ts`'s own module doc), never to guess a split.
 */
export async function proposeAndPersistMergeRepair(
  vault: VaultSource,
  key: string,
  options: ProposeAndPersistMergeRepairOptions = {},
): Promise<MergeAuditRepairAttemptOutcome> {
  const now = options.now ?? defaultNow;
  return withPathQueue(mergeRepairProposalRecordPath(key), async () => {
    const existingRepair = await findMergeRepairProposalRecordEntry(vault, key);
    if (existingRepair !== undefined) {
      return { kind: 'repair-proposal', proposal: existingRepair.record };
    }

    const auditRecord = await findMergeAuditProposalRecordEntry(vault, key);
    if (auditRecord === undefined || auditRecord.record.status !== 'declined') {
      return { kind: 'not-declined' };
    }

    const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
    const records = options.records ?? (await listConceptKeyRecords(vault));
    const sameAsLinks =
      options.sameAsLinks ?? (await listSameAsLinkRecords(vault)).map((entry) => entry.record);
    const findings = findMergeAuditFindings(
      records.map(({ record }) => record),
      sameAsLinks,
      { coursesFolder },
    );
    const finding = findings.find((f) => f.key === key);
    if (finding === undefined) {
      // The old-merge shape this key's finding depended on no longer exists on disk (its
      // introducing paths were edited away since the audit ran) — nothing left to repair.
      return { kind: 'not-declined' };
    }

    const proposal: MergeAuditProposal = {
      key: auditRecord.record.key,
      wording: auditRecord.record.wording,
      anchorCourse: auditRecord.record.anchorCourse,
      misattributedCourseCodes: auditRecord.record.misattributedCourses.map((e) => e.course),
      status: 'declined',
    };
    const outcome = proposeMergeRepair(finding, proposal);
    if (outcome.kind === 'needs-decision') {
      return { kind: 'needs-decision', escalation: outcome.escalation };
    }

    const record: MergeRepairProposalRecord = {
      key: outcome.proposal.key,
      wording: auditRecord.record.wording,
      anchorCourse: auditRecord.record.anchorCourse,
      anchorPaths: auditRecord.record.anchorPaths,
      course: outcome.proposal.course,
      paths: outcome.proposal.paths,
      status: 'proposed',
      proposedAt: now(),
      schemaVersion: MERGE_REPAIR_PROPOSAL_RECORD_SCHEMA_VERSION,
    };
    await vault.write(mergeRepairProposalRecordPath(record.key), serialize(record));
    return { kind: 'repair-proposal', proposal: record };
  });
}

/** Persisted confirm for a repair proposal — records intent only; nothing here moves a path or
 * mints a key (module doc). Idempotent, reachable from `'declined'` too, same rule as
 * `confirmMergeAuditProposalRecord`. */
export async function confirmMergeRepairProposalRecord(
  vault: VaultSource,
  key: string,
  options: { readonly now?: () => string } = {},
): Promise<MergeRepairProposalRecord> {
  const now = options.now ?? defaultNow;
  return withPathQueue(mergeRepairProposalRecordPath(key), async () => {
    const existing = await findMergeRepairProposalRecordEntry(vault, key);
    if (existing === undefined) {
      throw new Error(
        `confirmMergeRepairProposalRecord: no persisted repair proposal for key ${JSON.stringify(key)}.`,
      );
    }
    const transitioned = confirmMergeRepairProposal(existing.record);
    if (transitioned.status === existing.record.status) return existing.record;
    const written: MergeRepairProposalRecord = {
      ...existing.record,
      status: 'confirmed',
      confirmedAt: now(),
    };
    await vault.write(existing.path, serialize(written));
    return written;
  });
}

/** Persisted decline for a repair proposal — a hard labelled negative on the repair itself, never
 * a reopening of the underlying audit judgement. */
export async function declineMergeRepairProposalRecord(
  vault: VaultSource,
  key: string,
  options: { readonly now?: () => string } = {},
): Promise<MergeRepairProposalRecord> {
  const now = options.now ?? defaultNow;
  return withPathQueue(mergeRepairProposalRecordPath(key), async () => {
    const existing = await findMergeRepairProposalRecordEntry(vault, key);
    if (existing === undefined) {
      throw new Error(
        `declineMergeRepairProposalRecord: no persisted repair proposal for key ${JSON.stringify(key)}.`,
      );
    }
    const transitioned = declineMergeRepairProposal(existing.record);
    if (transitioned.status === existing.record.status) return existing.record;
    const written: MergeRepairProposalRecord = {
      ...existing.record,
      status: 'declined',
      declinedAt: now(),
    };
    await vault.write(existing.path, serialize(written));
    return written;
  });
}
