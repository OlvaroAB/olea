/**
 * Two overlapping mints for one outcome source (`ol-egov.141.89.104.53`, race 1) — **pinned as a
 * known race, not fixed**, because the fix needs a decision first.
 *
 * `resolveOutcome` lists `.olea/outcomes/`, looks for a record with the same source (note path and
 * block index), and mints one only when there is none. The listing reads every record file and the
 * mint writes a new one, so no one record file's queue covers the check and the write together:
 * two calls that overlap both list before either write lands, both find nothing, and both mint.
 * Production overlaps this way: `packages/plugin/src/ingestion/wiring.ts`'s
 * `resolveOutcomeCandidates` resolves every extracted candidate at once (`Promise.all`).
 *
 * **Why it stops here.** One source block can hold several outcomes: the extractor anchors every
 * outcome it finds in a passage to that passage. Two existing plugin tests
 * (`test/ingestion/wiring.spec.ts`, `test/ingestion/canonical-key-readers.ol-egov.141.89.9.56.spec.ts`)
 * expect two outcomes with different labels at one anchor to become two records — which happens
 * today only because their mints overlap. Serialising the mint under today's match rule (source
 * alone) would fold the second outcome into the first and change what those tests expect. Making
 * the result independent of timing needs a rule for what identifies one outcome within one source
 * block: a decision, not a queue.
 *
 * Both cases below state an invariant that holds under any such rule, so each is `it.fails` until
 * the decision lands and the mint is serialised; then each passes, `it.fails` reports it, and the
 * marker comes off. `OverlapVault` lands each write one macrotask late, so overlapping listings
 * both run before either write. Every course, label and source here is invented.
 */

import { describe, expect, it } from 'vitest';
import { OverlapVault } from '../../test/support/overlap-vault.js';
import type { VaultPath } from '../vault/types.js';
import { OUTCOME_STORE_FOLDER, resolveOutcome } from './store.js';

const SOURCE = { path: '02 Assignments/Widget objectives.md' as VaultPath, blockIndex: 2 };
const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };

function input(label: string) {
  return { courses: ['COURSEA'], source: SOURCE, label, provenance: PROVENANCE };
}

function recordFiles(vault: OverlapVault): readonly VaultPath[] {
  return vault.paths().filter((path) => path.startsWith(`${OUTCOME_STORE_FOLDER}/`));
}

describe('race 1: two overlapping mints for one outcome source (pinned until its identity decision)', () => {
  it.fails('mints one record when two identical candidates overlap', async () => {
    const vault = new OverlapVault();
    const [first, second] = await Promise.all([
      resolveOutcome(vault, input('Explain the widget crank'), { now: () => '2026-10-05' }),
      resolveOutcome(vault, input('Explain the widget crank'), { now: () => '2026-10-05' }),
    ]);

    // Today: two records, one per call.
    expect(recordFiles(vault)).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });

  it.fails('gives the same records whether one block’s candidates are resolved together or one after the other', async () => {
    const candidates = [input('Explain the widget crank'), input('Explain the widget lid')];

    const together = new OverlapVault();
    await Promise.all(
      candidates.map((candidate) =>
        resolveOutcome(together, candidate, { now: () => '2026-10-05' }),
      ),
    );

    const inTurn = new OverlapVault();
    for (const candidate of candidates) {
      await resolveOutcome(inTurn, candidate, { now: () => '2026-10-05' });
    }

    // Today: two records together, one in turn — the second candidate folds into the first.
    expect(recordFiles(inTurn)).toHaveLength(recordFiles(together).length);
  });
});
