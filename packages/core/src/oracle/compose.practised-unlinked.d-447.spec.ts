/**
 * `[D-447]` option (b), as ruled 2026-09-29: an otherwise eligible course concept that she has
 * practised but that no assessment reaches is admitted into its course's ranking at the need-only
 * treatment, even when the course has assessment records. Unknown assessment relevance stays
 * unknown, an explicit assessment scope is respected, and a linked concept keeps its treatment.
 *
 * These are the scenarios written first (`ol-egov.141.89.10.96`). Every course code, concept
 * name, path and question below is invented (INV-3).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewLogEntry, ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { composeOracleRanking, practisedUnlinkedConceptsByCourse } from './compose.js';
import { RANK_REASON_PHRASES } from './rank.js';
import type { CourseOracleRanking, OracleProximityFactors } from './types.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const COURSE = 'TESTC101';
const OTHER_COURSE = 'TESTD200';

const concept = (slug: string, name: string, courses: readonly string[]): ConceptRecord => ({
  key: `concept-prov1:invented-${slug}`,
  name,
  tier: 2,
  courses: [...courses],
  sourcePaths: [`01 Courses/${courses[0]}/${name}.md` as VaultPath],
});

/** Reached by a past paper: linked in COURSE. */
const WIDGET = concept('widget', 'Widget theory', [COURSE]);
/** Practised, and no assessment reaches it. */
const GADGET = concept('gadget', 'Gadget lore', [COURSE]);
/** Never practised, and no assessment reaches it. */
const SPROCKET = concept('sprocket', 'Sprocket craft', [COURSE]);
/** In a second course whose assessments reach nothing at all. */
const LEVER = concept('lever', 'Lever craft', [OTHER_COURSE]);
const ALL_CONCEPTS = [WIDGET, GADGET, SPROCKET, LEVER];

function review(conceptKey: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:gadget:1',
    instrumentType: 'qa',
    conceptIds: [conceptKey],
    rating: 'good',
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

function suspend(
  instrumentId: string,
  conceptKey: string,
  reason?: 'defect' | 'own-choice',
): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'suspend',
    eventId: `s-${instrumentId}`,
    timestamp: '2026-08-11T09:00:00-04:00',
    instrumentId,
    conceptIds: [conceptKey],
    ...(reason !== undefined ? { reason } : {}),
  } as SuspendLogRecord;
}

function rankedCourse(
  courses: readonly CourseOracleRanking[],
  course: string,
): Extract<CourseOracleRanking, { status: 'ranked' }> {
  const found = courses.find((c) => c.course === course);
  if (found?.status !== 'ranked') throw new Error(`expected ${course} to be ranked`);
  return found;
}

