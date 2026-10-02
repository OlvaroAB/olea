// Scenario: "a file in an unsupported format fails visibly, never silently"
// (features/F1-sources.md, ol-egov.141.89.8.49; D-465). Test id:
// @auto:core/transcript/format-handling.ol-egov.141.89.8.49.spec
//
// Also the demonstrations of PERSISTENCE.md 3 A1-A4 that belong to the reader
// and the job kind (the census and queue-reload halves are V1b, ol-egov.141.89.5.44),
// and the job kind of section 2.7. All text is invented.

import { describe, expect, it } from 'vitest';
import {
  buildTranscriptEnqueueInput,
  createTranscriptAwareJobRunner,
  isTranscriptJobPayload,
  TRANSCRIPT_WORKFLOW_VERSION,
} from '../ingestion/transcript-job.js';
import type { JobRunnerView } from '../ingestion/types.js';
import {
  DECLARED_MARKDOWN,
  LONG_PLAIN,
  MemoryVault,
  UNDECLARED_MARKDOWN,
} from './transcript.fixtures.js';
import {
  describeTranscriptFailure,
  readTranscriptFromVault,
  readTranscriptText,
  resolveTranscriptFormat,
  TRANSCRIPT_FORMATS,
} from './transcript.js';
import type { ExtractedUnit } from './types.js';

describe('format resolution is explicit and one-to-one', () => {
  it('.txt is plain-text, a declared .md is markdown, an undeclared .md is not a transcript', () => {
    expect(resolveTranscriptFormat('a/l.txt')).toEqual({
      kind: 'transcript',
      format: 'plain-text',
    });
    expect(resolveTranscriptFormat('a/l.md', DECLARED_MARKDOWN)).toEqual({
      kind: 'transcript',
      format: 'markdown',
    });
    expect(resolveTranscriptFormat('a/l.md', UNDECLARED_MARKDOWN)).toEqual({
      kind: 'not-a-transcript',
    });
    expect(resolveTranscriptFormat('a/l.md')).toEqual({ kind: 'not-a-transcript' });
  });

  it('.vtt and .srt are known formats with no reader in this build', () => {
    expect(resolveTranscriptFormat('a/l.vtt')).toEqual({ kind: 'no-reader', format: 'webvtt' });
    expect(resolveTranscriptFormat('a/l.srt')).toEqual({ kind: 'no-reader', format: 'srt' });
  });

  it('any other extension has no reader and is never taken for plain text', () => {
    expect(resolveTranscriptFormat('a/l.rtf')).toEqual({ kind: 'no-reader', format: 'rtf' });
    expect(resolveTranscriptFormat('a/noext')).toEqual({ kind: 'no-reader', format: 'unknown' });
  });
});

describe('a file in an unsupported format fails visibly, never silently', () => {
  it('a known format with no reader fails with "no reader for this format", never ok', () => {
    for (const format of ['webvtt', 'srt'] as const) {
      const r = readTranscriptText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n', format);
      expect(r).toEqual({ ok: false, reason: 'no-reader-for-format', format });
      expect(describeTranscriptFailure(r as never)).toMatch(/^no reader for this format/);
      // Never the shape of a transcript with no content.
      expect(r).not.toHaveProperty('parts');
      expect(r).not.toHaveProperty('outcome');
    }
  });

  it('a value outside the closed set fails and names the value', () => {
    const r = readTranscriptText('x', 'docx');
    expect(r).toEqual({ ok: false, reason: 'unknown-format', format: 'docx' });
    expect(describeTranscriptFailure(r as never)).toContain('"docx"');
  });

  it('the closed set is exactly the four values of section 2.7', () => {
    expect([...TRANSCRIPT_FORMATS]).toEqual(['plain-text', 'markdown', 'webvtt', 'srt']);
  });

  it('A2: a declaration removed after queueing fails at read, with a reason, and yields no parts', async () => {
    const vault = new MemoryVault({ 'a/l.md': UNDECLARED_MARKDOWN });
    const r = await readTranscriptFromVault(vault, 'a/l.md', 'markdown');
    expect(r).toMatchObject({ ok: false, reason: 'format-changed', recorded: 'markdown' });
    expect(r).not.toHaveProperty('parts');
    expect(describeTranscriptFailure(r as never)).toContain('no longer reads as a markdown');
  });

  it('an extension changed to another transcript format also fails the second check', async () => {
    const vault = new MemoryVault({ 'a/l.txt': LONG_PLAIN });
    const r = await readTranscriptFromVault(vault, 'a/l.txt', 'markdown');
    expect(r).toMatchObject({ ok: false, reason: 'format-changed' });
  });
});

