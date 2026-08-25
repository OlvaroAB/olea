import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  type AssessmentScope,
  extractStatedScope,
  readStatedScope,
  resolveScope,
} from './scope.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('F1.7 / ASC-1 — stated coverage is read where she has recorded it', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it("reads the Midterm note's own body prose verbatim, with no inference or model call", async () => {
    const scope = await readStatedScope(source, '02 Assignments/Midterm Test - GEOL204.md');
    expect(scope).toBe('Covers WEEK 1 through WEEK 5 material.');
  });

  it('a scope-aliased frontmatter property outranks body prose when both are present', () => {
    const doc = parseDocument(
      '---\nclass: COURSEA\ncovers: Weeks 1-3, propagation and reflection\n---\n\n# Quiz\n\nThis paragraph is not the coverage statement.\n',
    );
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') throw new Error('expected frontmatter block');
    const fm = parseFrontmatter(first.inner);
    expect(extractStatedScope(fm, doc)).toBe('Weeks 1-3, propagation and reflection');
  });

  it('is tolerant of the alias table the same way ../assessment/read.ts is (Scope, Topics, Coverage)', () => {
    for (const key of ['Scope', 'Topics', 'Coverage', 'covers']) {
      const doc = parseDocument(`---\nclass: COURSEA\n${key}: stated via ${key}\n---\n\n# Quiz\n`);
      const first = doc.blocks[0];
      if (first?.kind !== 'frontmatter') throw new Error('expected frontmatter block');
      const fm = parseFrontmatter(first.inner);
      expect(extractStatedScope(fm, doc)).toBe(`stated via ${key}`);
    }
  });

  it('returns undefined for a note with a heading but no body prose and no coverage property', () => {
    const doc = parseDocument('---\nclass: COURSEA\n---\n\n# Final Exam\n');
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') throw new Error('expected frontmatter block');
    const fm = parseFrontmatter(first.inner);
    expect(extractStatedScope(fm, doc)).toBeUndefined();
  });

  it('readStatedScope resolves undefined, never throwing, for a note that does not exist', async () => {
    await expect(
      readStatedScope(source, '02 Assignments/Does Not Exist.md'),
    ).resolves.toBeUndefined();
  });
});

describe('F1.7 / ASC-1 — unstated coverage is inferred from material sequenced before the assessment', () => {
  it('names the caller-supplied preceding material when nothing is stated, and marks it inferred', () => {
    const scope = resolveScope(undefined, [
      { label: 'Week 1 lecture: introduction' },
      { label: 'Week 2 lecture: deposition' },
    ]);
    expect(scope).toEqual<AssessmentScope>({
      text: 'Week 1 lecture: introduction, Week 2 lecture: deposition',
      origin: 'inferred',
    });
  });

  it('stated wins over inferred even when candidates are supplied — precedence, not a merge', () => {
    const scope = resolveScope('Covers weeks 1 through 5.', [{ label: 'Week 9 lecture' }]);
    expect(scope).toEqual<AssessmentScope>({
      text: 'Covers weeks 1 through 5.',
      origin: 'stated',
    });
  });
});

describe('F1.7 / ASC-1 — an absent or unreadable scope degrades to the ordinary ranking, never to an empty set', () => {
  it('resolveScope returns undefined, not an error and not an empty-string sentinel, when nothing is stated or inferable', () => {
    expect(resolveScope(undefined, [])).toBeUndefined();
    expect(resolveScope('', [])).toBeUndefined();
  });

  it('readAssessments itself never treats an unresolved scope as a required-field gap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olea-assessment-scope-'));
    try {
      const source = new FolderSource(root);
      await mkdir(join(root, 'Work'), { recursive: true });
      await writeFile(
        join(root, 'Work', 'Assignments.base'),
        'filters:\n  and:\n    - file.inFolder("Work")\n',
        'utf8',
      );
      await writeFile(
        join(root, 'Work', 'Quiz.md'),
        '---\nclass: COURSEA\ntype: Quiz\nweight: 5\ndue: 2026-09-01\nstatus: done\n---\n\n# Quiz\n',
        'utf8',
      );
      const { readAssessments } = await import('./read.js');
      const report = await readAssessments(source, 'Work/Assignments.base');
      expect(report.records[0]?.scope).toBeUndefined();
      expect(report.unresolvedFields).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('F1.7 / ASC-1 — per-assessment scope is never read as exam-likelihood prediction', () => {
  it('the resolved shape carries only text and an origin — no confidence score, no citation, nothing probabilistic', () => {
    const scope = resolveScope('covers weeks 1-5', []);
    expect(scope).toBeDefined();
    expect(Object.keys(scope ?? {}).sort()).toEqual(['origin', 'text']);
    expect(scope?.origin).toBe('stated');
  });

  it('a stated scope is carried verbatim, character for character, with no hedging applied', () => {
    const verbatim = 'covers weeks 1-5, with emphasis on turbidite sequences';
    expect(resolveScope(verbatim, [])).toEqual<AssessmentScope>({
      text: verbatim,
      origin: 'stated',
    });
  });
});
