/** `buildClosedList` — a course's concepts, keyed and described from her own vault (`ol-egov.141.89.7.52`). Invented wording only. */

import { OPAQUE_CONCEPT_KEY_PREFIX } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildClosedList } from '../../src/scope-reading/closed-list.js';
import { COURSE, conceptNotes, definitionOf, setup } from './drivers-kit.js';

describe('the closed list', () => {
  it('holds this course only, in key order, with permanent keys marked stable', async () => {
    const { vault } = setup({
      ...conceptNotes(['Alpha idea', 'Beta idea']),
      ...conceptNotes(['Other idea'], 'TESTC2'),
    });
    const list = await buildClosedList(vault, COURSE);
    expect(list.map((c) => c.name).sort()).toEqual(['Alpha idea', 'Beta idea']);
    expect(list.map((c) => c.key)).toEqual([...list.map((c) => c.key)].sort());
    expect(
      list.every((c) => c.stableKey && c.key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)),
    ).toBe(true);
    expect(list[0]?.attribution).toEqual({ courseId: COURSE, courseName: COURSE });
  });

  it('carries each kit concept with its definition, bound through the real enumeration', async () => {
    const { vault } = setup(conceptNotes(['Alpha idea', 'Beta idea']));
    const list = await buildClosedList(vault, COURSE);
    for (const c of list) {
      expect(c.source.definition).toBe(definitionOf(c.name));
      expect(c.source.definitionFoundInSource).toBe(true);
    }
    expect(list).toHaveLength(2);
  });

  it('sends no definition for a kit concept with no note of its own', async () => {
    const { vault } = setup(conceptNotes(['Alpha idea'], COURSE, false));
    const [c] = await buildClosedList(vault, COURSE);
    expect(c?.source.definition).toBeNull();
  });

  it('is empty for a course with no concepts', async () => {
    const { vault } = setup(conceptNotes(['Alpha idea']));
    expect(await buildClosedList(vault, 'NOPE')).toEqual([]);
  });
});
