/**
 * Mints and persists the simulator's own per-install device id, through the
 * same `ObsidianDataHost` shape `createPluginDataHost` exposes.
 *
 * **Why this is not an import of the real `ensureDeviceId`.** The real one
 * lives at `packages/plugin/src/device/device-id.ts`, and this package's own
 * convention (`plugin-bridge.ts`'s module doc: "The single file in this
 * package that reaches into `packages/plugin`") is to reach into that
 * package through exactly one gate. That gate is WBX-2's own `owns` and is
 * running concurrently with this bead — adding an export to it here would
 * step on a live lane's file. So this is a small, self-contained copy of the
 * real one's shape (mint-on-missing, one top-level `data.json` key,
 * read-modify-write so a concurrent feature's key survives), validated
 * against `olea-core`'s real `isValidDeviceId` rather than a re-invented
 * check. **Once WBX-2 lands**, the simulator route should switch to the real
 * `ensureDeviceId`/`resetDeviceId` through `plugin-bridge.ts` and this file
 * can be deleted — nothing else in `simulator/` depends on its id format
 * being anything other than "valid and stable."
 */

import { isValidDeviceId } from 'olea-core';
import type { ObsidianDataHost } from './plugin-data-host.js';

const DEVICE_ID_STORAGE_KEY = 'deviceId';
const ID_LENGTH = 12;

function generateDeviceId(): string {
  let suffix = '';
  while (suffix.length < ID_LENGTH) {
    suffix += Math.random().toString(36).slice(2);
  }
  return `olea-sim-${suffix.slice(0, ID_LENGTH)}`;
}

/** Returns the persisted device id, minting and saving one on first use. Idempotent. */
export async function ensureSimulatorDeviceId(host: ObsidianDataHost): Promise<string> {
  const existing = await host.loadData();
  const blob: Record<string, unknown> =
    typeof existing === 'object' && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const stored = blob[DEVICE_ID_STORAGE_KEY];
  if (typeof stored === 'string' && isValidDeviceId(stored)) return stored;

  const minted = generateDeviceId();
  blob[DEVICE_ID_STORAGE_KEY] = minted;
  await host.saveData(blob);
  return minted;
}
