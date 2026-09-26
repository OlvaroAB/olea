/**
 * `extractChangedRegions` — `[D-293]`'s decision-input half (`chg.md` §2,
 * §3, §7): the materiality judgment is meant to receive the CHANGED REGIONS
 * of a revision, with surrounding context, instead of two whole documents
 * with no size bound, as today's `MaterialityJudge`/`RevisionJudgePort`
 * still send (`packages/plugin/src/ingestion/materiality/types.ts`'s
 * `MaterialityJudgeInput`, this directory's `RevisionJudgeInput`).
 *
 * **Pure logic only, per `chg.md` §8 ("Pure logic first: the changed-region
 * extractor with context (core)... each with unit tests. Then the harness
 * runner...").** This module never reads a store, never calls a judge, and
 * has no opinion on which dependant is asking — see
 * `packages/plugin/src/ingestion/materiality/wiring.ts`'s
 * `buildRegionAwareMaterialityRequest` for where a caller pairs this
 * function's output with `ChangedRegionPurpose` and the live judge port.
 *
 * **Not yet reachable from the live paid judge call**
 * (`materiality/wiring.ts`'s `dispatchJudgeAndCommit`, which still sends
 * whole `previousText`/`currentText` to `MaterialityJudge.judge` — see that
 * function's own doc). `[D-293]`'s own close reason: "approved as proposed
 * on this bead, with the wiring still waiting on the chain's benchmark
 * report (the benchmark-and-wire bead runs the benchmark before it wires
 * anything). If the benchmark does not support the change, the wiring bead
 * says so and this ruling is revisited rather than applied." `chg.md` §7
 * names that bead explicitly: "[D-293]... gates the wiring ([ILB-CHG-5])."
 * Flipping the live call ahead of that benchmark would also require a new
 * `materiality.judge` task version (`olea-service`'s
 * `prompts/materiality.judge/VERSION` is `1.0.0`, a whole-document request
 * shape) — a wire-contract change this bead does not have standing to make
 * unprompted. This module and `buildRegionAwareMaterialityRequest` exist so
 * `[ILB-CHG-5]`'s benchmark (and its `scripts/harness/ilb-chg/` runner, a
 * different lane's owns) has something concrete to score against the
 * incumbent whole-document request, per `chg.md` §8's "prepare renders the
 * incumbent request and the target request."
 *
 * ## Algorithm
 * Lines are diffed with a classic LCS (longest common subsequence) over
 * line arrays. This is O(previousLines * currentLines) time and space,
 * bounded by `MAX_DIFF_CELLS` below (a vault note is small; the bound is a
 * safety net, not a tuning target) — above that bound the whole text is
 * treated as one changed region rather than attempting the exact diff,
 * which is never WRONG, only less compressed than usual.
 *
 * The diff naturally decomposes into an alternating sequence of maximal
 * EQUAL line-runs and the CHANGE gaps between them (a gap may be
 * insert-only, delete-only, or both). Two change gaps separated by an equal
 * run of at most `mergeGapLines` lines are merged into one region — a
 * paragraph edited in two nearby spots reads as one region, not two the
 * judge would have to stitch back together itself, and folds that short
 * equal run into the region's own body rather than treating it as mere
 * context. Each final region is then padded with up to `contextLines`
 * unchanged lines on both sides, taken from the equal run immediately
 * before and after it (clamped at the ends of either revision).
 */

export type ChangedRegionPurpose = 'note-concepts' | 'cited-passage';

export interface ChangedRegion {
  /** 0-based, exclusive-end line range in `previousText`, context lines included. */
  readonly previousStartLine: number;
  readonly previousEndLine: number;
  /** 0-based, exclusive-end line range in `currentText`, context lines included. */
  readonly currentStartLine: number;
  readonly currentEndLine: number;
  /** This region's text in the previous revision, context lines included. */
  readonly previousText: string;
  /** This region's text in the current revision, context lines included. */
  readonly currentText: string;
}

