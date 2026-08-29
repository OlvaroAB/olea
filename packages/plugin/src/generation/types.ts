/**
 * The unreviewed-draft cache's record shape (F3.3, `[CACHE-1]`/C6.2,
 * `ol-p3t07a`).
 *
 * This is plugin-internal storage, not a wire contract: `packages/contracts`
 * stays untouched (it governs the Worker boundary, D-005), and nothing here
 * is read by `olea-service`. A `DraftRecord` is the durable, per-record file
 * `[CACHE-1]` asks for — one JSON file per draft under `.olea/drafts/`
 * (`cache-store.ts`) — carrying exactly what F3.3's accept/edit/reject flow
 * needs and nothing she wrote: the drafted question, where it came from, and
 * D7.3's provenance triple (never her content, matching `ArtifactProvenance`
 * in `packages/contracts`' review-log schema).
 *
 * **Never deleted, per F3.3's "reject prunes… retained in full, never
 * deleted."** `status` moves `pending` → one of `accepted`/`edited`/
 * `rejected` in place; the record's own file is overwritten with the new
 * status, never removed (`VaultSource` has no delete method for exactly this
 * reason among others — see `cache-store.ts`).
 */

/** Mirrors `QuizGenerateResponsePayload['questions'][number]` (`draft-quiz-cards.ts`, olea repo) — the one question shape `draftQuizCardsForConcept` can currently produce. */
export interface DraftQuestion {
  readonly stem: string;
  readonly correctAnswer: string;
  readonly distractors: readonly string[];
  readonly feedback: string;
}

/**
 * D7.3/D-005-clean provenance: which generating call produced this draft.
 * Field-for-field the same triple `verdictLogRecordV4.artifactProvenance`
 * requires (`packages/contracts/src/review-log.ts`) — carried here so the
 * accept/reject port has it in hand at the moment she decides, per that
 * schema's own doc ("the emission site needs those three values in hand at
 * the moment she decides").
 */
export interface DraftProvenance {
  readonly taskId: string;
  readonly promptVersion: string;
  readonly modelId: string;
}

export type DraftStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface DraftRecord {
  /** Stable identity for this one drafted question — the file name (`cache-store.ts`) and, until accepted, the review queue's synthetic `instrumentId` stand-in. */
  readonly draftId: string;
  readonly status: DraftStatus;
  readonly courseCode: string;
  readonly conceptName: string;
  /**
   * `[ConceptRecord.key]` — the opaque, immutable join key (C7.11, `[D-088]`,
   * `ol-il6m`), never the display name. `session/enumerate.ts` keys
   * `ReviewInstrumentCommon.conceptIds` on this same opaque key (`ol-63e1`'s
   * coordinated flip, landed concurrently with this bead), and
   * `verdictLogRecordV4.conceptIds` is documented as keying on it "from day
   * one" — so this field is the single value both consumers read: the
   * review-view instrument's join key AND, copied verbatim, the verdict
   * `accept.ts` appends. One field, not two, now that both readers agree.
   */
  readonly conceptIds: readonly string[];
  /** The note this draft's material was embedded in (F1.6) — where `accept.ts` inserts the MCQ block on acceptance, and the instrument's `sourcePath` thereafter. */
  readonly sourcePath: string;
  /** ISO-8601 with offset — when the pipeline drafted this. */
  readonly createdAt: string;
  readonly question: DraftQuestion;
  readonly provenance: DraftProvenance;
  /**
   * Set the first time this draft is served in review (the "new" badge shows
   * exactly once — `open-session.ts`/`view.ts`). `null` before that.
   * Read-only bookkeeping: nothing about the accept/edit/reject flow depends
   * on it, and rendering the badge does not require flipping it (see that
   * module's doc for why the badge is keyed on `status === 'pending'`
   * instead — this field is for a future analytics/telemetry consumer that
   * wants to know staleness, not required by this round's scope).
   */
  readonly firstServedAt: string | null;
  /** Present only once resolved (`accepted`/`edited`/`rejected`). */
  readonly resolvedAt?: string;
  /** Present only once `accepted`/`edited`: the real vault instrument id `insertMcqBlock`/`stampMcqId` minted. */
  readonly instrumentId?: string;
  /**
   * `[D-133]` (`ol-2zfj.39`): the id of the instrument this draft, once
   * accepted, supersedes — set only for a draft the `'instrument-revision'`
   * job kind produced (`revision-job-runner.ts`), `undefined` for every
   * ordinary F3.3 sweep draft. `accept.ts` forwards this verbatim to
   * `materializeAcceptedDraft`'s `predecessorInstrumentId`, which is what
   * actually stamps the successor's block field and appends the succession
   * record — this field is only the vehicle that survives the draft cache's
   * pending→accepted round-trip between drafting and her review decision.
   */
  readonly predecessorInstrumentId?: string;
}

/** Runtime shape guard for a `DraftRecord` read back from a vault file — never trust `JSON.parse`'s `any` past this. Mirrors the "fail closed, report rather than throw" posture `olea-core`'s review-log `parse.ts` uses for a corrupt line, at plugin scope. */
export function isDraftRecord(value: unknown): value is DraftRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.draftId !== 'string' || v.draftId.length === 0) return false;
  if (
    v.status !== 'pending' &&
    v.status !== 'accepted' &&
    v.status !== 'edited' &&
    v.status !== 'rejected'
  ) {
    return false;
  }
  if (typeof v.courseCode !== 'string') return false;
  if (typeof v.conceptName !== 'string') return false;
  if (!Array.isArray(v.conceptIds) || !v.conceptIds.every((c) => typeof c === 'string')) {
    return false;
  }
  if (v.conceptIds.length === 0) return false;
  if (typeof v.sourcePath !== 'string') return false;
  if (typeof v.createdAt !== 'string') return false;
  if (typeof v.firstServedAt !== 'string' && v.firstServedAt !== null) return false;
  const q = v.question as Record<string, unknown> | undefined;
  if (
    typeof q !== 'object' ||
    q === null ||
    typeof q.stem !== 'string' ||
    typeof q.correctAnswer !== 'string' ||
    !Array.isArray(q.distractors) ||
    !q.distractors.every((d) => typeof d === 'string') ||
    typeof q.feedback !== 'string'
  ) {
    return false;
  }
  const p = v.provenance as Record<string, unknown> | undefined;
  if (
    typeof p !== 'object' ||
    p === null ||
    typeof p.taskId !== 'string' ||
    typeof p.promptVersion !== 'string' ||
    typeof p.modelId !== 'string'
  ) {
    return false;
  }
  if (v.resolvedAt !== undefined && typeof v.resolvedAt !== 'string') return false;
  if (v.instrumentId !== undefined && typeof v.instrumentId !== 'string') return false;
  if (v.predecessorInstrumentId !== undefined && typeof v.predecessorInstrumentId !== 'string') {
    return false;
  }
  return true;
}
