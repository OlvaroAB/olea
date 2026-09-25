/**
 * `composeOracleRanking` tests (P5-T07).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault. The
 * vault fixture below is a smaller cousin of `evidence-edge/build.spec.ts`'s
 * — one course, one cited concept — because this suite is not re-testing
 * `buildConceptAssessmentEdges`'s own acceptance criteria; it is testing the
 * ONE thing that module cannot test on its own: that the mastery join is
 * real, keyed correctly, and reaches `rankOracle`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord } from '../concept/types.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { FolderSource } from '../vault/folder-source.js';
import { composeOracleRanking, resolveTiebreakEligibleConcepts } from './compose.js';

/**
 * A `Scheduler` whose recall probability is looked up per instrument id —
 * the same technique `mastery/rollup.spec.ts`'s own `stubScheduler` uses, so
 * a test can say "this instrument reads 0.35" without reverse-engineering an
 * FSRS stability that produces it. `schedule` still returns a real-shaped
 * `SchedulerState`, because `readAllConceptReadiness` (`../mastery/attainment.js`
 * — the producer this suite is threading, since `ol-v7r5.54`) calls
 * `replaySchedulerStates` internally, which needs something to fold.
 */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule({ instrumentId, now }) {
      const state: SchedulerState = {
        schemaVersion: 1,
        due: now.toISOString(),
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningStepIndex: 0,
        reps: 1,
        lapses: 0,
        learningState: 'review',
        lastReview: now.toISOString(),
      };
      return { instrumentId, state, intervalDays: 1 };
    },
    retrievability({ instrumentId }) {
      const recallProbability = byInstrument[instrumentId];
      if (recallProbability === undefined) {
        throw new Error(`stubScheduler: no probability configured for ${instrumentId}`);
      }
      return { instrumentId, recallProbability };
    },
  };
}

const BASE_PATH = '02 Assignments/Assignments.base';

/**
 * `ol-63e1`: a review-log record's `conceptIds` now carries the opaque key
 * (`ConceptRecord.key`), never the display name — `widgetKey` (set in
 * `beforeEach`, from a real `extractConcepts` pass over the fixture vault) is
 * what production's `session/enumerate.ts` would actually mint here.
 */
