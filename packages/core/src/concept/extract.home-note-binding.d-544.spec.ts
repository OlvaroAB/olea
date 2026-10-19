/**
 * `ol-egov.141.89.3.53` (`[D-544]`, `[D-402]`): a topic binds to a concept note by title only
 * within its own course's reading set (F1.3, `[D-248]`), so an accepted draft landing in course C's
 * home note never joins C's course-scoped identity back into course D's.
 *
 * Before this, extraction bound a topic to any concept note one hop from ANY course's material.
 * Course C's home note names the wording it was drafted for, D's notes link a concept note of that
 * title, so C's topic bound to D's note and the two courses became one identity again — joined by
 * the wording alone, which `[D-402]` rules out. A confirmed same-as link stays the only join.
 *
 * Every fixture string is invented: course codes, the wordings, the notes and the paper.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConceptAssessmentEdges } from '../evidence-edge/build.js';
import { FolderSource } from '../vault/folder-source.js';
import { courseScopedStandInKey } from './course-scoped-identity.js';
import { extractConcepts } from './extract.js';
import { listConceptKeyRecords } from './key-store.js';
import { listSameAsLinkRecords, proposeSameAsFromMintCollisions } from './same-as.js';
import type { ConceptRecord } from './types.js';

const WORDING = 'Quillite';
const C = 'CEE101';
const D = 'DEE202';
const CONCEPT_NOTE = 'Zettelkasten/Quillite.md';
const C_LECTURE = '01 Courses/CEE101/Week 1/Lecture 1.md';
const D_LECTURE = '01 Courses/DEE202/Week 1/Lecture 1.md';
/** C's home note, beside a source with no note of its own (`homeNotePathForSource`). */
const C_HOME = '01 Courses/CEE101/Week 2/Slides 2.md';
const C_PAPER = '03 Research/CEE101 Past Paper 2024.md';
const D_PAPER = '03 Research/DEE202 Past Paper 2024.md';
const BASE_PATH = '02 Assignments/Assignments.base';
const LOOSE = '03 Research/Loose.md';

let root: string;
let source: FolderSource;

