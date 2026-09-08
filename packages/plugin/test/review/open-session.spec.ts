/**
 * Scenarios: `features/F2-review.md`, "F2.2 — Review is reachable, and what it
 * opens is her real queue" — @auto:plugin/review/open-session.spec.
 *
 * This is the suite that stands behind the wiring `main.ts` cannot have one
 * for. `main.ts` and `view.ts` import `obsidian`, which has no runtime outside
 * a real host, so neither can be loaded under Vitest at all — the response is
 * to keep everything that can be *wrong about what she is shown* out of them.
 * `open-session.ts` is that everything: vault in, `ReviewSession` out, real
 * `olea-core` composition in between and no fakes for the parts that decide.
 *
 * The ports are real too, and deliberately so. `createVaultReviewLogPort` moved
 * out of `obsidian-ports.ts` to make this possible: rating an item below writes
 * a genuine D7.1 record through the genuine append path into a genuine (if
 * in-memory) vault, and the assertion reads the file back. INV-4 says review
 * logging is wired *before* the features that produce the data because the data
 * is unrecoverable later; a test that stubbed the write would be asserting the
 * stub.
 *
 * ## `[SESS-8.4]` (`ol-egov.132.4`): what changed here
 *
 * The review tab no longer runs its own `composeQueue` selection step — it
 * reads the one composed-session holder (`../../src/session/holder.js`),
 * composing through the study-session composer on demand when that holder is
 * idle (`docs/dev/one-assembly-path.md` §3c, private repo). This suite is not
 * the composer's own acceptance test (`study-session/compose.spec.ts` in
 * `olea-core` is), so almost every fixture below pre-seeds the holder with a
 * hand-built `ComposedStudySession` naming exactly which instruments are
 * offered and in what order (`composedSessionFixture`), the same "drive
 * everything downstream of a composition" posture the module doc already
 * states. Only the three `F6.4 / C5.8` scenarios near the end exercise the
 * REAL composer, over the SAME kind of settings-host fixture
 * `session-builder/provider.spec.ts` already uses.
 *
 * Two mechanical consequences worth stating up front, since they touch
 * almost every existing scenario below rather than needing a new one each:
 *
 *  - **`deferredCount` is always `0` now.** F2.17's "offer one per concept,
 *    defer the rest" was `composeQueue`'s own bookkeeping;
 *    `executeStudyPlanOverComposedRows` (`[SESS-8.3]`) always returns
 *    `deferred: []` (its own doc: "a composed session's `StudySessionOmission`s
 *    are not restated here"). Assertions that used to read a nonzero deferral
 *    count are updated to `0`.
 *  - **C7.9's containment co-presence filter no longer reaches what she is
 *    served, at this call site.** It still runs inside the KEPT
 *    `buildReviewSession` call (dropping candidates before the retired
 *    `composeQueue`), but nothing downstream of that point reads
 *    `candidates`/`containmentDropped` to decide what is OFFERED any more —
 *    selection is entirely the composer's, and `study-session/compose.ts` has
 *    no containment logic of its own yet. Documented, not silently patched
 *    over, in the "C7.9" block below; filed as a discovered bead
 *    (`ol-egov.132.4`'s own close evidence names it) rather than fixed here,
 *    since porting the filter into the composer is real, separate work
 *    outside this bead's owned paths.
 */

import { type Rating, STUDY_PLAN_BODY_VERSION, type StudyPlanEnvelope } from 'olea-contracts';
import type {
  ComposedStudySession,
  ConceptRelation,
  RandomSource,
  StudySessionItem,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  appendReviewLogRecord,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  parseReviewLog,
  provisionalConceptKey,
  reviewLogPath,
  suspendedInstrumentIds,
  writeDistractorProvenance,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  STUDY_PLAN_SETTINGS_STORAGE_KEY,
} from '../../src/plan/settings-store.js';
import {
  createReviewSessionOpener,
  nextDueLabel,
  type OpenReviewSessionInput,
  openReviewSession,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  type EditPort,
} from '../../src/review/ports.js';
import type { ReviewSession } from '../../src/review/session.js';
import { createStudySessionHolder, type StudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault, unreadableVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';

/**
 * `ol-63e1`: `conceptIds`/`masteryAtTime`/a study plan's `conceptId` now carry
 * the opaque key, never the display name — 'Alpha'/'Beta' here are both
 * unbound (`Concepts/Alpha.md`/`Concepts/Beta.md` carry `title:`, not `topic:`,
 * and sit outside the default Zettelkasten folder, so they bind nothing;
 * the real binding comes from `Courses/TEST101/Week one|two.md`'s `topic:`).
 */
function unboundKey(name: string): string {
  return provisionalConceptKey({ name, boundNotePath: null });
}

/** Fixed so the composed queue, the log filename and the assertions all agree. */
const NOW = new Date('2026-08-10T14:00:00-04:00');

function fixedClock(now: Date = NOW): Clock {
  return { now: () => now };
}

const FRONTMATTER = (topic: string, course = 'TEST101') =>
  ['---', `topic: ${topic}`, `course: ${course}`, '---', ''].join('\n');

const CONCEPT_NOTE = ['---', 'title: Alpha', 'course: TEST101', '---', '', 'A concept.', ''].join(
  '\n',
);

const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'feedback: Because of the thing.',
  '```',
].join('\n');

/** Two notes, three instruments, two concepts — small enough to read in one screen. */
function studyVault(extra: Readonly<Record<string, string>> = {}) {
  return memoryVault({
    'Concepts/Alpha.md': CONCEPT_NOTE,
    'Concepts/Beta.md': CONCEPT_NOTE.replace('title: Alpha', 'title: Beta'),
    'Courses/TEST101/Week one.md': [
      FRONTMATTER('[Alpha]'),
      '## A question?',
      '',
      'The front::The back ^blk1',
      '',
    ].join('\n'),
    'Courses/TEST101/Week two.md': [
      FRONTMATTER('[Beta]'),
      '## Another question?',
      '',
      'Grains are ==sorted== by flow.',
      '',
      MCQ_BLOCK,
      '',
    ].join('\n'),
    ...extra,
  });
}

/**
 * The real ports, over the real (in-memory) vault — `suspendPort` included.
 * `createVaultSuspendPort` is the production implementation (`ol-xvmx`), so a
 * test driving a session through this composer proves the whole chain: a
 * suspend from the view reaches the log through the same append discipline a
 * review does, not a stub that only records that the call happened.
 */
function ports(vault: ReturnType<typeof memoryVault>, clock: Clock = fixedClock()) {
  const edited: string[] = [];
  const editPort: EditPort = {
    async edit(instrument) {
      edited.push(instrument.sourcePath);
    },
  };
  const shape: ReviewSessionPorts = {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort,
    noteExists: createVaultNoteExistsPort(vault),
    clock,
    // `ol-p3t07a`: no fixture in this suite composes a queue with a pending
    // draft item (that is `review/session.spec.ts`'s and
    // `generation/review-adapter.spec.ts`'s job) — this port is required by
    // `ReviewSessionPorts` but never called by anything this file drives.
    draftAcceptPort: {
      accept() {
        throw new Error('open-session.spec: no draft item in this suite should ever call accept');
      },
      reject() {
        throw new Error('open-session.spec: no draft item in this suite should ever call reject');
      },
    },
  };
  return { ports: shape, edited };
}