function review(conceptId: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:widget-theory:1',
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'again',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('composeOracleRanking — the join rankOracle had no production caller for', () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];
  let widgetKey: string;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-compose-'));
    source = new FolderSource(root);

    // `topic: Widget theory` — self-referencing, so this note produces a real,
    // tier-1-bound `ConceptRecord` via `extractConcepts` (`ol-63e1`'s
    // `widgetKey`), not merely a title `buildConceptAssessmentEdges`'s default
    // vocabulary would match with no corresponding record.
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );

    concepts = await extractConcepts(source, {});
    const widget = concepts.find((c) => c.name === 'Widget theory');
    if (widget === undefined) throw new Error('expected "Widget theory" to extract');
    widgetKey = widget.key;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('ranks the one cited concept, carrying mastery read from the review log — not "unknown"', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    expect(entry).toBeDefined();
    // `ol-63e1`: the entry's join key is the opaque one the review log was
    // written under — never the display name, even though both happen to be
    // available on the same entry.
    expect(entry?.conceptKey).toBe(widgetKey);
    // One logged review, rated `again`: a real (if bleak) success rate, so
    // this reads `sprout`, never the neutral `unknown` a caller that dropped
    // the log would produce, and never `seed` — mastery data WAS supplied.
    expect(entry?.factors.masteryState).toBe('sprout');

    // `edges` is passed through so a caller (the gap view) never has to
    // re-run the tier-3 walk to get the sourceCoverage it also needs.
    expect(result.edges.edges.some((e) => e.conceptName === 'Widget theory')).toBe(true);
    expect(result.edges.edges.some((e) => e.conceptKey === widgetKey)).toBe(true);
  });

  it('returns the mastery map it composed for rankOracle, keyed exactly by the edge concept KEY set — never the display name', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
    });

    const conceptKeys = [...new Set(result.edges.edges.map((e) => e.conceptKey))].sort();
    expect([...result.mastery.keys()].sort()).toEqual(conceptKeys);
    expect(result.mastery.get(widgetKey)?.state).toBe('sprout');
    // The display name is never a key in this map — a review log written
    // under the name (the pre-`ol-63e1` shape) would silently miss here.
    expect(result.mastery.has('Widget theory')).toBe(false);
  });

  it('a concept with evidence but no review history still reads `seed`, not `unknown` — mastery data was supplied for it', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    expect(entry?.factors.masteryState).toBe('seed');
  });

  it('a review logged under the OLD display-name join silently produces no mastery evidence — the exact regression this bead fixes', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review('Widget theory')],
      asOf: '2026-08-15',
      concepts,
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    // Proves the join is real, not accidental: a log entry keyed by the
    // display name (what a half-flipped mint site would still produce) does
    // NOT match `conceptKey`, so mastery reads `seed` exactly as if nothing
    // had been reviewed at all.
    expect(entry?.factors.masteryState).toBe('seed');
  });

  it("with no `retrievability` input at all, the stored factor is absent (never a defaulted 1) though the blend still reads neutral — `ol-v7r5.52`'s reshape", async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    // Absent, not `1` — "no eligible evidence" is now distinguishable from
    // "a genuine measured neutral value" (`OracleConceptFactors.retrievabilityWeight`'s doc).
    expect(entry?.factors.retrievabilityWeight).toBeUndefined();
  });

  it('threads retrievability from a supplied Scheduler + instant into the ranking (register join 1-2, `[D-087]`, `ol-95vv.1`)', async () => {
    const scheduler = stubScheduler({ 'qa:widget-theory:1': 0.35 });
    const now = new Date('2026-08-15T09:00:00.000Z');
    // `[D-264]` ruling 1: eligible for readiness needs an INDEPENDENT
    // success, not merely a completed review — see the dedicated
    // supported-only test below for the case this excludes.
    const eligibleReview = review(widgetKey, { rating: 'good', supportLevelShown: 'independent' });

    const withRetrievability = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [eligibleReview],
      asOf: '2026-08-15',
      concepts,
      retrievability: { scheduler, now },
    });
    const withoutRetrievability = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [eligibleReview],
      asOf: '2026-08-15',
      concepts,
    });

    const findEntry = (result: typeof withRetrievability) => {
      const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
      if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
      const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
      if (entry === undefined) throw new Error('expected Widget theory to be ranked');
      return entry;
    };

    const withEntry = findEntry(withRetrievability);
    const withoutEntry = findEntry(withoutRetrievability);

    // Absent without a scheduler — the blend still reads neutral (re-asserted
    // here so this test stands on its own if the dedicated default-path test
    // above is ever removed), but the stored factor no longer fabricates a 1.
    expect(withoutEntry.factors.retrievabilityWeight).toBeUndefined();
    // The stub's recall probability for `qa:widget-theory:1` — the review
    // fixture's `instrumentId` — flows straight through as the multiplier.
    expect(withEntry.factors.retrievabilityWeight).toBe(0.35);
    expect(withEntry.factors.priorityScore).toBeCloseTo(
      withoutEntry.factors.preMasteryScore * withoutEntry.factors.masteryNeedWeight * 0.35,
    );
    // The signal actually moved the score — this is the "changes ranking"
    // half `rank.ts`'s own blend arithmetic already specifies; this suite
    // covers only that compose's threading reaches it.
    expect(withEntry.factors.priorityScore).not.toBe(withoutEntry.factors.priorityScore);
  });

  it('a concept with no recall-tier instrument read (e.g. no review history) is left OUT of the map — reads neutral in the blend, absent in the stored factor, never a fabricated value', async () => {
    const scheduler = stubScheduler({}); // never queried: no review events exist for widgetKey
    const now = new Date('2026-08-15T09:00:00.000Z');

    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
      retrievability: { scheduler, now },
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    expect(entry?.factors.retrievabilityWeight).toBeUndefined();
  });

  it('`[D-264]` ruling 1: an instrument whose only success was SUPPORTED carries no eligible recall evidence for readiness — the behaviour delta `ol-v7r5.54` closes', async () => {
    const scheduler = stubScheduler({ 'qa:widget-theory:1': 0.35 });
    const now = new Date('2026-08-15T09:00:00.000Z');
    // A completed, successful review — recall-tier, not recognition — but
    // its only success was shown at `'prompted'` support. Before this bead,
    // `resolveRetrievabilityScores` folded through the plain
    // `readAllConceptVitality` (R3's recall-tier filter only), so this
    // instrument WOULD have set a real, non-neutral `retrievabilityWeight`.
    // It still schedules and still counts toward mastery ([D-094]'s
    // discount) — only the readiness fold excludes it.
    const supportedOnlyReview = review(widgetKey, {
      rating: 'good',
      supportLevelShown: 'prompted',
    });

    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [supportedOnlyReview],
      asOf: '2026-08-15',
      concepts,
      retrievability: { scheduler, now },
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    // Absent, not a defaulted 1 and not the stub's 0.35 — no eligible
    // evidence, so the blend reads neutral, exactly as "no review history"
    // does (the prior test), even though a review happened and succeeded.
    expect(entry?.factors.retrievabilityWeight).toBeUndefined();
    // The mastery join is unaffected: the same log still counts as a scored
    // success for mastery ([D-094]'s discount for supported success), which
    // is what makes this a readiness-only exclusion rather than a second,
    // accidental change to the mastery join this suite already covers.
    const masteryEntry = result.mastery.get(widgetKey);
    expect(masteryEntry?.evidence.scoredSuccessCount).toBe(1);
  });
});

