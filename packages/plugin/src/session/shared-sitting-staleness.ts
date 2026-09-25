/**
 * `ol-egov.141.89.10.14` (C5.8, `[D-162]`, `[D-193]`/`[D-241]`) — the one
 * piece of `main.ts`'s `enterStudySessionHolderForStart` wiring that is more
 * than a call, pulled out here so it can be driven directly under Vitest:
 * `main.ts` imports `obsidian` and cannot be loaded in this package's test
 * runner at all (every `test/main-wiring.spec.ts` file's own module doc), so
 * a source-level regex pin is the only instrument reaching the CALL shape,
 * and cannot exercise the branching itself.
 *
 * What this answers: given the shared session holder's own frozen sitting
 * scope and its initial snapshot (`main.ts`'s `sharedSittingFrozenScope`/
 * `sharedSittingFrozenSnapshot` fields — that doc explains why those two are
 * always current for whichever sitting is active, regardless of which
 * surface entered it), what real `SittingStalenessInput` should
 * `StudySessionHolder.decide` be handed right now?
 *
 * This is deliberately the SAME computation `session-builder/provider.ts`'s
 * own `load()` runs for ITS OWN sitting (`ol-v7r5.26`, `ol-egov.141.89.10.46`
 * exported `buildScopeSnapshotAt` for exactly this reuse) — one definition
 * of `[D-162]`'s three facts, never two independently-drifting ones
 * (`[D-033]`). Both the idle-threshold precheck (skip the light `firstSeen`
 * work when nowhere near the threshold — `decideRebuild` would ignore
 * `staleness` before it anyway, since the freeze holds unconditionally until
 * then) and the honest-zeros fallback when nothing has been frozen yet
 * mirror `provider.ts`'s own `load()` line for line.
 */

import {
  DEFAULT_SITTING_IDLE_THRESHOLD_MS,
  diffSittingScopeSnapshots,
  EMPTY_SITTING_SCOPE_SNAPSHOT,
  type SittingScopeSnapshot,
  type SittingStalenessInput,
  type VaultPath,
} from 'olea-core';
import { buildScopeSnapshotAt, type FrozenSittingScope } from '../session-builder/provider.js';
import { localToday } from '../today/data-source.js';

/** The honest-zeros reading: no material change has been observed (or can be, yet) — the same reading `provider.ts`'s own `load()` gives before the idle threshold, or when nothing has been frozen. */
const NO_STALENESS: SittingStalenessInput = {
  itemsDueInScope: false,
  materialArrivedInScope: false,
  assessmentProximityBandCrossedInScope: false,
};

/**
 * `main.ts`'s `sharedSittingFrozenScope`/`sharedSittingFrozenSnapshot` pair,
 * for whichever sitting the shared holder currently carries — `undefined`
 * exactly when nothing has been composed for it yet.
 */
export interface SharedSittingFreeze {
  readonly frozenScope: FrozenSittingScope | undefined;
  readonly frozenSnapshot: SittingScopeSnapshot | undefined;
}

/**
 * Real `SittingStalenessInput` facts for the shared holder's active sitting,
 * or {@link NO_STALENESS} when the idle threshold has not passed yet
 * (`DEFAULT_SITTING_IDLE_THRESHOLD_MS`, the same gate `decideRebuild` itself
 * applies — this is an optimization against the unneeded `firstSeen` work,
 * not a second, different threshold) or nothing was ever frozen for this
 * sitting (`freeze.frozenScope === undefined`).
 *
 * `enteredAt`/`now` are the caller's own clock readings (INV-1 discipline —
 * no clock read in here), matching `sitting.enteredAt` and the instant
 * `enterStudySessionHolderForStart` is itself called at.
 */
export async function computeSharedSittingStaleness(
  freeze: SharedSittingFreeze,
  enteredAt: Date,
  now: Date,
  firstSeen?: (path: VaultPath) => Promise<number | null> | number | null,
): Promise<SittingStalenessInput> {
  const elapsedMs = now.getTime() - enteredAt.getTime();
  if (elapsedMs < DEFAULT_SITTING_IDLE_THRESHOLD_MS || freeze.frozenScope === undefined) {
    return NO_STALENESS;
  }
  return diffSittingScopeSnapshots(
    freeze.frozenSnapshot ?? EMPTY_SITTING_SCOPE_SNAPSHOT,
    await buildScopeSnapshotAt(freeze.frozenScope, localToday(now), firstSeen),
  );
}
