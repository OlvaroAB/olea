/**
 * `simulator/seed-events.ts` (`ol-3ux7.64.16` [WBX-13], consuming
 * `ol-3ux7.64.15` [WBX-14]'s contract — `eval/data/persona-synthetic/worlds/
 * README.md`'s "The file-path convention for laying `seed-events.json` into
 * the simulator's vault" section).
 *
 * An invented seed array stands in for a real persona's `seed-events.json` —
 * INV-3 keeps real persona data out of this public repo, and none of this
 * module's logic depends on what a record's OTHER fields are, only on its
 * `timestamp`.
 */
import { describe, expect, it } from 'vitest';
import {
  layOutSeedEventsByDay,
  loadSimulatorSeedEvents,
  personaDeviceId,
  type SimulatorSeedEventRecord,
  writeSeedEventsIntoVault,
} from '../src/simulator/seed-events.js';

function record(timestamp: string, extra: Record<string, unknown> = {}): SimulatorSeedEventRecord {
  return { timestamp, kind: 'review', ...extra } as SimulatorSeedEventRecord;
}

describe('loadSimulatorSeedEvents', () => {
  it('parses a well-formed array of records', async () => {
    const raw = [record('2026-08-01T09:00:00+00:00'), record('2026-08-02T09:00:00+00:00')];
    const fetchFn = (async () =>
      new Response(JSON.stringify(raw), { status: 200 })) as typeof fetch;

    const result = await loadSimulatorSeedEvents(fetchFn);
    expect(result.available).toBe(true);
    expect(result.records).toHaveLength(2);
  });

  it('drops a malformed entry (no timestamp) without dropping the rest', async () => {
    const raw = [record('2026-08-01T09:00:00+00:00'), { kind: 'review' }, 'not even an object'];
    const fetchFn = (async () =>
      new Response(JSON.stringify(raw), { status: 200 })) as typeof fetch;

    const result = await loadSimulatorSeedEvents(fetchFn);
    expect(result.available).toBe(true);
    expect(result.records).toHaveLength(1);
  });

  it('reports unavailable, never throws, on a 404', async () => {
    const fetchFn = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const result = await loadSimulatorSeedEvents(fetchFn);
    expect(result).toEqual({ records: [], available: false });
  });

  it('reports unavailable on a non-array JSON body', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ not: 'an array' }), { status: 200 })) as typeof fetch;
    const result = await loadSimulatorSeedEvents(fetchFn);
    expect(result).toEqual({ records: [], available: false });
  });

  it('reports unavailable, never throws, when fetch itself rejects', async () => {
    const fetchFn = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const result = await loadSimulatorSeedEvents(fetchFn);
    expect(result).toEqual({ records: [], available: false });
  });
});

describe('layOutSeedEventsByDay', () => {
  it('groups records by the calendar-day portion of their timestamp, one file per day', () => {
    const records = [
      record('2026-08-01T09:00:00+00:00', { eventId: 'e1' }),
      record('2026-08-01T18:00:00+00:00', { eventId: 'e2' }),
      record('2026-08-02T09:00:00+00:00', { eventId: 'e3' }),
    ];

    const byPath = layOutSeedEventsByDay(records, 'persona-steady-device');

    expect([...byPath.keys()].sort()).toEqual([
      '.olea/reviews/2026-08-01.persona-steady-device.jsonl',
      '.olea/reviews/2026-08-02.persona-steady-device.jsonl',
    ]);
    const day1 = byPath.get('.olea/reviews/2026-08-01.persona-steady-device.jsonl') ?? '';
    // Two lines, chronological (array order), trailing newline.
    expect(day1).toBe(`${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n`);
    expect(day1.endsWith('\n')).toBe(true);
    const day2 = byPath.get('.olea/reviews/2026-08-02.persona-steady-device.jsonl') ?? '';
    expect(day2).toBe(`${JSON.stringify(records[2])}\n`);
  });

  it('an empty record set lays out no files', () => {
    expect(layOutSeedEventsByDay([], 'device').size).toBe(0);
  });

  it('preserves every field a record carries — never re-shapes the record it was handed', () => {
    const withExtras = record('2026-08-01T09:00:00+00:00', {
      eventId: 'e1',
      instrumentId: 'syn:inst:abc:mcq',
      rating: 'good',
    });
    const byPath = layOutSeedEventsByDay([withExtras], 'device');
    const content = [...byPath.values()][0] ?? '';
    expect(JSON.parse(content.trim())).toEqual(withExtras);
  });
});

describe('writeSeedEventsIntoVault', () => {
  it('writes one vault.write call per day, with the exact grouped content', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const vault = {
      write: async (path: string, content: string) => {
        writes.push({ path, content });
      },
    };

    const records = [
      record('2026-08-01T09:00:00+00:00', { eventId: 'e1' }),
      record('2026-08-02T09:00:00+00:00', { eventId: 'e2' }),
    ];
    const count = await writeSeedEventsIntoVault(vault, records, 'device-x');

    expect(count).toBe(2);
    expect(writes.map((w) => w.path).sort()).toEqual([
      '.olea/reviews/2026-08-01.device-x.jsonl',
      '.olea/reviews/2026-08-02.device-x.jsonl',
    ]);
  });

  it('writes nothing for an empty record set', async () => {
    let calls = 0;
    const vault = {
      write: async () => {
        calls += 1;
      },
    };
    const count = await writeSeedEventsIntoVault(vault, [], 'device-x');
    expect(count).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('personaDeviceId', () => {
  it('extracts a valid string deviceId', () => {
    expect(personaDeviceId({ deviceId: 'persona-steady-device' })).toBe('persona-steady-device');
  });

  it('returns undefined for every shape that is not a usable device id', () => {
    expect(personaDeviceId(undefined)).toBeUndefined();
    expect(personaDeviceId(null)).toBeUndefined();
    expect(personaDeviceId('a string, not an object')).toBeUndefined();
    expect(personaDeviceId({})).toBeUndefined();
    expect(personaDeviceId({ deviceId: '' })).toBeUndefined();
    expect(personaDeviceId({ deviceId: 42 })).toBeUndefined();
  });
});
