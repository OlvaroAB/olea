/**
 * `ol-0r92.38` (`[D-190]`, component register row 4.6's "Plus" clause) —
 * a health check that the retrospective note directory
 * (`.olea/retrospectives/`, `../../plugin/src/retrospective/note-writer.js`'s
 * `RETROSPECTIVE_NOTES_FOLDER` — not importable from here, INV-1's layering
 * keeps `packages/core` from depending on `packages/plugin`, so the literal
 * is duplicated at the call site and the coupling is stated in the caller's
 * own comment) sits outside the local block/full-text indexer's roots
 * (C6.2).
 *
 * **Why this needed a check at all.** `[D-190]`'s ruling is that nothing
 * consumes her kept retrospective line as input — "no component consumes
 * the kept note... as input; nothing reads it but her." The one real reader
 * that could accidentally start doing so is the local indexer: `buildFullIndex`
 * (`../keyword-index/build.js`, driven by `KeywordIndexEngine.rebuild`,
 * `../keyword-index/engine.ts:109`) calls `vault.list({ extensions: ['md'] })`
 * with **no `under` restriction** — the configured index root is the whole
 * vault, not some allow-listed subtree. The one thing standing between that
 * and indexing `.olea/retrospectives/` is a structural property of both
 * `VaultSource` implementations' `list()`: `FolderSource.walk` explicitly
 * skips any dot-prefixed segment (`../vault/folder-source.ts`'s own comment:
 * "never part of the vault's content surface"), and `ObsidianSource.list()`
 * is built on `vault.getFiles()`, which — per that class's own doc —
 * "never returns dot-prefixed paths at all... a real host limitation, not a
 * choice this file makes." Today's "never read" is therefore true because
 * there is no reader, not because any parser stops at a heading — exactly
 * the distinction the register row names. A future change to the indexer's
 * configured roots (an explicit `under: '.olea'` somewhere, or a rewritten
 * walk that stops skipping dot segments) could silently start reading her
 * free text, and nothing today would notice.
 *
 * **What this check tests, and what it deliberately does not.** It re-states
 * the dot-segment-skip rule as a pure predicate over paths — the same rule
 * both `list()` implementations apply — and asks: starting a walk that obeys
 * that rule from each of the indexer's configured roots, would the
 * retrospective directory (or anything under it) ever be enumerated? This is
 * a structural check on **paths**, not a behavioural test against a real
 * `FolderSource`/`ObsidianSource` — the two already agree on the rule (see
 * above), so re-deriving it here catches a *regression* in either one
 * (or in the indexer's own configuration) without needing a live vault.
 * Following this directory's own "check compares, harness runs" split
 * (`./types.js`), the harness (`olea-service`'s
 * `scripts/harness/algorithm-checks.mjs`, id `4.6-retrospective-outside-index`)
 * is what states today's real configured root (the whole vault, `''`, per
 * `engine.ts:109`'s call with no `under`) — this module does no I/O and reads
 * no configuration itself.
 *
 * **This check can fail, on purpose (N-013).** If the indexer's roots were
 * ever reconfigured to include `.olea` itself (`under: '.olea'`, or a walk
 * rewritten to stop skipping dot segments), this reports the retrospective
 * directory as reachable — a real finding, not something to special-case
 * away. See `.spec.ts` for the case that exercises exactly that.
 */
import type { VaultPath } from '../vault/types.js';
import type { CheckVerdict } from './types.js';

export interface RetrospectiveOutsideIndexMeasured {
  readonly retrospectiveDirectory: VaultPath;
  readonly rootsChecked: readonly VaultPath[];
  /** Configured roots whose dot-segment-skipping walk would reach the retrospective directory — empty when the guarantee holds. */
  readonly reachableFrom: readonly VaultPath[];
}

/**
 * Would a walk starting at `root` and skipping every dot-prefixed path
 * segment (`FolderSource.walk`'s rule, `ObsidianSource.list()`'s structural
 * host behaviour) ever enumerate `target` or anything under it?
 *
 * `root === ''` means "the whole vault" (today's real configured root — see
 * this module's own doc). A `target` that is not a subtree of `root` at all
 * is trivially unreachable *from that root* — this only matters when the
 * caller checks several roots, one of which may not contain the directory
 * at all.
 */
function isReachableByDotSkippingWalk(root: VaultPath, target: VaultPath): boolean {
  const rootSegments = root === '' ? [] : root.split('/');
  const targetSegments = target.split('/');

  for (let i = 0; i < rootSegments.length; i += 1) {
    if (targetSegments[i] !== rootSegments[i]) {
      // `target` is not under `root` at all — this root never reaches it,
      // reachable or not.
      return false;
    }
  }

  // Every segment of `target` from immediately below `root` onward is what
  // the walk would have to descend through (or land on) to reach it. A dot
  // prefix on ANY of those segments — not just the first — means the walk
  // never gets there, matching both implementations skipping a dot-directory
  // encountered at any depth.
  const relativeSegments = targetSegments.slice(rootSegments.length);
  return relativeSegments.every((segment) => !segment.startsWith('.'));
}

/**
 * `indexRoots` — the vault-relative roots the local block/full-text indexer
 * is actually configured to scan (already-computed by the caller; this
 * function does no I/O and reads no configuration itself, per `./types.js`).
 * `retrospectiveDirectory` — `.olea/retrospectives/` in production; passed in
 * rather than hardcoded because the canonical constant lives in
 * `packages/plugin` and INV-1 forbids this package importing it.
 *
 * Fails (N-013) on zero roots supplied — a check that verified nothing
 * cannot pass — and fails on any root whose dot-segment-skipping walk would
 * reach the directory. Passes only when every configured root is blocked
 * from reaching it, honestly reporting a reconfigured indexer that removes
 * the dot-skip or points `under` inside `.olea` as the real finding it is,
 * rather than special-casing it away.
 */
export function checkRetrospectiveOutsideIndex(
  indexRoots: readonly VaultPath[],
  retrospectiveDirectory: VaultPath,
): CheckVerdict<RetrospectiveOutsideIndexMeasured> {
  const rootsChecked = [...indexRoots];
  const reachableFrom = rootsChecked.filter((root) =>
    isReachableByDotSkippingWalk(root, retrospectiveDirectory),
  );

  const measured: RetrospectiveOutsideIndexMeasured = {
    retrospectiveDirectory,
    rootsChecked,
    reachableFrom,
  };

  if (rootsChecked.length === 0) {
    return { ok: false, measured, detail: 'zero index roots supplied — nothing was checked' };
  }
  if (reachableFrom.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${retrospectiveDirectory} would be enumerated by the indexer's walk from root(s): ${reachableFrom.join(', ')} — the "never read" guarantee (D-190) is broken`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `${retrospectiveDirectory} sits outside every configured index root (${rootsChecked.length} checked) — its own dot-prefixed segment is skipped by the walk that would otherwise reach it`,
  };
}
