// ol-0r92.38 (`[D-190]`, component register row 4.6). Opaque paths only.
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): a reconfigured `under` that
// lands inside `.olea`, a root that IS the retrospective directory, and
// zero roots supplied are each asserted `ok: false` below, alongside the
// real production shape (`under` never set, i.e. root `''`) passing.
import { describe, expect, it } from 'vitest';
import { checkRetrospectiveOutsideIndex } from './retrospective-outside-index.js';

const RETROSPECTIVE_DIR = '.olea/retrospectives';

describe('checkRetrospectiveOutsideIndex', () => {
  it("passes for today's real configuration — the whole vault as root, no `under` restriction", () => {
    const verdict = checkRetrospectiveOutsideIndex([''], RETROSPECTIVE_DIR);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.reachableFrom).toEqual([]);
  });

  it('passes for an ordinary named root that is not an ancestor of the retrospective directory', () => {
    const verdict = checkRetrospectiveOutsideIndex(['01 Courses'], RETROSPECTIVE_DIR);
    expect(verdict.ok).toBe(true);
  });

  it('fails honestly if the indexer were reconfigured to scan `.olea` itself', () => {
    const verdict = checkRetrospectiveOutsideIndex(['.olea'], RETROSPECTIVE_DIR);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.reachableFrom).toEqual(['.olea']);
  });

  it('fails if a configured root IS the retrospective directory', () => {
    const verdict = checkRetrospectiveOutsideIndex([RETROSPECTIVE_DIR], RETROSPECTIVE_DIR);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.reachableFrom).toEqual([RETROSPECTIVE_DIR]);
  });

  it('fails if ANY of several configured roots can reach the directory, not just the first', () => {
    const verdict = checkRetrospectiveOutsideIndex(
      ['01 Courses', '.olea', '03 Research'],
      RETROSPECTIVE_DIR,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.reachableFrom).toEqual(['.olea']);
  });

  it('fails on zero roots supplied rather than vacuously passing (N-013)', () => {
    const verdict = checkRetrospectiveOutsideIndex([], RETROSPECTIVE_DIR);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.rootsChecked).toEqual([]);
  });

  it('a dot segment anywhere below the root blocks reachability, not only at the first level', () => {
    // A root two levels up from a dot-prefixed intermediate folder still
    // cannot reach the target — matches both `FolderSource.walk` and
    // `ObsidianSource.list()` skipping a dot-directory at any depth.
    const verdict = checkRetrospectiveOutsideIndex([''], 'a/b/.olea/retrospectives');
    expect(verdict.ok).toBe(true);
  });
});
