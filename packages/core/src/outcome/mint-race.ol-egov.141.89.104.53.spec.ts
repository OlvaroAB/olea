/**
 * Two overlapping mints for one outcome source (`ol-egov.141.89.104.53`, race 1) — pinned as a known
 * race until `[D-477]` decided what identifies one outcome within one source block, and fixed under
 * `ol-egov.141.89.7.43`.
 *
 * `resolveOutcome` lists `.olea/outcomes/`, looks for the record a candidate is, and mints one only
 * when there is none. The listing reads every record file and the mint writes a new one, so no one
 * record file's queue covers the check and the write together: two calls that overlapped both
 * listed before either write landed, both found nothing, and both minted. Production overlapped
 * this way: the plugin resolved every extracted candidate at once (`Promise.all`).
 *
 * **The fix, in two parts that had to land together.** `[D-477]`: a record is identified by its
 * block AND its own wording (`source.labelDigest`, `./source-identity.ts`), so two outcomes on one
 * block stay two records whatever the timing; and the whole find-or-mint runs as one task on the
 * outcome folder's queue key, so overlapping calls run one after the other. Serialising alone would
 * have folded every outcome on a block into the first; widening identity alone would have left the
 * duplicate mint below.
 *
 * `OverlapVault` lands each write one macrotask late, so overlapping listings would both run before
 * either write if nothing serialised them. Every course, label and source here is invented.
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

describe('race 1: two overlapping mints for one outcome source ([D-477], ol-egov.141.89.7.43)', () => {
  it('mints one record when two identical candidates overlap', async () => {
    const vault = new OverlapVault();
    const [first, second] = await Promise.all([
      resolveOutcome(vault, input('Explain the widget crank'), { now: () => '2026-10-05' }),
      resolveOutcome(vault, input('Explain the widget crank'), { now: () => '2026-10-05' }),
    ]);

    expect(recordFiles(vault)).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });

  it('gives the same records whether one block’s candidates are resolved together or one after the other', async () => {
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

    // Two outcomes on one block: two records either way, never one folded into the other.
    expect(recordFiles(together)).toHaveLength(2);
    expect(recordFiles(inTurn)).toHaveLength(recordFiles(together).length);
  });
});
