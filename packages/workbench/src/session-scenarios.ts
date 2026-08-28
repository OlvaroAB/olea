/**
 * The session-builder surface's addressable states (F4.6, F4.7, F4.8;
 * `ol-p5t06b` [P5-T06b]).
 *
 * Mirrors `timeline-scenarios.ts`'s shape — a state list, a finder, and a
 * builder returning the real view's `deps` plus inspector data — over the
 * **fixture vault**, not `packages/synthetic`'s coined curriculum.
 *
 * ## Why the fixture vault, and why that needs no cassette
 *
 * `oracle/fixture-oracle.ts` is the precedent and carries the full argument
 * (D-041, `ol-st9i`): `composeOracleRanking`, `extractConcepts`,
 * `buildMaterialPresence` and `buildGapView` are pure, model-free,
 * network-free projections over a `VaultSource`, and `buildStudySession`
 * (`olea-core`) is likewise pure arithmetic over the result. Every number on
 * this surface is real computation over her real (invented) notes and her real
 * (invented) assignments Base — no embedding, no generative call, no
 * `.embedding-cassette/`, and **no model tokens spent, ever**.
 *
 * The synthetic corpus would be the wrong input here specifically. This
 * surface's subject is *how long a session takes* and *what she sits next*, and
 * both are only legible against a corpus with real instrument types in real
 * notes and real dated assignments. The fixture vault has all three.
 *
 * ## The vault is an ARGUMENT, exactly as `buildFixtureOracle`'s is
 *
 * `loadFixtureVault()` uses `fetch` and only works in the browser, so a state
 * builder calling it could not be exercised under Vitest at all. Taking a
 * `VaultSource` means `main.ts` passes the fetched one and
 * `test/session-scenarios.spec.ts` passes a `FolderSource` over the same files
 * on disk — one code path, two hosts, and the states are actually tested rather
 * than only rendered.
 *
 * ## THE FINDING THIS FILE RAN INTO, AND WHAT IT DOES ABOUT IT
 *
 * **In the fixture vault, no concept the oracle ranks has a single card.** The
 * four ranked concepts are Zettelkasten titles cited by her past papers; every
 * one of the thirteen instruments lives in a lecture note bound to a *tier-1/2*
 * `topic:` concept that no past paper cites. The intersection of "ranked" and
 * "practisable" is empty, so `buildStudySession` over the fixture vault as it
 * stands returns an empty session on every budget. Widening the tier-3
 * vocabulary to include the tier-1/2 names (a supported option) changes
 * nothing: the past papers cite only the four zettel titles.
 *
 * That is a property of the corpus, not a defect in the fill, and it is
 * `'session-no-cards-yet'`'s entire subject — that state is left **unborrowed**
 * so the finding is visible on screen rather than only in a report.
 *
 * The other practising states **borrow** the missing half, exactly as
 * `oracle/fixture-oracle.ts` borrows the review history it does not have and
 * for the same stated reason: her real instruments are re-bound, round-robin,
 * onto the ranked concepts and their zettel notes. The cards are real fixture
 * cards, the concepts are real ranked concepts, the durations and the fill are
 * real arithmetic — only the binding between them is this file's. Each such
 * state says so in its own `note`, on screen, and this is dev tooling rather
 * than a product surface (see this package's own description).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  AssessmentRecord,
  CalendarDay,
  ConceptRecord,
  GapRow,
  StudySessionModel,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  allGapRows,
  buildConceptInstrumentIndex,
  buildGapView,
  buildMaterialPresence,
  buildStudySession,
  type ConceptInstrumentIndex,
  composeOracleRanking,
  type DurationModel,
  enumerateVaultInstruments,
  estimateInstrumentDurations,
  extractConcepts,
} from 'olea-core';
// Types only: nothing at runtime, so this file never pulls `obsidian` (even
// through the shim) into a Node test process. `main.ts` mounts the real
// `SessionBuilderView` itself, the way it already mounts `GapView`.
import type {
  SessionBuilderRequest,
  SessionBuilderState,
  SessionBuilderViewDeps,
} from '../../plugin/src/session-builder/view.js';
import { withoutCourseCrossReferences } from './vault/session-no-cards-vault.js';

/** The Bases assignments table `readAssessments` scans — real, checked-in fixture content. */
const BASE_PATH = '02 Assignments/Assignments.base' as VaultPath;
/** Not a note of hers — excluded from every walk, exactly as `oracle/fixture-oracle.ts` excludes it. */
const EXCLUDE_PATHS = ['README.md'];

