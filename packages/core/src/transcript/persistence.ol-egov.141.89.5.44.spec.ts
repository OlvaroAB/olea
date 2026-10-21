// Scenario: features/F1-sources.md, "reconstruction after restart and a reader-version change"
// (ol-egov.141.89.5.44; D-465; PERSISTENCE.md 2.5, 2.8 and 2.9, section 3 cases E1, E3, E4 and F2,
// and the reader's half of D1 and E2). Test id:
// @auto:core/transcript/persistence.ol-egov.141.89.5.44.spec
//
// The core half of the restart: what a new session re-derives from the same bytes, what a reader
// version change re-reads, and the passage-rule and registration claims. The stores that persist
// per device (anchors, reading records, processed revisions) are restarted in the plugin's
// `test/ingestion/materiality/transcript-persistence.ol-egov.141.89.5.44.spec.ts`. Every text is
// invented ("course A").

import { describe, expect, it } from 'vitest';
import {
  DECLARED_MARKDOWN,
  LONG_PLAIN,
  MemoryVault,
  SHORT_PLAIN,
} from '../extract/transcript.fixtures.js';
import {
  readTranscriptText,
  TRANSCRIPT_PART_RULE_VERSION,
  TRANSCRIPT_READER_VERSION,
} from '../extract/transcript.js';
import type { ExtractedUnit } from '../extract/types.js';
import { IngestionQueueEngine } from '../ingestion/engine.js';
import { createExtractionJobRunner } from '../ingestion/extraction-runner.js';
import { hashText } from '../ingestion/hash.js';
import {
  buildTranscriptEnqueueInput,
  createTranscriptAwareJobRunner,
  TRANSCRIPT_WORKFLOW_VERSION,
} from '../ingestion/transcript-job.js';
import type { PersistedQueue, QueueStore } from '../ingestion/types.js';
import { transcriptEnumeration } from '../ingestion/unit-manifest/transcript-reading.js';
import {
  CURRENT_PASSAGE_RULE,
  currentPassageRule,
  PASSAGE_RULES,
  parsePassageDigest,
  sealCitationPassage,
} from '../source/passage-identity.js';
import { isRegisterableDocument, registerSources } from '../source/register.js';

const PLAIN = 'Course A/Lecture 3/transcript.txt';
const DECLARED = 'Course A/Lecture 4/transcript.md';

class TextQueueStore implements QueueStore {
  text: string | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.text === null ? null : (JSON.parse(this.text) as PersistedQueue);
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.text = JSON.stringify(queue);
  }
}

describe('D1 and E2, the reader’s half: a restart re-derives the same parts from the same bytes', () => {
  it('two sessions cut the same bytes into deep-equal parts, and the reading record’s pages are their ordinals', () => {
    for (const [text, format] of [
      [SHORT_PLAIN, 'plain-text'],
      [LONG_PLAIN, 'plain-text'],
      [DECLARED_MARKDOWN, 'markdown'],
    ] as const) {
      const before = readTranscriptText(text, format);
      // A restart holds nothing over: the reader is pure, so a second session reads the same.
      const after = readTranscriptText(`${text}`, format);
      expect(after).toEqual(before);
      if (!before.ok) throw new Error('fixture does not read');
      expect(transcriptEnumeration(before.parts.length).pages).toEqual(
        before.parts.map((part) => part.ordinal),
      );
      // Untimed: no time range exists to persist or re-parse.
      for (const part of before.parts) expect(part).not.toHaveProperty('timeRange');
    }
  });

  it('the reader version is not part of where parts fall: the result names the part rule separately', () => {
    const read = readTranscriptText(LONG_PLAIN, 'plain-text');
    expect(read).toMatchObject({
      ok: true,
      readerVersion: TRANSCRIPT_READER_VERSION,
      partRuleVersion: TRANSCRIPT_PART_RULE_VERSION,
    });
    expect(TRANSCRIPT_WORKFLOW_VERSION).toBe(TRANSCRIPT_READER_VERSION);
  });
});

