// D7.1 / `[D-614]` (ol-egov.141.89.6.128): each answer she saves in the v0.9 practice view is
// written once as a practice explanation, when she leaves it by "Done" or "Try again", carrying
// the support actually shown before she wrote it, read from her log as well as the open view.
// Scenarios: `features/F5-explain-it-back.md` (olea-service), "D7.1 / [D-614] — a practice
// explanation is its own log entry", the four tagged `core/review-log/write-practice-explanation.spec`.
// Real writers on a real folder: the view's `[D-460]` marker writer, then this one, in the order
// the view calls them. Ids and text are structural placeholders (INV-3).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewLogEntry } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReviewLogHistory } from '../session/history.js';
import { FolderSource } from '../vault/folder-source.js';
import { CONTENT_STORE_FOLDER, contentStorePath, readContentRecord } from './content-store.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import {
  appendExplainBackFeedbackShownRecord,
  appendNonAttemptRecord,
  appendPracticeExplanationRecord,
  appendReviewLogRecord,
  type RecordPracticeExplanationInput,
  recordPracticeExplanation,
} from './write.js';

const DAY = '2026-10-23';
const QUESTION = 'explain-back:concept-a';
const ANSWER = 'synthetic answer, first try';

function answer(
  over: Partial<RecordPracticeExplanationInput> = {},
): RecordPracticeExplanationInput {
  return {
    timestamp: '2026-10-23T10:15:00-04:00',
    instrumentId: QUESTION,
    attemptId: 'attempt-1',
    conceptIds: ['concept-a'],
    promptShape: 'concept',
    trigger: 'repeated-failure',
    offerEventId: 'offer-1',
    durationMs: 64000,
    answer: ANSWER,
    passagesShownInView: [],
    ...over,
  };
}

let ids = 0;
function options(deviceId = 'desktop') {
  return {
    deviceId,
    generateEventId: () => {
      ids += 1;
      return `event-${ids}`;
    },
    generateContentId: () => {
      ids += 1;
      return `${deviceId}.content-${ids}`;
    },
  };
}

/** The `[D-460]` marker the view writes before the passages appear for one attempt. */
async function markShown(
  source: FolderSource,
  attemptId: string,
  timestamp: string,
  over: { readonly instrumentId?: string; readonly deviceId?: string } = {},
): Promise<void> {
  await appendExplainBackFeedbackShownRecord(
    source,
    { timestamp, instrumentId: over.instrumentId ?? QUESTION, attemptId },
    { deviceId: over.deviceId ?? 'desktop' },
  );
}

