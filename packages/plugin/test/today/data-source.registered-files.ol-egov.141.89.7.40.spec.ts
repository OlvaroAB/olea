/**
 * `ol-egov.141.89.7.40` — Today's scope reading forwards her registered documents to the tier-3
 * evidence read (F1.5, F8.1, F6.2). Written and run failing first.
 *
 * The defect (the same one `ol-egov.141.89.7.35` fixed in the four ranking callers): a PDF she
 * declares a past paper through the register gesture cannot carry frontmatter, so it becomes a
 * source only through the "source registered" event in her local log. `createVaultScopeSource`
 * read that same log (`entries`) for its mastery fold but called `extractTier3Evidence` without
 * `registeredFiles`, so the grove counted the paper and Today's scope card never did: the two
 * disagreed about the same course.
 *
 * Three things are pinned, on the fixture the four ranking callers' specs share (one course, one
 * concept, one PDF past paper; built twice, the event being the only difference):
 *
 * 1. the input is exactly `projectRegisteredFiles` over the log the source already read;
 * 2. the effect: the same vault reads as declared from the past paper with the event, and as an
 *    inferred course without it, and Today's reading agrees with the grove's for the same course;
 * 3. what she sees at Today: existing wording only, changed only in which existing sentence a
 *    course with a registered past paper takes.
 *
 * INV-3: every string is coined (the fixture's course code, concept and file names are invented).
 */
import {
  buildCrossCourseScopeOverview,
  extractTier3Evidence,
  type GroveCourseModel,
} from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import { SCOPE_NOT_YET_DECLARED, scopeSummaryLine } from '../../src/today/copy.js';
import { createVaultScopeSource } from '../../src/today/data-source.js';
import {
  CONCEPT,
  COURSE,
  DEVICE,
  NOW,
  PAST_PAPER_PDF,
  pastPaperPdfVault,
} from '../oracle/registered-past-paper-fixture.js';

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, extractTier3Evidence: vi.fn(actual.extractTier3Evidence) };
});

/** A settings host that has stored nothing: the grove reads its stores through it. */
class EmptySettingsHost {
  private blob: unknown = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

async function todayScopeFor(registered: boolean): Promise<{
  readonly vault: Awaited<ReturnType<typeof pastPaperPdfVault>>;
  readonly course: GroveCourseModel;
}> {
  const vault = await pastPaperPdfVault({ registered });
  const source = createVaultScopeSource({ vault, deviceId: DEVICE, now: () => NOW });
  const models = await source.listCourseGroveModels();
  const course = (models ?? []).find((model) => model.course === COURSE);
  if (course === undefined) throw new Error('Today read no model for the fixture course');
  return { vault, course };
}

describe('createVaultScopeSource — forwards registered documents to the tier-3 read (ol-egov.141.89.7.40)', () => {
  beforeEach(() => {
    vi.mocked(extractTier3Evidence).mockClear();
  });

  it('passes registeredFiles from the "source registered" events in her log', async () => {
    await todayScopeFor(true);

    expect(extractTier3Evidence).toHaveBeenCalledTimes(1);
    const options = vi.mocked(extractTier3Evidence).mock.calls[0]?.[1];
    expect(options?.registeredFiles).toEqual([
      { path: PAST_PAPER_PDF, role: 'past-paper', course: COURSE },
    ]);
  });

  it('passes an empty registeredFiles when nothing is registered', async () => {
    await todayScopeFor(false);

    const options = vi.mocked(extractTier3Evidence).mock.calls[0]?.[1];
    expect(options?.registeredFiles).toEqual([]);
  });

  it('a registered past-paper PDF reaches Today’s scope reading; the same vault without the event does not (F1.5, F8.1)', async () => {
    const without = await todayScopeFor(false);
    // No source of any kind is known for the course: Olea's own guess at its concepts, nothing declared.
    expect(without.course.status).toBe('inferred');

    const withEvent = await todayScopeFor(true);
    if (withEvent.course.status !== 'declared') {
      throw new Error(`expected Today to read the course declared, got ${withEvent.course.status}`);
    }
    expect(withEvent.course.summary.denominatorSourcePaths).toEqual([PAST_PAPER_PDF]);
    expect(withEvent.course.summary.pastPaperSourcePaths).toEqual([PAST_PAPER_PDF]);
    expect(withEvent.course.summary.denominatorCount).toBe(1);
    expect(withEvent.course.summary.builtCount).toBe(1);
    expect(
      withEvent.course.cells.map((cell) => [cell.conceptName, cell.pastPaperCitationCount]),
    ).toEqual([[CONCEPT, 1]]);
  });

  it('Today and the grove now read the same course the same way: the same status, cells and summary', async () => {
    const { vault, course: todayCourse } = await todayScopeFor(true);

    const groveState = await createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new EmptySettingsHost(),
      now: () => NOW,
    }).load();
    if (groveState.kind !== 'model') throw new Error('expected the grove to read a model');
    const groveCourse = groveState.courses.find((section) => section.course === COURSE)?.model;
    if (groveCourse === undefined)
      throw new Error('the grove read no model for the fixture course');

    // Before this bead the grove read `declared` (one built, one denominator, from the past paper)
    // and Today read `inferred` for the same course in the same vault.
    expect(todayCourse.status).toBe(groveCourse.status);
    if (todayCourse.status !== 'declared' || groveCourse.status !== 'declared') {
      throw new Error('expected both readers to read the course declared');
    }
    expect(todayCourse.summary).toEqual(groveCourse.summary);
    expect(todayCourse.cells).toEqual(groveCourse.cells);
    expect(todayCourse.materialGaps).toEqual(groveCourse.materialGaps);
  });
});

describe('what she sees on Today’s scope card for a course with a registered past paper (ol-egov.141.89.7.40)', () => {
  it('reads the existing declared sentence from the past paper, where it read the existing not-yet-declared sentence before, and no new wording is needed', async () => {
    const asOf = '2026-08-10';

    const without = buildCrossCourseScopeOverview([(await todayScopeFor(false)).course], asOf);
    expect(without.courses).toEqual([{ course: COURSE, status: 'no-denominator-yet' }]);
    // The sentence the view shows for that row: it says no past paper is registered, which a past
    // paper she has registered made false.
    expect(SCOPE_NOT_YET_DECLARED).toBe('No objectives document or past paper registered yet.');

    const withEvent = buildCrossCourseScopeOverview([(await todayScopeFor(true)).course], asOf);
    expect(withEvent.courses).toEqual([
      {
        course: COURSE,
        status: 'declared',
        denominatorCount: 1,
        builtCount: 1,
        denominatorSourcePaths: [PAST_PAPER_PDF],
      },
    ]);
    // `view.ts`'s `renderScopeCourse` composes the row's sentence from exactly these three numbers.
    const row = withEvent.courses[0];
    if (row === undefined || row.status !== 'declared') throw new Error('expected a declared row');
    expect(
      scopeSummaryLine(row.builtCount, row.denominatorCount, row.denominatorSourcePaths.length),
    ).toBe('1 of 1 built, from 1 registered source.');
  });
});
