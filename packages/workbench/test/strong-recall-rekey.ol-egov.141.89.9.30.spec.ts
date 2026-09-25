/**
 * `ol-egov.141.89.9.30` (`[D-357]`): the `strong-recall-banner` scenario re-keys the generated
 * `FIXTURE_ORACLE_HISTORY` (content-derived stand-in keys) onto the scenario vault's permanent
 * concept keys at load, so the F2.21 proposal still fires on the composed item now that
 * `./queue/derive.ts` stamps — and fires under the permanent key, never the stand-in.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFsrsScheduler,
  OPAQUE_CONCEPT_KEY_PREFIX,
  PROVISIONAL_CONCEPT_KEY_PREFIX,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { deriveWorkbenchQueue } from '../src/queue/derive.js';
import { buildScenario } from '../src/scenarios.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'fixtures',
  'vault',
);

function freshVault(): MemoryVaultSource {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        out.set(
          relative(FIXTURE_ROOT, absolute).split(sep).join(posix.sep),
          new Uint8Array(readFileSync(absolute)),
        );
      }
    }
  };
  walk(FIXTURE_ROOT);
  return MemoryVaultSource.fromBytes(out);
}

describe('strong-recall-banner over permanent concept keys (ol-egov.141.89.9.30)', () => {
  it('the scenario targets an item keyed by the permanent key, and the proposal fires for it', async () => {
    const vault = freshVault();
    const scheduler = createFsrsScheduler();
    const queue = await deriveWorkbenchQueue({ vault, scheduler, entries: [] });
    const scenario = buildScenario({ vault, scheduler, queue, stateId: 'strong-recall-banner' });

    const target = scenario.deps.queue?.[0];
    if (target === undefined) throw new Error('the scenario queued nothing');
    const conceptIds = target.instrument.conceptIds;
    expect(conceptIds.every((id) => id.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`))).toBe(true);

    const decision = scenario.deps.evaluateStrongRecallProposal?.({ conceptIds });
    expect(decision?.shouldPropose).toBe(true);
    if (decision?.shouldPropose !== true) return;
    expect(decision.conceptId.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`)).toBe(false);
    expect(conceptIds).toContain(decision.conceptId);
  });
});