export interface ChangedRegionOptions {
  /** Unchanged lines of context kept on each side of a changed run. Default 2. */
  readonly contextLines?: number;
  /**
   * Two changed runs separated by at most this many unchanged lines are
   * merged into one region. Default: twice `contextLines`, so two regions
   * whose own context windows would have overlapped anyway read as one.
   */
  readonly mergeGapLines?: number;
}

export interface ExtractChangedRegionsInput {
  readonly previousText: string;
  readonly currentText: string;
  readonly options?: ChangedRegionOptions | undefined;
}

const DEFAULT_CONTEXT_LINES = 2;

/**
 * `previousLines * currentLines` above which the exact LCS diff is skipped
 * in favour of one whole-text region (see module doc). 4,000,000 cells is
 * roughly a 2,000-line note diffed against another 2,000-line note —
 * comfortably past any real Obsidian note, so this bound is never expected
 * to fire in practice; it exists so this function's worst case is bounded
 * regardless of input size, never so a caller can rely on it as a size
 * limit.
 */
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\r|\n/);
}

type DiffOp =
  | { readonly kind: 'equal'; readonly previousLine: number; readonly currentLine: number }
  | { readonly kind: 'delete'; readonly previousLine: number }
  | { readonly kind: 'insert'; readonly currentLine: number };

/**
 * Classic LCS line diff via backward dynamic programming plus a forward
 * backtrack. `dp[i][j]` is the LCS length of `previous[i..]`/`current[j..]`.
 * Falls back to "delete everything, then insert everything" (one big
 * changed region, no equal runs) above `MAX_DIFF_CELLS` — see that
 * constant's doc.
 */
