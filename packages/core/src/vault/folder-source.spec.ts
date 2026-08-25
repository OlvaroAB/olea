import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from './folder-source.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
const CRLF_FIXTURE = '01 Courses/MUSTH104/Chorale No. 12/Listening notes.md';
const PDF_FIXTURE = '01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf';

describe('FolderSource against the synthetic fixture vault', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  describe('list', () => {
    it('returns vault-relative POSIX paths in stable sorted order', async () => {
      const paths = await source.list();
      expect(paths.length).toBeGreaterThan(10);
      // POSIX-separated, never absolute, never containing a backslash.
      for (const p of paths) {
        expect(p.startsWith('/')).toBe(false);
        expect(p.includes('\\')).toBe(false);
      }
      const sorted = [...paths].sort();
      expect(paths).toEqual(sorted);
    });

    it('is deterministic across repeated calls', async () => {
      const first = await source.list();
      const second = await source.list();
      expect(second).toEqual(first);
    });

    it('honours `under` to restrict to a subtree', async () => {
      const paths = await source.list({ under: '05 Zettelkasten' });
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p.startsWith('05 Zettelkasten/')).toBe(true);
      }
    });

    it('honours `extensions` (lowercase, no dot)', async () => {
      const paths = await source.list({ extensions: ['pdf'] });
      // Derived from the full listing rather than pinned to an inventory of
      // the vault's PDFs: what is under test here is the *filter*, and adding
      // a fixture PDF to the vault is not a regression in it. (Three live
      // here today — the one-page deck plus the two page-discovery fixtures
      // ol-voen added; see fixtures/vault/README.md.)
      const all = await source.list();
      expect(paths).toEqual(all.filter((p) => p.endsWith('.pdf')));
      expect(paths).toContain(PDF_FIXTURE);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('returns an empty list for an `under` subtree that does not exist', async () => {
      const paths = await source.list({ under: '99 Nonexistent' });
      expect(paths).toEqual([]);
    });

    it('rejects an invalid `under` path', async () => {
      await expect(source.list({ under: '../escape' })).rejects.toThrow();
    });
  });

  describe('read — byte-exact', () => {
    it('preserves CRLF line endings from the CRLF fixture', async () => {
      const content = await source.read(CRLF_FIXTURE);
      expect(content).toContain('\r\n');
      // Confirm against the raw bytes on disk, independent of our own reader.
      const raw = await readFile(join(FIXTURE_ROOT, CRLF_FIXTURE), 'utf8');
      expect(content).toBe(raw);
    });

    it('preserves exact byte content for an ordinary markdown fixture', async () => {
      const path = '01 Courses/GEOL204/WEEK 3/scratch-thoughts.md';
      const content = await source.read(path);
      const raw = await readFile(join(FIXTURE_ROOT, path), 'utf8');
      expect(content).toBe(raw);
    });

    it('rejects an invalid path', async () => {
      await expect(source.read('/absolute/path.md')).rejects.toThrow();
      await expect(source.read('../escape.md')).rejects.toThrow();
    });
  });

  describe('readBinary', () => {
    it('returns a Uint8Array with the PDF magic bytes', async () => {
      const bytes = await source.readBinary(PDF_FIXTURE);
      expect(bytes).toBeInstanceOf(Uint8Array);
      const magic = new TextDecoder('ascii').decode(bytes.subarray(0, 4));
      expect(magic).toBe('%PDF');
    });
  });

  describe('exists', () => {
    it('is true for a real file and false for a missing one', async () => {
      expect(await source.exists(PDF_FIXTURE)).toBe(true);
      expect(await source.exists('01 Courses/does-not-exist.md')).toBe(false);
    });
  });

  describe('firstSeen (ARRIVE-1, `ol-4pue`)', () => {
    it('returns null for a missing file rather than throwing', async () => {
      expect(await source.firstSeen('01 Courses/does-not-exist.md')).toBeNull();
    });

    // Deliberately NOT a synthetic case: this repo's own git-checked-out
    // fixture files report `birthtimeMs: 0` on this project's dev/CI
    // platform (verified directly against this exact file with `fs.statSync`
    // — Linux ext4-family filesystems frequently do not track a real
    // creation time). This is the production-shaped "no signal" path the
    // interface doc calls a first-class, expected outcome, and it is exactly
    // why `study-session/compose.ts`'s fallback matters: a real vault's own
    // dev-platform checkout hits it routinely, not just a contrived edge
    // case.
    it('returns null (not epoch 0) for a real file whose birthtime the host cannot report', async () => {
      expect(await source.firstSeen(PDF_FIXTURE)).toBeNull();
    });
  });
});

