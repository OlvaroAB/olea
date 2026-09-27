/**
 * `OleaLayerWriteSeal` (`ol-egov.141.8.14`): the one gate every `.olea/` write of a plugin
 * instance passes through. What it drops, what it lets through, how it orders a write already in
 * flight, and that it claims no capability the source underneath lacks. The settings-pane path —
 * a job in flight at delete time, then the reload — is in `settings-section.spec.ts`; the source
 * pins that make this the one gate in production are at the end of this file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { isSealedOleaPath, OleaLayerWriteSeal } from '../../src/privacy/olea-layer-write-seal.js';
import { MemoryVaultSource } from './fakes.js';

/** A memory vault whose writes to one path wait until the test lets them land. */
class HeldWriteVault extends MemoryVaultSource {
  private readonly holds = new Map<VaultPath, Promise<void>>();

  hold(path: VaultPath): () => void {
    let release = () => {};
    this.holds.set(
      path,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  override async write(path: VaultPath, content: string): Promise<void> {
    await this.holds.get(path);
    await super.write(path, content);
  }
}

describe('isSealedOleaPath', () => {
  it('matches the .olea folder in any letter case and behind a leading ./', () => {
    for (const path of ['.olea/a.json', '.olea/reviews/d/x.jsonl', '.OLEA/a.json', './.olea/a']) {
      expect(isSealedOleaPath(path)).toBe(true);
    }
  });

  it('leaves every other path alone', () => {
    for (const path of [
      'Notes/a.md',
      'Olea exports/e.json',
      '.oleax/a',
      'x/.olea/a',
      '.obsidian/a',
    ]) {
      expect(isSealedOleaPath(path)).toBe(false);
    }
  });
});

describe('OleaLayerWriteSeal', () => {
  it('while sealed, drops every .olea/ write and passes every other write', async () => {
    const inner = new MemoryVaultSource({ '.olea/concepts/a.json': 'before' });
    const seal = new OleaLayerWriteSeal(inner);
    await seal.seal();

    await seal.write('.olea/concepts/a.json', 'after');
    await seal.write('.olea/reviews/d/2026-09-27.jsonl', 'line');
    await seal.write('.OLEA/concepts/b.json', 'upper case');
    await seal.write('Notes/accepted.md', 'kept');

    expect(inner.paths()).toEqual(['.olea/concepts/a.json', 'Notes/accepted.md']);
    expect(inner.raw('.olea/concepts/a.json')).toBe('before');
  });

  it('reads, lists and deletes pass through while sealed', async () => {
    const inner = new MemoryVaultSource({ '.olea/a.json': 'x', '.olea/b.json': 'y' });
    const seal = new OleaLayerWriteSeal(inner);
    await seal.seal();

    expect(await seal.read('.olea/a.json')).toBe('x');
    expect(await seal.exists('.olea/b.json')).toBe(true);
    expect(await seal.list({ under: '.olea' })).toEqual(['.olea/a.json', '.olea/b.json']);
    await seal.delete?.('.olea/a.json');
    expect(inner.paths()).toEqual(['.olea/b.json']);
  });

  it('the vault it hands the delete is the unsealed source underneath', async () => {
    const inner = new MemoryVaultSource();
    const seal = new OleaLayerWriteSeal(inner);
    const sealed = await seal.seal();
    expect(sealed.vault).toBe(inner);
  });

  it('a .olea/ write in flight when the seal closes lands before the seal resolves', async () => {
    const inner = new HeldWriteVault();
    const seal = new OleaLayerWriteSeal(inner);
    const release = inner.hold('.olea/drafts/d1.json');
    const write = seal.write('.olea/drafts/d1.json', '{}');

    let sealed = false;
    const sealing = seal.seal().then((s) => {
      sealed = true;
      return s;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(sealed).toBe(false);

    release();
    await write;
    await sealing;
    expect(sealed).toBe(true);
    expect(inner.paths()).toEqual(['.olea/drafts/d1.json']);
  });

  it('a failed in-flight write does not block or fail the seal', async () => {
    const inner = new MemoryVaultSource();
    inner.write = async () => {
      throw new Error('disk full');
    };
    const seal = new OleaLayerWriteSeal(inner);
    const write = seal.write('.olea/a.json', 'x');
    await expect(seal.seal()).resolves.toBeDefined();
    await expect(write).rejects.toThrow('disk full');
  });

  it('release lifts the seal; a sealed instance that retires stays sealed', async () => {
    const inner = new MemoryVaultSource();
    const lifted = new OleaLayerWriteSeal(inner);
    (await lifted.seal()).release();
    expect(lifted.retire()).toBe(true);
    await lifted.write('.olea/a.json', 'x');
    expect(inner.paths()).toEqual(['.olea/a.json']);

    const other = new MemoryVaultSource();
    const retired = new OleaLayerWriteSeal(other);
    const sealed = await retired.seal();
    expect(retired.retire()).toBe(false);
    sealed.release();
    await retired.write('.olea/a.json', 'x');
    expect(other.paths()).toEqual([]);
  });

  it('offers an optional capability exactly when the source underneath has it', async () => {
    const bare = new OleaLayerWriteSeal(new MemoryVaultSource());
    expect(typeof bare.delete).toBe('function');
    expect(bare.firstSeen).toBeUndefined();
    expect(bare.removeEmptyFolder).toBeUndefined();
    expect('listUnder' in bare).toBe(false);

    const calls: string[] = [];
    const rich = Object.assign(new MemoryVaultSource(), {
      firstSeen: async (path: VaultPath) => {
        calls.push(`firstSeen:${path}`);
        return 7;
      },
      removeEmptyFolder: async (path: VaultPath) => {
        calls.push(`rmdir:${path}`);
      },
      listUnder: async (path: VaultPath) => {
        calls.push(`listUnder:${path}`);
        return ['.olea/x'];
      },
    });
    const seal = new OleaLayerWriteSeal(rich);
    expect(await seal.firstSeen?.('.olea/x')).toBe(7);
    await seal.removeEmptyFolder?.('.olea');
    expect(await seal.listUnder?.('.olea')).toEqual(['.olea/x']);
    expect(calls).toEqual(['firstSeen:.olea/x', 'rmdir:.olea', 'listUnder:.olea']);
  });
});

describe('the seal is the one gate in production (ol-egov.141.8.14)', () => {
  const srcRoot = fileURLToPath(new URL('../../src', import.meta.url));
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return name.endsWith('.ts') ? [path] : [];
    });
  }

  const main = stripComments(readFileSync(join(srcRoot, 'main.ts'), 'utf8'));

  it('main.ts builds ObsidianSource exactly once, inside the seal', () => {
    expect(main.match(/new ObsidianSource\(/g)).toHaveLength(1);
    expect(main).toMatch(
      /private readonly vaultSource = new OleaLayerWriteSeal\(new ObsidianSource\(this\.app\)\);/,
    );
  });

  it('main.ts hands that seal to the settings host, so one full-delete seal closes both', () => {
    expect(main).toMatch(
      /new FullDeleteWriteSeal\(\s*new SerializingDataHost\(\{[\s\S]*?\}\),\s*this\.vaultSource,\s*\)/,
    );
  });

  it('no other plugin source builds an ObsidianSource or reaches the raw vault', () => {
    const allowed = new Set([
      join(srcRoot, 'main.ts'),
      join(srcRoot, 'vault', 'obsidian-source.ts'),
      join(srcRoot, 'vault', 'hidden-path-fallback.ts'),
      join(srcRoot, 'vault', 'dot-folder-walk.ts'),
    ]);
    const offenders = sourceFiles(srcRoot)
      .filter((path) => !allowed.has(path))
      .filter((path) =>
        /new ObsidianSource\(|app\.vault\b|\bvault\.(adapter|create|createBinary|modify|modifyBinary|append|process|createFolder|copy|rename)\b/.test(
          stripComments(readFileSync(path, 'utf8')),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('main.ts itself writes to the vault only through the seal', () => {
    expect(main).not.toMatch(/app\.vault\.(adapter|create|modify|append|process|createFolder)\b/);
  });
});