async function write(relPath: string, content: string): Promise<void> {
  const full = join(root, ...relPath.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

/**
 * The note an accepted draft lands in: the shape the plugin's `initialHomeNoteContent` creates and
 * `ensureTopicIncludes` grows (`generation/home-note.ts`), with the accepted item below it.
 */
function homeNote(topics: readonly string[]): string {
  return [
    '---',
    'topic:',
    ...topics.map((topic) => `  - ${topic}`),
    'olea-home-note: true',
    '---',
    '',
    '*Olea created this note beside `Slides 2.pdf`, to keep generated practice out of it directly.',
    "Generated quiz items land here on acceptance. This note is Olea's own layer (INV-6) —",
    'renameable and prunable like anything else Olea writes without asking.*',
    '',
    'What habit does the invented mineral show? :: A layered one. #flashcards',
    '',
  ].join('\n');
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

function assessmentNote(course: string, heading: string): string {
  return `---\nclass: ${course}\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n---\n\n# ${heading}\n`;
}

/** Course D's material: a lecture note linking the concept note, which therefore D alone reaches. */
async function writeCourseD(): Promise<void> {
  await write(CONCEPT_NOTE, '# Quillite\n\nAn invented layered habit.\n');
  await write(D_LECTURE, '---\ntopic: []\n---\n\n# Lecture 1\n\nSee [[Quillite]].\n');
}

function ofWording(records: readonly ConceptRecord[], name = WORDING): ConceptRecord[] {
  return records.filter((record) => record.name === name);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-home-binding-'));
  source = new FolderSource(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("an accepted draft in course C's home note leaves C's course-scoped identity apart ([D-544], [D-402])", () => {
  async function writeAssessments(): Promise<void> {
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
    await write(C_PAPER, pastPaper(C, `Explain ${WORDING} with an example.`));
    await write(D_PAPER, pastPaper(D, `Define ${WORDING}.`));
    await write('02 Assignments/Exam C.md', assessmentNote(C, 'Exam C'));
    await write('02 Assignments/Exam D.md', assessmentNote(D, 'Exam D'));
  }

  async function buildEdges(concepts: readonly ConceptRecord[]) {
    return buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts,
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
  }

  it("C's topic keys to C's course-scoped identity, and D keeps its note-bound identity alone", async () => {
    await writeCourseD();
    await write(C_LECTURE, '---\ntopic: []\n---\n\n# Lecture 1\n\nNothing on the wording.\n');
    await writeAssessments();

    // Before the draft: D's identity is bound to D's note; C's past paper names the wording, so
    // the edge builder mints C's course-scoped identity (`[D-544]`).
    const before = await extractConcepts(source, { stampConceptKeys: true });
    const [dBefore] = ofWording(before);
    expect(ofWording(before)).toHaveLength(1);
    expect(dBefore?.courses).toEqual([D]);
    expect(dBefore?.boundNotePath).toBe(CONCEPT_NOTE);
    const edgesBefore = await buildEdges(before);
    const cKey = edgesBefore.edges.find((edge) => edge.course === C)?.conceptKey as string;
    expect(edgesBefore.courseScopedConcepts.map((c) => c.key)).toEqual([cKey]);
    const keyRecordsBefore = (await listConceptKeyRecords(source)).length;

    // She accepts a draft for C's identity: it lands in C's home note, whose topic names it.
    await write(C_HOME, homeNote([WORDING]));

    const after = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    expect(after.map((record) => record.courses)).toEqual([[C], [D]]);
    const [cAfter, dAfter] = after;
    expect(cAfter?.key).toBe(cKey);
    expect(cAfter?.boundNotePath).toBeUndefined();
    expect(cAfter?.definition).toBeUndefined();
    expect(cAfter?.tier).toBe(2);
    expect(cAfter?.sourcePaths).toEqual([C_HOME]);
    expect(dAfter?.key).toBe(dBefore?.key);
    expect(dAfter?.boundNotePath).toBe(CONCEPT_NOTE);
    expect(dAfter?.tier).toBe(1);
    expect(dAfter?.sourcePaths).toEqual([D_LECTURE]);
    // The re-extraction found C's course-scoped identity again: nothing new was minted.
    expect(await listConceptKeyRecords(source)).toHaveLength(keyRecordsBefore);

    // C's assessments still rank C's identity, and D's only D's.
    const edgesAfter = await buildEdges(after);
    expect(edgesAfter.edges.filter((e) => e.course === C).map((e) => e.conceptKey)).toEqual([cKey]);
    expect(edgesAfter.edges.filter((e) => e.course === D).map((e) => e.conceptKey)).toEqual([
      dAfter?.key,
    ]);
  });

  it('the only join is the proposed same-as link, and nothing confirms it', async () => {
    await writeCourseD();
    await writeAssessments();
    const before = await extractConcepts(source, { stampConceptKeys: true });
    const cKey = (await buildEdges(before)).edges.find((edge) => edge.course === C)
      ?.conceptKey as string;
    await write(C_HOME, homeNote([WORDING]));
    const after = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    const dKey = after.find((record) => record.courses.includes(D))?.key as string;

    await proposeSameAsFromMintCollisions(source, await listConceptKeyRecords(source));
    const links = (await listSameAsLinkRecords(source)).map(({ record }) => record);
    expect(links).toHaveLength(1);
    expect([links[0]?.keyA, links[0]?.keyB].sort()).toEqual([cKey, dKey].sort());
    expect(links.map((link) => link.status)).toEqual(['proposed']);
  });

  it('without stamping, C takes the course-scoped stand-in and D keeps the stand-in it had', async () => {
    await writeCourseD();
    const [dBefore] = ofWording(await extractConcepts(source));
    await write(C_HOME, homeNote([WORDING]));

    const after = ofWording(await extractConcepts(source));
    expect(after.map((record) => [record.courses, record.key])).toEqual([
      [[C], courseScopedStandInKey(WORDING, C)],
      [[D], dBefore?.key],
    ]);
  });
});

describe('a course cited only by its home notes binds to a concept note only when its own reading set holds the note', () => {
  it("with no course-scoped identity on file, C's identity stays apart and its mint proposes a same-as link", async () => {
    await writeCourseD();
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    expect(records.map((record) => record.courses)).toEqual([[C], [D]]);
    expect(records.map((record) => record.boundNotePath)).toEqual([undefined, CONCEPT_NOTE]);
    expect(records.map((record) => record.tier)).toEqual([2, 1]);
    const [cRecord, dRecord] = records;

    const keyRecords = await listConceptKeyRecords(source);
    const cKeyRecord = keyRecords.find(({ record }) => record.key === cRecord?.key)?.record;
    expect(cKeyRecord?.anchor).toMatchObject({ kind: 'topic', course: C, name: WORDING });
    expect(cKeyRecord?.normalizationCollisions).toEqual([dRecord?.key]);

    await proposeSameAsFromMintCollisions(source, keyRecords);
    const links = (await listSameAsLinkRecords(source)).map(({ record }) => record);
    expect(links.map((link) => link.status)).toEqual(['proposed']);
    expect([links[0]?.keyA, links[0]?.keyB].sort()).toEqual(
      [cRecord?.key as string, dRecord?.key as string].sort(),
    );
  });

  it('a second stamped pass finds both keys again and mints nothing', async () => {
    await writeCourseD();
    await write(C_HOME, homeNote([WORDING]));
    const first = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    const count = (await listConceptKeyRecords(source)).length;
    const second = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    expect(second.map((record) => record.key)).toEqual(first.map((record) => record.key));
    expect(await listConceptKeyRecords(source)).toHaveLength(count);
  });

  it("a home note never decides C's binding on its own: where her own C note cites the wording, C keeps today's binding and the home note follows it", async () => {
    // Her own plain topic in C, with only D linking the note, binds by today's rule (an open
    // question on the bead, left unchanged here). The home note must not split C in two.
    await writeCourseD();
    await write(C_LECTURE, `---\ntopic: [${WORDING}]\n---\n\n# Lecture 1\n`);
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source));
    expect(records).toHaveLength(1);
    expect(records[0]?.courses).toEqual([C, D]);
    expect(records[0]?.boundNotePath).toBe(CONCEPT_NOTE);
    expect(records[0]?.sourcePaths).toEqual([C_LECTURE, C_HOME, D_LECTURE]);
  });
});

describe('a topic in a course whose own reading set holds the concept note still binds to it', () => {
  it("C's own note links the concept note: both courses bind to it as one identity, as before", async () => {
    await writeCourseD();
    await write(C_LECTURE, '---\ntopic: []\n---\n\n# Lecture 1\n\nAlso [[Quillite]].\n');
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source));
    expect(records).toHaveLength(1);
    expect(records[0]?.courses).toEqual([C, D]);
    expect(records[0]?.boundNotePath).toBe(CONCEPT_NOTE);
    expect(records[0]?.tier).toBe(1);
    expect(records[0]?.definition).toBe('An invented layered habit.');
    expect(records[0]?.sourcePaths).toEqual([C_LECTURE, C_HOME, D_LECTURE]);
  });

  it("the concept note sits in C's own folder, so it is in C's reading set even though only D links it", async () => {
    const inC = '01 Courses/CEE101/Concepts/Quillite.md';
    await write(inC, '# Quillite\n\nAn invented layered habit.\n');
    await write(D_LECTURE, '---\ntopic: []\n---\n\n# Lecture 1\n\nSee [[Quillite]].\n');
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source));
    expect(records).toHaveLength(1);
    expect(records[0]?.courses).toEqual([C, D]);
    expect(records[0]?.boundNotePath).toBe(inC);
  });

  it('a course alone binds its own topic to the note its own material links', async () => {
    await write(CONCEPT_NOTE, '# Quillite\n\nAn invented layered habit.\n');
    await write(C_LECTURE, '---\ntopic: []\n---\n\n# Lecture 1\n\nSee [[Quillite]].\n');
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source));
    expect(records.map((record) => [record.courses, record.boundNotePath, record.tier])).toEqual([
      [[C], CONCEPT_NOTE, 1],
    ]);
  });
});