/**
 * Where the log actually lands.
 *
 * **The real local day, not `NOW`'s** — and the split is deliberate rather than
 * a leak. `createVaultReviewLogPort` stamps `timestamp` from the system clock at
 * the moment of appending, because the log records *when the event happened*
 * and the only honest answer to that is now; the injected `Clock` is what makes
 * *composition* and the interval previews deterministic. In production the two
 * are the same clock, so nothing diverges; in a suite that composes at a fixed
 * instant, the filename follows the wall clock and this helper says so out loud
 * instead of the assertion mysteriously failing on some future day.
 */
function todaysLogPath(): string {
  return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
}

/** Deterministic MCQ sampling, so an assertion about options is stable. */
const fixedRandom: RandomSource = { next: () => 0.42 };

// ---------------------------------------------------------------------------
// `[SESS-8.4]`: the composed-session holder fixtures every `sessionInput`/
// `open()` call now needs — see the module doc's "what changed here".
// ---------------------------------------------------------------------------

/**
 * Builds a minimal, honest `ComposedStudySession` naming exactly which
 * enumerated instruments a pre-seeded holder should serve, and in what
 * order — this suite drives everything DOWNSTREAM of a composition (module
 * doc: "it does not decide what is offered"), so the composer's own
 * selection/ordering is never re-derived here; it is simply stated, the way
 * a hand-built `StudySessionModel` fixture is meant to be used (`study-
 * session/build.ts`'s own `StudySessionModel` doc). Every field this suite
 * never reads (`courseShares`/`forcedCourses`/`obligationClasses`/
 * `overflow`, `leftOut`, `nextAssessment`, …) is a harmless, unused default —
 * the holder's own type wants the whole `ComposedStudySession` shape, not a
 * projection of it.
 */
async function composedSessionFixture(
  vault: VaultSource,
  instrumentIds: readonly string[],
  now: Date = NOW,
): Promise<ComposedStudySession> {
  const enumeration = await enumerateVaultInstruments(vault);
  const recordsById = new Map(enumeration.records.map((record) => [record.instrumentId, record]));
  const conceptNameByKey = new Map(
    enumeration.concepts.map((concept) => [concept.key, concept.name]),
  );
  const items: StudySessionItem[] = instrumentIds.map((instrumentId, index) => {
    const record = recordsById.get(instrumentId);
    if (record === undefined) {
      throw new Error(`composedSessionFixture: no enumerated instrument "${instrumentId}"`);
    }
    const conceptKey = record.conceptIds[0];
    return {
      position: index + 1,
      instrumentId: record.instrumentId,
      instrumentType: record.instrumentType,
      notePath: record.notePath,
      noteTitle: record.noteTitle,
      conceptName:
        (conceptKey !== undefined ? conceptNameByKey.get(conceptKey) : undefined) ?? 'unknown',
      course: record.courses[0] ?? 'TEST101',
      gapClass: 'coverage-gap',
      gapRank: index + 1,
      gapScore: 1,
      estimatedSeconds: 60,
      durationSource: 'assumed',
      formatMatch: 'no-preference',
    };
  });
  return {
    model: {
      asOf: calendarDayFromLocalDate(now),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: items.length * 60,
      items,
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: items.length,
      formatPreference: 'unknown',
      nextAssessment: null,
      durationBasis: 'assumed',
      focusConcept: null,
    },
    overflow: [],
    courseShares: new Map(),
    forcedCourses: [],
    obligationClasses: new Map(),
  };
}

/**
 * The default fixture for a vault this suite has not told to compose
 * anything specific: one instrument per concept — the FIRST
 * `enumerateVaultInstruments` finds for it — in enumeration order. Stands in
 * for the study-session composer's own per-concept selection (one
 * `StudySessionItem` per `GapRow`) without running the real oracle chain;
 * that chain's own acceptance criteria live in `study-session/compose.spec.ts`,
 * not here. For `studyVault()` this reproduces exactly the ordering every
 * existing scenario below already asserted: Alpha's `qa` (`Week one.md`),
 * then Beta's `cloze` (`Week two.md`, the first of Beta's two instruments in
 * enumeration order) — Beta's `mcq` is simply never the chosen representative
 * under this rule, which is fine: no scenario below depends on which of
 * Beta's formats stands in for it, only that some single instrument does
 * (F2.17's old "one per concept" outcome, now the composer's).
 */
async function defaultComposedSessionInstrumentIds(vault: VaultSource): Promise<readonly string[]> {
  const enumeration = await enumerateVaultInstruments(vault);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const record of enumeration.records) {
    const conceptKey = record.conceptIds[0] ?? record.instrumentId;
    if (seen.has(conceptKey)) continue;
    seen.add(conceptKey);
    ids.push(record.instrumentId);
  }
  return ids;
}

/**
 * A `StudySessionHolder` already `enter()`ed with a composed-session fixture
 * — `composedSessionFixture` over `instrumentIds`, or (when omitted) the
 * vault's own default one-per-concept fixture above. Every ordinary
 * `sessionInput`/`open()` call below seeds one of these, so `openReviewSession`
 * always finds the holder already active and never calls the idle-composer
 * port — see `composeDefaultStudySessionUnreachable` below for the
 * corresponding guard.
 */
async function seededHolder(
  vault: VaultSource,
  instrumentIds?: readonly string[],
  now: Date = NOW,
): Promise<StudySessionHolder> {
  const ids = instrumentIds ?? (await defaultComposedSessionInstrumentIds(vault));
  const holder = createStudySessionHolder();
  holder.enter(now, await composedSessionFixture(vault, ids, now));
  return holder;
}

/**
 * The `composeDefaultStudySession` port every `OpenReviewSessionInput` below
 * needs — never actually reachable in this suite's ordinary fixtures, since
 * `sessionInput`/`open()` always seed an already-active holder (above).
 * Throws loudly rather than silently composing something unintended, so a
 * future edit that accidentally leaves the holder idle fails as a test
 * failure here rather than as a confusing assertion mismatch three lines
 * down.
 */
const composeDefaultStudySessionUnreachable = (): Promise<ComposedStudySession | null> => {
  throw new Error(
    'open-session.spec: composeDefaultStudySession should not be reachable — every fixture in this suite pre-seeds an active holder',
  );
};

/** The plain `OpenReviewSessionInput` shape both `open()` below and the freeze suite share — never carries `frozenQueue` itself, so a `ReviewSessionOpener` can inject its own without a caller's help. */
async function sessionInput(
  vault: ReturnType<typeof memoryVault>,
  clock: Clock = fixedClock(),
  plan?: StudyPlanEnvelope | null,
  opts: { readonly instrumentIds?: readonly string[]; readonly holder?: StudySessionHolder } = {},
): Promise<OpenReviewSessionInput> {
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault, clock).ports,
    random: fixedRandom,
    probeDays: 30,
    studySessionHolder: opts.holder ?? (await seededHolder(vault, opts.instrumentIds)),
    composeDefaultStudySession: composeDefaultStudySessionUnreachable,
    ...(plan !== undefined ? { plan } : {}),
  };
}

async function open(
  vault: ReturnType<typeof memoryVault>,
  clock: Clock = fixedClock(),
  plan?: StudyPlanEnvelope | null,
  opts: { readonly instrumentIds?: readonly string[]; readonly holder?: StudySessionHolder } = {},
) {
  return openReviewSession(await sessionInput(vault, clock, plan, opts));
}

