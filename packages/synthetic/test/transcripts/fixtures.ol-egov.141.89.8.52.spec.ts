// Scenario: features/F1-sources.md "the fixtures are synthetic and cover each case above"
// (ol-egov.141.89.8.52; D-465). Test id:
// @auto:synthetic/transcripts/fixtures.ol-egov.141.89.8.52.spec
//
// The fixture folder is `packages/core/fixtures/transcripts/`. This spec checks the manifest
// against the folder and runs each text fixture through the T2 reader. All fixtures are invented.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTranscriptText, TRANSCRIPT_PART_MAX_CHARS } from 'olea-core';
import { describe, expect, it } from 'vitest';

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'core',
  'fixtures',
  'transcripts',
);

interface Entry {
  readonly file: string;
  readonly purpose: string;
  readonly group?: string;
}

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  fixtures: Entry[];
};
const entries = manifest.fixtures;
const read = (file: string): string => readFileSync(join(DIR, file), 'utf8');

describe('transcript fixtures match their manifest', () => {
  it('lists every file in the folder, and every listed file exists', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f !== 'manifest.json')
      .sort();
    const listed = entries.map((e) => e.file).sort();
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(onDisk);
  });

  it('declares a purpose for every fixture', () => {
    for (const e of entries) expect(e.purpose.trim().length, e.file).toBeGreaterThan(0);
  });

  it('groups the re-cut pair and the corrected pair', () => {
    const group = (g: string) =>
      entries
        .filter((e) => e.group === g)
        .map((e) => e.file)
        .sort();
    expect(group('recut')).toEqual(['resegmented-copy.txt', 'resegmented-original.txt']);
    expect(group('corrected')).toEqual(['corrected-export-v1.txt', 'corrected-export-v2.txt']);
  });

  it('keeps the over-cap file over the reader part cap', () => {
    expect(read('long-over-cap.txt').length).toBeGreaterThan(TRANSCRIPT_PART_MAX_CHARS);
  });

  it('covers timed, untimed, labelled and unlabelled cases', () => {
    const files = entries.map((e) => e.file);
    expect(files).toContain('sample.vtt');
    expect(files).toContain('sample.srt');
    expect(files).toContain('plain-untimed-unlabelled.txt');
    expect(files).toContain('speaker-labelled.txt');
  });
});

describe('each text fixture reads through the T2 reader', () => {
  const timed = (f: string) => f.endsWith('.vtt') || f.endsWith('.srt');
  for (const e of entries.filter((x) => !timed(x.file))) {
    it(`${e.file} reads without error`, () => {
      const format = e.file.endsWith('.md') ? 'markdown' : 'plain-text';
      const r = readTranscriptText(read(e.file), format);
      if (e.file === 'undeclared-markdown.md') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('not-declared-transcript');
      } else {
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.parts.length).toBeGreaterThan(0);
      }
    });
  }

  it('VTT and SRT read as no reader for this format until T3', () => {
    for (const [file, format] of [
      ['sample.vtt', 'webvtt'],
      ['sample.srt', 'srt'],
    ] as const) {
      const r = readTranscriptText(read(file), format);
      expect(r.ok, file).toBe(false);
      if (!r.ok) expect(r.reason).toBe('no-reader-for-format');
    }
  });
});
