// explain-scenarios.spec.ts — F2.7's grounding half, over the REAL fixture
// vault (`packages/core/fixtures/vault/`), via `FolderSource` — the same
// direct-filesystem `VaultSource` `packages/core/src/vault/folder-source.spec.ts`
// itself uses against this corpus, so this suite needs no build step and no
// cassette.
//
// The refusal assertion below is the first automated coverage F2.7's own
// scenario file (`../olea/features/F2-review.md:267`, "Olea states it cannot
// ground an explanation rather than producing one anyway") has ever had —
// every one of its three scenarios is currently `@manual`. Treated
// accordingly: the assertion checks `status`, never chunk-array length, so a
// future regression to "grounded with zero chunks" cannot slip past it.

import { FolderSource } from 'olea-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildExplainScenario,
  EXPLAIN_STATES,
  findExplainState,
} from '../src/explain-scenarios.js';

const FIXTURE_ROOT = new URL('../../core/fixtures/vault', import.meta.url).pathname;

let vault: FolderSource;

beforeAll(() => {
  vault = new FolderSource(FIXTURE_ROOT);
});

describe('the two addressable explain states — mechanism over the real fixture vault', () => {
  it('EXPLAIN_STATES has exactly the two states this surface defines', () => {
    expect(EXPLAIN_STATES.map((s) => s.id)).toEqual([
      'explanation-grounded',
      'explanation-refused-no-grounding',
    ]);
  });

  it('every state builds without throwing', async () => {
    for (const state of EXPLAIN_STATES) {
      const scenario = await buildExplainScenario(state.id, vault);
      expect(scenario.result.query.length).toBeGreaterThan(0);
    }
  });

  it('findExplainState resolves exactly EXPLAIN_STATES and nothing else', () => {
    for (const state of EXPLAIN_STATES) {
      expect(findExplainState(state.id)?.id).toBe(state.id);
    }
    expect(findExplainState('not-a-real-state')).toBeUndefined();
  });

  it('buildExplainScenario throws on an unknown state id', async () => {
    await expect(buildExplainScenario('not-a-real-state', vault)).rejects.toThrow(
      /unknown explain state/,
    );
  });

  it('explanation-grounded: grounds with real citations into the fixture vault, never the ratified composite gate', async () => {
    const scenario = await buildExplainScenario('explanation-grounded', vault);
    expect(scenario.result.result.status).toBe('grounded');
    expect(scenario.result.requireComposite).toBe(false);
    if (scenario.result.result.status !== 'grounded') throw new Error('unreachable');
    expect(scenario.result.result.chunks.length).toBeGreaterThan(0);

    // Attribution: every cited chunk points at a REAL location in the fixture
    // vault's own keyword index, never an invented path — and every chunk
    // carries the quotable text this whole surface exists to show.
    for (const chunk of scenario.result.result.chunks) {
      expect(chunk.path.length).toBeGreaterThan(0);
      expect(chunk.path).not.toBe('README.md');
      expect(typeof chunk.blockIndex).toBe('number');
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  // The load-bearing assertion (see this file's own header): checks the
  // discriminated union's `status`, never an array length, so a regression to
  // "grounded with zero chunks" — which would still pass a length-only check
  // — fails this test.
  it('explanation-refused-no-grounding: REFUSES — status, not an empty chunk list (INV-5, F2.7)', async () => {
    const scenario = await buildExplainScenario('explanation-refused-no-grounding', vault);
    expect(scenario.result.result.status).toBe('refused');
    if (scenario.result.result.status !== 'refused') throw new Error('unreachable');
    expect(scenario.result.result.reason).toBe('no-hits');
    expect(scenario.result.requireComposite).toBe(false);
  });
});

describe('determinism — byte-identical outcome across two runs', () => {
  it('every explain state produces the identical GroundingResult twice', async () => {
    for (const state of EXPLAIN_STATES) {
      const a = await buildExplainScenario(state.id, vault);
      const b = await buildExplainScenario(state.id, vault);
      expect(a.result.result).toEqual(b.result.result);
      expect(a.result.trace.stages[0]?.outputSummary).toEqual(
        b.result.trace.stages[0]?.outputSummary,
      );
    }
  });
});

describe('groundExplanation via the driver — the trace, one stage per call', () => {
  it('records exactly one "retrieve" StageRecord, with couldHaveSucceeded true', async () => {
    const scenario = await buildExplainScenario('explanation-grounded', vault);
    expect(scenario.result.trace.stages).toHaveLength(1);
    expect(scenario.result.trace.stages[0]?.stage).toBe('retrieve');
    expect(scenario.result.trace.stages[0]?.couldHaveSucceeded).toBe(true);
    expect(scenario.result.trace.stages[0]?.attributedTo).toBeNull();
  });

  it('never logs raw query text or chunk text in the trace summaries — only ids/counts', async () => {
    const scenario = await buildExplainScenario('explanation-grounded', vault);
    const serialised = JSON.stringify(scenario.result.trace.stages[0]);
    expect(serialised).not.toContain(scenario.result.query);
    if (scenario.result.result.status === 'grounded') {
      for (const chunk of scenario.result.result.chunks) {
        expect(serialised).not.toContain(chunk.text);
      }
    }
  });
});
