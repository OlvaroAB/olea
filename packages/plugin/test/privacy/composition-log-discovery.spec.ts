/**
 * `[D-395]` / `[D-331]` choice 4 (a) (`ol-egov.141.89.10.65`): the composition records are kept
 * like the review log — found by F7.4's discovery (listed, and probed by exact path for this
 * device on a host that lists nothing), carried by the export as the exact text on disk, and
 * removed by the full delete. `olea-layer-coverage.spec.ts` holds the registration itself;
 * `olea-layer-fixture.spec.ts` proves the export and delete over every registered folder.
 */
import type { CalendarDay } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_LOG_FOLDER,
  compositionLogPath,
} from '../../../core/src/study-session/composition-log.js';
import {
  discoverOleaLayerPaths,
  isEventLogPath,
  isInOleaLayerRole,
  OLEA_LAYER_FOLDERS,
} from '../../src/privacy/log-discovery.js';
import { deleteVaultArtifacts } from '../../src/privacy/vault-artifact-delete.js';
import { MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';

describe('[D-395] the composition log in the F7.4 registry', () => {
  it('is registered as a record folder, not an event log any review fold would parse', () => {
    expect(OLEA_LAYER_FOLDERS).toContainEqual({ folder: COMPOSITION_LOG_FOLDER, role: 'record' });
    const path = compositionLogPath(TODAY, DEVICE_ID);
    expect(isInOleaLayerRole(path, 'record')).toBe(true);
    expect(isEventLogPath(path, '.olea/reviews')).toBe(false);
  });

  it("finds this device's composition file by exact path on a host that cannot list", async () => {
    const path = compositionLogPath(TODAY, DEVICE_ID);
    const vault = new MemoryVaultSource({ [path]: '{}\n' });
    vault.list = async () => {
      throw new Error('this host cannot list');
    };
    expect(
      await discoverOleaLayerPaths(vault, { deviceId: DEVICE_ID, today: TODAY, probeDays: 5 }),
    ).toEqual([path]);
  });

  it('the full delete removes it', async () => {
    const path = compositionLogPath(TODAY, DEVICE_ID);
    const vault = new MemoryVaultSource({ [path]: '{}\n' });
    const result = await deleteVaultArtifacts({
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });
    expect(result.deletedRecordPaths).toEqual([path]);
    expect(await vault.exists(path)).toBe(false);
  });
});
