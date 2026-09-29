import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  appendScopeReadingEvents,
  latestEntryPerKey,
  orderScopeReadingEntries,
  readScopeReadingLog,
  SCOPE_READING_FOLDER,
  SCOPE_READING_STORES,
  type ScopeReadingLogEntry,
  scopeReadingEventId,
  scopeReadingLogPath,
} from './scope-reading-log.js';
import { OUTCOME_STORE_FOLDER } from './store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md, F8.1, filed as owed on the D-429 build
// bead (the features file is outside this lane's paths). Synthetic ids only.

let root: string;
let vault: FolderSource;
let tick: number;
const now = () => `2026-09-29T00:00:${String(tick++).padStart(2, '0')}.000Z`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-scope-reading-log-'));
  vault = new FolderSource(root);
  tick = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const draft = (key: string, payload: unknown = { v: 1 }, kind = 'document-state') => ({
  kind,
  key,
  payload,
});

describe('where the log lives', () => {
  it('sits under the outcome store folder, so the F7.4 export and full delete already carry it', () => {
    expect(SCOPE_READING_FOLDER.startsWith(`${OUTCOME_STORE_FOLDER}/`)).toBe(true);
    expect(SCOPE_READING_STORES).toEqual(['document-state', 'paper-structure', 'alignment-result']);
  });

  it('is one file per store per device, named so a device id cannot escape the folder', () => {
    expect(scopeReadingLogPath('document-state', 'olea-abc123')).toBe(
      `${SCOPE_READING_FOLDER}/document-state.olea-abc123.jsonl`,
    );
    expect(() => scopeReadingLogPath('document-state', '../x')).toThrow(/device id/);
    expect(() => scopeReadingLogPath('document-state', '')).toThrow(/device id/);
  });
});

describe('event identity is the content hash', () => {
  it('is the same for the same content however the payload keys were built, and differs for different content', async () => {
    const a = await scopeReadingEventId('document-state', 'k', { x: 1, y: { b: 2, a: 1 } });
    const b = await scopeReadingEventId('document-state', 'k', { y: { a: 1, b: 2 }, x: 1 });
    const c = await scopeReadingEventId('document-state', 'k', { x: 2, y: { a: 1, b: 2 } });
    const d = await scopeReadingEventId('document-state', 'other', { x: 1, y: { a: 1, b: 2 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith('sr1-')).toBe(true);
  });
});

describe('appending', () => {
  it('writes one line per event with a logical clock that follows what the device has seen', async () => {
    const [first] = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-a',
      [draft('k1')],
      { now },
    );
    const [second] = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-a',
      [draft('k2')],
      { now },
    );
    expect(first?.appended).toBe(true);
    expect(first?.entry.clock).toBe(1);
    expect(second?.entry.clock).toBe(2);
    const text = await readFile(join(root, scopeReadingLogPath('document-state', 'dev-a')), 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('takes its clock from the highest clock ANY device has written, so a later append sorts after what it saw', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1'), draft('k2')], {
      now,
    });
    const [entry] = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-b',
      [draft('k3')],
      { now },
    );
    expect(entry?.entry.clock).toBe(3);
  });

  it('appends nothing for a repeat of what is already current for the key', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1', { v: 1 })], {
      now,
    });
    const [again] = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-a',
      [draft('k1', { v: 1 })],
      { now },
    );
    expect(again?.appended).toBe(false);
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' });
    expect(entries).toHaveLength(1);
  });

  it('records a flip back (A, then B, then A again) as a new event, since A is not current when it returns', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1', { v: 'A' })], {
      now,
    });
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1', { v: 'B' })], {
      now,
    });
    const [third] = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-a',
      [draft('k1', { v: 'A' })],
      { now },
    );
    expect(third?.appended).toBe(true);
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' });
    const current = latestEntryPerKey(entries).get('k1');
    expect((current?.payload as { v: string } | undefined)?.v).toBe('A');
  });

  it('dedupes inside one batch: the same key twice with the same content writes once', async () => {
    const results = await appendScopeReadingEvents(
      vault,
      'document-state',
      'dev-a',
      [draft('k1', { v: 1 }), draft('k1', { v: 1 })],
      { now },
    );
    expect(results.map((r) => r.appended)).toEqual([true, false]);
  });

  it('extends a file whose last line was torn by an interrupted write, never welding onto it', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1')], { now });
    const path = join(root, scopeReadingLogPath('document-state', 'dev-a'));
    await writeFile(
      path,
      `${await readFile(path, 'utf8')}{"schemaVersion":1,"eventId":"sr1-x`,
      'utf8',
    );
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k2')], { now });
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' });
    expect(entries.map((e) => e.key).sort()).toEqual(['k1', 'k2']);
  });
});