describe('the transcript job kind (PERSISTENCE 2.7)', () => {
  const view = (payload: unknown): JobRunnerView => ({
    contentHash: 'h1',
    label: 'a/l.txt',
    payload,
    attempts: 0,
  });
  const fallbackCalls: JobRunnerView[] = [];
  const mk = (files: Record<string, string>) => {
    const received: ExtractedUnit[][] = [];
    const vault = new MemoryVault(files);
    const runner = createTranscriptAwareJobRunner({
      vault,
      sink: {
        async receive(units) {
          received.push([...units]);
        },
      },
      fallback: async (job) => {
        fallbackCalls.push(job);
        return { ok: true };
      },
    });
    return { runner, received, vault };
  };

  it('builds the payload, the path as sourceUnitId, and a workflow version of its own', () => {
    const input = buildTranscriptEnqueueInput({
      sourcePath: 'a/l.txt',
      transcriptFormat: 'plain-text',
      contentHash: 'abc',
    });
    expect(input.payload).toEqual({
      kind: 'transcript',
      sourcePath: 'a/l.txt',
      transcriptFormat: 'plain-text',
    });
    expect(input).toMatchObject({
      contentHash: 'abc',
      sourceUnitId: 'a/l.txt',
      workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
    });
    expect(TRANSCRIPT_WORKFLOW_VERSION).not.toMatch(/^vision:/);
  });

  it('rejects an unknown format at enqueue, visibly', () => {
    expect(() =>
      buildTranscriptEnqueueInput({
        sourcePath: 'a/l.txt',
        transcriptFormat: 'docx' as never,
        contentHash: 'abc',
      }),
    ).toThrow(/unknown transcript format "docx"/);
  });

  it('the payload guard accepts only the closed set', () => {
    expect(
      isTranscriptJobPayload({ kind: 'transcript', sourcePath: 'p', transcriptFormat: 'srt' }),
    ).toBe(true);
    expect(
      isTranscriptJobPayload({ kind: 'transcript', sourcePath: 'p', transcriptFormat: 'rtf' }),
    ).toBe(false);
    expect(
      isTranscriptJobPayload({ kind: 'transcript', sourcePath: '', transcriptFormat: 'srt' }),
    ).toBe(false);
    expect(isTranscriptJobPayload({ kind: 'source', sourcePath: 'p', format: 'pdf' })).toBe(false);
  });

  it('reads a plain-text job and hands the parts to the sink as units, writing nothing', async () => {
    const { runner, received, vault } = mk({ 'a/l.txt': LONG_PLAIN });
    const out = await runner(
      view({ kind: 'transcript', sourcePath: 'a/l.txt', transcriptFormat: 'plain-text' }),
    );
    expect(out).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]?.map((u) => u.provenance.location.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(vault.writes).toEqual([]);
  });

  it('an unknown persisted format fails, not to be retried, naming the value; the payload is untouched', async () => {
    const payload = { kind: 'transcript', sourcePath: 'a/l.txt', transcriptFormat: 'wav' };
    const before = JSON.stringify(payload);
    const { runner, received } = mk({ 'a/l.txt': LONG_PLAIN });
    const out = await runner(view(payload));
    expect(out).toMatchObject({ ok: false, retryable: false });
    expect((out as { reason: string }).reason).toContain('"wav"');
    expect(received).toEqual([]);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('a known format with no reader fails, not to be retried, as "no reader for this format"', async () => {
    const { runner } = mk({ 'a/l.vtt': 'WEBVTT\n' });
    const out = await runner(
      view({ kind: 'transcript', sourcePath: 'a/l.vtt', transcriptFormat: 'webvtt' }),
    );
    expect(out).toMatchObject({ ok: false, retryable: false });
    expect((out as { reason: string }).reason).toMatch(/^no reader for this format/);
  });

  it('A2: a declaration removed after queueing fails, not to be retried, and sinks no parts', async () => {
    const { runner, received } = mk({ 'a/l.md': UNDECLARED_MARKDOWN });
    const out = await runner(
      view({ kind: 'transcript', sourcePath: 'a/l.md', transcriptFormat: 'markdown' }),
    );
    expect(out).toMatchObject({ ok: false, retryable: false });
    expect(received).toEqual([]);
  });

  it('an empty transcript fails visibly as empty-document, never as read', async () => {
    const { runner, received } = mk({ 'a/l.txt': '  \n\n' });
    const out = await runner(
      view({ kind: 'transcript', sourcePath: 'a/l.txt', transcriptFormat: 'plain-text' }),
    );
    expect(out).toMatchObject({ ok: false, retryable: false });
    expect((out as { reason: string }).reason).toContain('empty-document');
    expect(received).toEqual([]);
  });

  it('a file that vanished is retryable (transient), not a format failure', async () => {
    const { runner } = mk({});
    const out = await runner(
      view({ kind: 'transcript', sourcePath: 'a/gone.txt', transcriptFormat: 'plain-text' }),
    );
    expect(out).toEqual({ ok: false, retryable: true });
  });

  it('every other kind goes to the fallback untouched', async () => {
    fallbackCalls.length = 0;
    const { runner } = mk({});
    const job = view({ kind: 'source', sourcePath: 'a.pdf', format: 'pdf' });
    await runner(job);
    expect(fallbackCalls).toEqual([job]);
  });
});
