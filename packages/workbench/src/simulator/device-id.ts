/**
 * Retired local copy (`ol-3ux7.64.10` [WBX-1b]) — WBX-2 landed, so this file
 * now just re-exports the real `ensureDeviceId`
 * (`packages/plugin/src/device/device-id.ts`, reached through
 * `../plugin-bridge.ts` per that file's own rule: "the single file in this
 * package that reaches into `packages/plugin`") under its old name.
 *
 * **Why re-exported rather than deleted.** `test/simulator-device-id.spec.ts`
 * (WBX-1's own test, outside this bead's `owns`) imports
 * `ensureSimulatorDeviceId` from this exact path. Deleting the file, or
 * renaming the export, would fail that test for a reason unrelated to what
 * it actually checks — it asserts minting/idempotence/reset behaviour
 * against `SimulatorStore`, all of which the real `ensureDeviceId` satisfies
 * identically (same `{ loadData, saveData }` shape, same `isValidDeviceId`
 * check, same read-modify-write). This module's own prior doc already named
 * this exact retirement condition: "once WBX-2 lands, the simulator route
 * should switch to the real `ensureDeviceId`/`resetDeviceId` through
 * `plugin-bridge.ts` and this file can be deleted — nothing else in
 * `simulator/` depends on its id format being anything other than 'valid and
 * stable.'" Only the body moved; the test's import path was left alone on
 * purpose.
 */

export { ensureDeviceId as ensureSimulatorDeviceId } from '../plugin-bridge.js';