/** Drives past the current item regardless of its type, so a plan test never has to hard-code which instrument dedupe or the plan chose. */
async function advancePastCurrentItem(session: ReviewSession): Promise<void> {
  const vm = session.getViewModel();
  if (vm.phase === 'front' || vm.phase === 'reveal') {
    session.reveal();
    await session.rate('good');
    return;
  }
  if (vm.phase === 'mcq-open') {
    await session.mcqAnswer(0);
    await session.mcqNext();
  }
}

describe('opening a session composes it from her vault', () => {
  it('offers what the pipeline composed, in that order, with each type rendered as itself', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');

    // Two concepts: the pre-seeded composed-session fixture names one
    // instrument per concept (Alpha's `qa`, Beta's `cloze`) — see
    // `defaultComposedSessionInstrumentIds`'s own doc. `deferredCount` is
    // always `0` now (`executeStudyPlanOverComposedRows` never defers — see
    // the module doc's "what changed here").
    expect(outcome.itemCount).toBe(2);
    expect(outcome.deferredCount).toBe(0);

    await outcome.session.start();
    const vm = outcome.session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase !== 'front') return;
    expect(vm.instrument.type).toBe('qa');
    expect(vm.instrument.courseCode).toBe('TEST101');
    expect(vm.instrument.noteTitle).toBe('Week one');
    expect(vm.instrument.sourcePath).toBe('Courses/TEST101/Week one.md');
    expect(vm.instrument.blockId).toBe('blk1');
    expect(vm.progress).toEqual({ position: 1, total: 2 });
  });

  it('walks the vault once — the item it renders is the record the queue chose', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    // Every offered item resolved to a record; an id the adapter could not
    // find would silently shorten the queue, which is the failure a single
    // enumeration exists to make impossible.
    expect(outcome.itemCount).toBe(2);
    expect(outcome.session.currentItem?.instrument.instrumentId).toBeTruthy();
  });

  it('composes nothing from a vault with no instruments, and still opens', async () => {
    const vault = memoryVault({ 'Notes/prose.md': '---\ntopic: [Alpha]\n---\n\nJust prose.\n' });
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('an empty queue is a success, not a failure');

    expect(outcome.itemCount).toBe(0);
    await outcome.session.start();
    // The empty screen, not a refusal to open: "nothing is due" and "the
    // command is broken" must not be the same experience.
    expect(outcome.session.getViewModel().phase).toBe('empty');
  });
});

describe('[D-220] (ol-yfyi) — the distractor-provenance sidecar reaches the live queue', () => {
  /** One concept, one mcq instrument — deterministic offer order, no F2.17 deferral to reason about. */
  function mcqOnlyVault() {
    return memoryVault({
      'Concepts/Alpha.md': CONCEPT_NOTE,
      'Courses/TEST101/Week one.md': [
        FRONTMATTER('[Alpha]'),
        '## A question?',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });
  }

  it('populates each mcq option from the sidecar, matched by text, never by position or on the correct answer', async () => {
    const vault = mcqOnlyVault();
    // Same enumeration `openReviewSession` runs internally — reading it here
    // first only to learn the id the sidecar must be keyed under, the same
    // thing a real accept-time write already did before this session ever
    // opens.
    const enumerated = await enumerateVaultInstruments(vault);
    const mcqRecord = enumerated.records.find((record) => record.instrumentType === 'mcq');
    if (mcqRecord === undefined) throw new Error('expected the fixture to enumerate one mcq');

    await writeDistractorProvenance(vault, mcqRecord.instrumentId, {
      entries: [
        { text: 'd1', believes: 'she believes d1', source_says: 'the source says otherwise' },
      ],
    });

    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    const item = outcome.session.currentItem?.instrument;
    if (item?.type !== 'mcq') throw new Error('expected the single instrument to be the mcq');

    const named = item.options.find((option) => option.label === 'd1');
    expect(named?.believes).toBe('she believes d1');
    expect(named?.source_says).toBe('the source says otherwise');

    // Every other option — the other three distractors and the correct
    // answer — carries neither field: the sidecar named one distractor by
    // text, not a shape every option inherits.
    for (const option of item.options) {
      if (option.label === 'd1') continue;
      expect(option.believes).toBeUndefined();
      expect(option.source_says).toBeUndefined();
    }
  });

  it('leaves every option without believes/source_says when no sidecar was ever written — absent, not fabricated', async () => {
    const vault = mcqOnlyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    const item = outcome.session.currentItem?.instrument;
    if (item?.type !== 'mcq') throw new Error('expected the single instrument to be the mcq');

    for (const option of item.options) {
      expect(option.believes).toBeUndefined();
      expect(option.source_says).toBeUndefined();
    }
  });
});

// `[SESS-8.4]`: BEFORE this bead, `input.relations` reached `buildReviewSession`'s
// `filterContainmentCoPresence` call and its result (`candidates`) was what
// `composeQueue` selected from — so a live `part-of` edge visibly dropped the
// container from what she was served. That selection step is gone from this
// call site (§4 of the design note: `candidates`/`recordsById` are kept only
// as the plan-executor's enumeration, never consulted to decide what is
// OFFERED any more — the composer decides that, and `study-session/compose.ts`
// has no containment logic of its own yet). So `input.relations` still
// reaches `buildReviewSession` (`containmentDropped` below proves it), but
// C7.9 no longer changes what she is served through the review tab — a real,
// named gap, not a silently-passed test: filed as a discovered bead against
// `[SESS-8]` for whoever extends the study-session composer next, rather than
// fixed here (porting containment filtering into `study-session/compose.ts`
// is real work outside this bead's owned paths).
describe('C7.9 containment co-presence reaches this call site (ol-v7r5.7)', () => {
  /** Beta is part of Alpha — `from` is the finer side, `to` the container (`session/containment.ts`'s convention). */
  function partOfAlphaBeta(): ConceptRelation {
    return {
      type: 'part-of',
      from: 'Beta',
      to: 'Alpha',
      provenance: 'model-proposed',
      confidence: 0.9,
      introducingPassages: {
        from: {
          sourcePath: 'Concepts/Beta.md',
          location: { page: 1, charRange: { start: 0, end: 1 } },
        },
        to: {
          sourcePath: 'Concepts/Alpha.md',
          location: { page: 1, charRange: { start: 0, end: 1 } },
        },
      },
    };
  }

  it("with no relations threaded, the container and the part are both offered (today's no-op baseline)", async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    expect(outcome.itemCount).toBe(2);
  });

  it('a live part-of edge still reaches buildReviewSession, but no longer changes what the review tab serves', async () => {
    const vault = studyVault();
    const outcome = await openReviewSession(await sessionInput(vault, fixedClock(), undefined, {}));
    const withRelations = await openReviewSession({
      ...(await sessionInput(vault, fixedClock())),
      relations: [partOfAlphaBeta()],
    });
    if (!outcome.ok || !withRelations.ok) throw new Error('expected composed sessions');

    // The composed-session fixture both calls share names both Alpha and
    // Beta regardless of `relations` — proving the point: the served item
    // count is identical with and without the edge threaded.
    expect(withRelations.itemCount).toBe(outcome.itemCount);
  });
});

