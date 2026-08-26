/**
 * Types for the materiality trigger (register row 1.4, `TRG-1`, `ol-tqy3`).
 *
 * Row 1.4's own shape: "two stages — a free content hash over every vault
 * file, then, for changed files, a cheap model judgement asking whether the
 * change says anything new about the concepts it touches." Everything in
 * this directory implements exactly that split: `trigger.ts`'s
 * `evaluateMaterialityGate` is the free stage (hashing, debounce, the
 * minimum-edit-size floor); `MaterialityJudge` below is the seam the paid
 * second stage plugs into. **No `MaterialityJudge` implementation is built
 * here** — see `wiring.ts`'s module doc for why, and what remains.
 */

/** Raw and canonicalised content hashes for one observed version of a file's text. */
export interface MaterialityHashes {
  readonly rawHash: string;
  readonly canonicalHash: string;
}

/** What this module persists per vault path between evaluations. */
export interface MaterialityRecord {
  readonly path: string;
  readonly hashes: MaterialityHashes;
  /**
   * Length, in characters, of the canonicalised text these hashes were
   * computed from. Kept instead of the text itself so this cache stays a
   * bookkeeping record (hash + length), never a second copy of her material
   * — the minimum-edit-size floor only needs a size signal, and a length
   * delta is that signal without retaining content.
   */
  readonly canonicalLength: number;
  /** Epoch ms this path was last observed changing (raw hash differed from the record then current). */
  readonly lastChangedAt: number;
  /** Epoch ms a verdict (material or not) was last committed for this path, or `null` before the first one. */
  readonly lastVerdictAt: number | null;
}

/** Persistence port for `MaterialityRecord`s, one per vault path — mirrors `QueueStore`'s shape and reasoning (`olea-core`). */
export interface MaterialityHashStore {
  load(path: string): Promise<MaterialityRecord | null>;
  save(record: MaterialityRecord): Promise<void>;
}

/**
 * The row's second, paid stage: "a cheap model judgement asking whether the
 * change says anything new about the concepts it touches." A service call
 * by the row's own boundary ("hashing client, judgement service") — this
 * plugin package only ever holds the port, never a local stand-in that could
 * be mistaken for a real judgement.
 */
export interface MaterialityJudgeInput {
  readonly path: string;
  readonly previousText: string;
  readonly currentText: string;
}

export interface MaterialityJudgeVerdict {
  readonly material: boolean;
  /** Content-free (INV-3) — never her wording, only a short structural reason for logging/debugging. */
  readonly reason?: string | undefined;
}

export interface MaterialityJudge {
  judge(input: MaterialityJudgeInput): Promise<MaterialityJudgeVerdict>;
}

/**
 * What `evaluateMaterialityGate` decides before any judge call — see
 * `trigger.ts`. Every branch except `'call-judge'` means the judge is never
 * invoked for this evaluation.
 */
export type MaterialityGateOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'formatting-only' }
  | { readonly kind: 'debounced'; readonly resumeNotBefore: number }
  | { readonly kind: 'below-floor' }
  | { readonly kind: 'call-judge' };

/**
 * The row's `Out`: "a materiality verdict, read by the on-device work queue
 * (3.10), which schedules regeneration; the affected instrument is offered
 * an edit, never silently rewritten, at first presentation, preserving its
 * identity and review history." This event is what a consumer (3.10's queue,
 * the instrument review surface) would subscribe to — see `wiring.ts` for
 * why nothing in this plugin subscribes to it yet.
 */
export interface MaterialityVerdictEvent {
  readonly path: string;
  readonly at: number;
  readonly material: boolean;
  readonly reason?: string | undefined;
}
