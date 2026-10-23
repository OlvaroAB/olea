/**
 * ol-egov.141.89.7.109 (HELD, decision sheet v85): the practice paper counts its unlock days on the
 * device's local calendar, the way F4.7's session builder does. Scenarios: features/F4-oracle.md,
 * "The unlock rule counts days on her local calendar". Synthetic course SYN101 only. The device zone
 * is set through process.env.TZ inside each test and restored afterwards.
 */
import type { VaultSource } from 'olea-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalPracticePaperProvider } from '../../src/paper/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const COURSE = 'SYN101';
const BASE_PATH = '02 Assignments/Assignments.base';
const BASE_FILE = [
  'filters:',
  '  and:',
  '    - file.inFolder("02 Assignments")',
  '    - file.ext == "md"',
  'properties:',
  '  class:',
  '  type:',
  '  weight:',
  '  due:',
  '  status:',
].join('\n');
const DUE = '2026-09-22';

function vaultDue(due: string): VaultSource {
  return memoryVault({
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/exam.md': `---\nclass: ${COURSE}\ntype: exam\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`,
  });
}

const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

async function kindAt(tz: string, iso: string): Promise<string> {
  process.env.TZ = tz;
  const provider = createLocalPracticePaperProvider({
    vault: vaultDue(DUE),
    settingsStore: {
      load: async () => ({ version: 1 as const, assignmentsBasePath: BASE_PATH }),
    },
    generationPort: async () => null,
    now: () => new Date(iso),
  });
  return (await provider.load(COURSE)).kind;
}

describe('the unlock days count on the local calendar (ol-egov.141.89.7.109)', () => {
  it('east of UTC (UTC+01:00): local 00:30 on day -7 is offered, local 00:30 the day after the due day is not', async () => {
    // Etc/GMT-1 is UTC+01:00 all year.
    expect(await kindAt('Etc/GMT-1', '2026-09-14T23:30:00Z')).toBe('unlocked-not-pulled');
    expect(await kindAt('Etc/GMT-1', '2026-09-13T23:30:00Z')).toBe('locked');
    expect(await kindAt('Etc/GMT-1', '2026-09-22T23:30:00Z')).toBe('no-assessment-ahead');
    expect(await kindAt('Etc/GMT-1', '2026-09-21T23:30:00Z')).toBe('unlocked-not-pulled');
  });

  it('west of UTC (UTC-05:00): local 23:30 on day -8 is locked, local 23:30 on the due day is still offered', async () => {
    // Etc/GMT+5 is UTC-05:00 all year.
    expect(await kindAt('Etc/GMT+5', '2026-09-15T04:30:00Z')).toBe('locked');
    expect(await kindAt('Etc/GMT+5', '2026-09-16T04:30:00Z')).toBe('unlocked-not-pulled');
    expect(await kindAt('Etc/GMT+5', '2026-09-23T04:30:00Z')).toBe('unlocked-not-pulled');
    expect(await kindAt('Etc/GMT+5', '2026-09-24T04:30:00Z')).toBe('no-assessment-ahead');
  });

  it('at UTC the same instants read as before', async () => {
    expect(await kindAt('UTC', '2026-09-15T00:30:00Z')).toBe('unlocked-not-pulled');
    expect(await kindAt('UTC', '2026-09-23T00:30:00Z')).toBe('no-assessment-ahead');
  });
});
