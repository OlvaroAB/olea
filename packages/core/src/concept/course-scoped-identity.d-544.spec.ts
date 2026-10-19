/**
 * `[D-544]` (ruled by David 2026-10-17, `ol-egov.141.89.3.52`): a course-scoped identity minted for
 * a wording only another course held, the same-as proposal it raises, and what confirming that
 * proposal does and does not change.
 *
 * David's words: "identity equivalence, assessment relevance and permission to reuse another
 * course's material are separate decisions. Confirming same-as should preserve those distinctions."
 * So once she confirms, the identity readers read the two as one concept, while each course's
 * assessments still rank only its own identity. (Drafting's own scope, the third decision, is
 * pinned in the plugin's `draft-course-scope.d-544.spec.ts`.)
 *
 * Every fixture string is invented: course codes, the wording, the papers, the note.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConceptAssessmentEdges } from '../evidence-edge/build.js';
import { composeOracleRanking } from '../oracle/compose.js';
import { FolderSource } from '../vault/folder-source.js';
import { courseScopedStandInKey, resolveCourseScopedIdentities } from './course-scoped-identity.js';
import {
  buildConceptKeyCanonicalIndex,
  listConceptKeyRecords,
  resolveConceptKey,
} from './key-store.js';
import {
  confirmSameAsLink,
  listSameAsLinkRecords,
  proposeSameAsFromMintCollisions,
} from './same-as.js';
import { buildSameAsKeyRedirect } from './same-as-consumer.js';
import type { ConceptRecord } from './types.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const WORDING = 'Tessellite';
const C = 'CEE101';
const D = 'DEE202';
const C_PAPER = '03 Research/CEE101 Past Paper 2024.md';
const D_PAPER = '03 Research/DEE202 Past Paper 2024.md';
const D_NOTE = 'Zettelkasten/Tessellite.md';

function assessmentNote(course: string, heading: string): string {
  return `---\nclass: ${course}\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n---\n\n# ${heading}\n`;
}

function pastPaper(course: string, question: string): string {
  return [
    '---',
    'role: past-paper',
    `course: ${course}`,
    '---',
    '',
    `# ${course} Past Paper — 2024`,
    '',
    '## Question 1 (10 marks)',
    '',
    question,
    '',
  ].join('\n');
}

describe('[D-544] a course-scoped identity, its same-as proposal, and what confirming it changes', () => {
  let root: string;
  let source: FolderSource;
  let dIdentity: ConceptRecord;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-d544-'));
    source = new FolderSource(root);
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
    await write(D_NOTE, '# Tessellite\n\nAn invented crystal habit.\n');
    await write(C_PAPER, pastPaper(C, `Explain ${WORDING} with an example.`));
    await write(D_PAPER, pastPaper(D, `Define ${WORDING}.`));
    await write('02 Assignments/Exam C.md', assessmentNote(C, 'Exam C'));
    await write('02 Assignments/Exam D.md', assessmentNote(D, 'Exam D'));
    // Course D's identity, bound to her note, as extraction keys it.
    const dKey = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: null,
      notePath: D_NOTE,
    });
    dIdentity = {
      key: dKey,
      name: WORDING,
      tier: 1,
      courses: [D],
      sourcePaths: ['01 Courses/DEE202/Week 1.md'],
      boundNotePath: D_NOTE,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function buildEdges() {
    return buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [dIdentity],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
  }

  it('the proposal step proposes exactly one same-as link, confirms nothing, and a second run writes nothing new', async () => {
    const edges = await buildEdges();
    const cKey = edges.edges.find((e) => e.course === C)?.conceptKey as string;

    const keyRecords = await listConceptKeyRecords(source);
    const canonicalKeys = buildConceptKeyCanonicalIndex(keyRecords.map(({ record }) => record));
    await proposeSameAsFromMintCollisions(source, keyRecords, { canonicalKeys });
    const once = await listSameAsLinkRecords(source);
    expect(once).toHaveLength(1);
    expect(once[0]?.record).toMatchObject({
      keyA: [cKey, dIdentity.key].sort()[0],
      keyB: [cKey, dIdentity.key].sort()[1],
      status: 'proposed',
      reason: 'normalisation-collision',
    });

    await proposeSameAsFromMintCollisions(source, await listConceptKeyRecords(source), {
      canonicalKeys,
    });
    const twice = await listSameAsLinkRecords(source);
    expect(twice.map(({ record }) => record)).toEqual(once.map(({ record }) => record));
  });

  it('confirming the link establishes identity equivalence only: the identity readers fold it, the edges do not', async () => {
    const before = await buildEdges();
    const cKey = before.edges.find((e) => e.course === C)?.conceptKey as string;
    const keyRecords = await listConceptKeyRecords(source);
    await proposeSameAsFromMintCollisions(source, keyRecords);
    await confirmSameAsLink(source, cKey, dIdentity.key);

    // Identity equivalence: the readers that fold confirmed links read the two keys as one.
    const links = (await listSameAsLinkRecords(source)).map(({ record }) => record);
    expect(links.map((link) => link.status)).toEqual(['confirmed']);
    const redirect = buildSameAsKeyRedirect(links);
    const canonical = (key: string): string => redirect.get(key) ?? key;
    expect(canonical(cKey)).toBe(canonical(dIdentity.key));

    // Assessment relevance unchanged: each course's assessments still rank only its own identity.
    const after = await buildEdges();
    expect(after.edges.map((e) => [e.course, e.conceptKey])).toEqual(
      before.edges.map((e) => [e.course, e.conceptKey]),
    );
    expect(after.edges.filter((e) => e.course === C).map((e) => e.conceptKey)).toEqual([cKey]);
    expect(after.edges.filter((e) => e.course === D).map((e) => e.conceptKey)).toEqual([
      dIdentity.key,
    ]);
  });

  it("through the production composition, C ranks its own identity and D's ranking never includes it", async () => {
    const { ranking, edges } = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      concepts: [dIdentity],
      vocabulary: [WORDING],
      stampConceptKeys: true,
      reviewLog: [],
      asOf: '2026-09-01',
    });
    const keysOf = (course: string): string[] => {
      const entry = ranking.courses.find((c) => c.course === course);
      if (entry === undefined || entry.status !== 'ranked') throw new Error(`${course} unranked`);
      return entry.ranked.map((row) => row.conceptKey);
    };
    const [cScoped] = edges.courseScopedConcepts;
    expect(cScoped?.courses).toEqual([C]);
    expect(keysOf(C)).toEqual([cScoped?.key]);
    expect(keysOf(D)).toEqual([dIdentity.key]);
  });

  it('resolves stamped keys through the store once per identity, and stand-ins without stamping', async () => {
    const request = {
      course: C,
      name: WORDING,
      introducingPaths: [C_PAPER],
      otherKeys: [dIdentity.key],
    };
    expect(await resolveCourseScopedIdentities(source, [request])).toEqual([
      courseScopedStandInKey(WORDING, C),
    ]);
    const [first] = await resolveCourseScopedIdentities(source, [request], {
      stampConceptKeys: true,
    });
    const [again] = await resolveCourseScopedIdentities(source, [request], {
      stampConceptKeys: true,
    });
    expect(again).toBe(first);
    // D's note-bound identity plus C's one course-scoped identity.
    expect(await listConceptKeyRecords(source)).toHaveLength(2);
  });
});
