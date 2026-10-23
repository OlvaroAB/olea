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

async function kindAt(tz: string, iso: string, due: string = DUE): Promise<string> {
  process.env.TZ = tz;
  const provider = createLocalPracticePaperProvider({
    vault: vaultDue(due),
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

// ---- daylight-saving boundaries (ol-egov.141.89.7.109, [D-621]) ----
// Every instant is hard-coded in UTC with its local time and offset beside it. Each case checks (a) that
// the UTC instant really is the local wall clock claimed, and (b) where flagged, that the UTC date
// differs from the local date: that is the instant where counting on the UTC date gives the other answer.

interface DstCase {
  due: string;
  iso: string;
  local: string; // intended local wall clock, 'YYYY-MM-DD, HH:MM'
  kind: 'locked' | 'unlocked-not-pulled' | 'no-assessment-ahead';
  discriminates: boolean; // true when the UTC date differs from the local date
}

function wallClock(tz: string, iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

async function checkCases(tz: string, cases: DstCase[]): Promise<void> {
  for (const c of cases) {
    expect(wallClock(tz, c.iso), `${tz} ${c.iso} wall clock`).toBe(c.local);
    const utcDate = new Date(c.iso).toISOString().slice(0, 10);
    const localDate = c.local.slice(0, 10);
    expect(utcDate !== localDate, `${tz} ${c.iso} UTC date vs local date`).toBe(c.discriminates);
    expect(await kindAt(tz, c.iso, c.due), `${tz} ${c.iso} due ${c.due}`).toBe(c.kind);
  }
  expect(cases.some((c) => c.discriminates)).toBe(true);
}

describe('daylight-saving boundaries (ol-egov.141.89.7.109, [D-621])', () => {
  it('Europe/London: unlock and expiry hold at local midnight across the spring and autumn changes', async () => {
    await checkCases('Europe/London', [
      // Spring 2026-03-29 (01:00 UTC). Unlock for due 04-06 is local midnight 03-30, already BST.
      {
        due: '2026-04-06',
        iso: '2026-03-29T22:30:00Z',
        local: '2026-03-29, 23:30',
        kind: 'locked',
        discriminates: false,
      }, // BST UTC+1
      {
        due: '2026-04-06',
        iso: '2026-03-29T23:30:00Z',
        local: '2026-03-30, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // BST UTC+1; UTC date 03-29 would say locked
      // Expiry for due 03-29 is local midnight 03-30 (BST).
      {
        due: '2026-03-29',
        iso: '2026-03-29T22:30:00Z',
        local: '2026-03-29, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // BST UTC+1
      {
        due: '2026-03-29',
        iso: '2026-03-29T23:30:00Z',
        local: '2026-03-30, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: true,
      }, // BST UTC+1; UTC date 03-29 would say still offered
      // Autumn 2026-10-25 (01:00 UTC). Unlock for due 11-01 is local midnight 10-25, still BST.
      {
        due: '2026-11-01',
        iso: '2026-10-24T22:30:00Z',
        local: '2026-10-24, 23:30',
        kind: 'locked',
        discriminates: false,
      }, // BST UTC+1
      {
        due: '2026-11-01',
        iso: '2026-10-24T23:30:00Z',
        local: '2026-10-25, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // BST UTC+1; UTC date 10-24 would say locked
      // Expiry for due 10-25 is local midnight 10-26, now GMT.
      {
        due: '2026-10-25',
        iso: '2026-10-25T23:30:00Z',
        local: '2026-10-25, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // GMT UTC+0
      {
        due: '2026-10-25',
        iso: '2026-10-26T00:30:00Z',
        local: '2026-10-26, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: false,
      }, // GMT UTC+0
    ]);
  });

  it('America/New_York: unlock and expiry hold at local midnight across the spring and autumn changes', async () => {
    await checkCases('America/New_York', [
      // Spring 2026-03-08 (02:00 local). Unlock for due 03-15 is local midnight 03-08 (EST).
      {
        due: '2026-03-15',
        iso: '2026-03-08T04:30:00Z',
        local: '2026-03-07, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // EST UTC-5; UTC date 03-08 would say unlocked
      {
        due: '2026-03-15',
        iso: '2026-03-08T05:30:00Z',
        local: '2026-03-08, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // EST UTC-5
      // Expiry for due 03-08 is local midnight 03-09 (EDT).
      {
        due: '2026-03-08',
        iso: '2026-03-09T03:30:00Z',
        local: '2026-03-08, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // EDT UTC-4; UTC date 03-09 would say expired
      {
        due: '2026-03-08',
        iso: '2026-03-09T04:30:00Z',
        local: '2026-03-09, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: false,
      }, // EDT UTC-4
      // Autumn 2026-11-01 (02:00 local). Unlock for due 11-08 is local midnight 11-01 (EDT).
      {
        due: '2026-11-08',
        iso: '2026-11-01T03:30:00Z',
        local: '2026-10-31, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // EDT UTC-4; UTC date 11-01 would say unlocked
      {
        due: '2026-11-08',
        iso: '2026-11-01T04:30:00Z',
        local: '2026-11-01, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // EDT UTC-4
      // Expiry for due 11-01 is local midnight 11-02 (EST).
      {
        due: '2026-11-01',
        iso: '2026-11-02T04:30:00Z',
        local: '2026-11-01, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // EST UTC-5; UTC date 11-02 would say expired
      {
        due: '2026-11-01',
        iso: '2026-11-02T05:30:00Z',
        local: '2026-11-02, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: false,
      }, // EST UTC-5
    ]);
  });

  it('Australia/Sydney: unlock and expiry hold at local midnight across the autumn and spring changes', async () => {
    await checkCases('Australia/Sydney', [
      // DST ends 2026-04-05 (03:00 local). Unlock for due 04-12 is local midnight 04-05 (AEDT).
      {
        due: '2026-04-12',
        iso: '2026-04-04T12:30:00Z',
        local: '2026-04-04, 23:30',
        kind: 'locked',
        discriminates: false,
      }, // AEDT UTC+11
      {
        due: '2026-04-12',
        iso: '2026-04-04T13:30:00Z',
        local: '2026-04-05, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // AEDT UTC+11; UTC date 04-04 would say locked
      // Expiry for due 04-05 is local midnight 04-06 (AEST).
      {
        due: '2026-04-05',
        iso: '2026-04-05T13:30:00Z',
        local: '2026-04-05, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // AEST UTC+10
      {
        due: '2026-04-05',
        iso: '2026-04-05T14:30:00Z',
        local: '2026-04-06, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: true,
      }, // AEST UTC+10; UTC date 04-05 would say still offered
      // DST starts 2026-10-04 (02:00 local). Unlock for due 10-11 is local midnight 10-04 (AEST).
      {
        due: '2026-10-11',
        iso: '2026-10-03T13:30:00Z',
        local: '2026-10-03, 23:30',
        kind: 'locked',
        discriminates: false,
      }, // AEST UTC+10
      {
        due: '2026-10-11',
        iso: '2026-10-03T14:30:00Z',
        local: '2026-10-04, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // AEST UTC+10; UTC date 10-03 would say locked
      // Expiry for due 10-04 is local midnight 10-05 (AEDT).
      {
        due: '2026-10-04',
        iso: '2026-10-04T12:30:00Z',
        local: '2026-10-04, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // AEDT UTC+11
      {
        due: '2026-10-04',
        iso: '2026-10-04T13:30:00Z',
        local: '2026-10-05, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: true,
      }, // AEDT UTC+11; UTC date 10-04 would say still offered
    ]);
  });

  it('America/Santiago: the repeated 23:30 reads one local date, and the missing midnight hour does not move the day', async () => {
    await checkCases('America/Santiago', [
      // DST ends 2026-04-05: local 24:00 on 04-04 goes back to 23:00, so 23:30 on 04-04 happens twice.
      // Due 04-04: both passes are the due day, still offered. UTC date is 04-05 for both.
      {
        due: '2026-04-04',
        iso: '2026-04-05T02:30:00Z',
        local: '2026-04-04, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // first pass, CLST UTC-3; UTC date 04-05 would say expired
      {
        due: '2026-04-04',
        iso: '2026-04-05T03:30:00Z',
        local: '2026-04-04, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // second pass, CLT UTC-4; UTC date 04-05 would say expired
      // Due 04-12: 04-04 is day -8, so both passes are locked (UTC date 04-05 would say unlocked).
      {
        due: '2026-04-12',
        iso: '2026-04-05T02:30:00Z',
        local: '2026-04-04, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // first pass, CLST UTC-3
      {
        due: '2026-04-12',
        iso: '2026-04-05T03:30:00Z',
        local: '2026-04-04, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // second pass, CLT UTC-4
      // Expiry for due 04-04 is local midnight 04-05 (CLT).
      {
        due: '2026-04-04',
        iso: '2026-04-05T04:30:00Z',
        local: '2026-04-05, 00:30',
        kind: 'no-assessment-ahead',
        discriminates: false,
      }, // CLT UTC-4
      // Unlock for due 04-11 is local midnight 04-04 (CLST).
      {
        due: '2026-04-11',
        iso: '2026-04-04T02:30:00Z',
        local: '2026-04-03, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // CLST UTC-3; UTC date 04-04 would say unlocked
      {
        due: '2026-04-11',
        iso: '2026-04-04T03:30:00Z',
        local: '2026-04-04, 00:30',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // CLST UTC-3
      // DST starts 2026-09-06: local 00:00 jumps to 01:00, so 00:00-00:59 does not exist.
      // Due 09-05: expiry is local midnight 09-06, which does not exist; 01:00 is the first local time of 09-06.
      {
        due: '2026-09-05',
        iso: '2026-09-06T03:30:00Z',
        local: '2026-09-05, 23:30',
        kind: 'unlocked-not-pulled',
        discriminates: true,
      }, // CLT UTC-4; UTC date 09-06 would say expired
      {
        due: '2026-09-05',
        iso: '2026-09-06T04:00:00Z',
        local: '2026-09-06, 01:00',
        kind: 'no-assessment-ahead',
        discriminates: false,
      }, // first instant of 09-06, CLST UTC-3
      // Due 09-13: unlock is the same missing midnight; 23:30 on 09-05 is day -8, 01:00 on 09-06 is day -7.
      {
        due: '2026-09-13',
        iso: '2026-09-06T03:30:00Z',
        local: '2026-09-05, 23:30',
        kind: 'locked',
        discriminates: true,
      }, // CLT UTC-4; UTC date 09-06 would say unlocked
      {
        due: '2026-09-13',
        iso: '2026-09-06T04:00:00Z',
        local: '2026-09-06, 01:00',
        kind: 'unlocked-not-pulled',
        discriminates: false,
      }, // first instant of 09-06, CLST UTC-3
    ]);
  });
});
