// `ol-egov.141.89.9.70` item 2 ([D-414], `ol-egov.141.89.48`): the demand-grain reading appears on the
// gap view and the grove and nowhere else. Registry section 25: "Placing the sentence inside an
// ordinary session: it belongs to the gap view and the grove only, and the existing refusal
// surfaces keep their own messages"; F4.10 at demand grain: "an ordinary session carries nothing".
//
// Two guards, because a reading can escape in two different ways:
//
//  1. WHERE IT IS REFERENCED. Every non-test source file that names the reading, its producers or
//     its consumers must be on one of two closed lists: the modules that build and fold it, or the
//     surfaces the clause permits (the gap view and the grove). A file in a session, Today, Home,
//     plan, review, practice-paper or refusal path that starts to read it fails here, by path,
//     before it renders anything.
//  2. WHERE IT TRAVELS. Handing rows that carry the reading to the session builders produces a
//     session, and a composition result, in which nothing of it appears: a spread of a whole row
//     into a session item would carry it without any file naming it, which the scan cannot see.
//
// Every string here is invented (INV-3).

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GapRow } from '../gap/build.js';
import type { QaInstrumentRecord } from '../session/types.js';
import { buildStudySession } from '../study-session/build.js';
import type { DurationModel } from '../study-session/duration.js';
import { buildConceptInstrumentIndex } from '../study-session/instrument-index.js';
import type { VaultPath } from '../vault/types.js';
import type { DemandGapReading } from './demand-gap.js';

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The modules that build, fold, carry and adapt the reading. None of them is a student surface:
 * `build.ts` passes the reading through as data, `demand-gap.ts` and its checker are the logic,
 * `assess-support.ts` maps a decision to an answer, and the plugin's re-ask is the runner. The two
 * barrels are listed so that exporting the reading from `olea-core` is a deliberate, reviewed change.
 */
const PLUMBING: readonly string[] = [
  'packages/core/src/gap/build.ts',
  'packages/core/src/gap/demand-gap.ts',
  'packages/core/src/gap/demand-gap-sentence-check.ts',
  'packages/core/src/stage-contract/adapters/assess-support.ts',
  'packages/core/src/stage-contract/index.ts',
  'packages/core/src/index.ts',
  'packages/plugin/src/gap/demand-gap-reask.ts',
];

/**
 * The surfaces the clause permits, the gap view and the grove. None of them reads the reading
 * today (`demand-gap-copy-guard.spec.ts` in the plugin pins that no gap-view line exists for it);
 * they are listed so that giving it a place is a change to this list, not a side effect.
 */
const SURFACES: readonly string[] = [
  'packages/plugin/src/gap/provider.ts',
  'packages/plugin/src/gap/view.ts',
  'packages/plugin/src/gap/copy.ts',
  'packages/plugin/src/grove/provider.ts',
  'packages/plugin/src/grove/view.ts',
  'packages/plugin/src/grove/copy.ts',
];

/** Where an ordinary session, Today, Home, the plan, review and the refusal surfaces live. A hit in any of these is named as a placement violation. */
const ORDINARY_SURFACE_DIRS: readonly string[] = [
  'packages/core/src/study-session/',
  'packages/core/src/session/',
  'packages/core/src/queue/',
  'packages/core/src/today/',
  'packages/core/src/plan/',
  'packages/core/src/scheduler/',
  'packages/core/src/oracle/',
  'packages/plugin/src/session/',
  'packages/plugin/src/session-builder/',
  'packages/plugin/src/today/',
  'packages/plugin/src/home/',
  'packages/plugin/src/plan/',
  'packages/plugin/src/review/',
  'packages/plugin/src/paper/',
  'packages/plugin/src/retrieval/',
  'packages/plugin/src/generation/',
  'packages/plugin/src/explain-back/',
];

