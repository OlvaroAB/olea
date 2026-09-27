/**
 * `ol-egov.141.8.15`: the probe presentation records (`.olea/probe-presentation/`) are in F7.4's
 * registry — found by discovery, carried by the export, and removed by the full delete, so a full
 * delete no longer leaves them behind. `olea-layer-coverage.spec.ts` holds the registration
 * itself; this file proves the delete end to end over a record written by the real store.
 */
import type { CalendarDay } from 'olea-core';
import {
  PROBE_PRESENTATION_STORE_FOLDER,
  probePresentationStorePath,
  writeProbePresentation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  discoverOleaLayerPaths,
  isInOleaLayerRole,
  OLEA_LAYER_FOLDERS,
} from '../../src/privacy/log-discovery.js';
import { deleteVaultArtifacts } from '../../src/privacy/vault-artifact-delete.js';
import { MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-09-27';
const DEVICE_ID = 'device-1';

describe('ol-egov.141.8.15: the probe presentation folder in the F7.4 registry', () => {
  it('is registered as a record folder', () => {
    expect(OLEA_LAYER_FOLDERS).toContainEqual({
      folder: PROBE_PRESENTATION_STORE_FOLDER,
      role: 'record',
    });
    expect(isInOleaLayerRole(probePresentationStorePath('instrument-1'), 'record')).toBe(true);
  });

  it('discovery finds a record the real store wrote, and the full delete removes it', async () => {
    const vault = new MemoryVaultSource({});
    await writeProbePresentation(vault, 'instrument-1', '2026-09-27T09:00:00.000+00:00');
    const path = probePresentationStorePath('instrument-1');
    expect(await vault.exists(path)).toBe(true);

    expect(
      await discoverOleaLayerPaths(vault, { deviceId: DEVICE_ID, today: TODAY, probeDays: 5 }),
    ).toEqual([path]);

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
