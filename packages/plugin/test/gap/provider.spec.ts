/**
 * `createLocalGapProvider` tests (`ol-2tyj`).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault. The
 * base fixture is the gap-view twin of `plan/provider.spec.ts`'s own —
 * deliberately, since both compose over `composeOracleRanking` and this suite
 * is not re-testing that module's or `buildGapView`'s own acceptance
 * criteria a second time. What it tests is the WIRING this bead adds: the
 * settings gate, the two concurrent vault walks, the join between them, and
 * the honest pass-through of `sourceCoverage` into `model.scope`.
 */
import { describe, expect, it } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';

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

const BASE_FILE = [
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
].join('\n');

const QUIZ =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';

/**
 * One course, one cited concept, one note carrying both the topic binding
 * and a real instrument — so `buildMaterialPresence`'s `instrumentCount` is
 * exercised, not just its `notePaths` half.
 */
function gapVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    '03 Research/TESTC101 Past Paper 2023.md': [
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
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': QUIZ,
  });
}

describe('createLocalGapProvider — not configured', () => {
  it('returns "unavailable" rather than a fabricated model when no Base path is set', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalGapProvider — configured', () => {
  it('composes a real GapViewModel, with the row classified by what her material holds and the scope rendered honestly', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') throw new Error('expected a model');

    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    expect(row).toBeDefined();
    // She has a topic-bound note AND a card on it — never a material-gap
    // (F4.10) or a coverage-gap (F4.5); this is F4.3's "you know it badly"
    // class by elimination, since nothing has been reviewed yet.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
    expect(row?.instrumentCount).toBe(1);

    // ol-cvsc: the one source (the past paper) was actually read, so the
    // scope grants the exhaustiveness claim — this is the assertion the
    // N-013 mutation (see the task report) turns red when the
    // `sourceCoverage` pass-through is deleted.
    expect(state.model.scope.sources).toHaveLength(1);
    expect(state.model.scope.canStateExhaustiveness).toBe(true);
  });

  it('a fresh install with no review log yet still composes a model — mastery reads new, not unknown', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    expect(row?.masteryState).toBe('seed');
  });

  it('a vault that throws mid-walk resolves to "unavailable", not a crash', async () => {
    const vault = gapVault();
    const originalList = vault.list.bind(vault);
    let calls = 0;
    vault.list = async (options) => {
      calls += 1;
      if (calls > 1) throw new Error('simulated read failure');
      return originalList(options);
    };

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalGapProvider — the concept-name join is case-sensitive on both sides (R1/R2), and ol-5y40 fixes it at the composition seam', () => {
  it('a topic value that does not byte-match her Zettelkasten note title still resolves as her material — never a false material-gap', async () => {
    // Her Zettelkasten note is titled "Widget Theory" (capital W, capital
    // T) — the vocabulary `composeOracleRanking`'s tier-3 pass matches
    // against by default (`concept/evidence.ts`'s `zettelVocabulary`,
    // titles verbatim). Her `topic:` property on the note that actually
    // carries the card reads "widget theory" (all lowercase) — a plausible
    // authoring slip, not a wikilink. `extractConcepts`'s tier-1 binding
    // (`resolveTitle`) requires an exact string match, so this topic value
    // binds to NOTHING and the concept record is minted at tier 2, named
    // "widget theory" verbatim (R1/R2: never case-folded — the extraction
    // side of this is untouched by the fix below).
    //
    // The past paper cites "Widget Theory" (matching her note's title).
    // `findMentionedTerms` matches case-insensitively but returns the
    // VOCABULARY's own casing (R2), so the resulting edge — and therefore
    // the ranking's `conceptName` — is "Widget Theory", not "widget theory".
    //
    // `evidence-edge/build.ts`'s name→key lookup is exact-match, so it would
    // otherwise miss and fall back to "Widget Theory" as the (wrong) key —
    // which never matches `buildMaterialPresence`'s map (keyed by the real
    // `ConceptRecord.key`), reading as a material-gap (F4.10) even though
    // `Notes/one.md` is right there. `ol-5y40`'s fix
    // (`oracle/compose.ts`'s `resolveCaseInsensitiveConceptKeys`) repairs
    // exactly this fallback, case- and course-scoped, before the edge ever
    // reaches `rankOracle` or `buildMaterialPresence` — so this row now
    // reads the same as the base fixture's exact-case case: she has a
    // topic-bound note AND a card on it, `mastery-gap` by elimination.
    const vault = memoryVault({
      '05 Zettelkasten/Widget Theory.md': '# Widget Theory\n',
      'Notes/one.md': [
        '---',
        'topic: widget theory',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      '03 Research/TESTC101 Past Paper 2023.md': [
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
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget Theory');
    expect(row).toBeDefined();
    // The fix: never the alarming, wrong "we don't have it" reading — she
    // has a topic-bound note AND a card on it, so this is F4.3's
    // "you know it badly" class by elimination, exactly as the base fixture
    // (`createLocalGapProvider — configured`, above) reads when the casing
    // matches byte-for-byte.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
    expect(row?.instrumentCount).toBe(1);
  });

  it('a genuinely distinct concept in a DIFFERENT course, sharing a name only by casefold, is never collapsed onto it', async () => {
    // Two DIFFERENT courses each author their own case variant of the same
    // casefolded topic string — R1/R2 mints two distinct `ConceptRecord`s
    // for "widget theory" (TESTC101) and "WIDGET THEORY" (OTHERC202), since
    // they are not byte-identical. Only TESTC101 has a past paper, citing
    // "Widget Theory" (matching the Zettelkasten note's own casing, neither
    // note's exact topic casing). A fold that matched on casefolded name
    // ALONE — ignoring course — would resolve the TESTC101 edge onto
    // whichever concept happened to be inserted last into the lookup map
    // (here, OTHERC202's), pulling OTHERC202's note into TESTC101's row.
    // The course-scoped fallback (`oracle/compose.ts`'s
    // `resolveCaseInsensitiveConceptKeys`) must resolve it onto TESTC101's
    // own record only.
    const vault = memoryVault({
      '05 Zettelkasten/Widget Theory.md': '# Widget Theory\n',
      'Notes/one.md': [
        '---',
        'topic: widget theory',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      'Notes/other.md': [
        '---',
        'topic: WIDGET THEORY',
        'course: OTHERC202',
        '---',
        '',
        'A different, unrelated card::for a different course',
        '',
      ].join('\n'),
      '03 Research/TESTC101 Past Paper 2023.md': [
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
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget Theory');
    expect(row).toBeDefined();
    // Resolves onto TESTC101's own note, not OTHERC202's — the course-scoped
    // match, not a bare name-only fold.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
  });
});
