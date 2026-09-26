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

import type { InstrumentType } from 'olea-contracts';
import type { InstrumentCitation } from 'olea-core';

/**
 * `[D-195]` (`ol-0r92.40`): a grounded distractor's provenance — the wrong
 * belief it encodes and the source material that corrects it, mirroring
 * `quizGenerateResponse`'s `distractorSchema` field-for-field
 * (`olea-service/src/tasks/quizGenerate.ts`, private; read for shape only).
 * Carried on `DraftQuestion` **in memory only** — see that field's own doc.
 */
export interface DraftDistractorGrounding {
  readonly believes: string;
  readonly source_says: string;
}

/**
 * Mirrors `QuizGenerateResponsePayload['questions'][number]` (`draft-quiz-cards.ts`, olea repo) —
 * the one question shape `draftQuizCardsForConcept` can currently produce.
 */
export interface DraftQuestion {
  readonly stem: string;
  readonly correctAnswer: string;
  /**
   * The option text only — what `materialize-mcq.ts` writes into the vault's
   * MCQ block (`olea-core`'s `McqFields.distractors`). Populated from either
   * the pre-`[D-195]` bare-string generation shape or the `text` field of the
   * `[D-195]` object shape — `response.ts`'s `extractDraftedQuestions`
   * normalises both to this.
   */
  readonly distractors: readonly string[];
  readonly feedback: string;
  /**
   * `[D-195]`'s per-distractor grounding, aligned by index with `distractors`
   * above — `distractorGrounding[i]` describes `distractors[i]`. `undefined`
   * for the whole array when the generation response used the pre-`[D-195]`
   * bare-string shape (nothing to carry); `null` at one index if that
   * position's own entry didn't parse as the object shape while its siblings
   * did (defensive — a single response is not expected to mix shapes, but
   * this is not assumed).
   *
   * **In-memory / cache-scoped, not a persisted-block field.** The vault's
   * MCQ instrument (`olea-core`'s `McqInstrument.distractors: readonly
   * string[]`) has no place for `believes`/`source_says` yet — that is
   * `[D-202]` (`ol-egov.92`), explicitly HELD. `materialize-mcq.ts` /
   * `acceptGeneratedMcq` must keep reading only `distractors` above; this
   * field exists so the richer data survives from generation through to
   * whatever eventually consumes it (a review-view affordance, or `[D-202]`
   * itself), without forcing a persisted-schema decision to land first.
   */
  readonly distractorGrounding?: readonly (DraftDistractorGrounding | null)[];
}

/**
 * `ol-0r92.88`: the drafted content of a `'qa'`-instrument-typed
 * `DraftRecord` — mirrors `createQaCard`'s own `front`/`back` pair
 * (`olea-core`'s `packages/core/src/instrument/card-format.ts`), the shape a
 * hand-authored Q&A card already carries, so a card materializer built
 * against this shape can reuse the same vault-write vocabulary. Sibling to
 * `DraftQuestion` above: `DraftRecord.question` carries an `'mcq'` draft's
 * content, `DraftRecord.card` carries a `'qa'` draft's — the two are
 * mutually exclusive, selected by `DraftRecord.instrumentType` (see that
 * field's own doc). No `'cloze'` or `'explain-back'` counterpart exists yet;
 * nothing in this pipeline drafts either shape.
 */