/**
 * `[D-149]` (`ol-4e7o`): unlike `relations` above, `arrivalDays`/
 * `conceptSourcePaths` need no new field on `OpenReviewSessionInput` at
 * all — `buildReviewSession` resolves both fully from `vault` (already
 * forwarded here, unconditionally, as `input.vault`) and its own
 * `instruments.concepts` enumeration (`session/build.ts`'s
 * `arrivalDaysByConceptKey`/`conceptSourcePathsByConceptKey`). So the thing
 * to prove reachable at *this* call site is narrower than the C7.9 block
 * above: not a new forwarded value, but that the real "Olea: Start today's
 * review" path actually calls the injected vault's `firstSeen` at all — the
 * accessor `session/build.ts` had no caller resolving before this bead
 * (`ol-v7r5.22`'s own honest gap).
 */
describe('[D-149] (`ol-4e7o`) — arrivalDays resolution reaches this call site too', () => {
  function vaultWithFirstSeenSpy(vault: ReturnType<typeof memoryVault>): {
    readonly vault: VaultSource;
    readonly calls: readonly VaultPath[];
  } {
    const calls: VaultPath[] = [];
    const vaultWithSpy: VaultSource = {
      ...vault,
      async firstSeen(path: VaultPath) {
        calls.push(path);
        return null;
      },
    };
    return { vault: vaultWithSpy, calls };
  }

  it("opening a session queries the vault's firstSeen over the concepts it enumerated — the mutation this catches is build.ts never calling it at all", async () => {
    const { vault, calls } = vaultWithFirstSeenSpy(studyVault());
    const outcome = await openReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(vault as ReturnType<typeof memoryVault>).ports,
      random: fixedRandom,
      probeDays: 30,
      studySessionHolder: await seededHolder(vault),
      composeDefaultStudySession: composeDefaultStudySessionUnreachable,
    });
    if (!outcome.ok) throw new Error('expected a composed session');

    // Alpha's only `topic:` occurrence is `Week one.md`; Beta's is
    // `Week two.md` — exactly `ConceptRecord.sourcePaths` for each, per
    // `arrivalDaysByConceptKey`'s doc. Order-independent: what matters is
    // that both were queried through this real command path, not a second,
    // parallel enumeration this suite would have no way to catch drifting.
    expect(new Set(calls)).toEqual(
      new Set(['Courses/TEST101/Week one.md', 'Courses/TEST101/Week two.md']),
    );
  });
});

describe('a vault it cannot read is not a vault with nothing due', () => {
  // The walk throws before this module ever reads `studySessionHolder`/
  // `composeDefaultStudySession` — an idle holder and the unreachable-port
  // guard are supplied only to satisfy the type, same as `probeDays` above.
  it('reports the failure instead of handing back an empty session', async () => {
    const outcome = await openReviewSession({
      vault: unreadableVault('disk went away'),
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(memoryVault()).ports,
      probeDays: 30,
      studySessionHolder: createStudySessionHolder(),
      composeDefaultStudySession: composeDefaultStudySessionUnreachable,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(String(outcome.error)).toContain('disk went away');
  });

  it('never throws out of the call — the caller decides what to say', async () => {
    await expect(
      openReviewSession({
        vault: unreadableVault(),
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        ports: ports(memoryVault()).ports,
        probeDays: 30,
        studySessionHolder: createStudySessionHolder(),
        composeDefaultStudySession: composeDefaultStudySessionUnreachable,
      }),
    ).resolves.toBeDefined();
  });
});

describe('what she rates reaches the review log (D7.1, INV-4)', () => {
  it('appends a record for the instrument she rated, through the real port', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    const instrumentId = outcome.session.currentItem?.instrument.instrumentId;
    outcome.session.reveal();
    await outcome.session.rate('good' satisfies Rating);

    const logPath = todaysLogPath();
    const written = vault.contentOf(logPath);
    expect(
      written,
      `expected a log at ${logPath}, wrote: ${vault.writes.join(', ')}`,
    ).toBeDefined();

    const parsed = parseReviewLog(written ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.instrumentId).toBe(instrumentId);
    expect(record.instrumentType).toBe('qa');
    expect(record.rating).toBe('good');
    expect(record.wasUnsure).toBe(false);
    // The queue's own account of why this was offered, carried through
    // untouched — never re-derived by the view.
    expect(record.selectionContext.dueState).toBe('new');
    expect(record.selectionContext.yieldRank).toBeNull();
    // `ol-rpr4`: C5.4's rollup is wired now, so every v4 record carries it.
    // This is her first-ever review of Alpha, so the log the builder read
    // (before this rating) had no scored evidence for it at all — `seed`, not
    // `sprout`, which is what folding this very rating into the slice would
    // wrongly produce (see the discriminating test below for that failure
    // made concrete).
    expect(record.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { [unboundKey('Alpha')]: 'seed' },
    });
  });

  it('THE TRAP: stamps mastery from the log as it stood BEFORE this rating, not after (ol-rpr4)', async () => {
    // Two prior, real, on-disk v4 records for Alpha — both successes, on two
    // distinct days — appended through the same production writer the port
    // itself uses. Read alone, that history is exactly `sprout`: a perfect
    // recent rate, but only 2 distinct days, short of `minSpacedDays` (3) —
    // "recalled reliably *across spaced attempts*" (R7) is not yet earned.
    const vault = studyVault();
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'seed-alpha-1',
        instrumentType: 'qa',
        conceptIds: [unboundKey('Alpha')],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'seed-alpha-again' },
    );
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'seed-alpha-2',
        instrumentType: 'qa',
        conceptIds: [unboundKey('Alpha')],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'seed-alpha-good' },
    );

    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    // The first offered item is Alpha's `qa` (proven by the untouched suite
    // above) — rate it `good`, the third scored event for Alpha ever, and the
    // one whose own write is under test.
    outcome.session.reveal();
    await outcome.session.rate('good' satisfies Rating);

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records.find(
      (r) =>
        r.kind === 'review' &&
        r.instrumentId !== 'seed-alpha-1' &&
        r.instrumentId !== 'seed-alpha-2',
    );
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;

    // The falsifiable claim: `sprout` (only the 2 PRIOR distinct days — short
    // of `minSpacedRetrievalDays`, 3), not `sapling` (3 distinct days
    // INCLUDING the just-written rating's day, which is what a caller that
    // folded its own event into the slice would compute — the spacing gate
    // crosses `MIN_SPACED_RETRIEVAL_DAYS` a day early). A regression that
    // reorders the read and the append above turns this into `sapling` and
    // this assertion goes red. (`tree` is not in play either way: nothing
    // here ever grades an explain-back, and under the high-water-mark model
    // `tree` is reachable only by clearing the depth gate — see
    // `packages/core/src/mastery/rollup.ts`'s module doc, R7/`[D-145]`, MAT-6
    // / `ol-95vv.7`.)
    expect(record.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { [unboundKey('Alpha')]: 'sprout' },
    });
  });

  it('writes the log and no note', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    outcome.session.reveal();
    await outcome.session.rate('again');

    expect(vault.writes).toEqual([todaysLogPath()]);
  });

  it('a second rating appends rather than replacing the first', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    outcome.session.reveal();
    await outcome.session.rate('good');
    // The next item is the cloze or the MCQ, depending on which won dedupe;
    // both reach the log by the same path.
    const vm = outcome.session.getViewModel();
    if (vm.phase === 'front' || vm.phase === 'reveal') {
      outcome.session.reveal();
      await outcome.session.rate('hard');
    } else if (vm.phase === 'mcq-open') {
      await outcome.session.mcqAnswer(0);
      await outcome.session.mcqNext();
    }

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.records).toHaveLength(2);
    expect(new Set(parsed.records.map((r) => r.eventId)).size).toBe(2);
  });
});