function diffLines(previous: readonly string[], current: readonly string[]): readonly DiffOp[] {
  const n = previous.length;
  const m = current.length;
  if (n * m > MAX_DIFF_CELLS) {
    const ops: DiffOp[] = [];
    for (let i = 0; i < n; i++) ops.push({ kind: 'delete', previousLine: i });
    for (let j = 0; j < m; j++) ops.push({ kind: 'insert', currentLine: j });
    return ops;
  }
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  // Every index below is in range by construction (`i`/`j` never leave
  // `[0, n]`/`[0, m]`, and `dp` has exactly `n + 1` rows of `m + 1` cells,
  // all populated by the loop just above) — `!` documents that, it does not
  // create it.
  for (let i = n - 1; i >= 0; i--) {
    const dpI = dp[i]!;
    const dpI1 = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      dpI[j] = previous[i] === current[j] ? dpI1[j + 1]! + 1 : Math.max(dpI1[j]!, dpI[j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (previous[i] === current[j]) {
      ops.push({ kind: 'equal', previousLine: i, currentLine: j });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'delete', previousLine: i });
      i++;
    } else {
      ops.push({ kind: 'insert', currentLine: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: 'delete', previousLine: i });
    i++;
  }
  while (j < m) {
    ops.push({ kind: 'insert', currentLine: j });
    j++;
  }
  return ops;
}

/** A maximal run of consecutive equal ops, in both revisions' own line-index space. */
interface EqualSegment {
  readonly previousStart: number;
  readonly previousEnd: number;
  readonly currentStart: number;
  readonly currentEnd: number;
}

/** Groups `diffLines`'s flat op list into its maximal equal runs, bracketed by a zero-length virtual segment at each end so every changed span — including a leading or trailing one with no adjacent equal run — is the gap between two consecutive entries of this list. */
function equalSegments(
  ops: readonly DiffOp[],
  previousLineCount: number,
  currentLineCount: number,
): readonly EqualSegment[] {
  const segments: EqualSegment[] = [
    { previousStart: 0, previousEnd: 0, currentStart: 0, currentEnd: 0 },
  ];
  let index = 0;
  while (index < ops.length) {
    if (ops[index]!.kind !== 'equal') {
      index++;
      continue;
    }
    const start = index;
    while (index < ops.length && ops[index]!.kind === 'equal') index++;
    const first = ops[start] as { readonly previousLine: number; readonly currentLine: number };
    const last = ops[index - 1] as { readonly previousLine: number; readonly currentLine: number };
    segments.push({
      previousStart: first.previousLine,
      previousEnd: last.previousLine + 1,
      currentStart: first.currentLine,
      currentEnd: last.currentLine + 1,
    });
  }
  segments.push({
    previousStart: previousLineCount,
    previousEnd: previousLineCount,
    currentStart: currentLineCount,
    currentEnd: currentLineCount,
  });
  return segments;
}

interface RawRegion {
  previousStart: number;
  previousEnd: number;
  currentStart: number;
  currentEnd: number;
}

export function extractChangedRegions(
  input: ExtractChangedRegionsInput,
): readonly ChangedRegion[] {
  const previousLines = splitLines(input.previousText);
  const currentLines = splitLines(input.currentText);
  const contextLines = input.options?.contextLines ?? DEFAULT_CONTEXT_LINES;
  const mergeGapLines = input.options?.mergeGapLines ?? contextLines * 2;

  const ops = diffLines(previousLines, currentLines);
  const segments = equalSegments(ops, previousLines.length, currentLines.length);

  // One raw region per gap between consecutive equal segments (real or
  // virtual). Internal gaps (neither segment virtual) are never degenerate —
  // two consecutive MAXIMAL equal runs always have at least one changed line
  // between them, or they would already be one run. Only the very first and
  // very last gap (touching a virtual bookend) can be degenerate, when the
  // text starts or ends on an equal run.
  const rawRegions: RawRegion[] = [];
  // `sepLength[k]` is the length (in lines) of the equal segment separating
  // `rawRegions[k-1]` from `rawRegions[k]` — `segments[k]` itself, since
  // `rawRegions[k]` sits between `segments[k]` and `segments[k+1]`.
  const sepLength: number[] = [];
  for (let k = 0; k < segments.length - 1; k++) {
    // `k` and `k + 1` are always in `[0, segments.length - 1]` by the loop
    // bound above.
    const before = segments[k]!;
    const after = segments[k + 1]!;
    const region: RawRegion = {
      previousStart: before.previousEnd,
      previousEnd: after.previousStart,
      currentStart: before.currentEnd,
      currentEnd: after.currentStart,
    };
    const isDegenerate = region.previousStart === region.previousEnd && region.currentStart === region.currentEnd;
    const touchesBookend = k === 0 || k === segments.length - 2;
    if (isDegenerate && touchesBookend) continue;
    if (rawRegions.length > 0) sepLength.push(before.previousEnd - before.previousStart);
    rawRegions.push(region);
  }

  if (rawRegions.length === 0) return [];

  // Merge consecutive raw regions whose separating equal run is short
  // enough that their own context windows would have overlapped anyway.
  // `rawRegions.length === 0` already returned above, so `rawRegions[0]!`
  // below is non-empty; every other index in this loop is bounded by the
  // `for` condition or by `merged.length - 1` with `merged` non-empty.
  const merged: RawRegion[] = [rawRegions[0]!];
  for (let k = 1; k < rawRegions.length; k++) {
    const region = rawRegions[k]!;
    if (sepLength[k - 1]! <= mergeGapLines) {
      const last = merged[merged.length - 1]!;
      last.previousEnd = region.previousEnd;
      last.currentEnd = region.currentEnd;
    } else {
      merged.push(region);
    }
  }

  return merged.map((region) => {
    const previousStartLine = Math.max(0, region.previousStart - contextLines);
    const previousEndLine = Math.min(previousLines.length, region.previousEnd + contextLines);
    const currentStartLine = Math.max(0, region.currentStart - contextLines);
    const currentEndLine = Math.min(currentLines.length, region.currentEnd + contextLines);
    return {
      previousStartLine,
      previousEndLine,
      currentStartLine,
      currentEndLine,
      previousText: previousLines.slice(previousStartLine, previousEndLine).join('\n'),
      currentText: currentLines.slice(currentStartLine, currentEndLine).join('\n'),
    };
  });
}