export interface DraftCardContent {
  readonly front: string;
  readonly back: string;
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
  /**
   * `[D-181]`/`ol-2zfj.52`: the passage `pipeline.ts` drafted this concept
   * from — `ExtractedUnit.provenance` threaded at draft time, at the same
   * coarse grain `sourcePath` above already uses (the embedding note's or
   * standalone source's own unit; `pipeline.ts`'s module doc explains why
   * that grain is already an approximation at the concept level, not a new
   * one this field introduces). **Never `sourcePath`'s note** — this is the
   * cited source DOCUMENT's own location (a PDF/PPTX/DOCX page, optionally a
   * section), mirroring `SourceLocation`'s `page`/`section` fields but never
   * its `charRange` (`InstrumentCitation`'s own doc, `olea-core`).
   * `undefined` when the pipeline had no unit to draft from — omitted, never
   * fabricated. On accept, `accept.ts` forwards this verbatim into
   * `materializeAcceptedDraft`, which writes it to the citation sidecar
   * (`writeInstrumentCitation`) keyed by the frozen instrument id, or skips
   * that write entirely when this is absent.
   */
  readonly sourceCitation?: InstrumentCitation;
  /**
   * `ol-0r92.87`'s stale-input guard: the SHA-256 hex hash (`hashText`,
   * `olea-core`) `pipeline.ts` took of `sourcePath`'s note content at the
   * moment this draft was cached — the snapshot the drafted question was
   * actually grounded against. `accept.ts` forwards this verbatim into
   * `materializeAcceptedDraft`, which re-hashes the note fresh at accept
   * time and refuses (never materializes) on a mismatch — the note changed
   * under a still-pending draft while it was outstanding, and F3.3's
   * passive accept must never write against content nobody reviewed.
   * `undefined` only for a draft cached before this field existed;
   * `materializeAcceptedDraft` treats that as "no signal" and proceeds
   * exactly as before this bead — the same convention `sourceCitation`
   * above and `predecessorInstrumentId` below already use for an optional
   * field with no earlier producer.
   */
  readonly sourceContentHash?: string;
  /** ISO-8601 with offset — when the pipeline drafted this. */
  readonly createdAt: string;
  /**
   * `ol-0r92.88`: which vault-instrument shape this draft resolves into on
   * accept, and which `DRAFT_MATERIALIZERS`-registered materializer
   * (`accept.ts`) `DraftAcceptPort.accept` dispatches to. `undefined` means
   * `'mcq'` — every draft cached before this field existed, and every draft
   * `pipeline.ts`'s `quiz.generate.v1` sweep still produces today, is MCQ-
   * shaped and carries no explicit value; this keeps every existing producer
   * (`pipeline.ts`, `revision-job-runner.ts`, `review/heading-offer.ts`)
   * unchanged. Only `'mcq'` (reads `question` below) and `'qa'` (reads
   * `card` below) are meaningful today — nothing drafts `'cloze'` or
   * `'explain-back'` content, and `accept.ts` refuses, rather than guesses,
   * for a value with no registered materializer.
   */
  readonly instrumentType?: InstrumentType;
  /**
   * The drafted `'mcq'` content — required when `instrumentType` is
   * `'mcq'`/`undefined`, absent (never both) when it is `'qa'`. See
   * `card` below for the sibling field.
   */
  readonly question?: DraftQuestion;
  /**
   * The drafted `'qa'` content (`ol-0r92.88`) — required when
   * `instrumentType` is `'qa'`, absent (never both) when it is
   * `'mcq'`/`undefined`. See `DraftCardContent`'s own doc for why this
   * mirrors `createQaCard`'s `front`/`back` rather than `DraftQuestion`'s
   * shape.
   */
  readonly card?: DraftCardContent;
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
  // `ol-0r92.88`: `undefined` reads as `'mcq'` (every draft cached before this field existed) —
  // see `DraftRecord.instrumentType`'s own doc. Only `'mcq'` and `'qa'` have a content shape below
  // to validate against; a value outside the four canonical kinds is rejected outright, and
  // `'cloze'`/`'explain-back'` (real kinds, no drafted content shape yet) fall through to the
  // `'mcq'` branch's `question` check below and fail it — nothing drafts either today, so there is
  // no shape to accept for them.
  if (
    v.instrumentType !== undefined &&
    v.instrumentType !== 'mcq' &&
    v.instrumentType !== 'qa' &&
    v.instrumentType !== 'cloze' &&
    v.instrumentType !== 'explain-back'
  ) {
    return false;
  }
  if (v.instrumentType === 'qa') {
    const c = v.card as Record<string, unknown> | undefined;
    if (
      typeof c !== 'object' ||
      c === null ||
      typeof c.front !== 'string' ||
      typeof c.back !== 'string'
    ) {
      return false;
    }
    if (v.question !== undefined) return false; // mutually exclusive with `question` — see the field's own doc
  } else {
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
    if (v.card !== undefined) return false; // mutually exclusive with `card` — see the field's own doc
    // `[D-195]`'s optional per-distractor grounding (`DraftDistractorGrounding`) — absent entirely
    // for a draft cached before this bead, or for one built from the pre-`[D-195]` bare-string
    // generation shape. When present, each entry is either `null` or a fully-populated grounding
    // object; nothing partial is accepted, matching the "no believer behind it" defect F2.15
    // forbids typed rather than left to prose.
    if (q.distractorGrounding !== undefined) {
      if (!Array.isArray(q.distractorGrounding)) return false;
      for (const entry of q.distractorGrounding) {
        if (entry === null) continue;
        if (typeof entry !== 'object') return false;
        const g = entry as Record<string, unknown>;
        if (typeof g.believes !== 'string' || typeof g.source_says !== 'string') return false;
      }
    }
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
  if (v.sourceCitation !== undefined && !isInstrumentCitationShape(v.sourceCitation)) return false;
  if (v.sourceContentHash !== undefined && typeof v.sourceContentHash !== 'string') return false;
  return true;
}

/**
 * `InstrumentCitation`'s own shape (`sourcePath`, optional `page`/`section`) — not that module's
 * export (`isCitationRecord`, `olea-core`), which additionally requires `instrumentId` and
 * `schemaVersion`. `DraftRecord.sourceCitation` is the bare citation, minted before an
 * `instrumentId` exists to key it by.
 */
function isInstrumentCitationShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.sourcePath !== 'string' || c.sourcePath.length === 0) return false;
  if (c.page !== undefined && typeof c.page !== 'number') return false;
  if (c.section !== undefined && (typeof c.section !== 'string' || c.section.length === 0)) {
    return false;
  }
  return true;
}