describe('FolderSource write, against a temp copy', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-folder-source-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes exactly the string given: no trailing newline added, no translation', async () => {
    const source = new FolderSource(tempRoot);
    await source.write('note.md', 'no trailing newline here');
    const raw = await readFile(join(tempRoot, 'note.md'), 'utf8');
    expect(raw).toBe('no trailing newline here');
  });

  it('creates parent directories as needed', async () => {
    const source = new FolderSource(tempRoot);
    await source.write('a/b/c/deep.md', 'deep content');
    const raw = await readFile(join(tempRoot, 'a', 'b', 'c', 'deep.md'), 'utf8');
    expect(raw).toBe('deep content');
  });

  it('round-trips an ordinary fixture byte-identically: read -> write -> read', async () => {
    const relPath = '01 Courses/GEOL204/WEEK 3/scratch-thoughts.md';
    const original = await readFile(join(FIXTURE_ROOT, relPath), 'utf8');
    await mkdir(join(tempRoot, '01 Courses/GEOL204/WEEK 3'), { recursive: true });
    await writeFile(join(tempRoot, relPath), original, 'utf8');

    const source = new FolderSource(tempRoot);
    const read1 = await source.read(relPath);
    await source.write(relPath, read1);
    const read2 = await source.read(relPath);

    expect(read2).toBe(original);
    expect(read1).toBe(original);
  });

  it('round-trips the CRLF fixture byte-identically, including \\r\\n', async () => {
    const original = await readFile(join(FIXTURE_ROOT, CRLF_FIXTURE), 'utf8');
    expect(original).toContain('\r\n');
    await mkdir(join(tempRoot, '01 Courses/MUSTH104/Chorale No. 12'), { recursive: true });
    await writeFile(join(tempRoot, CRLF_FIXTURE), original, 'utf8');

    const source = new FolderSource(tempRoot);
    const read1 = await source.read(CRLF_FIXTURE);
    await source.write(CRLF_FIXTURE, read1);
    const read2 = await source.read(CRLF_FIXTURE);

    expect(read2).toBe(original);
    expect(read2).toContain('\r\n');
    // Prove the round trip didn't collapse CRLF -> LF anywhere.
    expect(read2.split('\r\n').length).toBe(original.split('\r\n').length);
  });

  it('preserves a leading BOM through write -> read -> write (INV-2: a BOM is a byte, not a decoration)', async () => {
    // ol-inv2remainder: added because a mutation making `write` strip a leading
    // U+FEFF left the entire core suite green. `folder-source.ts`'s own doc
    // asserts this in prose on both sides — "'utf8' decoding neither strips a
    // leading BOM" and "including any BOM character already present in
    // `content`" — and nothing tested either half. An editor-saved note that
    // begins with a BOM would have lost three bytes on the first targeted edit
    // Olea ever made to it, silently, and INV-2 exists to make exactly that
    // impossible.
    const source = new FolderSource(tempRoot);
    // Written as an escape, deliberately: an invisible literal BOM in a source
    // file is exactly the thing a future editor would strip without noticing.
    const original = '\uFEFF---\ntitle: bom note\n---\n\nBody.\n';

    await source.write('bom.md', original);
    expect(await readFile(join(tempRoot, 'bom.md'), 'utf8')).toBe(original);

    const read1 = await source.read('bom.md');
    expect(read1).toBe(original);
    expect(read1.charCodeAt(0)).toBe(0xfeff);

    await source.write('bom.md', read1);
    expect(await source.read('bom.md')).toBe(original);

    // Asserted as bytes too: exactly one EF BB BF, at offset 0 — neither
    // dropped by the writer nor doubled by a reader that re-adds it.
    const bytes = await readFile(join(tempRoot, 'bom.md'));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...bytes.subarray(3, 6)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it('preserves trailing spaces and tabs on every line — a markdown hard line break IS two trailing spaces', async () => {
    // ol-inv2remainder: added because a mutation making `write` strip trailing
    // spaces and tabs per line left the entire core suite green. The existing
    // "writes exactly the string given" test writes a single line with no
    // trailing whitespace, so it could not see it. Two trailing spaces are
    // CommonMark's hard line break: silently trimming them is a visible change
    // to her rendered note that no round-trip test above would have reported.
    const source = new FolderSource(tempRoot);
    const original = 'first line  \nsecond\tline\t\n   indented and trailing   \nlast\n';

    await source.write('hard-breaks.md', original);
    expect(await readFile(join(tempRoot, 'hard-breaks.md'), 'utf8')).toBe(original);

    const read1 = await source.read('hard-breaks.md');
    await source.write('hard-breaks.md', read1);
    expect(await source.read('hard-breaks.md')).toBe(original);
  });

  it('firstSeen reports a plausible epoch-ms timestamp for a freshly-created file (ARRIVE-1)', async () => {
    // A temp directory's files (as opposed to a git checkout's) do get a real
    // `birthtimeMs` on this platform — see the top-level `firstSeen` describe
    // block's fixture-vault test for the platform's other, equally real, case.
    const source = new FolderSource(tempRoot);
    const before = Date.now();
    await source.write('fresh.md', 'x');
    const after = Date.now();

    const seen = await source.firstSeen('fresh.md');
    expect(seen).not.toBeNull();
    expect(seen as number).toBeGreaterThanOrEqual(before - 1000); // small clock-skew margin
    expect(seen as number).toBeLessThanOrEqual(after + 1000);
  });

  it('rejects an invalid path', async () => {
    const source = new FolderSource(tempRoot);
    await expect(source.write('/absolute.md', 'x')).rejects.toThrow();
  });
});

