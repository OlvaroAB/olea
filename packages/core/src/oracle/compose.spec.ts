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
import type { ReviewLogRecord } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import { composeOracleRanking } from './compose.js';

const BASE_PATH = '02 Assignments/Assignments.base';

/**
 * `ol-63e1`: a review-log record's `conceptIds` now carries the opaque key
 * (`ConceptRecord.key`), never the display name — `widgetKey` (set in
 * `beforeEach`, from a real `extractConcepts` pass over the fixture vault) is
 * what production's `session/enumerate.ts` would actually mint here.
 */
function review(conceptId: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 4,
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
});
