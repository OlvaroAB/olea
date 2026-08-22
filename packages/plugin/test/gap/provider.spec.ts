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
    expect(row?.masteryState).toBe('new');
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

describe('createLocalGapProvider — the concept-name join is case-sensitive on both sides (R1/R2), and that is a real trap', () => {
  it('a topic value that does not byte-match her Zettelkasten note title misclassifies as material-gap, even though she has a note about it', async () => {
    // Her Zettelkasten note is titled "Widget Theory" (capital W, capital
    // T) — the vocabulary `composeOracleRanking`'s tier-3 pass matches
    // against by default (`concept/evidence.ts`'s `zettelVocabulary`,
    // titles verbatim). Her `topic:` property on the note that actually
    // carries the card reads "widget theory" (all lowercase) — a plausible
    // authoring slip, not a wikilink. `extractConcepts`'s tier-1 binding
    // (`resolveTitle`) requires an exact string match, so this topic value
    // binds to NOTHING and the concept record is minted at tier 2, named
    // "widget theory" verbatim (R1/R2: never case-folded).
    //
    // The past paper cites "Widget Theory" (matching her note's title).
    // `findMentionedTerms` matches case-insensitively but returns the
    // VOCABULARY's own casing (R2), so the resulting edge — and therefore
    // the ranking's `conceptName` — is "Widget Theory", not "widget theory".
    //
    // `buildMaterialPresence` keys its map on `ConceptRecord.name` —
    // "widget theory" here — so `materialPresence.get("Widget Theory")`
    // misses, and `classifyGap` reads that as "her material does not name
    // it" (F4.10) even though `Notes/one.md` is right there. This is a
    // genuine, reproducible defect in the join this bead wires up for the
    // first time, rooted in core's exact-match topic binding (not something
    // this file's own code can fix without case-folding a name somewhere —
    // which R1/R2 forbids without a decision bead). Documented here as a
    // characterisation test, not a fix; flagged in the task report.
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
    // The alarming, wrong reading: "we don't have it", when she does.
    expect(row?.gapClass).toBe('material-gap');
    expect(row?.notePaths).toEqual([]);
  });
});