describe('composeOracleRanking — practised concepts no assessment reaches ([D-447] option (b))', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  /** One assessment note; `extra` lines are added to its frontmatter, `body` to its prose. */
  async function assessment(
    name: string,
    course: string,
    due: string,
    extra: readonly string[] = [],
    body = '',
  ): Promise<void> {
    await write(
      `02 Assignments/${name}.md`,
      [
        '---',
        `class: ${course}`,
        'type: Quiz',
        'weight: 10',
        `due: ${due}`,
        'status: upcoming',
        ...extra,
        '---',
        '',
        `# ${name}`,
        ...(body === '' ? [] : ['', body]),
        '',
      ].join('\n'),
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-d447-'));
    source = new FolderSource(root);
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
    await write(
      `03 Research/${COURSE} Past Paper 2023.md`,
      [
        '---',
        'role: past-paper',
        `course: ${COURSE}`,
        '---',
        '',
        `# ${COURSE} Past Paper 2023`,
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
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const compose = (
    reviewLog: readonly ReviewLogEntry[],
    overrides: Record<string, unknown> = {},
    asOf = '2026-08-15',
  ) =>
    composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog,
      asOf,
      concepts: ALL_CONCEPTS,
      serveCoursesWithoutAssessmentsOnNeed: true,
      ...overrides,
    });

  it('admits a practised concept no assessment reaches, at unknown relevance, with her own evidence read', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const result = await compose([review(GADGET.key)]);

    const course = rankedCourse(result.ranking.courses, COURSE);
    const gadget = course.ranked.find((c) => c.conceptKey === GADGET.key);
    expect(gadget).toBeDefined();
    // `[D-329]`'s unknown-relevance entry: no contributing edge, no citation.
    expect(gadget?.factors.contributions).toEqual([]);
    expect(gadget?.citations).toEqual([]);
    expect(gadget?.factors.vetoedEdges ?? []).toEqual([]);
    // Her own practice reaches the entry: the mastery fold covers the key.
    expect(result.mastery.get(GADGET.key)?.state).toBe('sprout');
    expect(gadget?.factors.masteryState).toBe('sprout');
    expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    // The concept an edge reaches is still ranked, with its evidence.
    const widget = course.ranked.find((c) => c.conceptKey === WIDGET.key);
    expect(widget?.factors.contributions.length).toBeGreaterThan(0);
  });

  it('leaves a never-practised unlinked concept out', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const result = await compose([review(GADGET.key)]);
    const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).not.toContain(SPROCKET.key);
    expect(result.mastery.has(SPROCKET.key)).toBe(false);
    expect(result.practisedUnlinkedAdmitted.get(COURSE)).not.toContain(SPROCKET.key);
  });

  it('does not admit a concept on an attempt nothing rated (blank or skipped)', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const result = await compose([review(GADGET.key, { rating: null } as never)]);
    const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).not.toContain(GADGET.key);
  });

  it('counts a wrong attempt as practice: an unsuccessful answer still admits the concept', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const result = await compose([review(GADGET.key, { rating: 'again' })]);
    const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).toContain(GADGET.key);
  });

  it('leaves a linked concept exactly as it was: same factors, same citations, same score', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const log = [review(GADGET.key), review(WIDGET.key, { instrumentId: 'qa:widget:1' })];
    const before = await compose(log, { admitPractisedUnlinkedConcepts: false });
    const after = await compose(log);

    const linked = (r: Awaited<ReturnType<typeof compose>>) =>
      rankedCourse(r.ranking.courses, COURSE).ranked.find((c) => c.conceptKey === WIDGET.key);
    const b = linked(before);
    const a = linked(after);
    expect(b).toBeDefined();
    expect(a?.factors).toEqual(b?.factors);
    expect(a?.citations).toEqual(b?.citations);
    expect(a?.priorityScore).toEqual(b?.priorityScore);
    // The edges the ranking composes from are untouched.
    expect(after.edges).toEqual(before.edges);
  });

  it('with the option off the ranking equals today: nothing admitted, the course reads as before', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const log = [review(GADGET.key)];
    const off = await compose(log, { admitPractisedUnlinkedConcepts: false });
    const noOptIn = await compose(log, { serveCoursesWithoutAssessmentsOnNeed: undefined });
    expect(off.practisedUnlinkedAdmitted.size).toBe(0);
    expect(off.ranking.courses.filter((c) => c.course === COURSE)).toEqual(
      noOptIn.ranking.courses.filter((c) => c.course === COURSE),
    );
    const keys = rankedCourse(off.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).not.toContain(GADGET.key);
    expect(off.mastery.has(GADGET.key)).toBe(false);
  });

  it('the caller that does not opt in is unchanged (no need-only door of any kind)', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    const result = await compose([review(GADGET.key)], {
      serveCoursesWithoutAssessmentsOnNeed: undefined,
    });
    expect(result.practisedUnlinkedAdmitted.size).toBe(0);
    const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).not.toContain(GADGET.key);
  });

  it('the option can be turned on by itself, without the no-assessment-course door', async () => {
    await assessment('Quiz 1', COURSE, '2026-09-01');
    await assessment('Lab 1', OTHER_COURSE, '2026-09-02');
    const result = await compose([review(GADGET.key)], {
      serveCoursesWithoutAssessmentsOnNeed: undefined,
      admitPractisedUnlinkedConcepts: true,
    });
    const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
    expect(keys).toContain(GADGET.key);
  });

  describe('an explicit assessment scope is respected', () => {
    it('every upcoming assessment states its scope and none reaches the concept: it stays out however much she practised it', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01', ['scope: Widget theory']);
      const log = [review(GADGET.key), review(GADGET.key), review(GADGET.key)];
      const result = await compose(log);
      const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
      expect(keys).not.toContain(GADGET.key);
      expect(result.practisedUnlinkedAdmitted.size).toBe(0);
      expect(result.mastery.has(GADGET.key)).toBe(false);
    });

    it('a scope that names the concept links it: the ordinary treatment applies, not the need-only door', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01', ['scope: Gadget lore']);
      const result = await compose([review(GADGET.key)]);
      const gadget = rankedCourse(result.ranking.courses, COURSE).ranked.find(
        (c) => c.conceptKey === GADGET.key,
      );
      expect(gadget?.factors.contributions.length).toBeGreaterThan(0);
      expect(result.practisedUnlinkedAdmitted.size).toBe(0);
    });

    it('one upcoming assessment states no scope: relevance to it is unknown, so the concept is admitted', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01', ['scope: Widget theory']);
      await assessment('Quiz 2', COURSE, '2026-09-08');
      const result = await compose([review(GADGET.key)]);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });

    it('a concept name that merely appears in body prose is not a scope: the concept is admitted', async () => {
      await assessment(
        'Quiz 1',
        COURSE,
        '2026-09-01',
        [],
        'Covers the widget material only, not gadget lore.',
      );
      const result = await compose([review(GADGET.key)]);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });

    it('a scope on an assessment that has already passed filters nothing', async () => {
      await assessment('Quiz 1', COURSE, '2026-08-01', ['scope: Widget theory']);
      await assessment('Quiz 2', COURSE, '2026-09-08');
      const result = await compose([review(GADGET.key)]);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });
  });

  describe('a completed course keeps its own reading (D-373)', () => {
    it('every assessment has passed: no unlinked concept is admitted, the linked one is vetoed as before', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const result = await compose([review(GADGET.key)], {}, '2026-10-15');
      const course = rankedCourse(result.ranking.courses, COURSE);
      expect(course.ranked).toEqual([]);
      expect((course.vetoedConcepts ?? []).map((c) => c.conceptKey)).toEqual([WIDGET.key]);
      expect(result.practisedUnlinkedAdmitted.size).toBe(0);
    });

    it('an assessment due today has not passed: the course is live, and its unlinked concept is admitted', async () => {
      await assessment('Quiz 1', COURSE, '2026-08-15');
      const result = await compose([review(GADGET.key)]);
      const course = rankedCourse(result.ranking.courses, COURSE);
      expect(course.ranked.map((c) => c.conceptKey)).toContain(GADGET.key);
      // Agrees with the ranking's own veto: the day-of assessment still counts.
      expect(course.ranked.find((c) => c.conceptKey === WIDGET.key)).toBeDefined();
    });

    it('one assessment passed and one still to come: the course is live', async () => {
      await assessment('Quiz 1', COURSE, '2026-08-01');
      await assessment('Quiz 2', COURSE, '2026-09-08');
      const result = await compose([review(GADGET.key)]);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });

    it('an assessment with no readable date is not known to have passed: the course is live', async () => {
      await assessment('Quiz 1', COURSE, 'sometime in term');
      const result = await compose([review(GADGET.key)], {}, '2027-01-01');
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });
  });

  describe('a course whose assessments reach nothing', () => {
    it('ranks a practised concept in place of abstaining; with no practice it still abstains', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      await assessment('Lab 1', OTHER_COURSE, '2026-09-02');

      const untouched = await compose([review(GADGET.key)]);
      const stillAbstained = untouched.ranking.courses.find((c) => c.course === OTHER_COURSE);
      expect(stillAbstained?.status).toBe('abstained');

      const practised = await compose([review(LEVER.key, { instrumentId: 'qa:lever:1' })]);
      const course = rankedCourse(practised.ranking.courses, OTHER_COURSE);
      expect(course.ranked.map((c) => c.conceptKey)).toEqual([LEVER.key]);
      expect(course.ranked[0]?.factors.contributions).toEqual([]);
      expect(practised.practisedUnlinkedAdmitted.get(OTHER_COURSE)).toEqual([LEVER.key]);
    });
  });

  describe('practice must be valid, and the instrument-eligibility veto still applies', () => {
    it('practice only on an instrument proven defective admits nothing', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const log = [
        review(GADGET.key, { instrumentId: 'qa:gadget:bad' }),
        suspend('qa:gadget:bad', GADGET.key, 'defect'),
      ];
      const result = await compose(log);
      const keys = rankedCourse(result.ranking.courses, COURSE).ranked.map((c) => c.conceptKey);
      expect(keys).not.toContain(GADGET.key);
      expect(result.practisedUnlinkedAdmitted.size).toBe(0);
    });

    it('practice on a good instrument still admits it when a second instrument was proven defective', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const log = [
        review(GADGET.key, { instrumentId: 'qa:gadget:bad' }),
        suspend('qa:gadget:bad', GADGET.key, 'defect'),
        review(GADGET.key, { instrumentId: 'qa:gadget:good' }),
      ];
      const result = await compose(log);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });

    it('a withdrawal is not invalidity: earlier practice on a withdrawn instrument still admits the concept when no inventory says it cannot be served', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const log = [review(GADGET.key), suspend('qa:gadget:1', GADGET.key, 'own-choice')];
      const result = await compose(log);
      expect(result.practisedUnlinkedAdmitted.get(COURSE)).toEqual([GADGET.key]);
    });

    it('an admitted concept whose every instrument is suspended is removed and listed with its reason, never ranked', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const log = [review(GADGET.key), suspend('qa:gadget:1', GADGET.key, 'own-choice')];
      const result = await compose(log, {
        instrumentInventory: [{ instrumentId: 'qa:gadget:1', conceptIds: [GADGET.key] }],
      });
      const course = rankedCourse(result.ranking.courses, COURSE);
      expect(course.ranked.map((c) => c.conceptKey)).not.toContain(GADGET.key);
      const vetoed = (course.vetoedConcepts ?? []).find((c) => c.conceptKey === GADGET.key);
      expect(vetoed?.eligibilityVeto).toBe('suspended');
    });
  });

  describe('what the ranking says about an admitted concept never claims assessment relevance (rows 32 and 33)', () => {
    it('the reasoning carries no relevance or positive-evidence phrase for a need-only entry', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const result = await compose([review(GADGET.key)]);
      const course = rankedCourse(result.ranking.courses, COURSE);
      const gadget = course.ranked.find((c) => c.conceptKey === GADGET.key);
      expect(gadget).toBeDefined();
      const reasoning = gadget?.reasoning ?? '';
      for (const claim of [
        RANK_REASON_PHRASES.relevance,
        RANK_REASON_PHRASES.evidencePastPapers,
        RANK_REASON_PHRASES.evidenceObjectives,
        RANK_REASON_PHRASES.evidenceBoth,
        RANK_REASON_PHRASES.evidenceOther,
      ]) {
        expect(reasoning).not.toContain(claim);
      }
    });

    it('nor when relevance is what puts it ahead: the unknown-relevance placement is worded as a placement, never as assessment importance', async () => {
      // An undated assessment leaves proximity equal, so relevance alone can decide the order.
      await assessment('Quiz 1', COURSE, 'to be announced');
      const result = await compose([review(GADGET.key)]);
      const course = rankedCourse(result.ranking.courses, COURSE);
      const gadget = course.ranked.find((c) => c.conceptKey === GADGET.key);
      expect(gadget).toBeDefined();
      const reasoning = gadget?.reasoning ?? '';
      for (const claim of [
        RANK_REASON_PHRASES.relevance,
        RANK_REASON_PHRASES.evidencePastPapers,
        RANK_REASON_PHRASES.evidenceObjectives,
        RANK_REASON_PHRASES.evidenceBoth,
        RANK_REASON_PHRASES.evidenceOther,
      ]) {
        expect(reasoning).not.toContain(claim);
      }
    });

    it('the entry carries no default weight presented as evidence: no contribution, no citation, proximity nil', async () => {
      await assessment('Quiz 1', COURSE, '2026-09-01');
      const result = await compose([review(GADGET.key)]);
      const gadget = rankedCourse(result.ranking.courses, COURSE).ranked.find(
        (c) => c.conceptKey === GADGET.key,
      );
      expect(gadget?.factors.contributions).toEqual([]);
      expect(gadget?.factors.citations).toEqual([]);
      expect(gadget?.factors.objectivesCitations ?? []).toEqual([]);
      expect((gadget?.factors as Partial<OracleProximityFactors> | undefined)?.proximityScore).toBe(
        0,
      );
    });
  });
});