describe('recordPracticeExplanation (D7.1, [D-614])', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-practice-explanation-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function dayText(day = DAY, deviceId = 'desktop'): Promise<string> {
    return readFile(join(root, reviewLogPath(day, deviceId)), 'utf8');
  }

  async function practiceEntries(): Promise<ReviewLogEntry[]> {
    const history = await readReviewLogHistory(source);
    return history.entries.filter((entry) => entry.kind === 'practice-explanation');
  }

  async function contentFiles(): Promise<number> {
    return (await source.listUnder(CONTENT_STORE_FOLDER)).length;
  }

  describe('written once when she leaves an answer by "Done" or "Try again"', () => {
    it('appends one validated line on the shared append-only path, and her text only to the content store', async () => {
      const prior = await appendNonAttemptRecord(
        source,
        { timestamp: '2026-10-23T09:00:00-04:00', conceptIds: ['concept-b'], trigger: 'on-demand' },
        { deviceId: 'desktop', generateEventId: () => 'non-attempt-1' },
      );
      const before = await dayText();

      const result = await recordPracticeExplanation(source, answer(), options());

      expect(result.written).toBe(true);
      if (!result.written) return;
      // The same daily file its siblings use, extended and never rewritten.
      expect(result.path).toBe(prior.path);
      const after = await dayText();
      expect(after.startsWith(before)).toBe(true);
      const line = after.slice(before.length);
      expect(line).toBe(`${JSON.stringify(result.record)}\n`);
      // Stamped: version, kind and event id are the writer's.
      expect(result.record).toMatchObject({
        schemaVersion: 6,
        kind: 'practice-explanation',
        instrumentId: QUESTION,
        attemptId: 'attempt-1',
        conceptIds: ['concept-a'],
        promptShape: 'concept',
        trigger: 'repeated-failure',
        offerEventId: 'offer-1',
        durationMs: 64000,
        supportLevelShown: 'independent',
        contentRef: result.contentId,
      });
      expect(result.record.eventId.length).toBeGreaterThan(0);
      // It reads back as its own kind, never an invalid line.
      const parsed = parseReviewLog(after);
      expect(parsed.invalidLines).toEqual([]);
      expect(parsed.records.map((r) => r.kind)).toEqual(['non-attempt', 'practice-explanation']);
      // Her text: in the content store under the record's contentRef, never on the log line.
      expect(line).not.toContain('synthetic');
      const stored = await readContentRecord(source, result.contentId);
      expect(stored.status).toBe('found');
      if (stored.status === 'found') {
        expect(stored.record.studentAnswer).toBe(ANSWER);
        expect(stored.record.feedback).toBe('');
      }
    });

    it('an answer left by "Try again" and the next left by "Done" are two entries, one each', async () => {
      const first = await recordPracticeExplanation(source, answer(), options());
      const second = await recordPracticeExplanation(
        source,
        answer({
          attemptId: 'attempt-2',
          timestamp: '2026-10-23T10:20:00-04:00',
          answer: 'synthetic answer, second try',
        }),
        options(),
      );
      expect(first.written && second.written).toBe(true);
      expect((await practiceEntries()).map((e) => e.eventId)).toEqual([
        first.record.eventId,
        second.record.eventId,
      ]);
      expect(await contentFiles()).toBe(2);
    });

    it('a record that fails validation writes nothing: no line, and no text in the content store', async () => {
      await expect(
        recordPracticeExplanation(source, answer({ conceptIds: [] }), options()),
      ).rejects.toThrow(/schema validation/);
      await expect(
        recordPracticeExplanation(
          source,
          answer({ trigger: 'on-demand', offerEventId: 'offer-1' }),
          options(),
        ),
      ).rejects.toThrow(/schema validation/);
      expect(await practiceEntries()).toEqual([]);
      expect(await contentFiles()).toBe(0);
    });

    it("the local check's flag is kept as the one literal, and only when it flagged", async () => {
      const flagged = await recordPracticeExplanation(
        source,
        answer({ localCheckFlagged: true }),
        options(),
      );
      const unflagged = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-2', localCheckFlagged: false }),
        options(),
      );
      expect(flagged.record.localCheckFlagged).toBe(true);
      expect('localCheckFlagged' in unflagged.record).toBe(false);
    });
  });

  describe('reopening or reloading writes no second entry', () => {
    it('the same attempt written again — a reopened view, or a reload — writes nothing, not even her text', async () => {
      const first = await recordPracticeExplanation(source, answer(), options());
      const text = await dayText();
      const contents = await contentFiles();

      const again = await recordPracticeExplanation(source, answer(), options());

      expect(again.written).toBe(false);
      expect(again.record).toEqual(first.record);
      expect(await dayText()).toBe(text);
      expect(await contentFiles()).toBe(contents);
    });

    it('idempotent across her devices and days: a record of the attempt on any file is enough', async () => {
      await recordPracticeExplanation(source, answer(), options('laptop'));
      const again = await recordPracticeExplanation(
        source,
        answer({ timestamp: '2026-10-24T08:00:00-04:00' }),
        options('desktop'),
      );
      expect(again.written).toBe(false);
      expect(await practiceEntries()).toHaveLength(1);
    });

    it('two writes of one attempt racing on one install land one line', async () => {
      const [a, b] = await Promise.all([
        recordPracticeExplanation(source, answer(), options()),
        recordPracticeExplanation(source, answer(), options()),
      ]);
      expect([a.written, b.written].filter(Boolean)).toHaveLength(1);
      expect(await practiceEntries()).toHaveLength(1);
    });

    it('the record-level writer is idempotent on the attempt the same way', async () => {
      const first = await recordPracticeExplanation(source, answer(), options());
      const { schemaVersion: _v, kind: _k, eventId: _e, ...fields } = first.record;
      const again = await appendPracticeExplanationRecord(source, fields, { deviceId: 'desktop' });
      expect(again.written).toBe(false);
      expect(await practiceEntries()).toHaveLength(1);
      const fresh = await appendPracticeExplanationRecord(
        source,
        { ...fields, attemptId: 'attempt-9' },
        { deviceId: 'desktop' },
      );
      expect(fresh.written).toBe(true);
      expect(await practiceEntries()).toHaveLength(2);
    });
  });

  describe('a second answer after "Try again" carries the earlier attempt\'s passage exposure', () => {
    it('the first answer records no exposure; the second names the passages shown after the first', async () => {
      // She answers; the view marks the attempt before the passages appear; she reads them and
      // chooses Try again, which saves the first answer.
      await markShown(source, 'attempt-1', '2026-10-23T10:14:00-04:00');
      const first = await recordPracticeExplanation(source, answer(), options());
      // She writes again, the view marks it, shows its passages, and she chooses Done.
      await markShown(source, 'attempt-2', '2026-10-23T10:19:00-04:00');
      const second = await recordPracticeExplanation(
        source,
        answer({
          attemptId: 'attempt-2',
          timestamp: '2026-10-23T10:20:00-04:00',
          passagesShownInView: [
            { attemptId: 'attempt-1', passageFingerprints: ['digest-1', 'digest-2'] },
          ],
        }),
        options(),
      );

      // Its own marker is after it, so the first answer had been shown nothing.
      expect(first.record.supportLevelShown).toBe('independent');
      expect(first.record.passageFingerprints).toBeUndefined();
      // Try again never erases exposure: the second answer names what was shown before it.
      expect(second.record.supportLevelShown).toBe('guided');
      expect(second.record.passageFingerprints).toEqual(['digest-1', 'digest-2']);
    });

    it('a third answer names every passage shown before it, each once, in the order first shown', async () => {
      await markShown(source, 'attempt-1', '2026-10-23T10:14:00-04:00');
      await markShown(source, 'attempt-2', '2026-10-23T10:19:00-04:00');
      const third = await recordPracticeExplanation(
        source,
        answer({
          attemptId: 'attempt-3',
          timestamp: '2026-10-23T10:25:00-04:00',
          passagesShownInView: [
            { attemptId: 'attempt-1', passageFingerprints: ['digest-1', 'digest-2'] },
            { attemptId: 'attempt-2', passageFingerprints: ['digest-2', 'digest-3'] },
          ],
        }),
        options(),
      );
      expect(third.record.passageFingerprints).toEqual(['digest-1', 'digest-2', 'digest-3']);
    });

    it('a view that lost what it showed (a reload) still records the exposure from her log, as the coarser fact', async () => {
      await markShown(source, 'attempt-1', '2026-10-23T10:14:00-04:00');
      await recordPracticeExplanation(source, answer(), options());
      const second = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-2', timestamp: '2026-10-23T10:20:00-04:00' }),
        options(),
      );
      expect(second.record.supportLevelShown).toBe('guided');
      // Which passages the marker's attempt showed is not on the marker: none is guessed.
      expect(second.record.passageFingerprints).toBeUndefined();
    });

    it('an earlier attempt whose lookup found no passage showed none', async () => {
      await markShown(source, 'attempt-1', '2026-10-23T10:14:00-04:00');
      const second = await recordPracticeExplanation(
        source,
        answer({
          attemptId: 'attempt-2',
          timestamp: '2026-10-23T10:20:00-04:00',
          passagesShownInView: [{ attemptId: 'attempt-1', passageFingerprints: [] }],
        }),
        options(),
      );
      expect(second.record.supportLevelShown).toBe('independent');
    });
  });

  describe('exposure on an earlier attempt in an earlier session is support shown too', () => {
    it('a marker on the same prompt from an earlier session, on another device, makes the later answer guided', async () => {
      await markShown(source, 'attempt-0', '2026-10-20T19:00:00-04:00', { deviceId: 'laptop' });
      const later = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-5' }),
        options(),
      );
      expect(later.record.supportLevelShown).toBe('guided');
      expect(later.record.passageFingerprints).toBeUndefined();
    });

    it('[D-459]\'s "a later session is fresh" does not apply: an accepted review after that marker changes nothing', async () => {
      await markShown(source, 'attempt-0', '2026-10-20T19:00:00-04:00');
      await appendReviewLogRecord(
        source,
        {
          timestamp: '2026-10-20T19:05:00-04:00',
          instrumentId: QUESTION,
          instrumentType: 'explain-back',
          conceptIds: ['concept-a'],
          rating: null,
          wasUnsure: false,
          durationMs: 30000,
          selectionContext: {
            dueState: 'new',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['explain-back'],
            planVersion: null,
          },
          attemptId: 'attempt-0',
        },
        { deviceId: 'desktop' },
      );
      const later = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-5' }),
        options(),
      );
      expect(later.record.supportLevelShown).toBe('guided');
    });

    it('with view exposure as well, the earlier session keeps the record at the coarser fact', async () => {
      await markShown(source, 'attempt-0', '2026-10-20T19:00:00-04:00');
      await markShown(source, 'attempt-5', '2026-10-23T10:14:00-04:00');
      const later = await recordPracticeExplanation(
        source,
        answer({
          attemptId: 'attempt-6',
          timestamp: '2026-10-23T10:20:00-04:00',
          passagesShownInView: [{ attemptId: 'attempt-5', passageFingerprints: ['digest-1'] }],
        }),
        options(),
      );
      // Some of what was shown cannot be named, so no partial list stands in for all of it.
      expect(later.record.supportLevelShown).toBe('guided');
      expect(later.record.passageFingerprints).toBeUndefined();
    });

    it('a marker on a different prompt is not exposure on this one', async () => {
      await markShown(source, 'attempt-0', '2026-10-20T19:00:00-04:00', {
        instrumentId: 'explain-back:concept-b',
      });
      const later = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-5' }),
        options(),
      );
      expect(later.record.supportLevelShown).toBe('independent');
    });

    it('an unreadable line naming the prompt, with nothing else, leaves the support unknown — no rung', async () => {
      const path = reviewLogPath('2026-10-20', 'laptop');
      await source.write(
        path,
        `{"schemaVersion":6,"kind":"explain-back-feedback-shown","eventId":"m","timestamp":"2026-10-20T19:00:00-04:00","instrumentId":"${QUESTION}","attem`,
      );
      expect((await readReviewLogHistory(source)).invalidLines).toHaveLength(1);
      const later = await recordPracticeExplanation(
        source,
        answer({ attemptId: 'attempt-5' }),
        options(),
      );
      expect(later.written).toBe(true);
      expect('supportLevelShown' in later.record).toBe(false);
      expect('passageFingerprints' in later.record).toBe(false);
      // The unreadable line is left exactly as it was: extend, never rewrite.
      expect(await readFile(join(root, path), 'utf8')).toMatch(/"attem$/);
    });
  });
});

