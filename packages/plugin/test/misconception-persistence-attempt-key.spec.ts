/**
 * Bead: `olea-service`'s `ol-egov.141.89.6.17` — "misconception persistence
 * memoization is keyed on the instrument, dropping a second genuine
 * attempt's observations" — @auto:plugin/misconception-persistence-attempt-key.spec.
 *
 * `main.ts` imports `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all (see `main-wiring.spec.ts`'s own
 * module doc, which this file copies the source-level-assertion technique
 * from verbatim — including for a pure module-scope helper: extracting
 * `persistMisconceptionObservations`'s key computation into a standalone
 * function inside `main.ts` would not make it importable, since the whole
 * module fails to load, not just the class).
 *
 * What this file checks is that `acceptExplainBackGradingWithObservation`
 * keys the vault write it awaits — `persistMisconceptionObservations` —
 * on `context.attemptId ?? context.originInstrumentId`, the SAME fallback
 * `grading/wiring.ts`'s own `acceptExplainBackGradingWithObservation`
 * already uses for its own idempotency memo, rather than on
 * `context.originInstrumentId` alone. `originInstrumentId` is the
 * instrument's own id, the SAME value across every attempt she ever makes
 * at it; keying the memo on it collapses a SECOND genuine attempt at the
 * same instrument into "the same accept" and hands its caller the first
 * attempt's stale, already-resolved promise — no new
 * `appendMisconceptionEvent` calls, no new observations persisted. What
 * this file cannot check is that Obsidian then writes the events for real;
 * that stays covered by `grading/wiring.ts`'s own behavioural tests one
 * layer down, which already assert the equivalent fix for its memo
 * (`ol-0r92.94` [DOS-C1]).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Source with prose removed — a doc paragraph describing the fix must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

describe('persistMisconceptionObservations is keyed on the attempt, not the instrument', () => {
  it('acceptExplainBackGradingWithObservation passes the attempt-scoped key, falling back to the instrument only when no attemptId is present', () => {
    // The regression: a version of this call that passes bare
    // `context.originInstrumentId` collapses two genuine attempts at one
    // instrument into a single memoized promise.
    expect(main).toMatch(
      /persistMisconceptionObservations\(\s*context\.attemptId\s*\?\?\s*context\.originInstrumentId\s*,/,
    );
  });

  it('never calls persistMisconceptionObservations with originInstrumentId as the sole key argument', () => {
    // Guards against a future edit reintroducing the bare form even if the
    // fallback expression above is reworded elsewhere in the file.
    expect(main).not.toMatch(
      /persistMisconceptionObservations\(\s*context\.originInstrumentId\s*,/,
    );
  });

  it('the memo map get and set inside persistMisconceptionObservations read and write the same attempt-scoped parameter', () => {
    const fn = main.match(/private persistMisconceptionObservations\(([\s\S]*?)\n {2}\}/)?.[0];
    expect(fn, 'persistMisconceptionObservations body not found').toBeDefined();
    const body = fn as string;
    const param = body.match(/private persistMisconceptionObservations\(\s*(\w+):\s*string/)?.[1];
    expect(param, 'first parameter name not found').toBeDefined();
    expect(param).not.toBe('originInstrumentId');
    const getPattern = new RegExp(
      `persistedMisconceptionObservationsByAttempt\\.get\\(${param}\\)`,
    );
    const setPattern = new RegExp(`persistedMisconceptionObservationsByAttempt\\.set\\(${param},`);
    expect(body).toMatch(getPattern);
    expect(body).toMatch(setPattern);
  });
});
