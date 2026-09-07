/**
 * `createVaultMisconceptionStore` (`ol-2zfj.22`) — driven against a plain
 * in-memory `VaultSource`, no Obsidian anywhere, same discipline
 * `test/today/data-source.spec.ts` follows for its own vault-backed sources.
 *
 * Synthetic study material only (INV-3) — invented concept ids and wording,
 * never real vault content.
 */

import type {
  MisconceptionObservedEvent,
  MisconceptionResolutionEvidenceEvent,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultMisconceptionStore } from '../../src/misconception/store.js';

interface McqObservedOverrides {
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly instrumentId?: string;
  readonly conceptIds?: readonly string[];
  readonly reviewEventId?: string;
  readonly misconceptionId?: string;
  readonly distractor?: {
    readonly text: string;
    readonly believes: string;
    readonly source_says: string;
  };
}

/** One `kind: 'misconception-observed'` review-log line (`[D-202]`/`[D-220]`, `misconceptionObservedLogRecordV5`). */
function mcqObservedLine(overrides: McqObservedOverrides = {}): string {
  const record = {
    schemaVersion: 5,
    kind: 'misconception-observed',
    eventId: 'mcq-event-1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'mcq:concept-alpha:1',
    conceptIds: ['Concept Alpha'],
    reviewEventId: 'review-event-1',
    // Client-minted, fresh every write ([D-202]) — never used as the fold's
    // identity key (see `olea-core`'s `store.ts` module doc); present only
    // because the schema requires it.
    misconceptionId: 'mcq-minted-id-1',
    distractor: {
      text: 'Y always follows X',
      believes: 'Believes X always implies Y.',
      source_says: 'X implies Y only under condition Z.',
    },
    ...overrides,
  };
  return `${JSON.stringify(record)}\n`;
}

const DEVICE = 'olea-testdevice1';
const OTHER_DEVICE = 'olea-herphone01';

function observedLine(overrides: Partial<MisconceptionObservedEvent> = {}): string {
  const event: MisconceptionObservedEvent = {
    schemaVersion: 1,
    kind: 'observed',
    eventId: 'event-1',
    timestamp: '2026-08-10T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: 'misconception-1',
    conceptId: 'Concept Alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 3 },
    ...overrides,
  };
  return `${JSON.stringify(event)}\n`;
}

function resolutionLine(overrides: Partial<MisconceptionResolutionEvidenceEvent> = {}): string {
  const event: MisconceptionResolutionEvidenceEvent = {
    schemaVersion: 1,
    kind: 'resolution-evidence',
    eventId: 'event-2',
    timestamp: '2026-08-11T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:2',
    originReviewEventId: null,
    conceptId: 'Concept Alpha',
    evidenceKind: 'recall',
    ...overrides,
  };
  return `${JSON.stringify(event)}\n`;
}

interface FakeVaultOptions {
  /** Whether `list()` can see the dot-prefixed log folder, as a real host may or may not. */
  readonly listSeesDotFolder?: boolean;
  /** When set, every method throws — simulates a vault that cannot be read at all. */
  readonly broken?: boolean;
}

