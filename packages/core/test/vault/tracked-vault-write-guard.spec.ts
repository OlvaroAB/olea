// GUARD — `ol-egov.141.89.45` part 3: on 2026-09-26 a throwaway causal probe
// (a different lane's scratch script, run directly against the REAL tracked
// `packages/core/fixtures/vault` rather than a temp copy, to compare
// composition against "the fixture vault as committed") called production
// code that mints permanent concept keys (`stampConceptKeys: true`,
// `resolveConceptKeys` in `../../src/concept/key-store.ts`). The probe
// script itself was deleted afterward, but its SIDE EFFECT — 17 new
// `.olea/concepts/*.json` sidecar files — was left behind in the tracked
// fixture, silently, until `git status` next surfaced them as untracked.
//
// Every test file in this repo that reads the real fixture vault is already
// disciplined about this (copy-first via `mkdtemp`+`cp`, or `stampConceptKeys`
// left at its safe default) — see `production-callers.spec.ts`,
// `review/end-to-end.spec.ts`, `corpusRelationWiring.spec.ts`. The gap this
// guard closes is a ONE-OFF script or probe that skips that discipline
// entirely, which no per-file digest check can catch because it is not one
// of the disciplined files. This test is deliberately about the tracked
// fixture's state on disk, not about any one caller.
//
// Fails if `packages/core/fixtures/vault/.olea/` exists at all: the tracked
// fixture is synthetic, read-only material (INV-3, this repo's own
// "Footguns" — "The fixture vault is synthetic and must stay that way"), so
// a `.olea/` sidecar directory appearing there can only mean something
// wrote into the committed tree instead of a copy.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE_VAULT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('the tracked fixture vault is never written (guard, ol-egov.141.89.45)', () => {
  it('has no .olea/ sidecar directory on disk', () => {
    expect(existsSync(join(FIXTURE_VAULT, '.olea'))).toBe(false);
  });
});