/**
 * A folder of hers with no past papers in it.
 *
 * The degenerate state's whole mechanism: with no source registered for a
 * course, every one of its assessments lands in `assessmentsWithNoEvidence` and
 * `rankOracle` abstains — reached **through the real pipeline** rather than by
 * handing the view an empty model, and it is precisely the state a real vault
 * starts in before any past paper is registered.
 */
const NO_PAST_PAPERS_FOLDER = '04 Templates' as VaultPath;

export interface SessionWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'session';
  readonly note: string;
  /** The day the session is built for. Chosen per state so the countdown is interesting — see each state's note. */
  readonly asOf: CalendarDay;
  /** The budget the view opens on. She can change it in the view; `deps.load` rebuilds. */
  readonly budgetMinutes: number;
  /** `'borrowed'` re-binds real fixture instruments onto the ranked concepts; `'real'` leaves the vault exactly as it is. See the module doc's finding. */
  readonly instruments: 'real' | 'borrowed';
  /** `'borrowed'` writes the review history described in the module doc; `'none'` leaves the vault with no reviews, which is its true state. */
  readonly history: 'none' | 'borrowed';
  /** Overrides the sources folder — the degenerate state's mechanism. */
  readonly sourcesFolder?: VaultPath;
}

export const SESSION_STATES: readonly SessionWorkbenchState[] = [
  {
    id: 'session-exam-eve-90',
    label: 'Ninety minutes, the night before a quiz',
    group: 'session',
    asOf: '2026-09-10',
    budgetMinutes: 90,
    instruments: 'borrowed',
    history: 'none',
    note:
      'The assessment she sits next is a Quiz dated tomorrow, so F4.8 fires: the format ' +
      'preference resolves to multiple choice and MCQ instruments sort ahead of the Q&A and ' +
      'cloze cards for the same concept. Note that the quiz is NOT the assessment that drove ' +
      'the ranking — the heavily-weighted final does — which is exactly why the countdown reads ' +
      'the calendar rather than the score. Instruments are borrowed; see the module doc.',
  },
  {
    id: 'session-short-20',
    label: 'Twenty minutes, mid-semester',
    group: 'session',
    asOf: '2026-09-14',
    budgetMinutes: 20,
    instruments: 'borrowed',
    history: 'none',
    note:
      'F4.6’s own example budget, on a day with no imminent quiz — so the format preference is ' +
      'silent and the ordering is pure gap score. Instruments are borrowed; see the module doc.',
  },
  {
    id: 'session-tight-5',
    label: 'Five minutes between lectures',
    group: 'session',
    asOf: '2026-09-14',
    budgetMinutes: 5,
    instruments: 'borrowed',
    history: 'none',
    note:
      'The budget actually bites here, which is the point: watch the left-out lines below the ' +
      'session. A shortened list she cannot see the edge of is a claim about her material that ' +
      'nothing established — the rule ol-cvsc set one screen over, applied to time.',
  },
  {
    id: 'session-measured-45',
    label: 'Forty-five minutes, on measured durations',
    group: 'session',
    asOf: '2026-09-14',
    budgetMinutes: 45,
    instruments: 'borrowed',
    history: 'borrowed',
    note:
      'The other branch of the duration model. The fixture vault has no review log, so this ' +
      'state borrows one — real instrument and concept ids, durations assigned by ' +
      'session-scenarios.ts — purely so the measured path is visible. Compare the timing line ' +
      'with the other states’: those say Olea is assuming, this one says it measured.',
  },
  {
    id: 'session-no-cards-yet',
    label: 'Ranked, but nothing to practise',
    group: 'session',
    asOf: '2026-09-14',
    budgetMinutes: 20,
    instruments: 'real',
    history: 'none',
    note:
      'The fixture vault EXACTLY as it is, with nothing borrowed — and the honest result is an ' +
      'empty session. Every concept her past papers cite is a Zettelkasten title she has notes ' +
      'on and no cards for; every card she has is bound to a lecture-note topic no past paper ' +
      'cites. So the screen names each one as a coverage gap rather than pretending there was ' +
      'nothing to find. This state exists to keep that finding visible.',
  },
  {
    id: 'session-nothing-to-build',
    label: 'Nothing ranked to build from',
    group: 'session',
    asOf: '2026-09-14',
    budgetMinutes: 20,
    instruments: 'real',
    history: 'none',
    sourcesFolder: NO_PAST_PAPERS_FOLDER,
    note:
      'The other emptiness. With no past paper registered for any course, every assessment has ' +
      'zero evidence and rankOracle abstains, so there are no gap rows at all. The screen must ' +
      'say "nothing is ranked yet" and NOT "nothing fits in twenty minutes" — two emptinesses, ' +
      'two sentences, told apart by consideredRowCount.',
  },
];

