/**
 * The application-probe presentation sidecar (`[D-394]` choice 2, Option A —
 * "a presented flag on the instrument, set once, with the outcome always
 * derived at read time from the review-log event"; `ol-v7r5.74`).
 *
 * `[D-335]`/F2.24 need "shown" kept structurally apart from "successfully
 * answered": shown is a fact set exactly once, at the probe's actual
 * presentation, and it survives a restart; success is never stored beside
 * it (`../instrument/probe-outcome.js` derives that at read time instead).
 * This module is the "shown" half only — see that sibling file for the
 * other.
 *
 * ===========================================================================
 * SHAPE: MIRRORS `distractor-provenance-store.ts` / `citation-store.ts`
 * ===========================================================================
 * Same dot-prefixed `.olea/` folder, same schema-versioned record, same
 * hand-rolled runtime guard, same whole-file JSON, same `VaultSource`-
 * parameterised, no `obsidian` import (INV-1). Same addressing too: an
 * instrument id is never resolved by matching here — a caller that already
 * holds the exact, frozen probe instrument id (`[D-177]`) is the only shape
 * this module accepts; there is no listing function and no anchor-matching
 * seam, only `read`/`write` by id.
 *
 * `readProbePresentation` never throws: an absent file, an unreadable file,
 * a corrupt/malformed file, and a file whose `instrumentId` doesn't match
 * the one asked for all come back as `undefined` — the same failure posture
 * `readDistractorProvenance` documents. **A missing or unreadable sidecar
 * means "not yet shown", never "shown but the record was lost"** — an
 * application-probe trigger reading `undefined` here takes the
 * first-offer branch, which is the honest, conservative read: this module
 * would rather under-report shown (and let F2.24's own dedup gates catch a
 * true duplicate some other way) than ever silently forget that the record
 * itself failed to read.
 *
 * ===========================================================================
 * WRITE-ONCE, AND WHY THAT IS THE WHOLE POINT
 * ===========================================================================
 * `[D-394]`'s condition 1 ("shown is set only when the probe itself is
 * actually presented") and condition 2 ("shown is preserved across
 * restarts") are both discharged by the same write-once discipline
 * `writeDistractorProvenance`/`writeInstrumentCitation` already use:
 * `writeProbePresentation` refuses to overwrite an existing record for the
 * same instrument id. Writing, holding a probe undelivered, the exposure
 * re-check, an offer, and a declined or untaken offer all call nothing in
 * this module at all — the only call site a wiring lane may ever add is at
 * actual presentation, and even a caller that mistakenly calls this twice
 * for the same probe gets a thrown error rather than a silently-refreshed
 * timestamp.
 *
 * ===========================================================================
 * NO OUTCOME FIELD — STRUCTURALLY, NOT BY CONVENTION
 * ===========================================================================
 * `PresentedProbeRecord` below has exactly three fields: the id, the
 * timestamp, and the schema version. There is no `succeeded`, no `status`,
 * no `outcome` — `[D-394]`'s own text: "the probe record stores no outcome;
 * success is derived at read time from the qualifying review-log event of
 * that presentation." `probe-presentation-store.spec.ts` asserts the type
 * has no such field by round-tripping a record and checking its own key set,
 * so a future edit that adds one fails a test rather than shipping quietly.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/distractor-provenance/`. */
export const PROBE_PRESENTATION_STORE_FOLDER: VaultPath = '.olea/probe-presentation';

/** Bumped only on a breaking change to the record shape. */
export const PROBE_PRESENTATION_RECORD_SCHEMA_VERSION = 1;

/**
 * One probe's presentation record — the whole of "shown", nothing else.
 * `instrumentId` and `schemaVersion` are the record's own key and version;
 * `presentedAt` is the only fact this module ever asks a caller to supply.
 */
export interface PresentedProbeRecord {
  readonly instrumentId: string;
  /** ISO-8601 with offset — the moment the probe was actually presented. */
  readonly presentedAt: string;
  readonly schemaVersion: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation, matching this directory's hand-rolled-guard style (no schema library in this package). */
export function isPresentedProbeRecord(value: unknown): value is PresentedProbeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (!isNonEmptyString(v.presentedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/**
 * The vault path for one probe's presentation record. `encodeURIComponent`
 * for the same reason `distractorProvenanceStorePath` gives — an instrument
 * id is not necessarily filesystem-safe unescaped.
 */
export function probePresentationStorePath(instrumentId: string): VaultPath {
  return `${PROBE_PRESENTATION_STORE_FOLDER}/${encodeURIComponent(instrumentId)}.json`;
}

function serialize(record: PresentedProbeRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Records that one probe was actually presented, write-once — see the
 * module doc's "write-once" section. Throws, before touching the vault a
 * second time, if a record already exists under `instrumentId`; the file
 * that already exists is left untouched.
 */
export async function writeProbePresentation(
  vault: VaultSource,
  instrumentId: string,
  presentedAt: string,
): Promise<void> {
  const path = probePresentationStorePath(instrumentId);
  if (await vault.exists(path)) {
    throw new Error(
      `writeProbePresentation: instrument id ${JSON.stringify(instrumentId)} already has a presentation record — refusing to overwrite an immutable "shown" fact`,
    );
  }
  const record: PresentedProbeRecord = {
    instrumentId,
    presentedAt,
    schemaVersion: PROBE_PRESENTATION_RECORD_SCHEMA_VERSION,
  };
  await vault.write(path, serialize(record));
}

/**
 * Reads one probe's presentation record by id. Never throws — see the
 * module doc's "mirrors distractor-provenance-store.ts" section for the
 * full failure-posture list. `undefined` is exactly the signal a caller
 * reads as "not yet shown" — see `isProbeShown` below.
 */
export async function readProbePresentation(
  vault: VaultSource,
  instrumentId: string,
): Promise<PresentedProbeRecord | undefined> {
  if (instrumentId.length === 0) return undefined;
  const path = probePresentationStorePath(instrumentId);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isPresentedProbeRecord(parsed) && parsed.instrumentId === instrumentId) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * `true` exactly when a presentation record exists for this probe —
 * `[D-394]` condition 1's read-side counterpart. A caller building
 * `ApplicationProbeTriggerInput.presentation` for
 * `../study-session/application-probe-trigger.js` checks this first: an
 * unshown probe (or none written yet) means the input stays `undefined`
 * regardless of anything else on record.
 */
export async function isProbeShown(vault: VaultSource, instrumentId: string): Promise<boolean> {
  return (await readProbePresentation(vault, instrumentId)) !== undefined;
}
