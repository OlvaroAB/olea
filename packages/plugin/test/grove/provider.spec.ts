/**
 * `createLocalGroveProvider` wiring tests (F8.1, `[D-134]` Q1, `ol-0r92.17`;
 * real six-state computation `ol-o8eo`).
 *
 * Every fixture string below is INVENTED — course codes, concept names —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * WIRING this bead adds (assembling `buildGroveModel`'s inputs per course,
 * filtering the standing offer per course, respecting withdrawal) — not
 * `buildGroveModel`'s own acceptance criteria, which is `packages/core/
 * src/scope/grove.spec.ts` and `coverage.spec.ts`'s job.
 */
import type { ConceptRelation, GroveCourseModel, Provenance } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveCourseSection, GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createRetrospectiveOfferEventLog } from '../../src/retrospective/offer-events.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-01T09:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

/**
 * A course with a registered objectives document naming "Concept A", material
 * present for it, and NO instrument built — the `ground` cell F4.5's stall
 * flag needs (F8.2's "material present, nothing generated yet" narrowing;
 * `../../src/scope/coverage.ts` — no `::` card syntax anywhere below, so
 * `instrumentCount` stays 0).
 */
function fixtureVaultGroundOnly() {
  return memoryVault({
    [BASE_PATH]: [
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
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Some prose about Concept A, with no instrument built for it yet.',
      '',
    ].join('\n'),
  });
}