describe("composeOracleRanking — threading oracle.rank.v1's reasoning through (`ol-3ux7.5.57.14.53`)", () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];
  let widgetKey: string;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-compose-reasons-'));
    source = new FolderSource(root);
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );

    concepts = await extractConcepts(source, {});
    const widget = concepts.find((c) => c.name === 'Widget theory');
    if (widget === undefined) throw new Error('expected "Widget theory" to extract');
    widgetKey = widget.key;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is empty when no `rankedReasons` input is supplied — every caller today, since oracle.rank.v1 has no production caller', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
    });

    expect(result.rankedReasons.size).toBe(0);
  });

  it("re-keys a supplied reason from conceptName onto this composition's own conceptKey", async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
      rankedReasons: new Map([
        ['Widget theory', 'the past paper weights this heavily and she has not reviewed it yet'],
      ]),
    });

    expect(result.rankedReasons.size).toBe(1);
    expect(result.rankedReasons.get(widgetKey)).toBe(
      'the past paper weights this heavily and she has not reviewed it yet',
    );
    // Never keyed by the display name — the same "opaque key, not the name"
    // discipline `mastery` above already holds.
    expect(result.rankedReasons.has('Widget theory')).toBe(false);
  });

  it('drops a reason naming a concept this composition resolved no key for, silently — no-op, matching every other absent-signal lookup on this path', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
      rankedReasons: new Map([['A concept that does not exist here', 'invented reason']]),
    });

    expect(result.rankedReasons.size).toBe(0);
  });

  it("never reads or echoes `ConceptPriority.reasoning` (the deterministic core's own, STY-2-banned string) into `rankedReasons`", async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [review(widgetKey)],
      asOf: '2026-08-15',
      concepts,
    });

    const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
    // The deterministic reasoning exists on the ranking entry itself...
    expect(entry?.reasoning).toBeTruthy();
    // ...but with no `rankedReasons` input, the LLM-sourced map stays empty
    // regardless — the two are never conflated.
    expect(result.rankedReasons.size).toBe(0);
  });
});

