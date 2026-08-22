import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { misconceptionLogPath } from './path.js';
import type { MisconceptionEvent } from './types.js';
import { appendMisconceptionEvent } from './write.js';

const CITATION = { path: 'Courses/Sample/notes.md', blockIndex: 1 };

function observedEvent(overrides: Partial<MisconceptionEvent> = {}): MisconceptionEvent {
  return {
    schemaVersion: 1,
    kind: 'observed',
    eventId: 'e1',
    timestamp: '2026-08-16T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: 'm-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: CITATION,
    ...overrides,
  } as MisconceptionEvent;
}

describe('appendMisconceptionEvent', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-misconception-log-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes to the day/device path derived from the timestamp', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendMisconceptionEvent(source, observedEvent(), 'desktop');
    expect(result.path).toBe(misconceptionLogPath('2026-08-16', 'desktop'));

    const raw = await readFile(join(tempRoot, result.path), 'utf8');
    expect(raw).toBe(`${JSON.stringify(result.event)}\n`);
  });

  it('a second append adds exactly one more line and never rewrites the first', async () => {
    const source = new FolderSource(tempRoot);
    const first = await appendMisconceptionEvent(
      source,
      observedEvent({ eventId: 'e1' }),
      'desktop',
    );
    const second = await appendMisconceptionEvent(
      source,
      observedEvent({ eventId: 'e2', misconceptionId: 'm-2' }),
      'desktop',
    );

    const raw = await readFile(join(tempRoot, first.path), 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(JSON.stringify(first.event));
    expect(lines[1]).toBe(JSON.stringify(second.event));
  });

  it('closes off a crash-truncated trailing line with its own newline rather than welding onto it', async () => {
    const source = new FolderSource(tempRoot);
    const path = misconceptionLogPath('2026-08-16', 'desktop');
    // Simulate a previous append interrupted mid-write: no trailing newline.
    const corrupt = '{"schemaVersion":1,"kind":"observ';
    await source.write(path, corrupt);

    const result = await appendMisconceptionEvent(
      source,
      observedEvent({ eventId: 'e2' }),
      'desktop',
    );
    const raw = await readFile(join(tempRoot, result.path), 'utf8');

    expect(raw.startsWith(corrupt)).toBe(true);
    expect(raw).toBe(`${corrupt}\n${JSON.stringify(result.event)}\n`);
  });

  it('two different devices on the same day write to two different files', async () => {
    const source = new FolderSource(tempRoot);
    const laptop = await appendMisconceptionEvent(
      source,
      observedEvent({ eventId: 'e1' }),
      'laptop',
    );
    const phone = await appendMisconceptionEvent(
      source,
      observedEvent({ eventId: 'e2', misconceptionId: 'm-2' }),
      'phone',
    );
    expect(laptop.path).not.toBe(phone.path);
  });
});
