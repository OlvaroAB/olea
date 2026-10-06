/**
 * Retiring the outcomes a revised document no longer states, once the revision has been read in
 * full (`ol-egov.141.89.7.68`; `[D-531]`, ruled B with completeness rules; `[D-272]` for
 * reinstatement). The design: olea-service `docs/direction/papers/examiner-scope-status/
 * 08-retire-on-revision.md`. Pure: no vault, no clock, no hashing.
 *
 * **Why a version must be read in full first.** A document's pages arrive in more than one delivery
 * (its text pages together, each scanned or figure page on its own), no delivery knows it is the
 * last of its version, the same version is delivered again (catch-up, an embedding note, a workflow
 * update), and a reload loses whatever was held in memory. Retiring after any one delivery would
 * retire outcomes another delivery of the same version states.
 *
 * **What is stored, and what this file reads.** Three facts, the ruling's:
 *  - each outcome's version stamp, `OutcomeRecord.statedInRevision` (`./types.ts`): the revision
 *    digest of the latest version of its document that stated it;
 *  - each page's "outcomes extracted" mark, kept per version in the unit manifest beside the page's
 *    concept-extraction state;
 *  - the reinstated event (`./events.ts`), which brings a retired outcome back.
 * The version's expected pages are the page record's own explicit list for that revision (its
 * enumeration). The page record reaches this file through {@link OutcomeRevisionPages}, an
 * interface defined here so this file depends on no storage: the unit manifest supplies it.
 *
 * **The completeness rules, as code.**
 *  1. *Every expected page.* Required pages are the version's expected list, plus any page a state
 *     names; a page with no state is not read. {@link outcomePagesReadInFull}.
 *  2. *Retire only after every required page is extracted.* A page is settled when it was read and
 *     its outcomes were extracted under this version, or it was read and held no text.
 *  3. *Failed or unavailable pages never establish absence.* Pending, unavailable, failed, partly
 *     read and not-legible pages are `'not-read'`, which never settles, extracted or not; and a
 *     version with no extracted page never counts (an empty or blank revision retires nothing).
 *  4. *Duplicate and late deliveries never undo a newer completed revision.* A version, once read
 *     in full, stays read in full ({@link outcomeRevisionReadInFull} replays the page history and
 *     asks whether any point of it was complete). A delivery of a version already read in full is a
 *     reread: it never reinstates or restamps. A delivery of any version but the current one is
 *     late: it writes nothing ({@link planOutcomeDelivery}).
 *  5. *No stored reason.* Revision is the only cause of retirement, so the retired event carries
 *     none.
 *  6. *Reinstatement.* An open delivery (the current version, not yet read in full) that states a
 *     retired outcome reinstates it, stamped with its version (`./store.ts`, `resolveOutcomes`).
 *
 * **Which outcomes a version read in full retires** ({@link outcomesToRetireOnRevision}): every
 * active outcome on that document stamped with another version the page record has listed for the
 * document. An outcome with no stamp, or stamped with a version the page record never listed, is
 * left alone: nothing establishes that its version is older.
 */

import type { VaultPath } from '../vault/types.js';
import type { OutcomeRecord } from './types.js';

/**
 * How far one page of a version has been read, as the page record says:
 *  - `'read'` — read in full, from its text layer, its image, or both;
 *  - `'nothing-to-read'` — read, and found to hold no text (a blank page, or no text on the page);
 *  - `'not-read'` — anything else: waiting, unavailable, failed, read only in part, or not legible.
 */
export type OutcomePageReading = 'read' | 'nothing-to-read' | 'not-read';

/** One page's whole state after a change, as far as the rule needs it. */
export interface OutcomePageState {
  readonly page: number;
  readonly reading: OutcomePageReading;
  /**
   * True when a delivery of this version extracted this page's outcomes successfully, after the
   * page's current reading landed and after the version was last listed. A failed, unavailable or
   * unstamped extraction never sets it.
   */
  readonly outcomesExtracted: boolean;
}

/**
 * One document's current version, as its page record holds it. The unit manifest supplies this
 * after checking the version against the file's current bytes.
 */
export interface OutcomeRevisionPages {
  readonly sourcePath: VaultPath;
  /** The current version's revision digest (the content hash of the document's bytes). */
  readonly revisionDigest: string;
  /** The version's explicit list of expected pages, from its enumeration. */
  readonly expectedPages: readonly number[];
  /**
   * Every recorded page state of this version since it was last listed, oldest first, each the
   * page's whole state after a change. A page with no entry has not been read.
   */
  readonly history: readonly OutcomePageState[];
  /** Every revision digest the page record has listed for this document, the current one included. */
  readonly knownRevisions: readonly string[];
}

/** Rule 2: a page needs nothing more for its version to be read in full. */
export function isPageSettledForOutcomes(state: OutcomePageState | undefined): boolean {
  if (state === undefined) return false;
  if (state.reading === 'nothing-to-read') return true;
  return state.reading === 'read' && state.outcomesExtracted;
}

function requiredPages(
  expectedPages: readonly number[],
  named: Iterable<number>,
): ReadonlySet<number> {
  const required = new Set(expectedPages);
  for (const page of named) required.add(page);
  return required;
}

