// PERSISTENCE.md section 3, case B5 (ol-egov.141.89.5.44; D-465; PERSISTENCE.md 2.7, "A guard test
// lists every reader of a job's kind, so one that is missed fails"). Test id:
// @auto:plugin/ingestion/transcript-kind-readers.ol-egov.141.89.5.44.spec
//
// The transcript kind is a fifth job kind on the persisted queue, so every place that reads or
// writes a job's kind by the source kinds' names has to decide what a transcript job is to it. This
// guard lists those places. A new file that compares a payload's kind with `'source'` or
// `'vision-page'`, or builds a `'source'` payload, fails it until it is listed with its decision;
// a listed file that is to handle transcripts and no longer names them fails it too. Its reach is
// the source text: a kind read through some other spelling (a lookup table, a computed key) is not
// seen, and is named here when it is written.
//
// Also, found beside case F1: the transcript exclusion on the note-level change trigger was for
// declared Markdown only; since ol-egov.141.89.5.102 a plain-text transcript is excluded too
// (checked below).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTranscriptFormat, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNED = ['packages/plugin/src', 'packages/core/src'];

/** A comparison with, or a construction of, one of the source job kinds. */
const KIND_READER =
  /\bkind\s*[!=]==\s*'(?:source|vision-page)'|case\s+'(?:source|vision-page)'\s*:|\bkind:\s*'source'/;
/** What a file that handles transcript jobs names. */
const HANDLES_TRANSCRIPT =
  /'transcript'|isTranscriptKind|buildTranscriptEnqueueInput|createTranscriptAwareJobRunner/;

