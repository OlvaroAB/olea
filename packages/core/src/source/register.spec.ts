import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { DEFAULT_SOURCES_FOLDER, registerSources } from './register.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('registerSources — against the fixture vault (F1.5, F7.9)', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('registers the past paper and objectives fixtures with their role, defaulting to 03 Research', async () => {
    const report = await registerSources(source);
    expect(report.sourcesFolder).toBe(DEFAULT_SOURCES_FOLDER);
    expect(report.configErrors).toEqual([]);

    const byPath = new Map(report.sources.map((s) => [s.path, s]));
    expect(byPath.get('03 Research/GEOL204 Past Paper 2024.md')).toEqual({
      path: '03 Research/GEOL204 Past Paper 2024.md',
      role: 'past-paper',
      course: 'GEOL204',
      // A folder-scanned markdown source is a REGISTERED source, not an
      // embedded one: nothing had to write `![[...]]` for it to be found.
      // That is what makes `SourceKind`'s two live values discriminate the
      // route rather than the file format (F3.1, R15).
      kind: 'registered-file',
      format: null,
    });
    expect(byPath.get('03 Research/GEOL204 Course Objectives.md')).toEqual({
      path: '03 Research/GEOL204 Course Objectives.md',
      role: 'objectives',
      course: 'GEOL204',
      kind: 'registered-file',
      format: null,
    });
  });

  it('reports the citation-workflow research notes as unclassified, not silently dropped or misread as course sources', async () => {
    const report = await registerSources(source);
    // These five carry `source-type` (bibliographic type), never `role`.
    expect(report.unclassified).toEqual(
      expect.arrayContaining([
        '03 Research/Norling 2019 - Turbidite Bedform Successions.md',
        '03 Research/Halloran 2018 - Chorale Doubling in Keyboard Realisation.md',
        '03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md',
        '03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md',
        '03 Research/Vance 2020 - Grainsize Fining Models.md',
      ]),
    );
    // None of the unclassified notes leak into `sources`.
    const classifiedPaths = new Set(report.sources.map((s) => s.path));
    for (const path of report.unclassified) {
      expect(classifiedPaths.has(path)).toBe(false);
    }
  });

  it('is deterministic across repeated calls', async () => {
    const first = await registerSources(source);
    const second = await registerSources(source);
    expect(second).toEqual(first);
  });
});

