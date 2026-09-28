/**
 * A fixed-seed `RandomSource` (`olea-core`'s `{ next(): number }` contract).
 *
 * ## Why this file exists (found by WB-2, `ol-z6x2`, while wiring visual regression)
 *
 * `packages/plugin`'s `adaptReviewQueue` documents its `random` field as
 * "Injected for deterministic tests. Production takes the default, which is
 * `Math.random`." — a seam built for exactly this. `queue/derive.ts`'s
 * `itemsOfType` called `adaptReviewQueue` with no `random`, so every MCQ
 * state's option sampling and shuffling (F2.15, `presentMcq`) drew from live
 * `Math.random()`, once per page load.
 *
 * That contradicts this package's own documented promise —
 * `scenarios.ts`'s header: "Determinism is deliberate: a fixed clock,
 * deterministic prior scheduling states, deterministic event ids, and
 * index-based instrument picks... A screenshot taken twice is the same
 * screenshot." The clock, the prior state and the event ids all held; MCQ
 * presentation did not. Found by loading `#/review/mcq-open` three times
 * against the same built artifact and diffing the four option labels in the
 * DOM — they differed on every load.
 *
 * This closes the gap through the seam that was already built for it, rather
 * than adding a new one: `deriveWorkbenchQueue` now threads one
 * `createDeterministicRandom()` instance through every `adaptReviewQueue`
 * call it makes, so the sequence of draws — and therefore every MCQ state's
 * rendered options — is identical on every load of the same URL.
 *
 * mulberry32: a small, public-domain, dependency-free PRNG (Tommy Ettinger).
 * Nothing about the seed or the algorithm needs to be unpredictable — the
 * whole point is that two runs draw the *same* sequence, not a hard-to-guess
 * one.
 */

import type { RandomSource } from 'olea-core';

/** Arbitrary and fixed. Its only property that matters is that it never changes. */
const FIXED_SEED = 0x0a1e_a75c;

export function createDeterministicRandom(seed: number = FIXED_SEED): RandomSource {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * A realm whose global `Math` the override replaces — `globalThis` itself, or
 * another same-origin window (the simulator's host `<iframe>`).
 */
export interface MathRealm {
  Math: Math;
}

/**
 * Installs a page-level override of `Math.random` for the simulator's whole
 * mounted lifetime and returns the function that restores the real one
 * (`ol-egov.141.89.45`, `ol-egov.141.89.51`).
 *
 * Why a global override here rather than one more per-call `random` seam:
 * `queue/derive.ts` and `simulator/live-queue.ts` (above) already thread
 * `createDeterministicRandom()` through `olea-core#adaptReviewQueue` for this
 * package's own synthetic queue composition, but `tour.spec.ts`'s generic
 * ribbon walk also opens the REAL plugin `ReviewView` — whose composition
 * path (`packages/plugin/src/main.ts`'s `buildReviewSessionInput` →
 * `review/open-session.ts`'s `openReviewSession` → `review/queue-adapter.ts`
 * → `olea-core#presentMcq`) never sets `random` and so keeps production's
 * correct default, live `Math.random`. Wiring a `random` parameter all the
 * way down that chain is `packages/plugin` production-source work this
 * package does not own; this override reaches the same result without
 * editing a single line of `packages/plugin` or `packages/core`.
 *
 * ## One stream per call site, not one shared sequence (`ol-egov.141.89.51`)
 *
 * The first version drew every `Math.random()` on the page from ONE shared
 * sequence. That made each draw's value depend on how many draws ANY other
 * code had made before it — and some of those are timing-dependent: the
 * plugin's device-id generator (`device/device-id.ts`) draws when a fresh
 * plugin-data blob has no id yet, from whichever async caller gets there
 * first, and the ingestion engine's pacing jitter (`olea-core`'s
 * `ingestion/engine.ts`) draws per retry. Measured in the built simulator:
 * opening the review view after a reset makes 14 draws from two sites (2 from
 * device-id generation, 12 from `presentMcq`'s default source). One extra or
 * one missing unrelated draw shifts every option order after it, so an MCQ
 * golden could change because of a change nowhere near the MCQ.
 *
 * Each call site therefore gets its OWN fixed-seed stream, keyed by the
 * caller's stack frame (script path, line and column — the origin and any
 * query string are stripped, so the port a test server happens to bind never
 * enters the key). `presentMcq`'s shuffle now draws the same values in the
 * same order however many draws any other site makes, and in whatever order
 * the two interleave. Within one built bundle the key is stable across runs
 * and machines; a rebuild that moves the call site may change which fixed
 * stream it draws from, which is the same "the golden moves with the code"
 * contract every other capture already has.
 *
 * ## Every realm, not just this one (`ol-egov.141.89.51`)
 *
 * `realms` defaults to `[globalThis]`; the simulator also passes its host
 * `<iframe>`'s window, whose `Math` is a separate object by spec. Measured:
 * no code draws from the frame's realm today — the plugin's modules are
 * evaluated in this (top) realm and only render into the frame's document,
 * so the frame's own `Math.random` was called zero times across a reset and
 * a review open. It is overridden anyway so that a draw from that realm can
 * never escape the fixed streams if that ever changes.
 *
 * Same install/uninstall convention `simulator/controller.ts`'s own
 * `installTransportBridge` already uses for `globalThis.fetch`: install once
 * in `SimulatorController.create()`, before `remountPane()` ever mounts the
 * plugin; call the returned function from `dispose()` so every realm's real
 * `Math.random` is restored the instant the simulator route is left, and no
 * other route or test on the same page is ever affected.
 */
export function installDeterministicMathRandomOverride(
  realms: readonly MathRealm[] = [globalThis],
  seed: number = FIXED_SEED,
): () => void {
  const streams = new Map<string, RandomSource>();
  const draw = (): number => {
    const key = callSiteKey(new Error().stack);
    let stream = streams.get(key);
    if (stream === undefined) {
      stream = createDeterministicRandom((seed ^ hashString(key)) >>> 0);
      streams.set(key, stream);
    }
    return stream.next();
  };
  const restores: Array<() => void> = [];
  const seen = new Set<Math>();
  for (const realm of realms) {
    const math = realm.Math;
    if (seen.has(math)) continue;
    seen.add(math);
    const original = math.random;
    math.random = draw;
    restores.push(() => {
      math.random = original;
    });
  }
  return () => {
    for (const restore of restores) restore();
  };
}

/**
 * The frame that called `Math.random()`, read from a stack captured INSIDE
 * the override: V8 writes an `Error` header line, then the override's own
 * frame, then its caller; engines without the header start at the override's
 * frame. `https://host:port` and any `?query` are stripped so the key names
 * the script and position only. An unavailable stack collapses every draw
 * onto one stream — the previous behaviour, never a throw.
 */
export function callSiteKey(stack: string | undefined): string {
  if (stack === undefined) return '';
  const lines = stack.split('\n');
  const callerIndex = lines[0]?.startsWith('Error') === true ? 2 : 1;
  const frame = lines[callerIndex]?.trim() ?? '';
  return frame.replace(/[a-z][a-z0-9+.-]*:\/\/[^/\s)]*/gi, '').replace(/\?[^:\s)]*/g, '');
}

/** FNV-1a over UTF-16 code units — a stable, dependency-free string hash for seeding one stream per key. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