/** Every place decided, with its decision. */
const DECIDED: Readonly<Record<string, { readonly handles: boolean; readonly why: string }>> = {
  'packages/plugin/src/ingestion/wiring.ts': {
    handles: true,
    why: 'the first-read folder counts, and the runner chain with the transcript kind outermost',
  },
  'packages/plugin/src/ingestion/processed-revisions/feed.ts': {
    handles: true,
    why: 'the processed-revision feed: queued, done and failed transcript jobs',
  },
  'packages/plugin/src/ingestion/arrival-watch.ts': {
    handles: true,
    why: 'arrival: a transcript is enqueued under its own kind',
  },
  'packages/plugin/src/ingestion/process-now.ts': {
    handles: true,
    why: 'process-now: a transcript is enqueued under its own kind',
  },
  'packages/plugin/src/ingestion/vision-page-runner.ts': {
    handles: false,
    why: 'serves vision-page jobs only; a transcript is never a vision-page job, and the transcript-aware runner is outermost',
  },
  'packages/core/src/ingestion/extraction-runner.ts': {
    handles: false,
    why: 'the dispatcher from before the change: a transcript job handed to it fails, not to be retried, as an unrecognised payload (case B2)',
  },
  'packages/core/src/oracle/paper-structure.ts': {
    handles: false,
    why: 'a paper-structure kind, not a queue job kind',
  },
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(): readonly string[] {
  return SCANNED.flatMap((dir) =>
    (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
      .filter(
        (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'),
      )
      .map((file) =>
        relative(ROOT, join(ROOT, dir, file))
          .split('\\')
          .join('/'),
      ),
  );
}

function readsAJobKind(source: string): boolean {
  return KIND_READER.test(stripComments(source));
}

describe('B5: every reader of a job’s kind decides what a transcript job is to it', () => {
  const readers = sourceFiles().filter((file) =>
    readsAJobKind(readFileSync(join(ROOT, file), 'utf8')),
  );

  it('finds the readers it lists, and no reader it does not', () => {
    expect([...readers].sort()).toEqual(Object.keys(DECIDED).sort());
  });

  it('each listed reader that is to handle the transcript kind names it', () => {
    for (const [file, decision] of Object.entries(DECIDED)) {
      if (!decision.handles) continue;
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      expect(HANDLES_TRANSCRIPT.test(source), `${file}: ${decision.why}`).toBe(true);
    }
  });

  it('fails on a reader that keys on the source kind and does not handle transcripts', () => {
    const unlisted = "if (job.payload.kind === 'source') counts.source += 1;";
    expect(readsAJobKind(unlisted)).toBe(true);
    expect(HANDLES_TRANSCRIPT.test(unlisted)).toBe(false);
    expect(readsAJobKind("switch (payload.kind) { case 'vision-page': return 1; }")).toBe(true);
    expect(readsAJobKind("payload: { kind: 'source', sourcePath, format }")).toBe(true);
    expect(readsAJobKind("// a comment naming kind === 'source'")).toBe(false);
  });
});

// PERSISTENCE.md 1.1 row 15: a transcript never enters the note-level change trigger, and "the
// design excludes every transcript path explicitly". `main.ts`'s `evaluateMaterialityChange` (the
// handler for every vault `create` and `modify`) returned early only for Markdown that declares
// itself a transcript. A plain-text transcript went on to `this.materiality.evaluate` (on a first
// sighting it answers `judge-unavailable`), and that answer or a material verdict took it to
// `triggerAuthoredNoteGenerationIfObserved`, which landed the whole file as one authored-note unit.
// Fixed by ol-egov.141.89.5.102: the exclusion by path uses the test the arrival watch and
// process-now apply before enqueueing the `'transcript'` job kind. Read the way
// `transcript-wiring.ol-egov.141.89.8.55.spec.ts` reads `main.ts` (it cannot be imported under
// Vitest): the source with comments removed.
describe('F1, beside it: a plain-text transcript is kept off the note-level change trigger', () => {
  const main = stripComments(
    readFileSync(join(ROOT, 'packages/plugin/src/main.ts'), 'utf8'),
  ).replace(/\/\/.*$/gm, '');
  const body = main.slice(main.indexOf('private async evaluateMaterialityChange'));
  const evaluate = body.indexOf('this.materiality.evaluate(');
  const noteFeed = body.indexOf('this.processedRevisionFeed?.noteEvaluated(');
  const generationHook = body.indexOf('this.triggerAuthoredNoteGenerationIfObserved(');

  it('the declared-Markdown exclusion stands before the gate (case F1 itself)', () => {
    const declared = body.indexOf('if (declaresTranscript(currentText)) return;');
    expect(declared).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(evaluate);
  });

  it('a transcript by its path is excluded before the gate, the processed-revision note feed and the generation hook (ol-egov.141.89.5.102)', () => {
    expect(evaluate).toBeGreaterThan(-1);
    expect(noteFeed).toBeGreaterThan(evaluate);
    expect(generationHook).toBeGreaterThan(evaluate);
    const byPath = body.search(/hasTranscriptExtension\(|resolveTranscriptFormat\(/);
    expect(byPath).toBeGreaterThan(-1);
    expect(byPath).toBeLessThan(evaluate);
    // The same test, with the same outcome, that the arrival watch and process-now enqueue by.
    const guard = body.indexOf(
      "if (resolveTranscriptFormat(path, currentText).kind === 'transcript') return;",
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard + 'if ('.length).toBe(byPath);
    for (const file of [
      'packages/plugin/src/ingestion/arrival-watch.ts',
      'packages/plugin/src/ingestion/process-now.ts',
    ]) {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      expect(source, file).toMatch(
        /resolveTranscriptFormat\(path, (?:text|await deps\.vault\.read\(path\))\)/,
      );
      expect(source, file).toMatch(/resolution\.kind [!=]== 'transcript'/);
    }
  });

  it('that test excludes plain text and declared Markdown, and leaves her undeclared notes on the gate', () => {
    const excluded = (path: string, text: string): boolean =>
      resolveTranscriptFormat(path as VaultPath, text).kind === 'transcript';
    const spoken = 'Today we cover the second law.';
    expect(excluded('Course A/Lectures/week-03.txt', spoken)).toBe(true);
    expect(excluded('Course A/Lectures/WEEK-03.TXT', spoken)).toBe(true);
    expect(
      excluded('Course A/Lectures/week-03.md', `---\nrole: transcript\n---\n${spoken}\n`),
    ).toBe(true);
    expect(excluded('Course A/Notes/entropy.md', '# Entropy\n\nMy own summary.\n')).toBe(false);
    // No reader in this build, so not enqueued as a transcript either; covered once its reader lands.
    expect(excluded('Course A/Lectures/week-03.vtt', 'WEBVTT\n')).toBe(false);
    expect(excluded('Course A/Lectures/week-03.srt', '1\n')).toBe(false);
  });
});