describe('the practice explanation record carries no content (D-005)', () => {
  it('a key smuggled past the types is stripped from the line, and a grade key is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olea-practice-explanation-content-'));
    try {
      const source = new FolderSource(root);
      const result = await appendPracticeExplanationRecord(
        source,
        {
          timestamp: '2026-10-23T10:15:00-04:00',
          instrumentId: QUESTION,
          attemptId: 'attempt-1',
          conceptIds: ['concept-a'],
          promptShape: 'concept',
          trigger: 'on-demand',
          durationMs: null,
          supportLevelShown: 'independent',
          contentRef: 'desktop.content-1',
          ...({ answer: 'synthetic smuggled text' } as object),
        },
        { deviceId: 'desktop' },
      );
      expect(result.written).toBe(true);
      const text = await readFile(join(root, reviewLogPath(DAY, 'desktop')), 'utf8');
      expect(text).not.toContain('synthetic');
      await expect(
        appendPracticeExplanationRecord(
          source,
          {
            timestamp: '2026-10-23T10:15:00-04:00',
            instrumentId: QUESTION,
            attemptId: 'attempt-2',
            conceptIds: ['concept-a'],
            promptShape: 'concept',
            trigger: 'on-demand',
            durationMs: null,
            contentRef: 'desktop.content-2',
            ...({ rating: 'good' } as object),
          },
          { deviceId: 'desktop' },
        ),
      ).rejects.toThrow(/schema validation/);
      expect(await readFile(join(root, reviewLogPath(DAY, 'desktop')), 'utf8')).toBe(text);
      // No content file is created by the record-level writer: the caller already holds a ref.
      await expect(
        readFile(join(root, contentStorePath('desktop.content-1')), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