describe('suspending reaches the log, not just this session (F2.6, D-020, ol-xvmx)', () => {
  // `ol-xvmx`: `appendSuspendRecord` had no production caller because
  // `SuspendPort.suspend` carried only an instrument id, and the frozen
  // suspend record requires the concept set as well. Before that was fixed,
  // this whole `describe` block did not compile — `createVaultSuspendPort`
  // did not exist — which is the sharpest form of "no implementation of this
  // port could produce a conforming record" the bead's diagnosis names.

  it('appends a suspend record carrying the instrument id and its concept ids, through the real port', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    const instrumentId = outcome.session.currentItem?.instrument.instrumentId;
    const conceptIds = outcome.session.currentItem?.instrument.conceptIds;
    if (instrumentId === undefined || conceptIds === undefined) {
      throw new Error('expected a current item');
    }

    await outcome.session.suspend();

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records.find((r) => r.kind === 'suspend');
    expect(record).toBeDefined();
    if (record?.kind !== 'suspend') return;
    expect(record.instrumentId).toBe(instrumentId);
    expect(record.conceptIds).toEqual(conceptIds);
  });

  it('survives a projection rebuild: a fresh fold over the log reports the instrument suspended', async () => {
    // "Rebuild" is the whole point of a projection (`core/review-log/suspension.ts`'s
    // doc): there is no stored suspended-list anywhere, only this fold over
    // whatever is on disk. Nothing here is held from the write above — the log
    // is read back with a brand-new `parseReviewLog` call and folded with a
    // brand-new `suspendedInstrumentIds` call, exactly as a new session
    // composed tomorrow would.
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    const instrumentId = outcome.session.currentItem?.instrument.instrumentId;
    if (instrumentId === undefined) throw new Error('expected a current item');

    await outcome.session.suspend();

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const suspended = suspendedInstrumentIds(parsed.records);
    expect(suspended.has(instrumentId)).toBe(true);
  });
});

describe('the session is scheduled against her replayed history', () => {
  // `[SESS-8.4]` NOTE: this used to prove "she is not offered what is not
  // due" by observing that a SECOND composition skipped the just-rated
  // instrument entirely — `composeQueue`'s own FSRS due-gate. Which
  // instruments are OFFERED is now the composer's decision
  // (`study-session/compose.spec.ts`'s own acceptance criteria), not
  // something this suite's hand-built fixture re-derives — the fixture below
  // deliberately names the SAME instrument again on the second compose. What
  // this call site still owns, and what this test now asserts instead: an
  // offered item's `priorState`/`selectionContext.dueState` is read fresh off
  // the replayed log every time (`queueItemsFromComposedSession`), never
  // carried over or cached from an earlier session.
  it('an offered instrument carries its replayed state, never a value carried over from an earlier session', async () => {
    const vault = studyVault();
    const ids = await defaultComposedSessionInstrumentIds(vault);
    const first = await open(vault, fixedClock(), undefined, { instrumentIds: ids });
    if (!first.ok) throw new Error('expected a composed session');
    await first.session.start();
    const ratedId = first.session.currentItem?.instrument.instrumentId;
    expect(first.session.currentItem?.priorState).toBeNull();
    first.session.reveal();
    await first.session.rate('easy');

    const laterClock = fixedClock(new Date('2026-08-11T14:00:00-04:00'));
    const second = await open(vault, laterClock, undefined, { instrumentIds: ids });
    if (!second.ok) throw new Error('expected a composed session');
    await second.session.start();

    // Same instrument the fixture names first both times — but the state
    // attached to it is read fresh off the log this second `open()` replayed,
    // never a value the first session happened to hold.
    expect(second.session.currentItem?.instrument.instrumentId).toBe(ratedId);
    expect(second.session.currentItem?.priorState).not.toBeNull();
    expect(second.session.currentItem?.selectionContext.dueState).not.toBe('new');
  });

  it('a fresh vault offers every instrument as new, with no prior state', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    expect(outcome.session.currentItem?.priorState).toBeNull();
    expect(outcome.session.currentItem?.selectionContext.dueState).toBe('new');
  });
});

// Scenarios: features/F2-review.md — "F2.8 — The switch-on: a cached plan
// actually reaches a real session (P5-T07)".
describe('P5-T07: a cached plan reaches the real session through executeStudyPlan', () => {
  /** Ranks Beta over Alpha; Alpha is deliberately absent from the plan. */
  const PLAN: StudyPlanEnvelope = {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: STUDY_PLAN_BODY_VERSION,
    policyVersion: 'sp1-test0000000001',
    computedAt: '2026-08-10T09:00:00-04:00',
    freshForSeconds: 3600,
    governsForSeconds: 86_400,
    body: {
      asOf: '2026-08-10',
      courses: [
        {
          course: 'TEST101',
          status: 'ranked',
          concepts: [
            {
              conceptId: unboundKey('Beta'),
              rank: 1,
              weight: 10,
              examProximityDays: 3,
              reasoning: 'test reasoning',
              citations: [{ sourcePath: '03 Research/paper.md', questionLabel: 'Q1' }],
            },
          ],
        },
      ],
    },
  };

  // `[SESS-8.4]`/`[SESS-8.3]`: `executeStudyPlanOverComposedRows` — the
  // composed-rows entry this call site now uses — adds NO cross-course sort
  // of its own (C5.7, F6.4; unlike the retired `executeStudyPlan`, which
  // sorted ranked-before-unranked). So the plan enriches D7.1's context on
  // every item without moving Beta ahead of Alpha, even though the plan
  // ranks Beta and not Alpha — the composer's own order (the fixture's
  // default: Alpha first, Beta second) stands.
  it("a cached plan completes D7.1's context on every item without reordering the composer's own rows (C5.7)", async () => {
    const vault = studyVault();
    const outcome = await open(vault, fixedClock(), PLAN);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    // Alpha is still first — the plan never ranked it, so its own nulls
    // stand, but `planVersion` still names the plan in force (C7.6/D7.1: it
    // reaches every item, ranked or not).
    const first = outcome.session.currentItem;
    expect(first?.instrument.conceptIds).toContain(unboundKey('Alpha'));
    expect(first?.selectionContext.planVersion).toBe(PLAN.policyVersion);
    expect(first?.selectionContext.yieldRank).toBeNull();
    expect(first?.selectionContext.examProximity).toBeNull();

    await advancePastCurrentItem(outcome.session);

    // Beta is second, exactly where the composer put it — ranked, weight 10,
    // its plan entry filled in, but not moved.
    const second = outcome.session.currentItem;
    expect(second?.instrument.conceptIds).toContain(unboundKey('Beta'));
    expect(second?.selectionContext.planVersion).toBe(PLAN.policyVersion);
    expect(second?.selectionContext.yieldRank).toBe(1);
    expect(second?.selectionContext.examProximity).toBe(3);
  });

  it('no cached plan degrades to exactly Phase A, item for item', async () => {
    const vault = studyVault();
    const withoutPlan = await open(vault, fixedClock(), null);
    const omittedPlan = await open(vault, fixedClock());
    if (!withoutPlan.ok || !omittedPlan.ok) throw new Error('expected composed sessions');

    await withoutPlan.session.start();
    await omittedPlan.session.start();

    // `plan: null` and omitting `plan` entirely reach the identical Phase A
    // shape through the same `executeStudyPlanOverComposedRows` call — no
    // second branch to drift from it.
    expect(withoutPlan.session.currentItem?.selectionContext).toEqual(
      omittedPlan.session.currentItem?.selectionContext,
    );
    expect(withoutPlan.session.currentItem?.selectionContext.planVersion).toBeNull();
    expect(withoutPlan.session.currentItem?.selectionContext.yieldRank).toBeNull();
    expect(withoutPlan.itemCount).toBe(omittedPlan.itemCount);
    expect(withoutPlan.deferredCount).toBe(omittedPlan.deferredCount);
  });
});