/** A course with a registered objectives document naming "Concept A" — the `'declared'` case. */
function fixtureVaultWithRegisteredSource() {
  return memoryVault({
    [BASE_PATH]: [
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
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Concept B]',
      'course: TESTC202',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

/**
 * A course with TWO declared names — a container ("Concept Wide") and one of
 * its own parts ("Concept Narrow") — both cited by the same registered
 * objectives document and both backed by real material, so absent a served
 * `part-of` edge they land as two independent denominator peers (`ol-kghd`,
 * C7.9).
 */
function fixtureVaultWithContainerAndPart() {
  return memoryVault({
    [BASE_PATH]: [
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
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept Wide and Concept Narrow in depth.',
      '',
    ].join('\n'),
    'Notes/wide.md': [
      '---',
      'topic: [Concept Wide]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/narrow.md': [
      '---',
      'topic: [Concept Narrow]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

/**
 * A course with three F7.9 files the pipeline could not read, one per
 * `[D-196]` reason: an unsupported spreadsheet extension, a `.pptx` embedded
 * by a note but structurally invalid, and an unregistered, unembedded image.
 * All three sit in `03 Research` unregistered — register.ts's folder scan
 * has no frontmatter to read off a binary, so every one lands in
 * `skippedNonMarkdown` and is matched to `TESTC101` by `./provider.ts`'s own
 * filename heuristic (its course names always prefix-match a real,
 * already-known course — see that module's doc).
 */
function fixtureVaultWithUnreadableFiles() {
  return memoryVault({
    [BASE_PATH]: [
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
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
      '![[TESTC101 Field Trip Slides.pptx]]',
      '',
    ].join('\n'),
    // `no-reader-for-format`: no `Extractor` claims `.xlsx` at all.
    '03 Research/TESTC101 Grading Weights.xlsx': 'not a real spreadsheet, never parsed',
    // `image-only-no-text`: embedded above, so it IS linked — but the bytes
    // are not a real .pptx, so the structural parse fails.
    '03 Research/TESTC101 Field Trip Slides.pptx': 'not a real pptx, garbage bytes',
    // `not-linked`: a supported format (image), sitting in the folder,
    // registered by nobody and embedded by no note.
    '03 Research/TESTC101 Scanned Handout.png': 'irrelevant — imageExtractor never reads content',
  });
}

/**
 * A course with TWO registered objectives documents, each naming its own
 * concept with real material — `denominatorCount` 2, from two distinct
 * `denominatorSourcePaths` (`[D-184]`, `ol-v7r5.32`'s scope-correction
 * receipt fixtures).
 */
function fixtureVaultWithTwoDeclaredDocs() {
  return memoryVault({
    [BASE_PATH]: [
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
    '03 Research/Objectives A.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    '03 Research/Objectives B.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept B in depth.',
      '',
    ].join('\n'),
    'Notes/a.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/b.md': [
      '---',
      'topic: [Concept B]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

/**
 * Same as `fixtureVaultWithTwoDeclaredDocs`, except `Objectives B.md`'s role
 * has been corrected away from `objectives` to `course-material` (F3.1 —
 * never declares scope). Concept B's own material is untouched: this is a
 * pure reclassification, the SAME `buildGroveModel` path a growth uses
 * (`../../../core/src/scope/grove.ts`'s module doc), never a second one.
 */
function fixtureVaultWithOneDocReclassifiedAway() {
  return memoryVault({
    [BASE_PATH]: [
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
    '03 Research/Objectives A.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    '03 Research/Objectives B.md': [
      '---',
      'role: course-material',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept B in depth.',
      '',
    ].join('\n'),
    'Notes/a.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/b.md': [
      '---',
      'topic: [Concept B]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

/**
 * `fixtureVaultWithRegisteredSource` plus a SECOND registered objectives
 * document naming a brand-new concept — a growth, never a reclassification
 * (F1.5(c)'s "system working" case), used to prove an addition gets no
 * scope-correction receipt.
 */
function fixtureVaultWithRegisteredSourceAndAddition() {
  return memoryVault({
    [BASE_PATH]: [
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
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    '03 Research/Objectives Extra.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course also covers Concept C in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/three.md': [
      '---',
      'topic: [Concept C]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Concept B]',
      'course: TESTC202',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

function relationPassage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// `from` is the finer/part side, `to` is the coarser/container side — the
// same convention `packages/core/src/scope/grove.spec.ts`'s own `partOf`
// helper documents.
function partOf(from: string, to: string): ConceptRelation {
  return {
    type: 'part-of',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: {
      from: relationPassage(`${from}.md`),
      to: relationPassage(`${to}.md`),
    },
  };
}

function modelOf(section: GroveCourseSection | undefined): GroveCourseModel {
  if (section === undefined) throw new Error('expected a course section');
  return section.model;
}

async function sectionsFrom(state: GroveViewState): Promise<readonly GroveCourseSection[]> {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.courses;
}

describe('createLocalGroveProvider — load', () => {
  it('reads a real declared scope for a course with a registered objectives source (F8.1)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const codes = courses.map((c) => c.course).sort();
    expect(codes).toEqual(['TESTC101', 'TESTC202']);

    const c101 = modelOf(courses.find((c) => c.course === 'TESTC101'));
    if (c101.status !== 'declared') throw new Error(`expected declared, got ${c101.status}`);
    expect(c101.cells.map((cell) => cell.conceptName)).toEqual(['Concept A']);
    expect(c101.summary.denominatorSourcePaths).toEqual(['03 Research/Objectives.md']);

    // TESTC202 has a concept of her own ("Concept B") but no registered
    // objectives/past-paper source at all — F8.1 scenario 3's inference case.
    const c202 = modelOf(courses.find((c) => c.course === 'TESTC202'));
    expect(c202.status).toBe('inferred');
  });

  it('a course with no registered source and nothing extracted gets the designed empty state (F8.1 scenario 2)', async () => {
    const vault = memoryVault({
      [BASE_PATH]: [
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
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC303\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const provider = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    expect(courses).toHaveLength(1);
    expect(courses[0]?.course).toBe('TESTC303');
    expect(modelOf(courses[0])).toEqual({ status: 'no-registered-source', course: 'TESTC303' });
  });

  it('filters the standing offer to each course, never pooling it either (D-134 Q1)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const c101 = courses.find((c) => c.course === 'TESTC101');
    const c202 = courses.find((c) => c.course === 'TESTC202');
    expect(c101?.offerCards).toHaveLength(1);
    expect(c101?.offerCards[0]?.course).toBe('TESTC101');
    expect(c202?.offerCards).toHaveLength(0);
  });

  it('is still readable (never unavailable) when no assignments Base is configured', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    expect(courses.map((c) => c.course).sort()).toEqual(['TESTC101', 'TESTC202']);
    for (const course of courses) expect(course.offerCards).toEqual([]);
  });

  it('returns unavailable, never throws, when the vault cannot be read', async () => {
    const provider = createLocalGroveProvider({
      vault: unreadableVault() as ReturnType<typeof fixtureVaultWithRegisteredSource>,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });

  it("persists a concept's ground-streak across two separate provider instances sharing the same data.json, so the stall flag can fire (F4.5, ol-0r92.20)", async () => {
    const host = hostWithBasePath(BASE_PATH);
    const vault = fixtureVaultGroundOnly();

    // First "session": a fresh provider, nothing persisted yet.
    const provider1 = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const first = await sectionsFrom(await provider1.load());
    const firstModel = modelOf(first.find((c) => c.course === 'TESTC101'));
    if (firstModel.status !== 'declared')
      throw new Error(`expected declared, got ${firstModel.status}`);
    expect(firstModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: false },
    ]);

    // Second "session": a BRAND NEW provider instance (as if the plugin were
    // closed and reopened) reading the SAME host/data.json — never the same
    // provider object, so nothing but the persisted store could carry the
    // streak forward.
    const provider2 = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const second = await sectionsFrom(await provider2.load());
    const secondModel = modelOf(second.find((c) => c.course === 'TESTC101'));
    if (secondModel.status !== 'declared')
      throw new Error(`expected declared, got ${secondModel.status}`);
    expect(secondModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: true },
    ]);
  });

  it('a concept that stops reading ground has its streak reset, not left stale, in the persisted store', async () => {
    const host = hostWithBasePath(BASE_PATH);

    const provider1 = createLocalGroveProvider({
      vault: fixtureVaultGroundOnly(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    await provider1.load();
    await provider1.load(); // streak now 2, stall true, per the test above

    // A later session where the concept now has material AND an instrument —
    // no longer `ground` at all.
    const vaultNowSeeded = memoryVault({
      [BASE_PATH]: [
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
      '03 Research/Objectives.md': [
        '---',
        'role: objectives',
        'course: TESTC101',
        '---',
        '',
        'The course covers Concept A in depth.',
        '',
      ].join('\n'),
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
    });
    const provider2 = createLocalGroveProvider({
      vault: vaultNowSeeded,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    await provider2.load();

    // A hypothetical regression back to no material this session should read
    // as a first-sight `ground` again, not a continued stall — proving the
    // store actually dropped the resolved concept rather than leaving it at
    // its old streak.
    const provider3 = createLocalGroveProvider({
      vault: fixtureVaultGroundOnly(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const third = await sectionsFrom(await provider3.load());
    const thirdModel = modelOf(third.find((c) => c.course === 'TESTC101'));
    if (thirdModel.status !== 'declared')
      throw new Error(`expected declared, got ${thirdModel.status}`);
    expect(thirdModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: false },
    ]);
  });
});

describe('createLocalGroveProvider — relations (ol-kghd, C7.9 part-of fold)', () => {
  it('counts a container and its declared part as two denominator peers when no relations thunk is supplied (unchanged default)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithContainerAndPart(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const model = modelOf(courses.find((c) => c.course === 'TESTC101'));
    if (model.status !== 'declared') throw new Error(`expected declared, got ${model.status}`);
    expect(model.cells.map((cell) => cell.conceptName).sort()).toEqual([
      'Concept Narrow',
      'Concept Wide',
    ]);
    expect(model.summary.denominatorCount).toBe(2);
  });

  it('folds the container out of the denominator once a served part-of edge reaches buildGroveModel through the relations thunk', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithContainerAndPart(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      relations: () => [partOf('Concept Narrow', 'Concept Wide')],
    });
    const courses = await sectionsFrom(await provider.load());
    const model = modelOf(courses.find((c) => c.course === 'TESTC101'));
    if (model.status !== 'declared') throw new Error(`expected declared, got ${model.status}`);
    expect(model.cells.map((cell) => cell.conceptName)).toEqual(['Concept Narrow']);
    expect(model.summary.denominatorCount).toBe(1);
  });
});

describe('createLocalGroveProvider — unreadable files ([D-196], F1.5(b), F8.1, ol-2zfj.56)', () => {
  it('classifies each of the three structural reasons and attaches them to the course section', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithUnreadableFiles(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const c101 = courses.find((c) => c.course === 'TESTC101');
    if (c101 === undefined) throw new Error('expected TESTC101');

    const byPath = new Map(c101.unreadableFiles.map((f) => [f.path, f.reason]));
    expect(byPath.get('03 Research/TESTC101 Grading Weights.xlsx')).toBe('no-reader-for-format');
    expect(byPath.get('03 Research/TESTC101 Field Trip Slides.pptx')).toBe('image-only-no-text');
    expect(byPath.get('03 Research/TESTC101 Scanned Handout.png')).toBe('not-linked');
    expect(c101.unreadableFiles).toHaveLength(3);
  });

  it('a course with none of these files gets an empty, not absent, list', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    for (const course of courses) expect(course.unreadableFiles).toEqual([]);
  });
});

describe('createLocalGroveProvider — scope-correction receipt ([D-184], F8.1, ol-v7r5.32)', () => {
  it('renders the receipt once, naming the reclassified document and the prior count, on the read where the denominator actually falls', async () => {
    const host = hostWithBasePath(BASE_PATH);

    // First "session": both documents still declare scope. Nothing shrank
    // yet (no prior stored at all), so no receipt regardless.
    const provider1 = createLocalGroveProvider({
      vault: fixtureVaultWithTwoDeclaredDocs(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const first = await sectionsFrom(await provider1.load());
    const firstModel = modelOf(first.find((c) => c.course === 'TESTC101'));
    if (firstModel.status !== 'declared')
      throw new Error(`expected declared, got ${firstModel.status}`);
    expect(firstModel.summary.denominatorCount).toBe(2);
    expect(first.find((c) => c.course === 'TESTC101')?.scopeCorrectionReceipt).toBeUndefined();

    // Second "session": a BRAND NEW provider instance reading the SAME
    // host/data.json — `Objectives B.md` has been reclassified away from
    // `objectives`, so its citation stops qualifying and the denominator
    // falls from 2 to 1.
    const provider2 = createLocalGroveProvider({
      vault: fixtureVaultWithOneDocReclassifiedAway(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const second = await sectionsFrom(await provider2.load());
    const secondSection = second.find((c) => c.course === 'TESTC101');
    const secondModel = modelOf(secondSection);
    if (secondModel.status !== 'declared')
      throw new Error(`expected declared, got ${secondModel.status}`);
    expect(secondModel.summary.denominatorCount).toBe(1);
    expect(secondSection?.scopeCorrectionReceipt).toEqual({
      reclassifiedDocumentPath: '03 Research/Objectives B.md',
      priorDenominatorCount: 2,
      newDenominatorCount: 1,
    });

    // A THIRD session, same host, same (already-reclassified) vault: the
    // stored prior now equals the current count, so the receipt does not
    // render a second time for the same correction.
    const provider3 = createLocalGroveProvider({
      vault: fixtureVaultWithOneDocReclassifiedAway(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const third = await sectionsFrom(await provider3.load());
    expect(third.find((c) => c.course === 'TESTC101')?.scopeCorrectionReceipt).toBeUndefined();
  });

  it('an addition (the denominator growing) never renders a receipt — its cause is already visible in the new numbers', async () => {
    const host = hostWithBasePath(BASE_PATH);

    const provider1 = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const first = await sectionsFrom(await provider1.load());
    const firstModel = modelOf(first.find((c) => c.course === 'TESTC101'));
    if (firstModel.status !== 'declared')
      throw new Error(`expected declared, got ${firstModel.status}`);
    expect(firstModel.summary.denominatorCount).toBe(1);

    // Second session, same host: a new registered objectives document
    // arrives, naming a brand-new concept — the denominator grows.
    const provider2 = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSourceAndAddition(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const second = await sectionsFrom(await provider2.load());
    const secondSection = second.find((c) => c.course === 'TESTC101');
    const secondModel = modelOf(secondSection);
    if (secondModel.status !== 'declared')
      throw new Error(`expected declared, got ${secondModel.status}`);
    expect(secondModel.summary.denominatorCount).toBe(2);
    expect(secondSection?.scopeCorrectionReceipt).toBeUndefined();
  });
});

describe('createLocalGroveProvider — dismiss', () => {
  it('ends the standing offer for that course — it never reappears there', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });

    const before = await sectionsFrom(await provider.load());
    const card = before.find((c) => c.course === 'TESTC101')?.offerCards[0];
    if (card === undefined) throw new Error('expected a standing offer card');

    await provider.dismiss(card.assessmentPath);

    const after = await sectionsFrom(await provider.load());
    expect(after.find((c) => c.course === 'TESTC101')?.offerCards).toEqual([]);
  });
});

describe('createLocalGroveProvider — retrospective-offered logging (D7.1, `[D-178]`, `ol-0r92.26`)', () => {
  it('records a retrospective-offered event the first time a standing card renders', async () => {
    const vault = fixtureVaultWithRegisteredSource();
    const provider = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const courses = await sectionsFrom(await provider.load());
    expect(courses.find((c) => c.course === 'TESTC101')?.offerCards).toHaveLength(1);

    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });
    const offered = (await log.load()).filter((event) => event.kind === 'retrospective-offered');
    expect(offered).toHaveLength(1);
    expect(offered[0]?.assessmentPath).toBe('02 Assignments/Quiz 1.md');
  });

  it('never re-logs an assessment already recorded as offered — one render, one record', async () => {
    const vault = fixtureVaultWithRegisteredSource();
    const provider = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    await provider.load();
    await provider.load();

    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });
    const offered = (await log.load()).filter((event) => event.kind === 'retrospective-offered');
    expect(offered).toHaveLength(1);
  });
});