function fakeVault(
  files: Record<string, string>,
  options: FakeVaultOptions = {},
): { vault: VaultSource; reads: string[] } {
  const reads: string[] = [];
  const unreachable = (name: string) => () => {
    throw new Error(`the misconception store must not call VaultSource.${name}`);
  };
  const vault = {
    async list(listOptions?: { under?: string }) {
      if (options.broken === true) throw new Error('list() failed');
      if (options.listSeesDotFolder !== true) return [];
      const under = listOptions?.under;
      const names = Object.keys(files);
      return (
        under === undefined ? names : names.filter((path) => path.startsWith(`${under}/`))
      ).sort();
    },
    async exists(path: string) {
      if (options.broken === true) throw new Error('exists() failed');
      return Object.hasOwn(files, path);
    },
    async read(path: string) {
      if (options.broken === true) throw new Error('read() failed');
      reads.push(path);
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    readBinary: unreachable('readBinary'),
    write: unreachable('write'),
    watch: unreachable('watch'),
  } as unknown as VaultSource;
  return { vault, reads };
}

function logPath(day: string, deviceId: string): string {
  return `.olea/misconceptions/${day}.${deviceId}.jsonl`;
}

function reviewPath(day: string, deviceId: string): string {
  return `.olea/reviews/${day}.${deviceId}.jsonl`;
}

describe('createVaultMisconceptionStore', () => {
  it('projects this device"s own log by exact path, on a host that cannot list the dot folder', async () => {
    const { vault } = fakeVault(
      { [logPath('2026-08-10', DEVICE)]: observedLine() },
      { listSeesDotFolder: false },
    );
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-10T12:00:00-04:00'),
    });

    const records = await store.load();
    expect(records).not.toBeNull();
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      id: 'misconception-1',
      conceptId: 'Concept Alpha',
      confusedWithConceptId: null,
      status: 'active',
      occurrenceCount: 1,
    });
  });

  it('merges another device"s log when the host does surface the dot folder', async () => {
    const { vault } = fakeVault(
      {
        [logPath('2026-08-10', DEVICE)]: observedLine({ eventId: 'event-1' }),
        [logPath('2026-08-10', OTHER_DEVICE)]: observedLine({
          eventId: 'event-3',
          misconceptionId: 'misconception-1',
          timestamp: '2026-08-10T10:00:00-04:00',
        }),
      },
      { listSeesDotFolder: true },
    );
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-10T12:00:00-04:00'),
    });

    const records = await store.load();
    expect(records).toHaveLength(1);
    // Both events fold onto the same misconceptionId — recurrence, not a duplicate record.
    expect(records?.[0]?.occurrenceCount).toBe(2);
  });

  it('folds resolution evidence into status, same as the core projection', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: observedLine(),
      [logPath('2026-08-11', DEVICE)]: resolutionLine(),
    });
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-11T12:00:00-04:00'),
    });

    const records = await store.load();
    expect(records?.[0]?.status).toBe('fading');
  });

  it('a vault with no misconception log at all is an empty projection, not an error', async () => {
    const { vault } = fakeVault({});
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-10T12:00:00-04:00'),
    });

    expect(await store.load()).toEqual([]);
  });

  it('returns null, never [], when the vault cannot be read at all', async () => {
    const { vault } = fakeVault({}, { broken: true });
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-10T12:00:00-04:00'),
    });

    expect(await store.load()).toBeNull();
  });

  it('a duplicate eventId across two "device" files is folded once, not double-counted', async () => {
    const { vault } = fakeVault(
      {
        [logPath('2026-08-10', DEVICE)]: observedLine({ eventId: 'event-1' }),
        [logPath('2026-08-10', OTHER_DEVICE)]: observedLine({ eventId: 'event-1' }),
      },
      { listSeesDotFolder: true },
    );
    const store = createVaultMisconceptionStore({
      vault,
      deviceId: DEVICE,
      now: () => new Date('2026-08-10T12:00:00-04:00'),
    });

    const records = await store.load();
    expect(records?.[0]?.occurrenceCount).toBe(1);
  });

  describe('Stream B: review-log misconception-observed picks (`[D-202]`, `ol-2zfj.74`)', () => {
    it('a review-log MCQ pick alone projects into a real record, no explain-back event needed', async () => {
      const { vault } = fakeVault(
        { [reviewPath('2026-08-10', DEVICE)]: mcqObservedLine() },
        { listSeesDotFolder: false },
      );
      const store = createVaultMisconceptionStore({
        vault,
        deviceId: DEVICE,
        now: () => new Date('2026-08-10T12:00:00-04:00'),
      });

      const records = await store.load();
      expect(records).not.toBeNull();
      expect(records).toHaveLength(1);
      expect(records?.[0]).toMatchObject({
        conceptId: 'Concept Alpha',
        status: 'active',
        occurrenceCount: 1,
        statement: 'Believes X always implies Y.',
        correction: 'X implies Y only under condition Z.',
      });
    });

    it('repeated picks of the same distractor accumulate occurrenceCount via the deterministic fallback key', async () => {
      const { vault } = fakeVault(
        {
          [reviewPath('2026-08-10', DEVICE)]: mcqObservedLine({ eventId: 'mcq-event-1' }),
          [reviewPath('2026-08-12', DEVICE)]: mcqObservedLine({
            eventId: 'mcq-event-2',
            reviewEventId: 'review-event-2',
            timestamp: '2026-08-12T09:00:00-04:00',
            // A fresh minted id per [D-202] — the fold must key on
            // (instrumentId, conceptId, distractor.text), never on this.
            misconceptionId: 'mcq-minted-id-2',
          }),
        },
        { listSeesDotFolder: false },
      );
      const store = createVaultMisconceptionStore({
        vault,
        deviceId: DEVICE,
        now: () => new Date('2026-08-12T12:00:00-04:00'),
      });

      const records = await store.load();
      expect(records).toHaveLength(1);
      expect(records?.[0]?.occurrenceCount).toBe(2);
    });

    it('an explain-back (Stream A) resolution fold downgrades an MCQ-origin (Stream B) record on the same concept', async () => {
      const { vault } = fakeVault({
        [reviewPath('2026-08-10', DEVICE)]: mcqObservedLine(),
        [logPath('2026-08-11', DEVICE)]: resolutionLine(),
      });
      const store = createVaultMisconceptionStore({
        vault,
        deviceId: DEVICE,
        now: () => new Date('2026-08-11T12:00:00-04:00'),
      });

      const records = await store.load();
      expect(records).toHaveLength(1);
      expect(records?.[0]?.status).toBe('fading');
    });

    it('a non-misconception review-log record (an ordinary review) contributes nothing', async () => {
      const ordinaryReview = `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'review-1',
        timestamp: '2026-08-10T09:00:00-04:00',
        instrumentId: 'qa:concept-alpha:1',
        instrumentType: 'qa',
        conceptIds: ['Concept Alpha'],
        rating: 3,
        correctness: { matchedKey: true },
      })}\n`;
      const { vault } = fakeVault(
        { [reviewPath('2026-08-10', DEVICE)]: ordinaryReview },
        { listSeesDotFolder: false },
      );
      const store = createVaultMisconceptionStore({
        vault,
        deviceId: DEVICE,
        now: () => new Date('2026-08-10T12:00:00-04:00'),
      });

      expect(await store.load()).toEqual([]);
    });
  });
});