describe('nextDueLabel — the empty screen names the next item, in whole local days', () => {
  it('is null when nothing is scheduled at all', () => {
    expect(nextDueLabel(NOW, null)).toBeNull();
  });

  it('later the same local day is today, not tomorrow', () => {
    // Four hours ahead. An hours-based rounding would call this tomorrow.
    expect(nextDueLabel(NOW, new Date('2026-08-10T18:00:00-04:00'))).toBe('today');
  });

  it('the next local calendar day is tomorrow, even a minute after midnight', () => {
    expect(nextDueLabel(NOW, new Date('2026-08-11T00:01:00-04:00'))).toBe('tomorrow');
  });

  it('further out is a day count', () => {
    expect(nextDueLabel(NOW, new Date('2026-08-16T09:00:00-04:00'))).toBe('in 6 days');
  });
});

describe('F2.7/F2.12 — explainWhyPort and evaluateConfusionRouting reach the composed session (ol-sn1q, ol-h2bx)', () => {
  it('an omitted explainWhyPort composes a session that cannot offer it (F7.8 grey-out)', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    expect(await outcome.session.requestExplainWhy('', [])).toBeNull();
  });

  it('a wired explainWhyPort is genuinely reachable through the composed session', async () => {
    const vault = studyVault();
    const explainWhyPort = {
      explainWhy: async () => ({
        refused: false as const,
        text: 'Because...',
        citedChunkIndex: 1,
        provenance: null,
      }),
    };
    const outcome = await openReviewSession({
      ...(await sessionInput(vault)),
      ports: { ...ports(vault).ports, explainWhyPort },
    });
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    expect(await outcome.session.requestExplainWhy('', [])).toEqual({
      refused: false,
      text: 'Because...',
      citedChunkIndex: 1,
      provenance: null,
    });
  });

  it('a wired evaluateConfusionRouting is genuinely reachable through the composed session', async () => {
    const vault = studyVault();
    const outcome = await openReviewSession({
      ...(await sessionInput(vault)),
      ports: {
        ...ports(vault).ports,
        evaluateConfusionRouting: () => ({
          shouldOffer: true,
          lapses: 4,
          promptText: 'offer text',
        }),
      },
    });
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await advancePastCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()?.promptText).toBe('offer text');
  });

  it('an omitted evaluateConfusionRouting composes a session that never offers', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await advancePastCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()).toBeNull();
  });
});

// Scenarios: features/F2-review.md, "F5.3a / R7 — the scheduling observation's
// third trigger" — @auto:plugin/review/open-session.spec.
describe("F5.3a / R7 — the scheduling observation's third trigger reaches the composed session (ol-0r92.11)", () => {
  /**
   * A real, on-disk explain-back review from two days before `NOW`, naming
   * Beta as the neighbour concept F5.3a's observation is about — written
   * through the same production `appendReviewLogRecord` `open-session.spec`
   * already uses to seed history, never a fake or a hand-built log line.
   */
  async function seedBetaObservation(vault: ReturnType<typeof memoryVault>): Promise<void> {
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'seed-explain-back-alpha',
        instrumentType: 'explain-back',
        conceptIds: [unboundKey('Alpha')],
        rating: null,
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
        schedulingObservation: { neighbourConceptId: unboundKey('Beta') },
      },
      { deviceId: DEVICE, generateEventId: () => 'seed-scheduling-observation' },
    );
  }

  it('the reciprocal offer surfaces once she reaches the named neighbour concept, unprompted by any caller-supplied port', async () => {
    const vault = studyVault();
    await seedBetaObservation(vault);
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    // Alpha's `qa` is offered first (the untouched suite's own ordering) —
    // rating it must not itself surface the offer, since the observation
    // names Beta, not Alpha.
    expect(outcome.session.currentItem?.instrument.conceptIds).toContain(unboundKey('Alpha'));
    outcome.session.reveal();
    await outcome.session.rate('good');
    expect(outcome.session.getSchedulingObservationOffer()).toBeNull();

    // Beta's turn — this is "the next time she is in the neighbour concept".
    expect(outcome.session.currentItem?.instrument.conceptIds).toContain(unboundKey('Beta'));
    await advancePastCurrentItem(outcome.session);

    expect(outcome.session.getSchedulingObservationOffer()?.neighbourConceptId).toBe(
      unboundKey('Beta'),
    );
  });

  it('with no unconsumed observation on the log, the same vault composes a session that never offers', async () => {
    const vault = studyVault();
    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await advancePastCurrentItem(outcome.session);
    await advancePastCurrentItem(outcome.session);

    expect(outcome.session.getSchedulingObservationOffer()).toBeNull();
  });

  it('reading the observation changes nothing about what is queued — never queue composition (F2.14/F2.21)', async () => {
    const withObservation = studyVault();
    await seedBetaObservation(withObservation);
    const withOutcome = await open(withObservation);
    const withoutOutcome = await open(studyVault());
    if (!withOutcome.ok || !withoutOutcome.ok) throw new Error('expected both sessions to compose');

    // Same item count, same deferral count, same first instrument — the
    // observation is read, but it moves nothing about order, due state or
    // FSRS scheduling, only whether the on-demand offer appears later.
    expect(withOutcome.itemCount).toBe(withoutOutcome.itemCount);
    expect(withOutcome.deferredCount).toBe(withoutOutcome.deferredCount);
    await withOutcome.session.start();
    await withoutOutcome.session.start();
    expect(withOutcome.session.currentItem?.instrument.conceptIds).toEqual(
      withoutOutcome.session.currentItem?.instrument.conceptIds,
    );
  });
});

