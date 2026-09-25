/**
 * The clock `diagnostics-clipboard.ts` stamps its report's `generatedAt` from — pulled into its
 * own pure, Obsidian-free file so it can be unit-tested under Vitest (`ol-3ux7.64.26`).
 * `diagnostics-clipboard.ts` itself imports `obsidian`'s `Notice`/`Platform`/`apiVersion`, which
 * has no runtime under Vitest (`obsidian`'s own `package.json` declares `main: ""`) — that
 * file's own module doc names this as the reason it carries no test file. Nothing about the
 * clock seam needs that import, so it lives here instead, following the same
 * pure/impure split `diagnostics.ts`'s own module doc describes for the rest of the report.
 *
 * **Defaults to the real wall clock** (`() => new Date()`); production behaviour is byte-identical
 * to a bare `new Date().toISOString()` read until a call site threads a clock in. No production
 * call site does yet — `main.ts:1111`'s `copyDiagnostics` command constructs `DiagnosticsSources`
 * without a `now`, so `generatedAt` still reads real wall time there; threading `now: this.now`
 * at that one call site (main.ts is outside this bead's owns) would complete the wiring.
 */

/** Shape of the plugin's own clock (`OleaPlugin`'s `now: () => Date`, `main.ts:377`). */
export type DiagnosticsClock = () => Date;

/** Resolves an optional injected clock (defaulting to the real wall clock) to the ISO string `buildDiagnosticsReport`'s `generatedAt` field expects. */
export function resolveDiagnosticsGeneratedAt(now: DiagnosticsClock | undefined): string {
  const clock = now ?? ((): Date => new Date());
  return clock().toISOString();
}