describe('FolderSource watch', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-folder-source-watch-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  // KNOWN FLAKE, not a product defect (`ol-q77r`, closed 2026-08-21 with this note
  // as its lift). Observed to fail exactly once, under full-suite load, and to pass
  // 3 of 3 in isolation and on every rerun since. It is an fs-watcher timing race
  // and it predates the current Node version — so a failure here is a known flake
  // and NOT evidence about whatever change happens to be in flight.
  //
  // If anyone fixes it: await the watcher's own readiness rather than racing a
  // timeout. Raising the timeout hides the race instead of settling it.
  it('delivers a create event when a file is written, and modify on subsequent writes', async () => {
    const source = new FolderSource(tempRoot);
    const events: Array<{ kind: string; path: string }> = [];
    const unsubscribe = source.watch((event) => {
      events.push({ kind: event.kind, path: event.path });
    });

    try {
      await writeFile(join(tempRoot, 'watched.md'), 'v1', 'utf8');
      await waitFor(() => events.some((e) => e.path === 'watched.md'));
      await writeFile(join(tempRoot, 'watched.md'), 'v2', 'utf8');
      await waitFor(() => events.filter((e) => e.path === 'watched.md').length >= 2);

      expect(events.some((e) => e.path === 'watched.md' && e.kind === 'create')).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('returns an unsubscribe that is safe to call twice', async () => {
    const source = new FolderSource(tempRoot);
    const unsubscribe = source.watch(() => {});
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  it('stops delivering events after unsubscribe', async () => {
    const source = new FolderSource(tempRoot);
    const events: string[] = [];
    const unsubscribe = source.watch((event) => events.push(event.path));

    await writeFile(join(tempRoot, 'first.md'), 'v1', 'utf8');
    await waitFor(() => events.includes('first.md'));
    // A single `writeFile` can generate more than one raw fs event (open +
    // write + close are separate syscalls); let those settle before
    // unsubscribing so this test's assertion is about *new* files, not an
    // exact event count for `first.md`.
    await new Promise((resolve) => setTimeout(resolve, 150));
    unsubscribe();

    await writeFile(join(tempRoot, 'second.md'), 'v1', 'utf8');
    // Give the watcher a moment to (wrongly) fire if it hadn't really closed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events.some((path) => path === 'second.md')).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