describe('composeOracleRanking — ol-5y40: a casing slip in her topic value must not read as a material-gap', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-compose-casefold-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves an edge whose vocabulary casing differs from the topic-bound record's own casing onto that record's real key, never the fallback name-as-key", async () => {
    // Her Zettelkasten note is titled "Widget Theory"; her `topic:` property
    // on the note that carries the card reads "widget theory" (lowercase) —
    // not a byte match, so tier-1 binding fails and `extractConcepts` mints
    // a tier-2 record named "widget theory" verbatim (R1/R2). The past
    // paper cites "Widget Theory" (the note's own casing), so
    // `extractTier3Evidence`'s vocabulary match returns the edge under THAT
    // casing (R2) — the exact case mismatch `ol-5y40` reports.
    await write('05 Zettelkasten/Widget Theory.md', '# Widget Theory\n');
    await write(
      'Notes/one.md',
      ['---', 'topic: widget theory', 'course: TESTC101', '---', '', 'Front::Back', ''].join('\n'),
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget Theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );

    const concepts = await extractConcepts(source, {});
    const widget = concepts.find((c) => c.name === 'widget theory');
    if (widget === undefined) throw new Error('expected "widget theory" to extract');

    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
    });

    // The edge itself now carries the REAL opaque key, never its own
    // display name as a fallback — the defect described in
    // `evidence-edge/build.ts`'s `conceptKeyByName` doc.
    const edge = result.edges.edges.find((e) => e.conceptName === 'Widget Theory');
    expect(edge?.conceptKey).toBe(widget.key);
    expect(edge?.conceptKey).not.toBe(edge?.conceptName);

    // And the mastery map — what `buildGapView`'s caller joins
    // `buildMaterialPresence` against, both keyed by `ConceptRecord.key` — is
    // keyed by that same real key, so a caller like `gap/provider.ts` finds
    // her material rather than reading a false material-gap.
    expect(result.mastery.has(widget.key)).toBe(true);
    expect(result.mastery.has('Widget Theory')).toBe(false);
  });

  it('never folds two genuinely distinct concepts across a course boundary that merely share a casefolded name', async () => {
    // TESTC101 and OTHERC202 each author their own case variant of the same
    // casefolded topic string ("widget theory" / "WIDGET THEORY") — R1/R2
    // mints two distinct `ConceptRecord`s, one per course. Only TESTC101 has
    // a past paper, citing "Widget Theory" (the Zettelkasten note's own
    // casing, matching neither topic value exactly). The fix must resolve
    // that edge onto TESTC101's own record — never OTHERC202's, which would
    // be a genuine identity fold this bead's fix is forbidden from making.
    await write('05 Zettelkasten/Widget Theory.md', '# Widget Theory\n');
    await write(
      'Notes/one.md',
      ['---', 'topic: widget theory', 'course: TESTC101', '---', '', 'Front::Back', ''].join('\n'),
    );
    await write(
      'Notes/other.md',
      [
        '---',
        'topic: WIDGET THEORY',
        'course: OTHERC202',
        '---',
        '',
        'A different card::for a different course',
        '',
      ].join('\n'),
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget Theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );

    const concepts = await extractConcepts(source, {});
    const testcWidget = concepts.find(
      (c) => c.name === 'widget theory' && c.courses.includes('TESTC101'),
    );
    const otherWidget = concepts.find(
      (c) => c.name === 'WIDGET THEORY' && c.courses.includes('OTHERC202'),
    );
    if (testcWidget === undefined || otherWidget === undefined) {
      throw new Error('expected two distinct per-course "widget theory" records to extract');
    }
    expect(testcWidget.key).not.toBe(otherWidget.key);

    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
    });

    const edge = result.edges.edges.find((e) => e.conceptName === 'Widget Theory');
    expect(edge?.conceptKey).toBe(testcWidget.key);
    expect(edge?.conceptKey).not.toBe(otherWidget.key);
  });
});

