/**
 * `createDraftAcceptPort` — the accept/edit/reject resolution for one cached
 * draft (F3.3, `[D-097]`, INV-6, `ol-mfn0`).
 *
 * This is the seam `review/session.ts` calls exactly once per new-badge
 * item, the moment she answers it (accept), asks to edit it before saving
 * (edit), or rejects it — never before, per `ol-mfn0`'s own sequencing
 * warning against emitting a verdict ahead of the write it describes. Each
 * of the three outcomes here does the vault write (if any) and the verdict
 * append as ONE unit, so a verdict recorded by this port always describes
 * something that already happened.
 *
 * **Idempotent against a re-call on an already-resolved draft** — a rating
 * click that lands twice (a double render, a retried failed write) does not
 * insert a second MCQ block or append a second verdict; `accept` and
 * `reject` both check `record.status` first and return/no-op past a
 * non-`pending` record.
 */

import type { InstrumentType } from 'olea-contracts';
import type { VaultSource } from 'olea-core';
import { appendVerdictRecord } from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';
import type { DraftCacheStore } from './cache-store.js';
import { materializeAcceptedDraft } from './materialize-mcq.js';
import type { DraftRecord } from './types.js';

/** Every instrument this pipeline can currently draft is an MCQ (`quiz.generate.v1` — see `pipeline.ts`'s module doc). A future card/cloze generator widens this, not the port's shape. */
const DRAFTED_INSTRUMENT_TYPE: InstrumentType = 'mcq';

export interface DraftAcceptPort {
  /**
   * Materializes the draft into the vault (F3.4/F2.15, through the existing
   * MCQ identity machinery), flips its cache record to `verdict`, and
   * appends the matching `verdictLogRecordV4`. Returns the REAL vault
   * instrument id so the caller (`review/session.ts`) can use it for
   * scheduling from this point on.
   *
   * Throws if `draftId` names no cached record — a programmer error (the
   * queue handed the session a draft id the cache does not have), not a
   * recoverable runtime condition.
   */
  accept(
    draftId: string,
    verdict: 'accepted' | 'edited',
  ): Promise<{ readonly instrumentId: string }>;
  /**
   * Prunes the draft (F3.3: "reject prunes — withdrawn from circulation,
   * retained in full, never deleted") — flips its cache record to
   * `rejected` and appends the matching verdict. Writes nothing to the
   * vault; there is no instrument to remove because one was never created.
   * No-ops on an unknown or already-resolved draft id.
   */
  reject(draftId: string): Promise<void>;
}

export interface DraftAcceptPortDeps {
  readonly vault: VaultSource;
  readonly cache: DraftCacheStore;
  readonly deviceId: string;
  /** Injectable for deterministic tests; defaults to `crypto.randomUUID()` (same default `appendVerdictRecord` itself uses when its own caller omits one). */
  readonly generateEventId?: () => string;
  /** Injectable clock, defaults to the real one. */
  readonly now?: () => Date;
}

export function createDraftAcceptPort(deps: DraftAcceptPortDeps): DraftAcceptPort {
  const now = deps.now ?? (() => new Date());

  async function requireRecord(draftId: string): Promise<DraftRecord> {
    const record = await deps.cache.get(draftId);
    if (record === null) {
      throw new Error(`createDraftAcceptPort: no cached draft record for id ${draftId}`);
    }
    return record;
  }

  return {
    async accept(draftId, verdict) {
      const record = await requireRecord(draftId);

      if (record.status !== 'pending') {
        // Already resolved — a re-call (double click, a retried render) is a
        // no-op that returns the instrument id already minted rather than
        // materializing a second block or appending a second verdict.
        if (record.instrumentId !== undefined) {
          return { instrumentId: record.instrumentId };
        }
        throw new Error(
          `createDraftAcceptPort: draft ${draftId} is already '${record.status}' with no instrumentId on record`,
        );
      }

      const { instrumentId } = await materializeAcceptedDraft(
        deps.vault,
        {
          sourcePath: record.sourcePath,
          question: record.question,
          // [D-133] (`ol-2zfj.39`): forwarded only when this draft was
          // produced by the `'instrument-revision'` job kind
          // (`revision-job-runner.ts`) — `undefined` for every ordinary
          // sweep draft, matching `materializeAcceptedDraft`'s own
          // "no succession bookkeeping unless a predecessor id is supplied"
          // branch.
          ...(record.predecessorInstrumentId !== undefined
            ? { predecessorInstrumentId: record.predecessorInstrumentId }
            : {}),
          // `[D-181]` (`ol-2zfj.52`): forwarded verbatim so the citation
          // sidecar gets written keyed by the id this call mints — omitted,
          // never fabricated, when `pipeline.ts` had no citation to record
          // for this draft.
          ...(record.sourceCitation !== undefined ? { sourceCitation: record.sourceCitation } : {}),
        },
        {
          // Only actually required by `materializeAcceptedDraft` when a
          // `predecessorInstrumentId` was supplied above (its own deviceId
          // doc) — harmless to pass unconditionally otherwise, since it is
          // simply unused on the ordinary path. `now` is this port's own
          // already-resolved clock (`deps.now` defaulted above), never
          // `deps.now` directly — `exactOptionalPropertyTypes` forbids
          // setting a key to `undefined` when `deps.now` was omitted.
          deviceId: deps.deviceId,
          now,
          ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
        },
      );

      await deps.cache.put({
        ...record,
        status: verdict,
        instrumentId,
        resolvedAt: isoWithLocalOffset(now()),
      });

      await appendVerdictRecord(
        deps.vault,
        {
          timestamp: isoWithLocalOffset(now()),
          instrumentId,
          instrumentType: DRAFTED_INSTRUMENT_TYPE,
          // Already the opaque key — see `types.ts`'s doc on `DraftRecord.conceptIds`.
          conceptIds: [...record.conceptIds],
          verdict,
          artifactProvenance: record.provenance,
        },
        {
          deviceId: deps.deviceId,
          ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
        },
      );

      return { instrumentId };
    },

    async reject(draftId) {
      const record = await deps.cache.get(draftId);
      if (record === null) return;
      if (record.status !== 'pending') return; // already resolved — idempotent no-op

      await deps.cache.put({
        ...record,
        status: 'rejected',
        resolvedAt: isoWithLocalOffset(now()),
      });

      await appendVerdictRecord(
        deps.vault,
        {
          timestamp: isoWithLocalOffset(now()),
          // Never materialized — the draft's own id stands in for "the
          // instrument this verdict is about" (schema requires a non-empty
          // string; there is no vault instrument to name instead).
          instrumentId: record.draftId,
          instrumentType: DRAFTED_INSTRUMENT_TYPE,
          conceptIds: [...record.conceptIds],
          verdict: 'rejected',
          artifactProvenance: record.provenance,
        },
        {
          deviceId: deps.deviceId,
          ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
        },
      );
    },
  };
}