describe('E1, the queue’s half: a new reader version with the part rule unchanged', () => {
  it('re-reads the transcript once: the earlier job is left as it was, a new one runs, and a further enqueue is a duplicate', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const contentHash = await hashText(LONG_PLAIN);
    const input = buildTranscriptEnqueueInput({
      sourcePath: PLAIN,
      transcriptFormat: 'plain-text',
      contentHash,
    });
    // The queue as an earlier reader version left it: the same bytes, read and done.
    const earlier = {
      contentHash,
      label: PLAIN,
      payload: input.payload,
      enqueuedAt: 10,
      status: 'done',
      attempts: 1,
      doneAt: 20,
      sourceUnitId: PLAIN,
      workflowVersion: 'transcript-reader:0',
    };
    const store = new TextQueueStore();
    store.text = JSON.stringify({ version: 1, jobs: [earlier], headroom: null });

    const received: ExtractedUnit[][] = [];
    const sink = {
      async receive(units: readonly ExtractedUnit[]) {
        received.push([...units]);
      },
    };
    const engine = await IngestionQueueEngine.create({
      store,
      capability: { canDrain: true },
      runner: createTranscriptAwareJobRunner({
        vault,
        sink,
        fallback: createExtractionJobRunner({
          vault,
          enqueuer: { enqueue: async () => ({ status: 'queued' }) },
          sink,
        }),
      }),
      clock: { now: () => 1_000 },
      random: { next: () => 0 },
    });
    expect(await engine.enqueue(input)).toEqual({ status: 'queued' });
    expect(await engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(await engine.enqueue(input)).toEqual({ status: 'duplicate', existingStatus: 'done' });
    expect(received).toHaveLength(1);

    const saved = (JSON.parse(store.text as string) as { jobs: Record<string, unknown>[] }).jobs;
    expect(saved).toHaveLength(2);
    expect(JSON.stringify(saved[0])).toBe(JSON.stringify(earlier));
    expect(saved[1]).toMatchObject({
      workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
      status: 'done',
    });
  });
});

describe('E3 and E4: the passage rules', () => {
  it('E4: with transcripts in the vault, a note citation still mints under version 1, the only rule registered', async () => {
    expect(PASSAGE_RULES.map((rule) => rule.version)).toEqual([1]);
    expect(currentPassageRule().version).toBe(1);
    expect(CURRENT_PASSAGE_RULE.version).toBe(1);
    const vault = new MemoryVault({
      [PLAIN]: LONG_PLAIN,
      [DECLARED]: DECLARED_MARKDOWN,
      'Course A/notes/one idea.md':
        '---\ncourse: course A\n---\n\nOne invented idea, in one paragraph.\n',
    });
    const sealed = await sealCitationPassage(
      vault,
      { sourcePath: 'Course A/notes/one idea.md' },
      'Course A/notes/one idea (Olea).md',
    );
    expect(sealed.outcome).toBe('minted');
    expect(parsePassageDigest(sealed.citation.passageDigest ?? '')?.version).toBe(1);
  });

  it('E3 as built: no transcript passage rule exists, so a plain-text transcript citation is sealed with no digest at all', async () => {
    // PERSISTENCE.md 2.5 designed a transcript rule appended to this registry. The build
    // (ol-egov.141.89.5.43) identifies a cited transcript passage by its anchor's text instead, so
    // no transcript digest is minted, and a retired rule cannot strand one.
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const citation = { sourcePath: PLAIN, page: 3 };
    const sealed = await sealCitationPassage(vault, citation, 'Course A/Lecture 3/transcript.md');
    expect(sealed).toEqual({ citation, outcome: 'not-applicable' });
    expect(vault.writes).toEqual([]);
  });
});

describe('F2: no transcript is offered for registration', () => {
  it('neither a plain-text, timed nor Markdown transcript can be offered as a past paper or objectives', async () => {
    for (const path of [PLAIN, 'Course A/l.vtt', 'Course A/l.srt', DECLARED]) {
      expect(isRegisterableDocument(path)).toBe(false);
    }
    const vault = new MemoryVault({
      '03 Research/lecture 3 transcript.txt': LONG_PLAIN,
      '03 Research/lecture 4 transcript.md': DECLARED_MARKDOWN,
    });
    const report = await registerSources(vault, {
      registeredFiles: [{ path: '03 Research/lecture 3 transcript.txt', role: 'past-paper' }],
    });
    expect(report.sources).toEqual([]);
    expect(report.unclassified).toEqual(['03 Research/lecture 4 transcript.md']);
    expect(report.unregisterable).toEqual([
      { path: '03 Research/lecture 3 transcript.txt', reason: 'unsupported-format' },
    ]);
    expect(vault.writes).toEqual([]);
  });
});