export function findSessionState(id: string): SessionWorkbenchState | undefined {
  return SESSION_STATES.find((state) => state.id === id);
}

// ---------------------------------------------------------------------------
// The borrowed halves
// ---------------------------------------------------------------------------

interface RankedTarget {
  readonly conceptName: string;
  /** `ol-63e1`: the opaque join key — what `borrowedInstruments` must stamp onto its rebuilt `conceptIds`, never `conceptName`. */
  readonly conceptKey: string;
  readonly course: string;
  readonly notePath: VaultPath;
  readonly noteTitle: string;
}

function noteTitleOf(path: VaultPath): string {
  const last = path.split('/').pop() ?? path;
  return last.endsWith('.md') ? last.slice(0, -3) : last;
}

/**
 * Re-binds real fixture instruments onto the ranked concepts, round-robin in
 * vault order.
 *
 * The instrument id, type and parsed card are the vault's own and untouched;
 * `conceptIds`, `courses`, `notePath` and `noteTitle` are re-pointed at the
 * ranked concept's own Zettelkasten note, so `buildMaterialPresence` reads the
 * rows as mastery gaps and the screen's note titles agree with its concept
 * names. Round-robin rather than clustered so the two MCQs land on different
 * concepts and F4.8's reordering has something to reorder.
 */
function borrowedInstruments(
  records: readonly VaultInstrumentRecord[],
  targets: readonly RankedTarget[],
): readonly VaultInstrumentRecord[] {
  if (targets.length === 0) return [];
  return records.map((record, index) => {
    const target = targets[index % targets.length] as RankedTarget;
    return {
      ...record,
      // `ol-63e1`: the opaque key, not the display name — this is what
      // `GapRow.conceptKey`/`study-session/build.ts`'s instrument lookup
      // joins on, matching production's `session/enumerate.ts` mint site.
      conceptIds: [target.conceptKey],
      courses: [target.course],
      notePath: target.notePath,
      noteTitle: target.noteTitle,
    };
  });
}

/**
 * Durations the borrowed history is written with, in milliseconds.
 *
 * **Workbench display values, and nothing more.** Not measurements of anybody,
 * not `olea-core`'s assumed constants, and read by nothing outside this file.
 * They differ from `ASSUMED_INSTRUMENT_SECONDS` on purpose, so a viewer
 * comparing `'session-measured-45'` against the other states sees the numbers
 * actually change rather than taking the label's word for it.
 */
const BORROWED_DURATION_MS: Readonly<Record<string, number>> = {
  qa: 55_000,
  cloze: 25_000,
  mcq: 35_000,
};

/** Enough reviews per instrument to clear `DEFAULT_MIN_MEASURED_REVIEWS` for every type present. */
const BORROWED_REVIEWS_PER_INSTRUMENT = 6;