/** What names the reading, its producers or its consumers, in code (comments are stripped first). */
const TRACKED =
  /demandGaps?\b|DemandGapReading|readDemandGap|SufficiencyRecord|SufficiencyAnswer|reaskOnArrival|createDemandGapReask|createRetrievalSufficiencyAsk|demand-gap(?:-reask|-sentence-check)?(?:\.js)?['"]/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-e2e', '.git', 'coverage']);

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
}

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pkg of await readdir(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    for (const sub of ['src', 'scripts']) {
      try {
        await walk(join(PACKAGES_DIR, pkg.name, sub), files);
      } catch {
        // a package without that folder
      }
    }
  }
  return files.filter((file) => !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file));
}

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the demand-grain reading is referenced only by its own modules and the two surfaces the clause permits', () => {
  it('scans real source files and finds the modules that carry the reading (a blind scan would pass vacuously)', async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      if (TRACKED.test(codeOf(await readFile(file, 'utf8')))) hits.push(relative(REPO_ROOT, file));
    }
    expect(hits).toContain('packages/core/src/gap/build.ts');
    expect(hits).toContain('packages/core/src/gap/demand-gap.ts');
    expect(hits).toContain('packages/plugin/src/gap/demand-gap-reask.ts');
  });

  it('no file outside those two lists names it', async () => {
    const allowed = new Set([...PLUMBING, ...SURFACES]);
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const rel = relative(REPO_ROOT, file);
      if (allowed.has(rel)) continue;
      if (TRACKED.test(codeOf(await readFile(file, 'utf8')))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('none of the ordinary-session, Today, Home, plan, review, practice-paper, retrieval or generation paths is on either list', () => {
    for (const listed of [...PLUMBING, ...SURFACES]) {
      const inOrdinaryPath = ORDINARY_SURFACE_DIRS.filter((dir) => listed.startsWith(dir));
      expect(inOrdinaryPath, `${listed} is an ordinary surface`).toEqual([]);
    }
  });

  it('the surfaces are exactly the gap view and the grove', () => {
    expect(SURFACES.every((path) => /\/(gap|grove)\//.test(path))).toBe(true);
    expect(new Set(SURFACES.map((path) => path.split('/')[3]))).toEqual(new Set(['gap', 'grove']));
  });
});

// ---------------------------------------------------------------------------
// Where it travels: nothing of it in a session
// ---------------------------------------------------------------------------

const MARKER = 'fp-must-not-travel-8f3a';
const READING: DemandGapReading = {
  kind: 'material-gap',
  demand: 'calculate',
  verdict: 'insufficient',
  evidenceFingerprint: MARKER,
  recheck: { reason: 'threshold-blocked' },
};

function row(conceptName: string, gapScore: number, reading: DemandGapReading | undefined): GapRow {
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'CRS101',
    gapClass: 'mastery-gap',
    rank: 1,
    oracleRank: 1,
    priorityScore: gapScore,
    gapScore,
    readiness: {
      assessmentFormat: 'unknown',
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'sprout',
    targetAssessmentPath: '02 Assignments/quiz-2.md' as VaultPath,
    assessmentFormat: 'unknown',
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: [],
    instrumentCount: 1,
    affordances: ['open-concept', 'build-session'],
    ...(reading !== undefined ? { demandGap: reading } : {}),
  };
}

function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

const DURATIONS: DurationModel = {
  estimates: (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds: 60,
    source: 'assumed' as const,
    sampleCount: 0,
  })),
  basis: 'assumed',
  totalSampleCount: 0,
  secondsFor: () => 60,
  sourceFor: () => 'assumed',
};

describe('an ordinary session carries nothing of the reading, however it was handed the rows', () => {
  const build = (reading: DemandGapReading | undefined) =>
    buildStudySession({
      rows: [row('A', 9, reading), row('B', 8, reading)],
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]),
      budgetMinutes: 30,
      durations: DURATIONS,
      asOf: '2026-09-14',
    });

  it('the session is non-trivial (it has items for both concepts), so nothing-of-it is a real claim', () => {
    const session = build(READING);
    expect(session.items.map((item) => item.conceptName)).toEqual(['A', 'B']);
  });

  it('the built session is byte-identical whether or not the rows carry the reading', () => {
    expect(JSON.stringify(build(READING))).toBe(JSON.stringify(build(undefined)));
  });

  it('no part of the reading, its fingerprint or its field name appears anywhere in the session', () => {
    const serialised = JSON.stringify(build(READING));
    for (const forbidden of [
      MARKER,
      'demandGap',
      'material-gap',
      'threshold-blocked',
      'evidenceFingerprint',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });
});