// Scenarios: features/F2-review.md — C5.8's freeze (`ol-v7r5.35`, `[D-193]`):
// `createReviewSessionOpener`'s `open`/`extend`/`close` are the reachable
// wiring `queue-adapter.ts`'s own `createFrozenReviewQueue` doc names as
// owed — one opener per opened tab, composing through those three verbs.
//
// `[SESS-8.4]` NOTE, read before the three scenarios below: this freeze now
// stacks on TOP of a second, more senior one — `session/holder.ts`'s shared
// `SittingState<ComposedStudySession>` (§3a: "Home, the session builder,
// Today and the review tab all read that one holder"). A test in this block
// passes the SAME `StudySessionHolder` instance across every `open`/`extend`
// call it makes, exactly the way `main.ts` shares one holder across the
// whole plugin — a fresh holder per call (this file's ordinary `open()`
// helper) would re-enter a brand-new sitting every time and never exercise
// either freeze.
//
// **What no longer holds, and why it is not a defect this row introduces:**
// closing the review tab (`opener.close()`) releases only the PER-TAB
// `frozenQueue` layer — it was never wired to the shared holder, which is
// deliberately per-PLUGIN, not per-tab (§3a again: the tab is "the reader of
// the holder rather than the owner of a private one"). So "close, then
// reopen" no longer recomposes by itself; only `session/holder.ts`'s own
// `exit()` (or a future material-change trigger `main.ts`'s
// `enterStudySessionHolderForStart` doc names as real future work) ends a
// sitting. The rewritten scenario below demonstrates both halves: closing
// and reopening alone changes nothing, and `holder.exit()` is what actually
// starts a fresh one — the same mechanism Start uses.
//
// **`extend`'s "outrunning the target" growth is a genuine, named gap**,
// not a reframing: design note §3b explicitly keeps it ("outrunning the
// target appends under the same plan's shares ... and never reorders"), but
// nothing in this build gives a frozen `ComposedStudySession` a way to grow
// its own `model.items` mid-sitting — that needs the composer's own
// `overflow`/`leftOut` candidates threaded through by instrument id, which
// does not exist yet. Filed as a discovered bead against `[SESS-8]` rather
// than built here (outside this row's owned paths); the rewritten scenario
// below asserts the honest current behaviour — `extend` finds nothing new
// while the holder itself has not been re-entered.
describe("ol-v7r5.35 — createReviewSessionOpener holds a tab's session still (C5.8, [D-193])", () => {
  /** A third concept, absent from `studyVault()` — written mid-test to simulate material arriving while a tab is open. */
  async function addGammaConcept(vault: ReturnType<typeof memoryVault>): Promise<void> {
    await vault.write('Concepts/Gamma.md', CONCEPT_NOTE.replace('title: Alpha', 'title: Gamma'));
    await vault.write(
      'Courses/TEST101/Week three.md',
      [
        FRONTMATTER('[Gamma]'),
        '## A third question?',
        '',
        'The gamma front::The gamma back ^blk3',
        '',
      ].join('\n'),
    );
  }

  it('re-render does not recompose: a second open() while the sitting is active ignores material that arrived since', async () => {
    const vault = studyVault();
    const opener = createReviewSessionOpener({ now: () => NOW });
    // One shared holder across both calls — entered once, before Gamma
    // exists, the same instance `main.ts` would share across a whole plugin
    // session.
    const holder = await seededHolder(vault);

    const first = await opener.open(await sessionInput(vault, fixedClock(), undefined, { holder }));
    if (!first.ok) throw new Error('expected a composed session');
    expect(first.itemCount).toBe(2);

    // Material arrives, but the sitting is still open and nowhere near the
    // idle threshold (the clock never moves) — `open()`'s hold branch must
    // return the SAME frozen list, not one that has picked Gamma up.
    await addGammaConcept(vault);
    const second = await opener.open(
      await sessionInput(vault, fixedClock(), undefined, { holder }),
    );
    if (!second.ok) throw new Error('expected a composed session');

    expect(second.itemCount).toBe(first.itemCount);
    expect(second.scheduledQueue.map((item) => item.instrument.instrumentId)).toEqual(
      first.scheduledQueue.map((item) => item.instrument.instrumentId),
    );
    expect(
      second.scheduledQueue.some((item) =>
        item.instrument.conceptIds.includes(unboundKey('Gamma')),
      ),
    ).toBe(false);
  });

  it("continue extends: finds nothing new while the shared holder's own sitting is untouched (outrun-the-target growth is not yet wired — see this block's own note)", async () => {
    const vault = studyVault();
    const opener = createReviewSessionOpener({ now: () => NOW });
    const holder = await seededHolder(vault);

    const opened = await opener.open(
      await sessionInput(vault, fixedClock(), undefined, { holder }),
    );
    if (!opened.ok) throw new Error('expected a composed session');
    await opened.session.start();
    await advancePastCurrentItem(opened.session);
    await advancePastCurrentItem(opened.session);
    expect(opened.session.getViewModel().phase).toBe('complete');

    // A brand-new concept arrives, but the SHARED holder was never told to
    // recompose — `extend` re-derives from the SAME frozen `ComposedStudySession`
    // the holder still holds, so it finds nothing new. This is the honest
    // current behaviour, not the target one — see this block's own note.
    await addGammaConcept(vault);
    const additions = await opener.extend(
      await sessionInput(vault, fixedClock(), undefined, { holder }),
    );

    expect(additions).toEqual([]);
    expect(opened.session.getViewModel().phase).toBe('complete');
  });

  it('closing and reopening the tab alone does not recompose; exiting the shared holder does (C5.8 — the tab is a reader, not the owner, of the sitting)', async () => {
    const vault = studyVault();
    const opener = createReviewSessionOpener({ now: () => NOW });
    const holder = await seededHolder(vault);

    const first = await opener.open(await sessionInput(vault, fixedClock(), undefined, { holder }));
    if (!first.ok) throw new Error('expected a composed session');
    expect(first.itemCount).toBe(2);

    opener.close();
    await addGammaConcept(vault);

    // Closing the TAB released only `frozenQueue`'s own per-tab freeze — the
    // shared holder is still active, so reopening reads the SAME composition,
    // Gamma-blind, exactly as if the tab had never closed.
    const reopened = await opener.open(
      await sessionInput(vault, fixedClock(), undefined, { holder }),
    );
    if (!reopened.ok) throw new Error('expected a composed session');
    expect(reopened.itemCount).toBe(2);
    expect(
      reopened.scheduledQueue.some((item) =>
        item.instrument.conceptIds.includes(unboundKey('Gamma')),
      ),
    ).toBe(false);

    // What actually starts a fresh sitting — `holder.exit()`, the same call
    // `main.ts`'s `enterStudySessionHolderForStart` makes on a stale decision.
    // A caller must ALSO release the per-tab freeze (`opener.close()`) or its
    // own `frozenQueue` would still hold the pre-Gamma list — the two layers
    // are independent, and a real caller (`main.ts`) always changes both
    // together on an explicit new ask.
    holder.exit();
    opener.close();
    const freshIds = await defaultComposedSessionInstrumentIds(vault);
    const afterExit = await opener.open(
      await sessionInput(vault, fixedClock(), undefined, { instrumentIds: freshIds }),
    );
    if (!afterExit.ok) throw new Error('expected a composed session');
    expect(afterExit.itemCount).toBe(3);
    expect(
      afterExit.scheduledQueue.some((item) =>
        item.instrument.conceptIds.includes(unboundKey('Gamma')),
      ),
    ).toBe(true);
  });
});

