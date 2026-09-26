/**
 * `discoverOleaLayerPaths` and `isOleaLayerPath` (F7.4, `ol-egov.141.8.7`): the one discovery the
 * export and the full delete share, bounded to Olea's own `.olea/` layer by construction.
 */
import type { CalendarDay, ListOptions, VaultPath } from 'olea-core';
import { misconceptionLogPath, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { discoverOleaLayerPaths, isOleaLayerPath } from '../../src/privacy/log-discovery.js';
import { MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';

describe('isOleaLayerPath (ol-egov.141.8.7)', () => {
  it.each([
    ['.olea/concepts/a.json', true],
    ['.olea/content/nested/b.json', true],
    ['.olea', false],
    ['.olea/', false],
    ['.olea-harness/run.json', false],
    ['.oleander/notes.md', false],
    ['01 Courses/.olea/x.json', false],
    ['.olea/../01 Courses/Lecture 1.md', false],
    ['.olea//x.json', false],
    ['/.olea/x.json', false],
    ['.olea\\x.json', false],
  ])('%s -> %s', (path, expected) => {
    expect(isOleaLayerPath(path)).toBe(expected);
  });
});

describe('discoverOleaLayerPaths (ol-egov.141.8.7)', () => {
  it('walks the whole .olea/ tree on a host that can list it, sorted and de-duplicated', async () => {
    const vault = new MemoryVaultSource({
      '.olea/concepts/b.json': '{}\n',
      '.olea/concepts/a.json': '{}\n',
      '.olea/content/nested/c.json': '{}\n',
      [reviewLogPath(TODAY, DEVICE_ID)]: '{}\n',
      '01 Courses/SYN101/Lecture 1.md': '# Lecture 1\n',
    });

    const found = await discoverOleaLayerPaths(vault, {
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });

    expect(found).toEqual([
      '.olea/concepts/a.json',
      '.olea/concepts/b.json',
      '.olea/content/nested/c.json',
      reviewLogPath(TODAY, DEVICE_ID),
    ]);
  });

  it("still finds this device's own logs by exact path on a host that cannot list at all", async () => {
    const vault = new MemoryVaultSource({
      '.olea/concepts/a.json': '{}\n',
      [reviewLogPath(TODAY, DEVICE_ID)]: '{}\n',
      [misconceptionLogPath(TODAY, DEVICE_ID)]: '{}\n',
    });
    vault.list = async () => {
      throw new Error('this host cannot list');
    };

    const found = await discoverOleaLayerPaths(vault, {
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });

    // The concept record is invisible to a host that lists nothing: the disclosed limit, the
    // same one discoverLogPaths states. The real host (ObsidianSource) lists through listUnder.
    expect(found).toEqual([
      misconceptionLogPath(TODAY, DEVICE_ID),
      reviewLogPath(TODAY, DEVICE_ID),
    ]);
  });

  it('never returns a path outside .olea/, even from a host whose listing matches a bare prefix', async () => {
    const vault = new MemoryVaultSource({
      '.olea/concepts/a.json': '{}\n',
      '.olea-harness/run.json': '{}\n',
      '.oleander/notes.md': '# x\n',
      '01 Courses/SYN101/Lecture 1.md': '# Lecture 1\n',
    });
    // A sloppy host: `under` matched as a bare string prefix, so '.olea' also matches its siblings.
    vault.list = async (options: ListOptions = {}) =>
      vault
        .paths()
        .filter((path: VaultPath) => options.under === undefined || path.startsWith(options.under));

    const found = await discoverOleaLayerPaths(vault, {
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });

    expect(found).toEqual(['.olea/concepts/a.json']);
  });
});
