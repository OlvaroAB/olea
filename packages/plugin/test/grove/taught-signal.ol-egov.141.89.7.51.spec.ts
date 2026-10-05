/**
 * F8.2 step two through the production grove provider (`ol-egov.141.89.7.51`; F8.2 as amended by
 * `[D-465]`, C3.6): the three provider scenarios of "Step two's producer" in the service repo's
 * `features/F8-concepts-scope.md`. The producer's own rules (past papers and objectives are never
 * decks, another course's file never counts, a name inside a longer word does not count) are
 * `packages/core/src/scope/taught-signal-producer.ol-egov.141.89.7.51.spec.ts`'s job; this suite
 * proves the wiring, through `createLocalGroveProvider` and `createLocalHomeProvider` exactly as
 * `main.ts` and Home construct them, over a vault whose decks and transcripts are read by the
 * real extractors.
 *
 * **The one stand-in.** A declared concept with no note of hers on it cannot come out of today's
 * concept extraction: `extractConcepts` mints a record only from a note that names it, so every
 * record carries at least one note and step one (her own note) already opens it. The scenario is
 * the concept a material-minted source would carry (`[D-068]`), so the real
 * `enumerateVaultInstruments` is wrapped, never replaced, and one record with no introducing note
 * is added to what it returns. Everything else (registration, tier 3's extraction, the grove
 * build, Home) runs for real.
 *
 * Every course code, concept name, path and sentence below is invented (INV-3).
 */
import type {
  ConceptRecord,
  GroveCourseModel,
  ListOptions,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { appendSourceRegisteredRecord, createFsrsScheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { GroveDataDeps } from '../../src/grove/provider.js';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveCourseSection } from '../../src/grove/view.js';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import type { HomeViewState } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { buildPdfBytes } from '../oracle/registered-past-paper-fixture.js';
import { memoryVault } from '../review/memory-vault.js';

const injected = vi.hoisted(() => ({ concepts: [] as unknown[] }));

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return {
    ...actual,
    enumerateVaultInstruments: async (
      ...args: Parameters<typeof actual.enumerateVaultInstruments>
    ) => {
      const result = await actual.enumerateVaultInstruments(...args);
      return {
        ...result,
        concepts: [...result.concepts, ...(injected.concepts as ConceptRecord[])],
      };
    },
  };
});

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-15T09:00:00Z');
const COURSE_A = 'TESTA101';
const COURSE_B = 'TESTB202';
const FLUX = 'Tirreb flux';
const VOSSANE = 'Vossane';
const FLUX_KEY = 'key-flux-a';
const VOSSANE_KEY = 'key-vossane-a';

const OBJECTIVES = '03 Research/TESTA101 outcomes.md';
const WEEK_NOTE = '01 Courses/TESTA101/week-3.md';
const DECK = '01 Courses/TESTA101/deck-3.pdf';
const TRANSCRIPT = '01 Courses/TESTA101/talk-4.txt';
const MD_TRANSCRIPT = '01 Courses/TESTA101/talk-5.md';
const OTHER_COURSE_TRANSCRIPT = `01 Courses/${COURSE_B}/talk-1.txt`;
const PAST_PAPER = 'Papers/TESTA101 paper.pdf';

/** Two declared-course concepts with no note of hers: the objectives name only the first. */
function noteLessConcepts(): ConceptRecord[] {
  return [
    { key: FLUX_KEY, name: FLUX, tier: 2, courses: [COURSE_A], sourcePaths: [] },
    { key: VOSSANE_KEY, name: VOSSANE, tier: 2, courses: [COURSE_A], sourcePaths: [] },
  ];
}

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function extensionOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

/**
 * `memoryVault` plus binary files, and a host arrival time (`VaultSource.firstSeen`) for every
 * path when `firstSeenMs` is given — the one file-date accessor a vault host exposes.
 */
function vaultOf(
  texts: Readonly<Record<string, string>>,
  binaries: Readonly<Record<string, Uint8Array>> = {},
  firstSeenMs?: number,
): VaultSource {
  const base = memoryVault(texts);
  return {
    async list(options: ListOptions = {}) {
      const extensions = options.extensions?.map((ext) => ext.toLowerCase());
      const binaryPaths = Object.keys(binaries)
        .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
        .filter((path) => {
          if (extensions === undefined) return true;
          const ext = extensionOf(path);
          return ext !== undefined && extensions.includes(ext);
        }) as VaultPath[];
      return [...(await base.list(options)), ...binaryPaths].sort();
    },
    read: (path) => base.read(path),
    async readBinary(path) {
      return binaries[path] ?? base.readBinary(path);
    },
    write: (path, content) => base.write(path, content),
    async exists(path) {
      return path in binaries || base.exists(path);
    },
    watch: (handler) => base.watch(handler),
    ...(firstSeenMs !== undefined ? { firstSeen: async () => firstSeenMs } : {}),
  };
}