describe('registerSources — tolerant role matching and honest reporting (synthetic)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-source-register-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('matches role aliases case-insensitively ("Past Paper", "Learning Objectives")', async () => {
    await write('03 Research/Paper.md', '---\nrole: Past Paper\ncourse: COURSEA\n---\n\n# Paper\n');
    await write(
      '03 Research/Objectives.md',
      '---\nrole: Learning Objectives\ncourse: COURSEA\n---\n\n# Objectives\n',
    );

    const report = await registerSources(source);
    const byPath = new Map(report.sources.map((s) => [s.path, s.role]));
    expect(byPath.get('03 Research/Paper.md')).toBe('past-paper');
    expect(byPath.get('03 Research/Objectives.md')).toBe('objectives');
  });

  it('respects a custom sourcesFolder option (F7.9 configurability)', async () => {
    await write(
      'Custom Folder/Paper.md',
      '---\nrole: past-paper\ncourse: COURSEA\n---\n\n# Paper\n',
    );
    await write('03 Research/Ignored.md', '---\nrole: past-paper\n---\n\n# Ignored\n');

    const report = await registerSources(source, { sourcesFolder: 'Custom Folder' });
    expect(report.sourcesFolder).toBe('Custom Folder');
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]?.path).toBe('Custom Folder/Paper.md');
  });

  it('reports a note with no role property as unclassified, course left undefined when absent', async () => {
    await write('03 Research/Mystery.md', '---\ncitekey: mystery2020\n---\n\n# Mystery\n');

    const report = await registerSources(source);
    expect(report.unclassified).toEqual(['03 Research/Mystery.md']);
    expect(report.sources).toEqual([]);
  });

  it('reports a note with no frontmatter at all, separately from unclassified', async () => {
    await write('03 Research/scratch.md', '# Just some notes, no frontmatter\n');

    const report = await registerSources(source);
    expect(report.notesWithoutFrontmatter).toEqual(['03 Research/scratch.md']);
    expect(report.unclassified).toEqual([]);
    expect(report.sources).toEqual([]);
  });

  it('lists non-markdown files under the folder separately, never silently registered', async () => {
    await write('03 Research/Scan.pdf', '%PDF-1.4 not a real pdf, just bytes\n');
    await write('03 Research/Paper.md', '---\nrole: past-paper\n---\n\n# Paper\n');

    const report = await registerSources(source);
    expect(report.skippedNonMarkdown).toEqual(['03 Research/Scan.pdf']);
    expect(report.notesScanned).toEqual(['03 Research/Paper.md']);
  });

  it('an empty/missing sources folder produces a configError, not a silent empty read', async () => {
    const report = await registerSources(source);
    expect(report.sources).toEqual([]);
    expect(report.configErrors).toHaveLength(1);
    expect(report.configErrors[0]).toMatch(/03 Research/);
  });

  it('an unrecognised role value is reported as unclassified, never guessed', async () => {
    await write('03 Research/Weird.md', '---\nrole: syllabus\n---\n\n# Weird\n');

    const report = await registerSources(source);
    expect(report.unclassified).toEqual(['03 Research/Weird.md']);
  });

  // ------------------------------------------------------------------------
  // F3.1 / `ol-ep3.2` — registration with no embedding note.
  //
  // R6's ruling is that "sources = embeds" does not ship. These assert the
  // property that makes that true: a file becomes a `Source` because someone
  // named it, not because some note happened to write `![[...]]`.
  // ------------------------------------------------------------------------

  it('registers a file no note embeds, from outside the sources folder', async () => {
    await write('01 Courses/COURSEA/Book.pdf', '%PDF-1.4 bytes\n');
    // Deliberately no note anywhere, so there is nothing that COULD embed it.

    const report = await registerSources(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    expect(report.sources).toEqual([
      {
        path: '01 Courses/COURSEA/Book.pdf',
        role: 'course-material',
        course: undefined,
        kind: 'registered-file',
        format: 'pdf',
      },
    ]);
    // Registering a file is not "the sources folder was misconfigured".
    expect(report.configErrors).toEqual([]);
  });

  it('carries the caller-supplied role and course verbatim', async () => {
    await write('Papers/2023.pdf', '%PDF-1.4 bytes\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: 'Papers/2023.pdf', role: 'past-paper', course: 'COURSEB' }],
    });
    expect(report.sources[0]).toMatchObject({ role: 'past-paper', course: 'COURSEB' });
  });

  it('reports a registered path the vault does not hold, rather than throwing or inventing it', async () => {
    await write('03 Research/Paper.md', '---\nrole: past-paper\n---\n\n# Paper\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: 'Nowhere/Missing.pdf' }],
    });
    expect(report.unregisterable).toEqual([{ path: 'Nowhere/Missing.pdf', reason: 'not-found' }]);
    expect(report.sources.map((s) => s.path)).toEqual(['03 Research/Paper.md']);
  });

  it('reports a registered file no extractor claims, rather than registering a permanent zero', async () => {
    await write('Media/lecture.mp3', 'not really audio\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: 'Media/lecture.mp3' }],
    });
    expect(report.unregisterable).toEqual([
      { path: 'Media/lecture.mp3', reason: 'unsupported-format' },
    ]);
    expect(report.sources).toEqual([]);
  });

  it('registers a markdown file explicitly, with format null so it keeps the block-parser route', async () => {
    await write('Elsewhere/Paper.md', '## Question 1 (5 marks)\n\nDefine a thing.\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: 'Elsewhere/Paper.md', role: 'past-paper' }],
    });
    expect(report.sources[0]).toMatchObject({ format: null, role: 'past-paper' });
  });

  it('does not register the same file twice when the folder scan already found it', async () => {
    await write('03 Research/Paper.md', '---\nrole: past-paper\ncourse: COURSEA\n---\n\n# P\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: '03 Research/Paper.md', role: 'objectives' }],
    });
    // One record, and the folder scan's classification stands — a duplicate
    // would double every page this source contributes downstream.
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]?.role).toBe('past-paper');
  });

  it('a file listed in skippedNonMarkdown can be registered by naming it', async () => {
    await write('03 Research/Scan.pdf', '%PDF-1.4 bytes\n');

    const scanOnly = await registerSources(source);
    expect(scanOnly.skippedNonMarkdown).toEqual(['03 Research/Scan.pdf']);
    expect(scanOnly.sources).toEqual([]);

    const registered = await registerSources(source, {
      registeredFiles: [{ path: '03 Research/Scan.pdf', role: 'past-paper' }],
    });
    expect(registered.sources.map((s) => s.path)).toEqual(['03 Research/Scan.pdf']);
    // Still reported by the scan — the scan's honesty does not change just
    // because a caller separately registered the file.
    expect(registered.skippedNonMarkdown).toEqual(['03 Research/Scan.pdf']);
  });

  it('reserves registered-url without producing it (R15)', async () => {
    await write('Docs/A.pdf', '%PDF-1.4 bytes\n');
    await write('03 Research/Paper.md', '---\nrole: past-paper\n---\n\n# P\n');

    const report = await registerSources(source, {
      registeredFiles: [{ path: 'Docs/A.pdf' }],
    });
    // Nothing in this codebase emits the third value. It exists in the type so
    // a URL source never forces a schema change; building it is `ol-fn7l`,
    // explicitly out of v0.9 scope.
    expect(report.sources.every((s) => s.kind === 'registered-file')).toBe(true);
    expect(report.sources.some((s) => s.kind === 'registered-url')).toBe(false);
  });
});
