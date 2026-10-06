/**
 * `discoverOleaLayerPaths` and `isOleaLayerPath` (F7.4, `ol-egov.141.8.7`): the one discovery the
 * export and the full delete share, bounded to Olea's own `.olea/` layer by construction.
 */
import type { CalendarDay, ListOptions, VaultPath } from 'olea-core';
import { misconceptionLogPath, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
// `[D-533]` (`ol-egov.141.89.7.26`): imported by module path, not the `olea-core` barrel, which
// other lanes are landing exports into this round (the registry's own stance).
import {
  OUTCOME_CONTAINMENT_CORRECTION_FOLDER,
  recordContainmentCorrection,
} from '../../../core/src/outcome/containment-correction.js';
import {
  discoverOleaLayerPaths,
  isOleaLayerPath,
  OLEA_LAYER_FOLDERS,
} from '../../src/privacy/log-discovery.js';
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

describe('her correction history for model-decided links ([D-533], ol-egov.141.89.7.26)', () => {
  it('is registered as a record folder, so the export carries it as text on disk and the full delete removes it', () => {
    expect(OUTCOME_CONTAINMENT_CORRECTION_FOLDER).toBe('.olea/outcome-containment-corrections');
    expect(OLEA_LAYER_FOLDERS).toContainEqual({
      folder: OUTCOME_CONTAINMENT_CORRECTION_FOLDER,
      role: 'record',
    });
  });

  it('a history the recorder wrote is found by the discovery the export and the delete share', async () => {
    const vault = new MemoryVaultSource({ '01 Courses/SYN101/Lecture 1.md': '# Lecture 1\n' });
    await recordContainmentCorrection(
      vault,
      { kind: 'objectives', sourcePath: '03 Research/Objectives A.md', wordingKey: 'v1:abc' },
      'concept-key1:synthetic',
      'declined',
      { now: () => '2026-10-06T00:00:00.000Z' },
    );
    const found = await discoverOleaLayerPaths(vault, {
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.startsWith(`${OUTCOME_CONTAINMENT_CORRECTION_FOLDER}/`)).toBe(true);
  });
});