const OBJECTIVES_TEXT = [
  '---',
  'role: objectives',
  `course: ${COURSE_A}`,
  '---',
  '',
  `By the end of the course students describe ${FLUX} and apply it.`,
  '',
].join('\n');

/** Her week note: it embeds the deck and names no concept, so it is not a note on either one. */
const WEEK_NOTE_TEXT = [
  '---',
  `course: ${COURSE_A}`,
  '---',
  '',
  '# Week three',
  '',
  `![[${DECK}]]`,
  '',
].join('\n');

function deckVault(options: { readonly deckNames: boolean; readonly firstSeenMs?: number }) {
  return vaultOf(
    { [OBJECTIVES]: OBJECTIVES_TEXT, [WEEK_NOTE]: WEEK_NOTE_TEXT },
    {
      [DECK]: buildPdfBytes(
        options.deckNames
          ? `This week covers ${FLUX} with two worked examples.`
          : 'This week covers two worked examples.',
      ),
    },
    options.firstSeenMs,
  );
}

function groveProvider(vault: VaultSource): GroveDataDeps {
  return createLocalGroveProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => NOW,
  });
}

async function loadCourses(vault: VaultSource): Promise<readonly GroveCourseSection[]> {
  const state = await groveProvider(vault).load();
  if (state.kind !== 'model') throw new Error(`expected a grove model, got ${state.kind}`);
  return state.courses;
}

function declaredModel(
  courses: readonly GroveCourseSection[],
  course: string,
): Extract<GroveCourseModel, { readonly status: 'declared' }> {
  const model = courses.find((section) => section.course === course)?.model;
  if (model?.status !== 'declared') throw new Error(`expected ${course} declared`);
  return model;
}

function withInjectedConcepts<T>(run: () => Promise<T>): Promise<T> {
  injected.concepts = noteLessConcepts();
  return run().finally(() => {
    injected.concepts = [];
  });
}

describe('a deck of the course that names a concept opens it, whenever the deck arrived (ol-egov.141.89.7.51)', () => {
  it('the declared concept with no note of hers is a live cell once a deck of its course names it, and a material gap without one', () =>
    withInjectedConcepts(async () => {
      const opened = declaredModel(await loadCourses(deckVault({ deckNames: true })), COURSE_A);
      // A grove cell exists only at teaching-arrival provenance `yes`: `classifyDeclaredConcept`
      // returns a cell solely when the taught-signal chain opened it (`coverage.ts`).
      expect(opened.cells).toEqual([
        {
          conceptKey: FLUX_KEY,
          conceptName: FLUX,
          state: 'ground',
          stall: false,
          pastPaperCitationCount: 0,
        },
      ]);
      expect(opened.materialGaps).toEqual([]);

      const unopened = declaredModel(await loadCourses(deckVault({ deckNames: false })), COURSE_A);
      expect(unopened.cells).toEqual([]);
      expect(unopened.materialGaps.map((gap) => gap.conceptName)).toEqual([FLUX]);
    }));

  it('reads the same whatever the deck’s file dates: long before the term, long after it, or none known', () =>
    withInjectedConcepts(async () => {
      const early = await loadCourses(deckVault({ deckNames: true, firstSeenMs: 0 }));
      const late = await loadCourses(
        deckVault({ deckNames: true, firstSeenMs: Date.parse('2031-01-01T00:00:00Z') }),
      );
      const unknown = await loadCourses(deckVault({ deckNames: true }));
      expect(late).toEqual(early);
      expect(unknown).toEqual(early);
      expect(declaredModel(early, COURSE_A).cells.map((cell) => cell.conceptName)).toEqual([FLUX]);
    }));

  it('a registered past paper (a PDF) naming the concept is not a deck and opens nothing', () =>
    withInjectedConcepts(async () => {
      const vault = vaultOf(
        { [OBJECTIVES]: OBJECTIVES_TEXT },
        { [PAST_PAPER]: buildPdfBytes(`Question 1. Explain ${FLUX}. (10 marks)`) },
      );
      await appendSourceRegisteredRecord(
        vault,
        {
          timestamp: '2026-09-01T09:00:00.000Z',
          path: PAST_PAPER,
          role: 'past-paper',
          course: COURSE_A,
        },
        { deviceId: DEVICE },
      );
      const model = declaredModel(await loadCourses(vault), COURSE_A);
      expect(model.summary.denominatorSourcePaths).toContain(PAST_PAPER);
      expect(model.cells).toEqual([]);
      expect(model.materialGaps.map((gap) => gap.conceptName)).toEqual([FLUX]);
    }));
});