// Scenarios: `features/F6-today.md` (olea-service), "F6.4 / C5.8 — The review
// tab reads the one composed-session holder" —
// @auto:plugin/review/open-session.spec. Unlike every fixture above, these
// three exercise the REAL `composeDefaultStudySession` port — the same
// assembly `session-builder/provider.spec.ts` drives, over an in-memory vault
// with its own real `.base` file (the composer needs assignments configured
// to run at all, the same `isStudyPlanConfigured` gate Home and the session
// builder already apply).
describe('F6.4 / C5.8 — the review tab reads the one composed-session holder', () => {
  const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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
   * The study-session composer ranks BOUND concepts only — `studyVault()`'s
   * own Alpha/Beta are deliberately unbound (this file's own module doc, "no
   * relations threaded" section), which the composeQueue-driven fixtures
   * above never cared about but the real composer does. This is
   * `test/gap/provider.spec.ts`'s/`test/session-builder/provider.spec.ts`'s
   * own minimal working fixture (both compose over the identical
   * `composeOracleRanking` chain) — a Zettelkasten-bound concept, a note
   * citing it with a real card, and one tier-3 past paper so the course
   * actually ranks rather than abstaining.
   */
  function configuredStudyVault() {
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
      [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });
  }

  class FakeSettingsHost implements ObsidianDataHost {
    private blob: unknown = {
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
    };
    async loadData(): Promise<unknown> {
      return this.blob;
    }
    async saveData(data: unknown): Promise<void> {
      this.blob = data;
    }
  }

  /** The real port `main.ts`'s `composeDefaultStudySession` wraps — see that method's own doc. */
  function realComposeDefaultStudySession(
    vault: ReturnType<typeof memoryVault>,
  ): () => Promise<ComposedStudySession | null> {
    return async () => {
      const result = await composeStudySessionForRequest(
        {
          vault,
          deviceId: DEVICE,
          settingsHost: new FakeSettingsHost(),
          now: () => NOW,
          scheduler: createFsrsScheduler(),
        },
        { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
        NOW,
      );
      return result?.composed.full ?? null;
    };
  }

  it('sits the held composition verbatim when the holder is already active — no composer call, no selection step of its own', async () => {
    const vault = configuredStudyVault();
    const ids = await defaultComposedSessionInstrumentIds(vault);
    const holder = await seededHolder(vault, ids);
    let composerCalls = 0;
    const composeDefaultStudySession = async (): Promise<ComposedStudySession | null> => {
      composerCalls += 1;
      return realComposeDefaultStudySession(vault)();
    };

    const outcome = await openReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(vault).ports,
      random: fixedRandom,
      probeDays: 30,
      studySessionHolder: holder,
      composeDefaultStudySession,
    });
    if (!outcome.ok) throw new Error('expected a composed session');

    expect(composerCalls).toBe(0);
    expect(outcome.itemCount).toBe(ids.length);
  });

  it('opening with the holder idle composes once, through the real study-session composer, and enters the result', async () => {
    const vault = configuredStudyVault();
    const holder = createStudySessionHolder();
    expect(holder.getSitting().status).toBe('idle');
    let composerCalls = 0;
    const composeDefaultStudySession = async (): Promise<ComposedStudySession | null> => {
      composerCalls += 1;
      return realComposeDefaultStudySession(vault)();
    };

    const outcome = await openReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(vault).ports,
      random: fixedRandom,
      probeDays: 30,
      studySessionHolder: holder,
      composeDefaultStudySession,
    });
    if (!outcome.ok) throw new Error('expected a composed session');

    // Exactly once — never more than the one composer call for this open —
    // and the holder now holds what it composed rather than sitting idle.
    expect(composerCalls).toBe(1);
    expect(holder.getSitting().status).toBe('active');
    expect(outcome.itemCount).toBeGreaterThan(0);
  });

  it('is not rebuilt mid-session: a second open() over the same holder never calls the composer again', async () => {
    const vault = configuredStudyVault();
    const holder = createStudySessionHolder();
    let composerCalls = 0;
    const composeDefaultStudySession = async (): Promise<ComposedStudySession | null> => {
      composerCalls += 1;
      return realComposeDefaultStudySession(vault)();
    };
    const input = (): OpenReviewSessionInput => ({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(vault).ports,
      random: fixedRandom,
      probeDays: 30,
      studySessionHolder: holder,
      composeDefaultStudySession,
    });

    const first = await openReviewSession(input());
    if (!first.ok) throw new Error('expected a composed session');
    expect(composerCalls).toBe(1);

    const second = await openReviewSession(input());
    if (!second.ok) throw new Error('expected a composed session');

    // Still just the one call from the first open — the holder was already
    // active, so this read it verbatim, and the rows/order/content match.
    expect(composerCalls).toBe(1);
    expect(second.itemCount).toBe(first.itemCount);
    expect(second.scheduledQueue.map((item) => item.instrument.instrumentId)).toEqual(
      first.scheduledQueue.map((item) => item.instrument.instrumentId),
    );
  });
});

// Scenario: `features/F2-review.md` (olea-service), "Feature: F2.21 wiring" —
// "the proposal is evaluated after a grade, for the concept just reviewed"
// (@auto:plugin/review/session.spec covers the session half; this is the
// composition half: that `openReviewSession` actually wires the reader, which
// is the production caller F2.21's decision module had none of).
describe('F2.21 — the strong-recall proposal is composed into every opened session (ol-v7r5.40)', () => {
  /** Four distinct successful days on ONE instrument for Alpha, through the real writer. */
  async function seedStrongRecall(vault: ReturnType<typeof memoryVault>): Promise<void> {
    const days = ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
    for (const [index, day] of days.entries()) {
      await appendReviewLogRecord(
        vault,
        {
          timestamp: `${day}T09:00:00-04:00`,
          instrumentId: 'seed-alpha-strong',
          instrumentType: 'qa',
          conceptIds: [unboundKey('Alpha')],
          rating: 'good',
          wasUnsure: false,
          durationMs: null,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
        },
        { deviceId: DEVICE, generateEventId: () => `seed-alpha-strong-${index}` },
      );
    }
  }

  it('grading an item on a strongly-recalled, never-explained concept raises the offer — no stub anywhere in the chain', async () => {
    const vault = studyVault();
    await seedStrongRecall(vault);

    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    const { session } = outcome;
    await session.start();

    // Drive to the Alpha item, whichever position the composition gave it.
    let offer = session.getStrongRecallOffer();
    for (let guard = 0; guard < 8 && offer === null; guard += 1) {
      const vm = session.getViewModel();
      if (vm.phase === 'complete' || vm.phase === 'empty') break;
      await advancePastCurrentItem(session);
      offer = session.getStrongRecallOffer();
    }

    expect(offer, 'expected the strong-recall proposal to reach the session').not.toBeNull();
    expect(offer?.conceptId).toBe(unboundKey('Alpha'));
    expect(offer?.promptText).toContain('explain it back');
  });

  it('a concept with no history at all raises nothing — the trigger is evidence-led, never a default', async () => {
    const vault = studyVault();

    const outcome = await open(vault);
    if (!outcome.ok) throw new Error('expected a composed session');
    const { session } = outcome;
    await session.start();

    for (let guard = 0; guard < 8; guard += 1) {
      const vm = session.getViewModel();
      if (vm.phase === 'complete' || vm.phase === 'empty') break;
      await advancePastCurrentItem(session);
      expect(session.getStrongRecallOffer()).toBeNull();
    }
  });

  it('never changes what is composed — the queue an opened session holds is identical with and without the seeded strong-recall history', async () => {
    const plain = await open(studyVault());
    const seeded = studyVault();
    await seedStrongRecall(seeded);
    const withHistory = await open(seeded);
    if (!plain.ok || !withHistory.ok) throw new Error('expected two composed sessions');

    // F2.21: "never through queue composition." The proposal rides on top of
    // the same queue; it does not add, remove or reorder an item.
    expect(withHistory.scheduledQueue.map((item) => item.instrument.instrumentId).sort()).toEqual(
      plain.scheduledQueue.map((item) => item.instrument.instrumentId).sort(),
    );
  });
});