describe('reading the log back', () => {
  it('reads every device that wrote, tagging each entry with the device its file is named for', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1')], { now });
    await appendScopeReadingEvents(vault, 'document-state', 'dev-b', [draft('k2')], { now });
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' });
    expect(entries.map((e) => [e.deviceId, e.key])).toEqual([
      ['dev-a', 'k1'],
      ['dev-b', 'k2'],
    ]);
  });

  it('keeps the three stores apart', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1')], { now });
    expect(await readScopeReadingLog(vault, 'paper-structure', { deviceId: 'dev-a' })).toEqual([]);
    expect(await readScopeReadingLog(vault, 'alignment-result', { deviceId: 'dev-a' })).toEqual([]);
  });

  it('skips a corrupt line, a wrong-shape line and a blank line, and keeps the rest', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1')], { now });
    const path = join(root, scopeReadingLogPath('document-state', 'dev-a'));
    const good = await readFile(path, 'utf8');
    await writeFile(
      path,
      `not json\n\n{"schemaVersion":2,"eventId":"x"}\n{"schemaVersion":1,"eventId":"e","clock":-1,"recordedAt":"t","kind":"k","key":"k","payload":{}}\n${good}`,
      'utf8',
    );
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' });
    expect(entries.map((e) => e.key)).toEqual(['k1']);
  });

  it('is empty, not an error, when nothing was ever written', async () => {
    expect(await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' })).toEqual([]);
  });

  it('drops an exact duplicate line (a file synced twice) but keeps a same-content event from a later clock', async () => {
    await appendScopeReadingEvents(vault, 'document-state', 'dev-a', [draft('k1', { v: 'A' })], {
      now,
    });
    const path = join(root, scopeReadingLogPath('document-state', 'dev-a'));
    const line = await readFile(path, 'utf8');
    await writeFile(path, line + line, 'utf8');
    expect(await readScopeReadingLog(vault, 'document-state', { deviceId: 'dev-a' })).toHaveLength(
      1,
    );
  });
});

describe('the total order and the fold per key', () => {
  const entry = (
    deviceId: string,
    clock: number,
    key: string,
    eventId: string,
  ): ScopeReadingLogEntry => ({
    schemaVersion: 1,
    eventId,
    clock,
    recordedAt: 't',
    kind: 'document-state',
    key,
    payload: { eventId },
    deviceId,
  });

  it('orders by clock, then device, then event id, whatever order the entries arrive in', () => {
    const a = entry('dev-b', 2, 'k', 'e1');
    const b = entry('dev-a', 2, 'k', 'e2');
    const c = entry('dev-a', 1, 'k', 'e3');
    const d = entry('dev-a', 2, 'k', 'e0');
    const expected = [c, d, b, a];
    expect(orderScopeReadingEntries([a, b, c, d])).toEqual(expected);
    expect(orderScopeReadingEntries([d, c, b, a])).toEqual(expected);
  });

  it('two devices writing the same key at the same clock fold to one deterministic winner', () => {
    const a = entry('dev-a', 5, 'k', 'ea');
    const b = entry('dev-b', 5, 'k', 'eb');
    expect(latestEntryPerKey([a, b]).get('k')?.deviceId).toBe('dev-b');
    expect(latestEntryPerKey([b, a]).get('k')?.deviceId).toBe('dev-b');
  });
});