describe('the lecture’s supplied transcript opens it the same way, and never puts it in scope (ol-egov.141.89.7.51)', () => {
  const transcriptText = `Today we work through ${FLUX}, and then a word on the ${VOSSANE}.`;

  it('a plain-text transcript of the course opens the declared concept, and the scope reads exactly as the examiner documents alone give it', () =>
    withInjectedConcepts(async () => {
      const withTranscript = declaredModel(
        await loadCourses(vaultOf({ [OBJECTIVES]: OBJECTIVES_TEXT, [TRANSCRIPT]: transcriptText })),
        COURSE_A,
      );
      const examinerOnly = declaredModel(
        await loadCourses(vaultOf({ [OBJECTIVES]: OBJECTIVES_TEXT })),
        COURSE_A,
      );

      expect(withTranscript.cells.map((cell) => [cell.conceptName, cell.state])).toEqual([
        [FLUX, 'ground'],
      ]);
      expect(examinerOnly.cells).toEqual([]);
      expect(examinerOnly.materialGaps.map((gap) => gap.conceptName)).toEqual([FLUX]);

      // Scope is the examiner's: same count, same documents, and the concept only the
      // transcript mentions stays a volunteer, outside the count.
      expect(withTranscript.summary.denominatorCount).toBe(examinerOnly.summary.denominatorCount);
      expect(withTranscript.summary.denominatorSourcePaths).toEqual(
        examinerOnly.summary.denominatorSourcePaths,
      );
      expect(withTranscript.volunteers).toEqual(examinerOnly.volunteers);
      expect(withTranscript.volunteers.map((cell) => cell.conceptName)).toEqual([VOSSANE]);
    }));

  it('a Markdown transcript that declares its role opens it the same way', () =>
    withInjectedConcepts(async () => {
      const model = declaredModel(
        await loadCourses(
          vaultOf({
            [OBJECTIVES]: OBJECTIVES_TEXT,
            [MD_TRANSCRIPT]: ['---', 'role: transcript', '---', '', transcriptText, ''].join('\n'),
          }),
        ),
        COURSE_A,
      );
      expect(model.cells.map((cell) => cell.conceptName)).toEqual([FLUX]);
    }));

  it("another course's transcript naming the concept opens nothing for this course", () =>
    withInjectedConcepts(async () => {
      const model = declaredModel(
        await loadCourses(
          vaultOf({ [OBJECTIVES]: OBJECTIVES_TEXT, [OTHER_COURSE_TRANSCRIPT]: transcriptText }),
        ),
        COURSE_A,
      );
      expect(model.cells).toEqual([]);
      expect(model.materialGaps.map((gap) => gap.conceptName)).toEqual([FLUX]);
    }));
});

describe('the grove view and Home read the same signal (ol-egov.141.89.7.51)', () => {
  async function homeMarks(vault: VaultSource) {
    const state: HomeViewState = await createLocalHomeProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
    }).load({ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES });
    if (state.kind !== 'dashboard') throw new Error(`expected a dashboard, got ${state.kind}`);
    return state.courses.find((row) => row.course === COURSE_A)?.marks;
  }

  it('a concept only a deck opens is open in both', () =>
    withInjectedConcepts(async () => {
      const grove = declaredModel(await loadCourses(deckVault({ deckNames: true })), COURSE_A);
      expect(grove.cells.map((cell) => cell.conceptName)).toEqual([FLUX]);
      expect(await homeMarks(deckVault({ deckNames: true }))).toEqual([{ kind: 'ground' }]);

      // And both still agree when no deck names it.
      expect(await homeMarks(deckVault({ deckNames: false }))).toEqual([{ kind: 'material-gap' }]);
    }));
});