describe("a topic cited from no course keeps today's binding", () => {
  it('one identity bound to the note, exactly as before, while no other course cites the wording', async () => {
    await writeCourseD();
    await write(LOOSE, `---\ntopic: [${WORDING}]\n---\n\n# Loose\n`);

    const records = ofWording(await extractConcepts(source));
    expect(records).toHaveLength(1);
    expect(records[0]?.courses).toEqual([D]);
    expect(records[0]?.boundNotePath).toBe(CONCEPT_NOTE);
    expect(records[0]?.sourcePaths).toEqual([D_LECTURE, LOOSE]);
  });

  it("once C's home note names the wording too, the course-less citation sits on both identities", async () => {
    await writeCourseD();
    await write(LOOSE, `---\ntopic: [${WORDING}]\n---\n\n# Loose\n`);
    await write(C_HOME, homeNote([WORDING]));

    const records = ofWording(await extractConcepts(source));
    expect(records.map((record) => [record.courses, record.boundNotePath])).toEqual([
      [[C], undefined],
      [[D], CONCEPT_NOTE],
    ]);
    expect(records.map((record) => record.sourcePaths)).toEqual([
      [C_HOME, LOOSE],
      [D_LECTURE, LOOSE],
    ]);
  });
});

describe('a wording no concept note carries is unchanged by the rule', () => {
  it('one unbound identity, keyed by the wording, exactly as before', async () => {
    await writeCourseD();
    await write(C_HOME, homeNote(['Unheld wording']));

    const records = ofWording(await extractConcepts(source), 'Unheld wording');
    expect(records.map((record) => [record.courses, record.key, record.tier])).toEqual([
      [[C], 'concept-prov1:Unheld wording', 2],
    ]);
    expect(records[0]?.boundNotePath).toBeUndefined();
  });

  it('named in two courses with no note, it keeps the per-course split it already had ([D-402])', async () => {
    await write(C_HOME, homeNote(['Unheld wording']));
    await write(D_LECTURE, '---\ntopic: [Unheld wording]\n---\n\n# Lecture 1\n');

    const records = ofWording(await extractConcepts(source), 'Unheld wording');
    expect(records.map((record) => [record.courses, record.key])).toEqual([
      [[C], 'concept-prov1:Unheld wording@CEE101'],
      [[D], 'concept-prov1:Unheld wording@DEE202'],
    ]);
  });
});

describe("a stamped pass over one course's folder takes that course's own key ([D-357])", () => {
  it('C and D each take their whole-vault key, and neither mints', async () => {
    await writeCourseD();
    await write(C_HOME, homeNote([WORDING]));

    const whole = ofWording(await extractConcepts(source, { stampConceptKeys: true }));
    expect(whole.map((record) => record.courses)).toEqual([[C], [D]]);
    const count = (await listConceptKeyRecords(source)).length;

    const inC = ofWording(
      await extractConcepts(source, { stampConceptKeys: true, under: '01 Courses/CEE101' }),
    );
    const inD = ofWording(
      await extractConcepts(source, { stampConceptKeys: true, under: '01 Courses/DEE202' }),
    );
    expect(inC.map((record) => record.key)).toEqual([whole[0]?.key]);
    expect(inD.map((record) => record.key)).toEqual([whole[1]?.key]);
    expect(inD[0]?.boundNotePath).toBe(CONCEPT_NOTE);
    expect(await listConceptKeyRecords(source)).toHaveLength(count);
  });
});
