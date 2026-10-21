import type { ExtractedUnit } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ReadMintResweep } from '../../src/ingestion/wiring.js';

/**
 * `ol-egov.141.89.105.33` (F3.3, `[D-238]`): a concept only the folder read mints is drafted in the
 * same arrival. The fake pipeline below mirrors the sweep's contract: it tries every candidate of
 * the units' courses once, and a concept already drafted is never called again (cache dedup).
 */
const FOLDER = 'Courses/CRS1';

function unit(path: string): ExtractedUnit {
  return {
    text: 't',
    provenance: {
      sourcePath: 'lecture.pdf',
      location: { page: 1, charRange: { start: 0, end: 1 } },
      embeddedIn: { notePath: path, blockStart: 0, blockEnd: 1 },
    },
  };
}

function rig() {
  const calls: string[] = [];
  const drafted = new Set<string>();
  const filing = ['filing-concept'];
  const minted: string[] = [];
  const sweepRuns: number[] = [];
  const sweepNow = async (units: readonly ExtractedUnit[]) => {
    sweepRuns.push(units.length);
    for (const key of [...filing, ...minted]) {
      if (drafted.has(key)) continue;
      calls.push(key);
      drafted.add(key);
    }
  };
  const resweep = new ReadMintResweep({
    candidateKeys: async (units) =>
      units.length === 0 ? new Set() : new Set([...filing, ...minted].map((k) => `CRS1\u0000${k}`)),
    sweep: sweepNow,
  });
  // The tick's own sweep: hold first, then sweep, as main.ts's onUnitsLanded does.
  const land = async (units: ExtractedUnit[]) => {
    resweep.hold([FOLDER], units);
    await sweepNow(units);
  };
  return { calls, drafted, minted, sweepRuns, resweep, land };
}

describe('ReadMintResweep', () => {
  it('drafts a concept only the read mints in the same arrival, a filing concept once, nothing twice', async () => {
    const r = rig();
    await r.land([unit(`${FOLDER}/a.md`)]);
    expect(r.calls).toEqual(['filing-concept']);

    const before = await r.resweep.before(FOLDER);
    r.minted.push('read-minted-concept'); // the read stamps a key
    await r.resweep.resweep(FOLDER, before);

    expect(r.calls).toEqual(['filing-concept', 'read-minted-concept']);
    expect(new Set(r.calls).size).toBe(r.calls.length);
  });

  it('does not sweep again when the read minted nothing new', async () => {
    const r = rig();
    await r.land([unit(`${FOLDER}/a.md`)]);
    const before = await r.resweep.before(FOLDER);
    await r.resweep.resweep(FOLDER, before);
    expect(r.sweepRuns).toEqual([1]);
  });

  it('a failed read (nothing minted) still releases the folder and drafts the others from the first sweep', async () => {
    const r = rig();
    await r.land([unit(`${FOLDER}/a.md`)]);
    const before = await r.resweep.before(FOLDER);
    await r.resweep.resweep(FOLDER, before);
    expect(r.calls).toEqual(['filing-concept']);
    // released: a later landing is not held
    r.resweep.hold([FOLDER], [unit(`${FOLDER}/b.md`)]);
    expect(await r.resweep.before(FOLDER)).toBeNull();
  });

  it('holds only units in the folder subtree, and a sweep failure never throws', async () => {
    const resweep = new ReadMintResweep({
      candidateKeys: async (units) => new Set(units.length > 1 ? ['x', 'y'] : ['x']),
      sweep: async () => {
        throw new Error('boom');
      },
    });
    resweep.hold(
      [FOLDER],
      [unit(`${FOLDER}/a.md`), unit('Courses/CRS2/b.md'), unit(`${FOLDER}-other/c.md`)],
    );
    const before = await resweep.before(FOLDER);
    expect(before).toEqual(new Set(['x']));
    await expect(resweep.resweep(FOLDER, before)).resolves.toBeUndefined();
  });
});
