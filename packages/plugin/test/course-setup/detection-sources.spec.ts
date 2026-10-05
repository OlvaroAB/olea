/**
 * `features/F1-sources.md`, "a course folder holding no Markdown notes is still
 * proposed" (F3.1, `[D-179]`). Runs the real committed fixture course.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectCourseProposals, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  courseMaterialPaths,
  isCourseMaterialPath,
} from '../../src/course-setup/detection-sources.js';

const FIXTURE_VAULT = join(__dirname, '../../../core/fixtures/vault');

function listAll(dir: string, rel = ''): VaultPath[] {
  const out: VaultPath[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listAll(dir, next));
    else out.push(next as VaultPath);
  }
  return out;
}

const none = new Set<string>();

describe('course detection from every format Olea reads', () => {
  it('proposes the slides-only fixture course ISLD140', () => {
    const all = listAll(FIXTURE_VAULT);
    const folder = all.filter((p) => p.startsWith('01 Courses/ISLD140/'));
    expect(folder.length).toBeGreaterThan(0);
    expect(folder.every((p) => p.toLowerCase().endsWith('.pdf'))).toBe(true);

    const proposals = detectCourseProposals(courseMaterialPaths(all), none);
    expect(proposals.map((p) => p.code)).toContain('ISLD140');
  });

  it('the old md-only listing never proposed it (the defect)', () => {
    const mdOnly = listAll(FIXTURE_VAULT).filter((p) => p.endsWith('.md'));
    expect(detectCourseProposals(mdOnly, none).map((p) => p.code)).not.toContain('ISLD140');
  });

  it('keeps md-only behaviour: every course proposed from notes is still proposed, same order', () => {
    const all = listAll(FIXTURE_VAULT);
    const mdOnly = all.filter((p) => p.endsWith('.md'));
    const before = detectCourseProposals(mdOnly, none).map((p) => p.code);
    const after = detectCourseProposals(courseMaterialPaths(all), none).map((p) => p.code);
    for (const code of before) expect(after).toContain(code);
    expect(after.filter((c) => before.includes(c))).toEqual(before);
  });

  it.each([
    ['pdf', '01 Courses/X101/a.pdf'],
    ['pptx', '01 Courses/X101/a.PPTX'],
    ['docx', '01 Courses/X101/a.docx'],
    ['txt', '01 Courses/X101/week1.txt'],
    ['md', '01 Courses/X101/a.md'],
  ])('reads %s as course material', (_name, path) => {
    expect(isCourseMaterialPath(path as VaultPath)).toBe(true);
  });

  it('does not treat system or unread files as material', () => {
    for (const p of [
      '01 Courses/X101/.DS_Store',
      '01 Courses/X101/noext',
      '01 Courses/X101/a.mp3',
    ]) {
      expect(isCourseMaterialPath(p as VaultPath)).toBe(false);
    }
    expect(
      detectCourseProposals(courseMaterialPaths(['01 Courses/X101/.DS_Store' as VaultPath]), none),
    ).toEqual([]);
  });
});