function settled(
  required: ReadonlySet<number>,
  states: ReadonlyMap<number, OutcomePageState>,
): boolean {
  if (required.size === 0) return false;
  let anyExtracted = false;
  for (const page of required) {
    const state = states.get(page);
    if (!isPageSettledForOutcomes(state)) return false;
    if (state?.reading === 'read') anyExtracted = true;
  }
  return anyExtracted;
}

/**
 * Rules 1 to 3 on the pages' current states: every required page settled, and at least one page
 * read with its outcomes extracted. `states` holds each page's current state, keyed by page.
 */
export function outcomePagesReadInFull(
  expectedPages: readonly number[],
  states: ReadonlyMap<number, OutcomePageState>,
): boolean {
  return settled(requiredPages(expectedPages, states.keys()), states);
}

/**
 * Rule 4's half for a version: true when, at any point of its recorded page history, the version
 * was read in full. Once true it stays true, whatever is recorded later, so a later change to a
 * page never reopens a version whose outcomes were already settled. The required pages are fixed
 * over the whole history (the expected list plus every page the history names), so a page named
 * late is required from the start.
 */
export function outcomeRevisionReadInFull(revision: OutcomeRevisionPages): boolean {
  const required = requiredPages(
    revision.expectedPages,
    revision.history.map((state) => state.page),
  );
  const states = new Map<number, OutcomePageState>();
  for (const state of revision.history) {
    states.set(state.page, state);
    if (settled(required, states)) return true;
  }
  return false;
}

/**
 * Where a delivery stands against its document's current version:
 *  - `'open'` — it is of the current version, not yet read in full;
 *  - `'reread'` — it is of the current version, already read in full;
 *  - `'late'` — its bytes are not the current version's;
 *  - `'unplaced'` — it carries no revision digest, or the page record has no current version.
 */
export type OutcomeDeliveryStanding = 'open' | 'reread' | 'late' | 'unplaced';

/**
 * Places a delivery. `current` must have been checked against the document's current bytes, so a
 * digest that differs from it is a delivery of bytes the document no longer has.
 */
export function outcomeDeliveryStanding(
  current: OutcomeRevisionPages | undefined,
  deliveryDigest: string | undefined,
): OutcomeDeliveryStanding {
  if (current === undefined || deliveryDigest === undefined) return 'unplaced';
  if (deliveryDigest !== current.revisionDigest) return 'late';
  return outcomeRevisionReadInFull(current) ? 'reread' : 'open';
}

/**
 * What `./store.ts`'s `resolveOutcomes` is told about the version a delivery was read from.
 * `digest` stamps every record it mints. `restates` is true only for an open delivery: then a
 * matched active record stamped otherwise is restamped with `digest`, and a matched retired record
 * is reinstated. Otherwise a matched record is left exactly as it is.
 */
export interface OutcomeDeliveryRevision {
  readonly digest: string;
  readonly restates: boolean;
}

/** What one delivery may write, by its standing. */
export interface OutcomeDeliveryPlan {
  readonly standing: OutcomeDeliveryStanding;
  /** False for a late delivery: nothing is resolved, so nothing is minted, stamped or reinstated. */
  readonly resolve: boolean;
  /** Passed to `resolveOutcomes`; absent when the delivery carries no digest (minted with no stamp, as before this rule). */
  readonly revision?: OutcomeDeliveryRevision;
  /** True when the pages the delivery carried are marked extracted for its version, after a successful extraction. */
  readonly markPages: boolean;
}

/** Rule 4 and 6 as a plan for one delivery (module doc). */
export function planOutcomeDelivery(
  current: OutcomeRevisionPages | undefined,
  deliveryDigest: string | undefined,
): OutcomeDeliveryPlan {
  const standing = outcomeDeliveryStanding(current, deliveryDigest);
  switch (standing) {
    case 'late':
      return { standing, resolve: false, markPages: false };
    case 'open':
    case 'reread':
      return {
        standing,
        resolve: true,
        revision: { digest: deliveryDigest as string, restates: standing === 'open' },
        markPages: true,
      };
    case 'unplaced':
      return deliveryDigest === undefined
        ? { standing, resolve: true, markPages: false }
        : {
            standing,
            resolve: true,
            revision: { digest: deliveryDigest, restates: false },
            markPages: false,
          };
  }
}

/**
 * Whether `record` is one the version read in full retires: active, on the version's document,
 * stamped with another version the page record has listed for it.
 */
export function isRetiredByRevision(
  record: OutcomeRecord,
  revision: Pick<OutcomeRevisionPages, 'sourcePath' | 'revisionDigest' | 'knownRevisions'>,
): boolean {
  if (record.status !== 'active') return false;
  if (record.source.path !== revision.sourcePath) return false;
  const stamp = record.statedInRevision;
  if (stamp === undefined || stamp === revision.revisionDigest) return false;
  return revision.knownRevisions.includes(stamp);
}

/**
 * The ids of the outcomes the version retires, sorted; none while the version is not read in full.
 * Selecting is all this does: `./store.ts`'s `retireOutcomesOnRevision` writes the retirements.
 */
export function outcomesToRetireOnRevision(
  records: readonly OutcomeRecord[],
  revision: OutcomeRevisionPages,
): readonly string[] {
  if (!outcomeRevisionReadInFull(revision)) return [];
  return records
    .filter((record) => isRetiredByRevision(record, revision))
    .map((record) => record.id)
    .sort();
}
