/**
 * The spend ledger is part of Olea's layer for F7.4 (`ol-egov.141.89.7.76`, `[D-540]`). Scenario:
 * F4.1, "the export carries the spend ledger and the full delete removes it". Synthetic only.
 */

import { type CalendarDay, SPEND_LEDGER_FOLDER, spendLedgerPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildPrivacyExportBundle } from '../../src/privacy/export-bundle.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import { OLEA_LAYER_FOLDERS } from '../../src/privacy/log-discovery.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';
import { ledgerOver, OTHER_DEVICE, otherDeviceFile, THIS_DEVICE } from './spend-kit.js';

const TODAY: CalendarDay = '2026-10-06';
const NOTE = { '01 Courses/TESTC1/note.md': '# A synthetic note\n\nBody.\n' };

async function vaultWithTwoDevices(): Promise<MemoryVaultSource> {
  const vault = new MemoryVaultSource({ ...NOTE, ...otherDeviceFile(1.25) });
  const ledger = ledgerOver(vault);
  const result = await ledger.reserve('outcomes.extract.v1', 100);
  if (!result.granted) throw new Error('expected a grant');
  return vault;
}

describe('the spend ledger in F7.4', () => {
  it('is a registered record folder of Olea’s layer', () => {
    expect(OLEA_LAYER_FOLDERS).toContainEqual({ folder: SPEND_LEDGER_FOLDER, role: 'record' });
  });

  it('the export carries every device’s file as the exact text on disk', async () => {
    const vault = await vaultWithTwoDevices();
    const bundle = await buildPrivacyExportBundle({
      vault,
      deviceId: THIS_DEVICE,
      today: TODAY,
      probeDays: 30,
      now: () => '2026-10-06T12:00:00.000Z',
    });
    const carried = bundle.oleaFiles.filter((file) =>
      file.path.startsWith(`${SPEND_LEDGER_FOLDER}/`),
    );
    expect(carried.map((file) => file.path)).toEqual(
      [spendLedgerPath(OTHER_DEVICE), spendLedgerPath(THIS_DEVICE)].sort(),
    );
    for (const file of carried) expect(file.content).toBe(vault.raw(file.path));
  });

  it('the full delete removes every device’s file and leaves her notes byte-identical', async () => {
    const vault = await vaultWithTwoDevices();
    const result = await runFullDelete({
      dataHost: new FakeDataHost(),
      vault,
      deviceId: THIS_DEVICE,
      today: TODAY,
      probeDays: 30,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest: async () => ({ status: 200 }),
    });
    expect(vault.paths().filter((path) => path.startsWith(`${SPEND_LEDGER_FOLDER}/`))).toEqual([]);
    expect(result.vaultArtifacts.deletedRecordPaths).toEqual(
      expect.arrayContaining([spendLedgerPath(OTHER_DEVICE), spendLedgerPath(THIS_DEVICE)]),
    );
    expect(vault.raw('01 Courses/TESTC1/note.md')).toBe(NOTE['01 Courses/TESTC1/note.md']);
  });
});
