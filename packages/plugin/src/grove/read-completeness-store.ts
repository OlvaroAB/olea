/**
 * `ObsidianGroveReadCompletenessStore` — persists `ol-2zfj.144` [IL-D5]'s
 * `ConceptReadCoverage` rows, per course, across desktop sessions
 * (`ol-2zfj.157` [DOS-I15]).
 *
 * `readConceptsAndRelations`'s corpus-relation-batch tick (`packages/plugin/
 * src/main.ts#tickIngestionAndMaybeRunCorpusRelations`) is transient: it
 * runs once per ingestion-session close and its `pass.read.coverage` value
 * is never held anywhere after that method returns, so `./provider.ts`'s own
 * `load()` — called on a completely separate cadence, whenever the grove
 * leaf opens or refreshes — has nothing to read `olea-core#buildGroveModel`'s
 * new `readCoverage` input from unless something durable sits between the
 * two. This store is that durable seam, matching `./ground-streak-store.ts`'s
 * identical shape and identical reasoning (no event-sourced home for this in
 * `packages/contracts` or `packages/core/src/review-log/`).
 *
 * **Keyed by course** (`olea-core#courseFromPath`'s own F1.3 folder rule),
 * because `olea-core#buildGroveModel`'s `readCoverage` input is scoped to
 * one course at a time (same "the caller filters vault-wide reads to
 * `course`" discipline that function's other fields already hold) —
 * `main.ts` groups the vault-wide `pass.read.coverage` array by
 * `courseFromPath(row.sourcePath)` before saving here, and a row whose path
 * resolves to no course (loose in the courses folder, or outside it
 * entirely) is dropped rather than guessed into one.
 *
 * **Replace, not merge, on every save** — same posture `./ground-streak-
 * store.ts` takes: a course this run's read never touched (nothing
 * ingested for it this tick) has nothing current to report, and keeping a
 * prior tick's rows would let a stale truncation/section reading outlive
 * the read that produced it.
 *
 * **Not her content, though `sections` carries her own heading names**
 * (INV-3/D-005's "never content" bar is about her WORDING inside a note,
 * not the structural fact that a heading with that name exists — same
 * reading `./copy.ts#groveReadCompletenessLine`'s own doc states for why it
 * is safe to render). `data.json` is plugin configuration under
 * `.obsidian/plugins/<id>/`, local to her own vault, never a vault note and
 * never synced anywhere by this store.
 */

import type { ConceptReadCoverage } from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import { hasReadModifyWrite } from '../retrieval/serializing-data-host.js';

export const GROVE_READ_COMPLETENESS_STORAGE_KEY = 'groveReadCompleteness';

export interface GroveReadCompleteness {
  readonly version: 1;
  /** Course code -> that course's `ConceptReadCoverage` rows from the most recent read. Never holds a course this store has not been told about. */
  readonly byCourse: Readonly<Record<string, readonly ConceptReadCoverage[]>>;
}

export const EMPTY_GROVE_READ_COMPLETENESS: GroveReadCompleteness = { version: 1, byCourse: {} };

function isConceptReadCoverageRow(value: unknown): value is ConceptReadCoverage {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sourcePath === 'string' &&
    typeof c.passagesOffered === 'number' &&
    typeof c.passagesRead === 'number' &&
    typeof c.conceptsFound === 'number' &&
    typeof c.calls === 'number' &&
    typeof c.truncatedByBudget === 'boolean' &&
    Array.isArray(c.sections) &&
    c.sections.every((s) => typeof s === 'string')
  );
}

function isGroveReadCompleteness(value: unknown): value is GroveReadCompleteness {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.byCourse !== 'object' || candidate.byCourse === null) return false;
  return Object.values(candidate.byCourse as Record<string, unknown>).every(
    (rows) => Array.isArray(rows) && rows.every(isConceptReadCoverageRow),
  );
}

export class ObsidianGroveReadCompletenessStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns an empty map — never throws — when nothing usable is stored. */
  async load(): Promise<ReadonlyMap<string, readonly ConceptReadCoverage[]>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[GROVE_READ_COMPLETENESS_STORAGE_KEY];
    if (!isGroveReadCompleteness(candidate)) return new Map();
    return new Map(Object.entries(candidate.byCourse));
  }

  /**
   * REPLACES the whole stored map — see module doc for why a course absent
   * from `byCourse` must not linger from a prior save. Atomic
   * (`readModifyWrite`) when `this.host` supports it, falling back to a
   * plain, non-atomic pair otherwise — see `../retrieval/serializing-data-
   * host.ts`'s module doc.
   */
  async save(byCourse: ReadonlyMap<string, readonly ConceptReadCoverage[]>): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const value: GroveReadCompleteness = { version: 1, byCourse: Object.fromEntries(byCourse) };
      blob[GROVE_READ_COMPLETENESS_STORAGE_KEY] = value;
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
