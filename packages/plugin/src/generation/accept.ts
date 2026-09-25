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
 *
 * **`ol-0r92.87`'s stale-input guard.** `accept` forwards
 * `record.sourceContentHash` into `materializeAcceptedDraft`, which throws
 * `StaleSourceRevisionError` (never writes) when the note has changed since
 * the draft was cached — see that module's doc for why. This port catches
 * exactly that error and runs the SAME bookkeeping `reject` uses (cache
 * flips to `rejected`, retained in full; a `rejected` verdict is appended
 * naming the draft's own id, since no instrument was ever materialized) —
 * factored into `rejectRecord` below so the two paths cannot drift — then
 * re-throws, so `accept` never returns a fabricated success and the caller
 * (`review/session.ts`) sees a real rejection rather than a silent accept.
 * The record leaving `pending` behind is what makes a retry safe: a second
 * `accept` call on the same draft id now hits the ordinary
 * already-resolved-with-no-instrumentId branch below and throws too, rather
 * than re-running `materializeAcceptedDraft` against whatever the note
 * contains by then.
 *
 * ## `ol-0r92.88`: generalized past a hard-coded MCQ instrument type
 *
 * Every drafted instrument used to be an MCQ (`quiz.generate.v1` was the
 * only generative task the plugin's generation pipeline called), so this
 * port used to hard-code `instrumentType: 'mcq'` on both verdicts it
 * appends and call `materializeAcceptedDraft` directly. Neither is true by
 * construction any more: `DraftRecord.instrumentType` (`types.ts`) now
 * names which vault-instrument shape a cached draft resolves into, and
 * `accept()` below dispatches to a materializer registered for that kind in
 * `DRAFT_MATERIALIZERS` (defaulted to `'mcq'` → `materializeAcceptedDraft`,
 * overridable per kind, or per call in tests, through
 * `DraftAcceptPortDeps.materializers`) rather than always calling the MCQ
 * one. A kind with no registered materializer throws a named, defined error
 * from `accept()` — never a silent mis-write and never a guess — matching
 * the "no signal, no gate" posture the rest of this file already uses for
 * an absent optional field.
 *
 * **Every protection this module already had generalizes for free**, because
 * none of it inspected the MCQ shape directly: idempotency keys on
 * `record.status`/`record.instrumentId`, the stale-input guard only needs
 * the injected materializer to throw `StaleSourceRevisionError` (still the
 * one class every materializer signals staleness with — see that error's
 * own doc, `materialize-mcq.ts`), and `rejectRecord` already took the
 * record, not its content, so it needs only the resolved `instrumentType`
 * threaded through rather than the module-level constant.
 *
 * **What this bead does NOT add: a real `'qa'` materializer.** No client
 * pipeline drafts card-shaped content yet (nothing produces a `DraftRecord`
 * with `instrumentType: 'qa'`), and `olea-core`'s only Q&A vault-writer,
 * `createQaCard`, requires an `anchorBlockIndex` — C1.4 anchoring, which
 * `materialize-mcq.ts`'s own module doc already establishes is a
 * hand-authoring concept a *generated*, unanchored item cannot supply.
 * Writing a production `'qa'` materializer needs either a new, unanchored
 * `olea-core` write primitive (out of this package) or a ruling on how a
 * generated card is represented in the vault absent an anchor — neither
 * exists. `DRAFT_MATERIALIZERS` below registers only `'mcq'`; this file's
 * own tests exercise the `'qa'` dispatch path with an injected test double,
 * proving the port's generalized logic (not a real card write) works.
 */

import type { InstrumentType } from 'olea-contracts';
import type { VaultSource } from 'olea-core';
import { appendVerdictRecord } from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';
import type { DraftCacheStore } from './cache-store.js';
import { materializeAcceptedDraft, StaleSourceRevisionError } from './materialize-mcq.js';
import type { DraftRecord } from './types.js';

/**
 * What a kind-specific materializer needs to do the vault write and return
 * the real instrument id: the vault to write into, the resolved cached
 * draft (its own content field — `question` or `card` — is this function's
 * to read), and the same device/clock/event-id trio every review-log append
 * in this file already takes. May throw `StaleSourceRevisionError`
 * (`materialize-mcq.ts`) to signal "the source changed, nothing was
 * written" — `accept()` below catches exactly that class, from any
 * registered materializer, the same way it always caught it from the MCQ
 * one alone.
 */
export type DraftMaterializeFn = (
  vault: VaultSource,
  record: DraftRecord,
  deps: {
    readonly deviceId: string;
    readonly now: () => Date;
    readonly generateEventId?: () => string;
  },
) => Promise<{ readonly instrumentId: string }>;

/**
 * The pre-`ol-0r92.88` behaviour, unchanged, now expressed as one entry in
 * `DRAFT_MATERIALIZERS` instead of `accept()`'s only path: reads
 * `record.question` (required for an `'mcq'`/`undefined`-kind record — see
 * `types.ts`'s doc) and forwards every optional field
 * `materializeAcceptedDraft` accepts, exactly as `accept()` used to inline.
 */
const materializeMcqDraft: DraftMaterializeFn = (vault, record, deps) => {
  if (record.question === undefined) {
    throw new Error(
      `createDraftAcceptPort: draft ${record.draftId} has instrumentType 'mcq' but no question`,
    );
  }
  return materializeAcceptedDraft(
    vault,
    {
      sourcePath: record.sourcePath,
      question: record.question,
      // `ol-egov.141.89.2.8`: this draft's own stable, unique-per-draft id, folded into
      // the instrument id `materializeAcceptedDraft` derives — see that module's doc
      // ("the id is per draft") for why: without it, two different drafts with identical
      // question text would derive the same instrument id, where a retry of this SAME
      // draft still needs to converge on one.
      draftId: record.draftId,
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
      // `ol-0r92.87`: the snapshot hash `pipeline.ts` took at draft
      // time — omitted (never fabricated) for a draft cached before
      // this field existed, which skips the check entirely inside
      // `materializeAcceptedDraft`.
      ...(record.sourceContentHash !== undefined
        ? { expectedSourceContentHash: record.sourceContentHash }
        : {}),
    },
    {
      deviceId: deps.deviceId,
      now: deps.now,
      ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
    },
  );
};

/**
 * The materializer registered per `DraftRecord.instrumentType`, consulted
 * by `accept()` below. Only `'mcq'` has a production entry today — see this
 * module's doc's "generalized past a hard-coded MCQ instrument type"
 * section for why `'qa'` does not yet. `DraftAcceptPortDeps.materializers`
 * merges over this, key by key, so a caller (a future card pipeline, or a
 * test) can add or override an entry without this module changing.
 */
const DRAFT_MATERIALIZERS: Partial<Record<InstrumentType, DraftMaterializeFn>> = {
  mcq: materializeMcqDraft,
};

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
   *
   * Also throws `StaleSourceRevisionError` (`ol-0r92.87`) when the note the
   * draft was generated against has changed since it was cached — never
   * accepted silently against unreviewed content. The record is left
   * `rejected`, with the matching verdict already appended, before this
   * throws — see the module doc's stale-input section.
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
  /**
   * `ol-0r92.88`: per-`InstrumentType` materializer overrides/additions,
   * merged over `DRAFT_MATERIALIZERS`' `'mcq'` default. Omitted in
   * production today (nothing needs an override yet); a test supplies a
   * `'qa'` entry to exercise the generalized dispatch without a real
   * `olea-core` write primitive — see this module's doc.
   */
  readonly materializers?: Partial<Record<InstrumentType, DraftMaterializeFn>>;
}

export function createDraftAcceptPort(deps: DraftAcceptPortDeps): DraftAcceptPort {
  const now = deps.now ?? (() => new Date());
  const materializers: Partial<Record<InstrumentType, DraftMaterializeFn>> = {
    ...DRAFT_MATERIALIZERS,
    ...deps.materializers,
  };

  async function requireRecord(draftId: string): Promise<DraftRecord> {
    const record = await deps.cache.get(draftId);
    if (record === null) {
      throw new Error(`createDraftAcceptPort: no cached draft record for id ${draftId}`);
    }
    return record;
  }

  /**
   * The reject bookkeeping, factored out so `reject()` and the stale-input
   * catch in `accept()` cannot drift: flip the cache record to `rejected`
   * (retained in full, F3.3) and append the matching verdict naming the
   * draft's own id — nothing was ever materialized on either path, so
   * there is no real instrument id to name instead. `instrumentType` is the
   * caller's already-resolved `record.instrumentType ?? 'mcq'` (`ol-0r92.88`
   * — no longer a module-level constant, since a card-shaped record's
   * verdict must name `'qa'`, not `'mcq'`).
   */
  async function rejectRecord(record: DraftRecord, instrumentType: InstrumentType): Promise<void> {
    await deps.cache.put({
      ...record,
      status: 'rejected',
      resolvedAt: isoWithLocalOffset(now()),
    });

    await appendVerdictRecord(
      deps.vault,
      {
        timestamp: isoWithLocalOffset(now()),
        instrumentId: record.draftId,
        instrumentType,
        conceptIds: [...record.conceptIds],
        verdict: 'rejected',
        artifactProvenance: record.provenance,
      },
      {
        deviceId: deps.deviceId,
        ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
      },
    );
  }

  return {
    async accept(draftId, verdict) {
      const record = await requireRecord(draftId);
      // `ol-0r92.88`: resolved once, used for both the materializer lookup
      // below and the verdict this call appends — `undefined` reads as
      // `'mcq'`, matching `DraftRecord.instrumentType`'s own doc.
      const instrumentType: InstrumentType = record.instrumentType ?? 'mcq';

      if (record.status !== 'pending') {
        // Already resolved — a re-call (double click, a retried render) is a
        // no-op that returns the instrument id already minted rather than
        // materializing a second block or appending a second verdict. A
        // draft this port rejected as stale (below) lands here too, on a
        // retry: `instrumentId` is undefined, so it throws rather than
        // silently re-accepting.
        if (record.instrumentId !== undefined) {
          return { instrumentId: record.instrumentId };
        }
        throw new Error(
          `createDraftAcceptPort: draft ${draftId} is already '${record.status}' with no instrumentId on record`,
        );
      }

      const materialize = materializers[instrumentType];
      if (materialize === undefined) {
        // `ol-0r92.88`: a defined, named refusal — never a silent mis-write
        // and never a guess — for a kind nothing has registered a
        // materializer for yet (every `'qa'` draft in production today,
        // since no card-drafting pipeline exists; see this module's doc).
        throw new Error(
          `createDraftAcceptPort: no materializer registered for draft ${draftId}'s instrumentType '${instrumentType}'`,
        );
      }

      let instrumentId: string;
      try {
        ({ instrumentId } = await materialize(deps.vault, record, {
          // Only actually required by `materializeAcceptedDraft` when a
          // `predecessorInstrumentId` was supplied (its own deviceId
          // doc) — harmless to pass unconditionally otherwise, since it is
          // simply unused on the ordinary path. `now` is this port's own
          // already-resolved clock (`deps.now` defaulted above), never
          // `deps.now` directly — `exactOptionalPropertyTypes` forbids
          // setting a key to `undefined` when `deps.now` was omitted.
          deviceId: deps.deviceId,
          now,
          ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
        }));
      } catch (err) {
        if (err instanceof StaleSourceRevisionError) {
          // Nothing was written — see that error's own doc. Run the same
          // bookkeeping a click-through reject does, then re-throw: accept
          // never returns a fabricated success on this path.
          await rejectRecord(record, instrumentType);
        }
        throw err;
      }

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
          instrumentType,
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

      await rejectRecord(record, record.instrumentType ?? 'mcq');
    },
  };
}