function borrowedHistory(
  records: readonly VaultInstrumentRecord[],
  asOf: CalendarDay,
): readonly ReviewLogEntry[] {
  const entries: ReviewLogEntry[] = [];
  for (const record of records) {
    for (let n = 0; n < BORROWED_REVIEWS_PER_INSTRUMENT; n += 1) {
      entries.push({
        schemaVersion: 5,
        kind: 'review',
        eventId: `workbench-session-${record.instrumentId}-${n}`,
        // A fixed hour on `asOf` with an explicit offset — the same anchoring
        // `persona/history.ts` uses, and enough for the mastery rollup to read
        // these as scored evidence.
        timestamp: `${asOf}T0${n % 8}:00:00.000+00:00`,
        instrumentId: record.instrumentId,
        instrumentType: record.instrumentType,
        conceptIds: [...record.conceptIds],
        rating: n % 3 === 0 ? 'hard' : 'good',
        wasUnsure: false,
        durationMs: BORROWED_DURATION_MS[record.instrumentType] ?? 40_000,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: [record.instrumentType],
          planVersion: null,
        },
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The composition, cached per state
// ---------------------------------------------------------------------------

interface SessionWorld {
  readonly rows: readonly GapRow[];
  readonly instruments: ConceptInstrumentIndex;
  readonly durations: DurationModel;
  readonly assessments: readonly AssessmentRecord[];
  readonly instrumentCount: number;
  readonly conceptCount: number;
  readonly borrowedInstrumentCount: number;
}

const worldCache = new Map<string, Promise<SessionWorld>>();

function tally(records: readonly VaultInstrumentRecord[]): ReadonlyMap<VaultPath, number> {
  const counts = new Map<VaultPath, number>();
  for (const record of records) {
    counts.set(record.notePath, (counts.get(record.notePath) ?? 0) + 1);
  }
  return counts;
}

function rankedTargetsOf(
  ranked: readonly {
    readonly conceptName: string;
    readonly conceptKey: string;
    readonly course: string;
  }[],
  concepts: readonly ConceptRecord[],
): readonly RankedTarget[] {
  const byName = new Map(concepts.map((concept) => [concept.name, concept]));
  const targets: RankedTarget[] = [];
  for (const entry of ranked) {
    const notePath = byName.get(entry.conceptName)?.sourcePaths[0];
    if (notePath === undefined) continue;
    targets.push({
      conceptName: entry.conceptName,
      conceptKey: entry.conceptKey,
      course: entry.course,
      notePath,
      noteTitle: noteTitleOf(notePath),
    });
  }
  return targets;
}

async function composeWorld(
  state: SessionWorkbenchState,
  rawVault: VaultSource,
): Promise<SessionWorld> {
  // `session-no-cards-vault.ts`'s module doc: F1.3's course-attribution
  // widening reads the SAME lecture-note prose this surface's
  // `'session-no-cards-yet'` state depends on being card-less, so every
  // state composes over the corrected overlay rather than the raw fixture
  // vault. Every other state borrows its instruments wholesale
  // (`borrowedInstruments` below) and never reads what the overlay changes.
  const vault = withoutCourseCrossReferences(rawVault);
  const sourcesOption =
    state.sourcesFolder !== undefined ? { sourcesFolder: state.sourcesFolder } : {};

  const [enumeration, concepts] = await Promise.all([
    enumerateVaultInstruments(vault, { excludePaths: EXCLUDE_PATHS }),
    extractConcepts(vault, { includeTier3: true }),
  ]);

  // Pass one: rank with no history, only to learn WHICH concepts rank. The
  // borrowed instruments and the borrowed history are both keyed on that, so
  // there is no way to build them before this is known — hence two passes over
  // a small in-memory vault rather than one.
  const first = await composeOracleRanking({
    vault,
    basePath: BASE_PATH,
    reviewLog: [],
    asOf: state.asOf,
    concepts,
    ...sourcesOption,
  });
  const rankedEntries = first.ranking.courses.flatMap((course) =>
    course.status === 'ranked' ? course.ranked : [],
  );

  const sessionRecords =
    state.instruments === 'borrowed'
      ? borrowedInstruments(enumeration.records, rankedTargetsOf(rankedEntries, concepts))
      : enumeration.records;

  const reviewLog = state.history === 'borrowed' ? borrowedHistory(sessionRecords, state.asOf) : [];

  // Pass two: the ranking that is actually rendered, with whatever history the
  // state supplies folded into mastery.
  const { ranking, edges, mastery } =
    reviewLog.length === 0
      ? first
      : await composeOracleRanking({
          vault,
          basePath: BASE_PATH,
          reviewLog,
          asOf: state.asOf,
          concepts,
          ...sourcesOption,
        });

  const gap = buildGapView({
    ranking,
    assessments: edges.assessmentsRead.records,
    mastery,
    materialPresence: buildMaterialPresence(concepts, tally(sessionRecords)),
    sourceCoverage: edges.tier3.sourceCoverage,
  });

  return {
    rows: allGapRows(gap),
    instruments: buildConceptInstrumentIndex(sessionRecords),
    durations: estimateInstrumentDurations(reviewLog),
    assessments: edges.assessmentsRead.records,
    instrumentCount: enumeration.records.length,
    conceptCount: concepts.length,
    borrowedInstrumentCount: state.instruments === 'borrowed' ? sessionRecords.length : 0,
  };
}

function worldFor(state: SessionWorkbenchState, vault: VaultSource): Promise<SessionWorld> {
  const cached = worldCache.get(state.id);
  if (cached !== undefined) return cached;
  const built = composeWorld(state, vault);
  worldCache.set(state.id, built);
  return built;
}

export interface SessionScenario {
  /** Mount the real `SessionBuilderView` against this. */
  readonly deps: SessionBuilderViewDeps;
  readonly note: string;
  readonly state: SessionWorkbenchState;
  /** The session at the state's own budget — inspector data, so a viewer never has to take the view's rendering on faith. */
  readonly model: StudySessionModel;
  /** How many gap rows the fill had to choose from. `0` is `'session-nothing-to-build'`'s whole point. */
  readonly gapRowCount: number;
  /** Instruments the vault really holds. Unchanged by borrowing — borrowing re-binds records, it never mints them. */
  readonly instrumentCount: number;
  readonly conceptCount: number;
  /** How many instruments were re-bound onto ranked concepts. `0` on the two unborrowed states, and worth showing beside the numbers. */
  readonly borrowedInstrumentCount: number;
}

/**
 * Builds one session-builder state over `vault`.
 *
 * Async and real: the underlying oracle chain is a genuine walk of the fixture
 * vault, never a stub. `deps.load` rebuilds the session for whatever budget the
 * view asks for, against the cached world — so the budget buttons are live
 * rather than pre-baked models.
 */
export async function buildSessionScenario(
  stateId: string,
  vault: VaultSource,
): Promise<SessionScenario> {
  const state = findSessionState(stateId);
  if (state === undefined) {
    throw new Error(`workbench: unknown session state ${JSON.stringify(stateId)}`);
  }

  const world = await worldFor(state, vault);

  const build = (budgetMinutes: number, focusConceptName: string | undefined): StudySessionModel =>
    buildStudySession({
      rows: world.rows,
      instruments: world.instruments,
      budgetMinutes,
      durations: world.durations,
      asOf: state.asOf,
      assessments: world.assessments,
      ...(focusConceptName !== undefined ? { focusConceptName } : {}),
    });

  const load = (request: SessionBuilderRequest): Promise<SessionBuilderState> =>
    Promise.resolve<SessionBuilderState>({
      kind: 'model',
      model: build(request.budgetMinutes, request.focusConceptName),
    });

  return {
    deps: { load, defaultBudgetMinutes: state.budgetMinutes },
    note: state.note,
    state,
    model: build(state.budgetMinutes, undefined),
    gapRowCount: world.rows.length,
    instrumentCount: world.instrumentCount,
    conceptCount: world.conceptCount,
    borrowedInstrumentCount: world.borrowedInstrumentCount,
  };
}
