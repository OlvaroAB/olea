/**
 * The simulator's world descriptor (`ol-3ux7.64.14` [WBX-12],
 * `docs/dev/simulator-design.md` §7, F9.S6).
 *
 * Fetched once per mount from the dist root's `/simulator-world.json` — the
 * public `build.mjs` writes it for the fixture world (`{ world: 'fixture',
 * label: 'FIXTURE', asOf: <the date of WORKBENCH_NOW> }`); the private build
 * (WBX-3, outside this lane's `owns`) writes the real/persona ones (`world:
 * 'real'` or `'persona:<id>'`, `label: 'REAL (private)'` or `'PERSONA <id>'`,
 * its own snapshot's `asOf`). This module never invents a label the fetched
 * file did not say — a missing or malformed descriptor falls back to the
 * FIXTURE default and tells the caller so (`fallback: true`), rather than
 * silently pretending the file was read. `provenance-badge.ts`'s own doc:
 * this lane only ever CONSTRUCTS a `'FIXTURE'` world (INV-3 — no real-vault
 * or persona-vault content in the public repo), but the type accepts
 * whatever string a fetched descriptor carries, so a private dist's file
 * passes through unchanged.
 */

import { utcDate, WORKBENCH_NOW } from '../clock.js';

export interface SimulatorWorldDescriptor {
  /** `'fixture'`, `'real'`, or `'persona:<id>'` — never validated here, just carried through. */
  readonly world: string;
  /** The badge's own display text — `'FIXTURE'`, `'REAL (private)'`, or `'PERSONA <id>'`. */
  readonly label: string;
  /** `YYYY-MM-DD` — the snapshot day the simulated clock starts at on first open and after reset. */
  readonly asOf: string;
  /**
   * Persona worlds only (`ol-3ux7.64.15` [WBX-14]'s `world.json` shape,
   * `eval/data/persona-synthetic/worlds/README.md`) — carries the device id
   * `simulator-seed-events.json`'s records should be grouped and written
   * under (`seed-events.ts`'s `personaDeviceId`), so a persona's lived
   * history lands in the vault under the exact convention a real device's
   * own review log uses (`packages/core/src/review-log/path.ts`,
   * `reviewLogPath`). Untyped and unvalidated here — like `world` above,
   * this lane only ever constructs a descriptor with no `streamSpec` at all
   * (INV-3: no persona data in the public repo), so a malformed one can only
   * ever arrive from a private build this module has no way to inspect the
   * contents of; `seed-events.ts` extracts it defensively instead.
   */
  readonly streamSpec?: unknown;
}

export interface SimulatorWorldLoadResult {
  readonly descriptor: SimulatorWorldDescriptor;
  /** `true` when `/simulator-world.json` was missing, unreadable, or malformed and the FIXTURE fallback below was used instead. */
  readonly fallback: boolean;
}

/**
 * The built-in default — used only as a fallback, never as this lane's own
 * "real" answer (the public repo has no `/simulator-world.json` write path
 * other than `build.mjs`'s own, which writes exactly this shape). Kept as a
 * function rather than a module-level constant so a test importing this
 * module does not freeze `WORKBENCH_NOW`'s value into a value computed at
 * import time in a way that reads oddly under `vi.setSystemTime` elsewhere in
 * this package's suite — `WORKBENCH_NOW` is itself a fixed constant, so this
 * is cosmetic, not load-bearing, but matches the "compute it, do not cache
 * it above the function" style the rest of `simulator/` already uses.
 */
function fallbackDescriptor(): SimulatorWorldDescriptor {
  return { world: 'fixture', label: 'FIXTURE', asOf: utcDate(WORKBENCH_NOW) };
}

const ASOF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isWorldDescriptor(value: unknown): value is SimulatorWorldDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.world === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.asOf === 'string' &&
    ASOF_PATTERN.test(candidate.asOf)
  );
}

/** `descriptor.asOf` (`YYYY-MM-DD`) as local midnight — the same convention `SimulatorController.jumpToDate` already uses for a typed date from a string. */
export function parseWorldAsOf(descriptor: SimulatorWorldDescriptor): Date {
  return new Date(`${descriptor.asOf}T00:00:00`);
}

/**
 * Best-effort, never-throwing load of `/simulator-world.json` — a plain
 * static GET (anything under `dist/` is already served this way, no server
 * change needed, matching `controller.ts`'s own `loadReplayCassette` for the
 * generation cassette). `fetchFn` is the caller's captured ORIGINAL `fetch`,
 * for the same reason that module takes one: called before the transport
 * bridge is installed in `SimulatorController.create`, so in practice any
 * `fetch` works, but naming it explicitly keeps the call site honest about
 * which one it means.
 */
export async function loadSimulatorWorld(fetchFn: typeof fetch): Promise<SimulatorWorldLoadResult> {
  try {
    const response = await fetchFn('/simulator-world.json');
    if (!response.ok) return { descriptor: fallbackDescriptor(), fallback: true };
    const raw: unknown = await response.json();
    if (!isWorldDescriptor(raw)) return { descriptor: fallbackDescriptor(), fallback: true };
    return { descriptor: raw, fallback: false };
  } catch {
    return { descriptor: fallbackDescriptor(), fallback: true };
  }
}