describe('practisedUnlinkedConceptsByCourse — the admission rule, over plain values', () => {
  const record = (
    course: string | undefined,
    due: string | undefined,
    path = `02 Assignments/${course ?? 'none'}-${due ?? 'undated'}.md`,
  ): AssessmentRecord => ({
    path: path as VaultPath,
    course,
    type: 'Quiz',
    weight: undefined,
    weightRaw: undefined,
    due,
    status: undefined,
  });

  const practisedAll = () => true;
  const admit = (over: Partial<Parameters<typeof practisedUnlinkedConceptsByCourse>[0]> = {}) =>
    practisedUnlinkedConceptsByCourse({
      concepts: [GADGET],
      assessmentRecords: [record(COURSE, '2026-09-01')],
      edges: [],
      asOf: '2026-08-15',
      isPractised: practisedAll,
      declaredScopePaths: new Set(),
      ...over,
    });

  it('admits an unlinked, practised concept of a live course, keyed course to concept key to name', () => {
    expect(admit()).toEqual(new Map([[COURSE, new Map([[GADGET.key, GADGET.name]])]]));
  });

  it('never names a course with nothing to admit (an empty entry would flip an abstention to a ranking)', () => {
    expect(admit({ isPractised: () => false }).size).toBe(0);
  });

  it('a concept with an edge in the course is linked and is left to its ordinary treatment', () => {
    expect(admit({ edges: [{ course: COURSE, conceptKey: GADGET.key }] }).size).toBe(0);
  });

  it('an edge in another course does not link the concept in this one', () => {
    const shared = concept('shared', 'Shared idea', [COURSE, OTHER_COURSE]);
    const result = admit({
      concepts: [shared],
      assessmentRecords: [record(COURSE, '2026-09-01'), record(OTHER_COURSE, '2026-09-01')],
      edges: [{ course: OTHER_COURSE, conceptKey: shared.key }],
    });
    expect([...result.keys()]).toEqual([COURSE]);
  });

  it('a course no record names is not this rule (the no-assessment-course door owns it)', () => {
    expect(admit({ assessmentRecords: [record(OTHER_COURSE, '2026-09-01')] }).size).toBe(0);
  });

  it('a record with no course attributes nothing to any course', () => {
    expect(admit({ assessmentRecords: [record(undefined, '2026-09-01')] }).size).toBe(0);
  });

  it('a course whose every dated assessment has passed is completed and is skipped', () => {
    expect(admit({ assessmentRecords: [record(COURSE, '2026-08-14')] }).size).toBe(0);
    expect(admit({ assessmentRecords: [record(COURSE, '2026-08-15')] }).size).toBe(1);
  });

  it('an undated or unparseable assessment keeps the course live', () => {
    expect(admit({ assessmentRecords: [record(COURSE, undefined)], asOf: '2030-01-01' }).size).toBe(
      1,
    );
    expect(
      admit({ assessmentRecords: [record(COURSE, '15/08/26')], asOf: '2030-01-01' }).size,
    ).toBe(1);
  });

  it('a scope statement on every live assessment closes the course; on some of them it does not', () => {
    const live = [record(COURSE, '2026-09-01', 'a.md'), record(COURSE, '2026-09-08', 'b.md')];
    expect(
      admit({
        assessmentRecords: live,
        declaredScopePaths: new Set(['a.md' as VaultPath, 'b.md' as VaultPath]),
      }).size,
    ).toBe(0);
    expect(
      admit({ assessmentRecords: live, declaredScopePaths: new Set(['a.md' as VaultPath]) }).size,
    ).toBe(1);
  });
});
