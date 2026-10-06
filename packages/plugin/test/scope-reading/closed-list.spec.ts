/** `buildClosedList` — a course's concepts, keyed and described from her own vault (`ol-egov.141.89.7.52`). Invented wording only. */

import { OPAQUE_CONCEPT_KEY_PREFIX } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildClosedList } from '../../src/scope-reading/closed-list.js';
import { COURSE, conceptNotes, setup } from './drivers-kit.js';

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

  it('is empty for a course with no concepts', async () => {
    const { vault } = setup(conceptNotes(['Alpha idea']));
    expect(await buildClosedList(vault, 'NOPE')).toEqual([]);
  });
});