describe("resolveTiebreakEligibleConcepts — C5.10 ruling 1's producer (`[D-265]`, `ol-egov.141.62`)", () => {
  // Self-contained review records — this describe block never touches the
  // vault, because `resolveTiebreakEligibleConcepts` is pure over the review
  // log alone (the AND of `../review-log/tiebreak.js` and
  // `../routing/instrument-eligibility.js`, both already unit-tested on
  // their own terms). Proving the resulting `tiebreakEligible` set actually
  // REORDERS `rankOracle`'s output needs two concepts tied to the last
  // decimal of `priorityScore`, which is `../oracle/rank.spec.ts`'s own
  // mechanism to prove (`ol-egov.141.52`'s tests already do); engineering an
  // exact tie through real vault evidence here would mostly re-test that
  // module for no added confidence in this bead's own logic.
  function disagreeingReviews(conceptId: string, instrumentId: string): ReviewLogRecord[] {
    return [
      review(conceptId, {
        eventId: `${instrumentId}-1`,
        instrumentId,
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review(conceptId, {
        eventId: `${instrumentId}-2`,
        instrumentId,
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];
  }

  it('is empty with no `resolveSourceVersion` — the same reachability gap `../review-log/tiebreak.js` documents', () => {
    const reviewLog = disagreeingReviews('widget-theory', 'qa:widget-theory:1');
    expect(resolveTiebreakEligibleConcepts(reviewLog, '2026-08-15', undefined).size).toBe(0);
  });

  it('flags a concept only when BOTH halves hold: comparable-observation disagreement AND a different eligible ordinary instrument', () => {
    const reviewLog = [
      ...disagreeingReviews('widget-theory', 'qa:widget-theory:1'),
      // The "different eligible ordinary instrument" the clause requires.
      review('widget-theory', {
        eventId: 'cloze-widget-1',
        instrumentId: 'cloze:widget-theory:1',
        instrumentType: 'cloze',
        timestamp: '2026-08-05T09:00:00-04:00',
        rating: 'good',
      }),
    ];

    const eligible = resolveTiebreakEligibleConcepts(reviewLog, '2026-08-15', () => 'rev-1');
    expect(eligible.has('widget-theory')).toBe(true);
  });

  it('does not flag a concept with disagreement but no OTHER eligible ordinary instrument', () => {
    // Same disagreeing pair as above, but no second instrument at all on
    // the concept — `hasDifferentEligibleOrdinaryInstrument` has nothing
    // else to offer.
    const reviewLog = disagreeingReviews('widget-theory', 'qa:widget-theory:1');
    const eligible = resolveTiebreakEligibleConcepts(reviewLog, '2026-08-15', () => 'rev-1');
    expect(eligible.has('widget-theory')).toBe(false);
  });

  it('does not flag a concept with an eligible other instrument but no disagreement (a tidy record)', () => {
    const reviewLog = [
      review('widget-theory', {
        eventId: 'qa-widget-1',
        instrumentId: 'qa:widget-theory:1',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review('widget-theory', {
        eventId: 'qa-widget-2',
        instrumentId: 'qa:widget-theory:1',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'good', // agrees — tidy
        supportLevelShown: 'independent',
      }),
      review('widget-theory', {
        eventId: 'cloze-widget-1',
        instrumentId: 'cloze:widget-theory:1',
        instrumentType: 'cloze',
        timestamp: '2026-08-05T09:00:00-04:00',
        rating: 'good',
      }),
    ];

    const eligible = resolveTiebreakEligibleConcepts(reviewLog, '2026-08-15', () => 'rev-1');
    expect(eligible.has('widget-theory')).toBe(false);
  });

  it('excludes the disagreeing instrument itself from counting as the "different" one — a suspended sole other instrument does not qualify either', () => {
    const reviewLog: ReviewLogEntry[] = [
      ...disagreeingReviews('widget-theory', 'qa:widget-theory:1'),
      review('widget-theory', {
        eventId: 'cloze-widget-1',
        instrumentId: 'cloze:widget-theory:1',
        instrumentType: 'cloze',
        timestamp: '2026-08-05T09:00:00-04:00',
        rating: 'good',
      }),
      {
        schemaVersion: 5,
        kind: 'suspend',
        eventId: 'suspend-cloze-1',
        timestamp: '2026-08-06T09:00:00-04:00',
        instrumentId: 'cloze:widget-theory:1',
        conceptIds: ['widget-theory'],
      },
    ];

    const eligible = resolveTiebreakEligibleConcepts(reviewLog, '2026-08-15', () => 'rev-1');
    expect(eligible.has('widget-theory')).toBe(false);
  });
});

describe('composeOracleRanking — threading `resolveTiebreakSourceVersion` (C5.10 ruling 1, `[D-265]`)', () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];
  let widgetKey: string;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-compose-tiebreak-'));
    source = new FolderSource(root);
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );

    concepts = await extractConcepts(source, {});
    const widget = concepts.find((c) => c.name === 'Widget theory');
    if (widget === undefined) throw new Error('expected "Widget theory" to extract');
    widgetKey = widget.key;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('accepts `resolveTiebreakSourceVersion` without changing the single-concept ranking (no tie is possible with only one concept) or throwing', async () => {
    const reviewLog: ReviewLogRecord[] = [
      review(widgetKey, {
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review(widgetKey, {
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    const withoutResolver = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog,
      asOf: '2026-08-15',
      concepts,
    });
    const withResolver = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog,
      asOf: '2026-08-15',
      concepts,
      resolveTiebreakSourceVersion: () => 'rev-1',
    });

    const findEntry = (result: typeof withResolver) => {
      const course = result.ranking.courses.find((c) => c.course === 'TESTC101');
      if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
      const entry = course.ranked.find((c) => c.conceptName === 'Widget theory');
      if (entry === undefined) throw new Error('expected Widget theory to be ranked');
      return entry;
    };

    // A single ranked concept has no tie to break either way — this proves
    // the new field threads through `buildConceptAssessmentEdges`'s options
    // cleanly (never leaking into `edgeOptions`) and never perturbs the
    // ordinary blend, not that the tiebreak fired (it cannot, with one
    // concept).
    expect(findEntry(withResolver).priorityScore).toBe(findEntry(withoutResolver).priorityScore);
    expect(findEntry(withResolver).rank).toBe(1);
  });
});
