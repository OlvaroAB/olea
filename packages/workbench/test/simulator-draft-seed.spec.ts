/**
 * `simulator/draft-seed.ts` (`ol-3ux7.64.19` [WBX-19]) — a populated
 * bulk-review state for the simulator.
 *
 * Proves the two shapes this module has to handle without hardcoding
 * either: a persona-world-shaped vault (a flat `01 Courses/<CODE>/
 * <concept>.md` note per concept) and a fixture-vault-shaped vault (a
 * nested `01 Courses/<CODE>/WEEK N/<lecture>.md`, with the concept named
 * only inside body prose via a wikilink) — both should be discovered by the
 * same verbatim, word-bounded match this module's own doc names. INV-3:
 * every course code and concept name below is invented for this suite.
 */
import { describe, expect, it } from 'vitest';
// Cross-package import of the plugin's own runtime shape guard — the same
// "prove a seeded record is a REAL `DraftRecord`, not just JSON that looks
// like one" posture `bundle-freshness.spec.ts` and this repo's other
// cross-package checks already take.
import { isDraftRecord } from '../../plugin/src/generation/types.js';
import { discoverDraftSeedCandidates, seedSimulatorDrafts } from '../src/simulator/draft-seed.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

const encode = (s: string) => new TextEncoder().encode(s);

function vaultOf(files: Readonly<Record<string, string>>): MemoryVaultSource {
  return MemoryVaultSource.fromBytes(
    new Map(Object.entries(files).map(([path, content]) => [path, encode(content)])),
  );
}

describe('discoverDraftSeedCandidates', () => {
  it('finds a flat, persona-world-shaped concept: one course note per concept', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Melspar.md':
        '# Melspar\n\nThree main stages for Melspar: first, second, third.\n',
      '05 Zettelkasten/Melspar.md': '# Melspar\n\nA concept note.\n',
    });

    const candidates = await discoverDraftSeedCandidates(vault);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      conceptName: 'Melspar',
      zettelPath: '05 Zettelkasten/Melspar.md',
      sourcePath: '01 Courses/VANTREL/Melspar.md',
      courseCode: 'VANTREL',
    });
  });

  it('finds a nested, fixture-vault-shaped concept named only via a wikilink in lecture prose', async () => {
    const vault = vaultOf({
      '01 Courses/GEOL204/WEEK 1/Lecture - Clast Provenance.md':
        '# Clast Provenance\n\nCompare against [[Imbrication]] for the fabric argument.\n',
      '05 Zettelkasten/Imbrication.md': '# Imbrication\n\nA concept note.\n',
    });

    const candidates = await discoverDraftSeedCandidates(vault);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.conceptName).toBe('Imbrication');
    expect(candidates[0]?.courseCode).toBe('GEOL204');
    expect(candidates[0]?.sourcePath).toBe(
      '01 Courses/GEOL204/WEEK 1/Lecture - Clast Provenance.md',
    );
  });

  it('is the honest empty case when no course note mentions any Zettelkasten title', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Melspar.md': '# Melspar\n\nNothing here names the other concept.\n',
      '05 Zettelkasten/Dornith.md': '# Dornith\n\nA concept note.\n',
    });

    expect(await discoverDraftSeedCandidates(vault)).toEqual([]);
  });

  it('is the honest empty case when there is no Zettelkasten folder at all', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Melspar.md': '# Melspar\n\nSome prose.\n',
    });

    expect(await discoverDraftSeedCandidates(vault)).toEqual([]);
  });

  it('never matches a Zettelkasten title that only appears as a substring of another word', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Notes.md':
        '# Notes\n\nDiscusses Melsparite, a different mineral entirely.\n',
      '05 Zettelkasten/Melspar.md': '# Melspar\n\nA concept note.\n',
    });

    expect(await discoverDraftSeedCandidates(vault)).toEqual([]);
  });

  it('is deterministic: two calls against the same vault return the same candidates in the same order', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Melspar.md': 'Melspar. Also Dornith.',
      '01 Courses/VANTREL/Dornith.md': 'Dornith. Also Melspar.',
      '05 Zettelkasten/Melspar.md': '# Melspar',
      '05 Zettelkasten/Dornith.md': '# Dornith',
    });

    const first = await discoverDraftSeedCandidates(vault);
    const second = await discoverDraftSeedCandidates(vault);
    expect(second).toEqual(first);
  });
});

describe('seedSimulatorDrafts', () => {
  it('writes an index.json plus one per-record file, each a valid DraftRecord', async () => {
    const vault = vaultOf({
      '01 Courses/VANTREL/Melspar.md': 'Melspar is discussed here.',
      '05 Zettelkasten/Melspar.md': '# Melspar',
    });

    const written = await seedSimulatorDrafts(vault, () => new Date('2026-06-01T09:00:00Z'));
    expect(written).toBe(1);

    const index = JSON.parse(await vault.read('.olea/drafts/index.json')) as {
      version: number;
      entries: readonly { draftId: string; status: string }[];
    };
    expect(index.version).toBe(1);
    expect(index.entries).toHaveLength(1);
    const [entry] = index.entries;
    expect(entry?.status).toBe('pending');

    const record: unknown = JSON.parse(await vault.read(`.olea/drafts/${entry?.draftId}.json`));
    expect(isDraftRecord(record)).toBe(true);
  });

  it('writes nothing when there is nothing to seed — no empty index, no empty draft', async () => {
    const vault = vaultOf({ '01 Courses/VANTREL/Melspar.md': 'No zettel titles mentioned.' });

    const written = await seedSimulatorDrafts(vault);
    expect(written).toBe(0);
    expect(await vault.exists('.olea/drafts/index.json')).toBe(false);
  });

  it('caps the number of seeded drafts rather than seeding one per candidate unbounded', async () => {
    const files: Record<string, string> = {};
    const names = ['Melspar', 'Dornith', 'Kelvane', 'Tirasp', 'Ilmenor', 'Sarquith'];
    for (const name of names) {
      files[`01 Courses/VANTREL/${name}.md`] = `${name} is discussed here.`;
      files[`05 Zettelkasten/${name}.md`] = `# ${name}`;
    }
    const vault = vaultOf(files);

    const written = await seedSimulatorDrafts(vault);
    expect(written).toBeLessThan(names.length);
    expect(written).toBeGreaterThan(0);
  });
});
