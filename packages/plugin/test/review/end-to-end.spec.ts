// PERMANENT SUITE — the whole review loop, end to end, over a real filesystem.
//
// Scenarios: `features/F2-review.md` (F2.2, F2.14, F2.16), `features/F6-today.md`
// (F6.1, and the `[SESS-12]` Feature blocks at the end of that file — "the count
// she reads is the session she is served, and repeated sessions converge") —
// @auto:plugin/review/end-to-end.spec
//
// Every other suite in this package proves one join. `open-session.spec.ts`
// drives the real composition but over a hand-written in-memory vault;
// `core/test/session/fixture-vault.spec.ts` drives the real corpus but stops at
// the composed queue and never rates anything. Neither can fail on the thing
// this one is here for: that the loop *closes*. Compose from a vault on disk,
// rate real items through the real ports, and then read the vault again with a
// fresh reader and find the session she just did reflected in it.
//
// **`[SESS-12]` (`ol-egov.132.13`): what this suite's END STATE now is.** Until
// `[SESS-8]` landed, the narrative here was a drain: drive the review tab until
// the vault's due set reaches zero. That was `composeQueue`'s mechanism — a
// strict scheduler-due FIFO — and the review tab no longer runs it. It opens
// over the one `SittingState<ComposedStudySession>` holder, composing through
// the study-session composer when that holder is idle
// (`docs/dev/one-assembly-path.md` §3a–§3c). That composer **fills C5.5's time
// budget with worth-doing material**; SESS-2's baseline/elective obligation
// classes deliberately choose a concept ahead of its own scheduler due day
// (`packages/core/src/session/build.ts`'s `composedDueState` doc: "'early'
// rather than excluding the instrument"). So a composed session over a vault
// with material in it **never empties**, and the honest end state to assert is
// *convergence*: the composed set reaches a fixed point, and what she has
// retrieved stops being counted as new. Every assertion below that used to read
// "drained" now reads "converged", and the three that could not be stated
// honestly at all under this composer were deleted rather than weakened — the
// bead carries which, and why.
//
// Four claims, and each is the reason a different failure would be invisible:
//
//  1. **The Today panel, the holder and the queue are one number.** F6.1's
//     `@manual` scenario is "the count she reads is the session she gets". It is
//     now true by construction rather than by two callers agreeing on a probe
//     window — Today, Home and the review tab all read one composition — and
//     this is where that construction is checked over one real directory,
//     against one shared holder.
//  2. **Every format survives being rated.** Q&A, cloze and MCQ take three
//     different paths through `ReviewSession` (front/reveal/rate vs.
//     mcq-open/answer/next) and three different rating mappings. A loop that
//     only ever reached Q&A would pass while MCQ was broken.
//  3. **The write round-trips (D7.1 / INV-4).** The records are read back with a
//     *new* `FolderSource` and the *real* `parseReviewLog`, then fed back into
//     the Today panel and the study-session composer — a later session composes
//     a different set *because* the earlier one was logged. Logging is the one thing in this
//     product that cannot be reconstructed after the fact, so "we called the
//     port" is not the assertion — "a later reader finds it" is.
//  4. **Her notes are byte-identical afterwards (INV-2).** Every file in the
//     vault is hashed before and after. The review loop may add review-log
//     files under `.olea/`; it may not touch one byte of anything she wrote.
//     This is also the end-to-end guard on D-030's "nothing stamps ids" claim:
//     provisional instrument identity is derived at read time, and if any part
//     of the pipeline ever started persisting an `id:` into her markdown to
//     stabilise it, this test is what would fail.
//
// The vault is copied to a temp directory first, so the committed fixtures are
// never the thing being written to. `OLEA_E2E_TMPDIR` overrides the parent
// directory for sandboxes whose `os.tmpdir()` is not writable.

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstrumentType, Rating } from 'olea-contracts';
import type { RandomSource, VaultPath } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  FolderSource,
  parseReviewLog,
  reviewLogPath,
} from 'olea-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  STUDY_PLAN_SETTINGS_STORAGE_KEY,
} from '../../src/plan/settings-store.js';
import { openReviewSession, type ReviewSessionPorts } from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  type EditPort,
  type ReviewLogPort,
  type SuspendPort,
} from '../../src/review/ports.js';
import type { ReviewSession } from '../../src/review/session.js';
import { createStudySessionHolder, type StudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { createVaultInstrumentSource, loadTodayPanel } from '../../src/today/data-source.js';

const here = dirname(fileURLToPath(import.meta.url));
/** `packages/plugin/test/review` -> `packages/core/fixtures/vault`. */
const FIXTURE_VAULT = join(here, '..', '..', '..', 'core', 'fixtures', 'vault');

const DEVICE = 'olea-e2e-device';

/**
 * The vault's own index documents the card separators it documents, so
 * `parseCards` reads cards out of its prose. Excluded by name exactly as
 * `core/test/session/fixture-vault.spec.ts` and
 * `core/test/instrument/vault-instruments.spec.ts` exclude it. It carries no
 * frontmatter, so those cards are `unbound` and never reach the queue anyway —
 * excluding it from the panel's walk keeps the two halves counting the same set
 * rather than relying on that.
 */
const NOT_A_FIXTURE_NOTE: readonly VaultPath[] = ['README.md'];

/**
 * Real wall-clock, read once and then frozen for the whole suite.
 *
 * Not a fixed literal date, and that is deliberate: `createVaultReviewLogPort`
 * timestamps each record from `new Date()` at write time (its doc says why —
 * the log records when the event happened), which also decides which daily file
 * it lands in. A frozen 2026 date in the panel and a real date in the log would
 * make the round-trip assert across two different days, and the "streak now
 * shows today" claim would be untestable. One instant for both keeps the
 * session self-consistent.
 */
const NOW = new Date();
const TODAY = calendarDayFromLocalDate(NOW);
const clock: Clock = { now: () => NOW };

/**
 * `[SESS-8.4]` (`ol-egov.132.4`): the fixture vault's own real `.base` file —
 * `packages/core/fixtures/vault/02 Assignments/Assignments.base`, the exact
 * path `session-builder/provider.spec.ts`'s own `BASE_PATH` fixture already
 * configures for the identical file. The study-session composer this suite
 * now opens the review tab over (see `composeDefaultStudySession` below)
 * needs assignments configured to run at all — the same
 * `isStudyPlanConfigured` gate Home and the session builder already apply.
 */
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';

/** A minimal, in-memory `ObsidianDataHost` pre-loaded with the fixture's own assignments path — same pattern `session-builder/provider.spec.ts`'s `FakeDataHost` uses. */
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

/**
 * `[SESS-8.4]` (design note §3c): the port a real plugin's `main.ts` wires —
 * composes through the SAME assembly Home and the session builder use
 * (`composeStudySessionForRequest`), no steering, C5.5's default budget.
 * Called only when a call's own fresh `studySessionHolder` (below) is idle,
 * which is every round here: each `compose()`/`composeCapturingLog()` call
 * is a fresh, unrelated "opening the tab" the same way a real Obsidian
 * restart between sessions would be, so a fresh holder per call is the
 * honest fixture, never one shared and re-entered across rounds.
 */
function composeDefaultStudySession(source: FolderSource) {
  return async () => {
    const result = await composeStudySessionForRequest(
      {
        vault: source,
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

/** Deterministic PRNG (mulberry32), so MCQ option sampling is reproducible. */
function seeded(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Every file under `root`, dotfiles included, as vault-relative POSIX paths. */
async function walkAll(root: string, base: string = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walkAll(absolute, base)));
    else if (entry.isFile()) out.push(relative(base, absolute).split(sep).join(posix.sep));
  }
  return out.sort();
}

/** path -> sha256 of the exact bytes. Byte hashes, not string comparison: a
 * line-ending or BOM change has to be able to fail this. */
async function digestVault(root: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const path of await walkAll(root)) {
    digests.set(
      path,
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
    );
  }
  return digests;
}

let vaultRoot: string;
let before: Map<string, string>;

function vault(): FolderSource {
  return new FolderSource(vaultRoot);
}

/**
 * The panel as production builds it (`[SESS-8.5]`, `ol-egov.132.5`): the
 * composed-session path, reading the SAME holder and the SAME default-budget
 * composer port the review tab opens over. `main.ts` supplies both fields; a
 * source built without them keeps the legacy `buildReviewSession` walk, which
 * is what {@link enumeratedDuePanel} below is for.
 *
 * `holder` is a parameter rather than a fresh one per call because the F6.1
 * claim is about ONE holder read by two surfaces — see the agreement test.
 * Called with no argument, it is a fresh idle holder, which is the "she opens
 * Obsidian and glances at Today" case.
 */
function todayPanel(holder: StudySessionHolder = createStudySessionHolder()) {
  const source = vault();
  return loadTodayPanel({
    vault: source,
    deviceId: DEVICE,
    now: () => NOW,
    instruments: createVaultInstrumentSource({
      vault: source,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now: () => NOW,
      excludePaths: NOT_A_FIXTURE_NOTE,
      studySessionHolder: holder,
      composeDefaultStudySession: composeDefaultStudySession(source),
    }),
  });
}

/**
 * The same panel over the LEGACY instrument source — no holder, no composer
 * port, so `createVaultInstrumentSource` runs its own `buildReviewSession`
 * walk and counts every schedulable instrument the vault enumerates.
 *
 * Not a second production path, and deliberately not deleted with the drain
 * narrative: it is the DENOMINATOR. "The composed session holds 8 items" says
 * nothing on its own — 8 could be everything there is. Read beside the
 * enumeration's own count it says what `[SESS-12]` is about: the session she is
 * served is a *choice* out of a larger due set, at a budget, and not the whole
 * of it.
 */
function enumeratedDuePanel() {
  const source = vault();
  return loadTodayPanel({
    vault: source,
    deviceId: DEVICE,
    now: () => NOW,
    instruments: createVaultInstrumentSource({
      vault: source,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now: () => NOW,
      excludePaths: NOT_A_FIXTURE_NOTE,
    }),
  });
}

/** One D7.1 write, captured in call order — see `ports()`'s `logged`. */
interface LoggedReview {
  readonly instrumentId: string;
  readonly rating: Rating;
  readonly sourcePath: VaultPath;
}

/**
 * The real ports, over the real vault. `suspend`/`edit` are recorders —
 * this session neither suspends nor edits, and a throwing stub would hide it
 * if it did. `reviewLog` wraps the real, vault-writing port to ALSO capture
 * exactly what was passed to `recordReview`, in call order — `ol-2zfj.53`'s
 * first-sight stamping trigger means the id a session held while she was
 * looking at an item (what `driveToCompletion` reads off `getViewModel()`,
 * before `rate`/`mcqNext` runs) and the id that write actually persists
 * under can now differ, for exactly the item that got stamped THIS review.
 * `logged` is the ground truth for "what actually reached the log," rather
 * than re-deriving it from the pre-stamp view.
 */
function ports(): {
  readonly ports: ReviewSessionPorts;
  readonly touched: string[];
  readonly logged: LoggedReview[];
} {
  const touched: string[] = [];
  const logged: LoggedReview[] = [];
  const source = vault();
  const realReviewLog = createVaultReviewLogPort(source, DEVICE);
  const reviewLog: ReviewLogPort = {
    async recordReview(input) {
      logged.push({
        instrumentId: input.instrument.instrumentId,
        rating: input.rating,
        sourcePath: input.instrument.sourcePath,
      });
      await realReviewLog.recordReview(input);
    },
  };
  const suspendPort: SuspendPort = {
    async suspend(id) {
      touched.push(`suspend:${id}`);
    },
  };
  const editPort: EditPort = {
    async edit(instrument) {
      touched.push(`edit:${instrument.sourcePath}`);
    },
  };
  return {
    touched,
    logged,
    ports: {
      reviewLog,
      suspendPort,
      editPort,
      noteExists: createVaultNoteExistsPort(source),
      clock,
      // `ol-p3t07a`: this suite never composes a queue with a pending draft
      // item — see `review/session.spec.ts` and `generation/*.spec.ts` for
      // that coverage.
      draftAcceptPort: {
        accept() {
          throw new Error('end-to-end.spec: no draft item in this suite should call accept');
        },
        reject() {
          throw new Error('end-to-end.spec: no draft item in this suite should call reject');
        },
      },
    },
  };
}

function compose(holder: StudySessionHolder = createStudySessionHolder()) {
  const source = vault();
  return openReviewSession({
    vault: source,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports().ports,
    random: seeded(20260814),
    studySessionHolder: holder,
    composeDefaultStudySession: composeDefaultStudySession(source),
  });
}

/**
 * Like `compose()`, but also hands back the `logged` array `driveToCompletion`
 * will fill as it drives the returned session — the only caller that needs
 * to see what was actually written, not just whether the session opened.
 */
function composeCapturingLog(): {
  readonly outcome: ReturnType<typeof openReviewSession>;
  readonly logged: readonly LoggedReview[];
} {
  const { ports: wired, logged } = ports();
  const source = vault();
  return {
    outcome: openReviewSession({
      vault: source,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: wired,
      random: seeded(20260814),
      studySessionHolder: createStudySessionHolder(),
      composeDefaultStudySession: composeDefaultStudySession(source),
    }),
    logged,
  };
}

interface RatedItem {
  readonly instrumentId: string;
  readonly type: InstrumentType;
  readonly rating: Rating;
  /** Which sitting rated it — see `SESSIONS` below. */
  readonly round: number;
}

/**
 * Drives one session to `complete`, taking whichever path each phase requires,
 * and reports what it rated. Everything is rated Good — the one rating that is
 * legal for all three formats (F2.16 caps MCQ at Good) and that pushes the next
 * scheduler due day past the end of today. `[SESS-12]`: that is what makes the
 * CONVERGENCE claim below mean something — a Good on every item is the
 * strongest case against "the composer only ever re-offers because nothing was
 * answered well", and the composer still fills the next session's budget.
 */
async function driveToCompletion(session: ReviewSession, round: number): Promise<RatedItem[]> {
  const rated: RatedItem[] = [];
  await session.start();

  // Bounded so a state machine that stopped advancing fails as a test failure
  // rather than as a hung suite.
  for (let guard = 0; guard < 200; guard += 1) {
    const view = session.getViewModel();
    if (view.phase === 'complete' || view.phase === 'empty') return rated;

    switch (view.phase) {
      case 'front':
        session.reveal();
        break;
      case 'reveal': {
        // The preview she is shown before she commits — four ratings, always.
        expect(view.ratingPreviews.map((preview) => preview.rating)).toEqual([
          'again',
          'hard',
          'good',
          'easy',
        ]);
        rated.push({
          instrumentId: view.instrument.instrumentId,
          type: view.instrument.type,
          rating: 'good',
          round,
        });
        await session.rate('good');
        break;
      }
      case 'mcq-open': {
        const correct = view.instrument.options.findIndex((option) => option.correct);
        expect(correct).toBeGreaterThanOrEqual(0);
        await session.mcqAnswer(correct);
        break;
      }
      case 'mcq-answered': {
        // Correct and not guessed maps to Good — F2.16's cap, applied by
        // `mapMcqRating` in core, not re-derived here.
        expect(view.intervalLabel).not.toBe('');
        rated.push({
          instrumentId: view.instrument.instrumentId,
          type: 'mcq',
          rating: 'good',
          round,
        });
        await session.mcqNext();
        break;
      }
      case 'note-missing':
        throw new Error(`the fixture vault lost a note mid-session: ${view.instrument.sourcePath}`);
      case 'loading':
        throw new Error('ReviewSession stayed in `loading` after start()');
    }
  }
  throw new Error('ReviewSession never reached `complete` — the queue did not advance');
}

beforeAll(async () => {
  const parent = process.env.OLEA_E2E_TMPDIR ?? tmpdir();
  vaultRoot = await mkdtemp(join(parent, 'olea-review-e2e-'));
  await cp(FIXTURE_VAULT, vaultRoot, { recursive: true });
  before = await digestVault(vaultRoot);
});

afterAll(async () => {
  if (vaultRoot !== undefined) await rm(vaultRoot, { recursive: true, force: true });
});

/**
 * Consecutive sessions against the one vault on disk, driven once and shared by
 * every assertion below. Split across `it`s for readable failures; run once
 * because the whole point is that these are claims about *the same* passes over
 * *the same* vault.
 *
 * **Why more than one session, and what the number is chosen against.** Each
 * round is a fresh `openReviewSession` over the same directory with a fresh,
 * idle holder — a real Obsidian restart between sessions — so every round after
 * the first is *also* a round-trip: it re-reads the log the previous round
 * wrote, replays it, and composes from it. `[SESS-12]`: what that produces is
 * not a drain but a **fixed point**. Measured over this fixture vault at C5.5's
 * default budget: round 1 and round 2 compose materially different sets (the log
 * reached the composer), and every round from the second on composes the
 * identical set. {@link ROUNDS} is four — one to establish, one to differ, and
 * two to show the set standing still — which is the smallest run that can fail
 * on either half of the claim.
 *
 * `deferredCount` is kept on the record because `openReviewSession` still
 * reports it, and is asserted to be zero: `executeStudyPlanOverComposedRows`
 * returns `deferred: []` unconditionally (`packages/core/src/plan/execute.ts`,
 * its own doc explains that a composed session's omission is a different shape
 * and is never restated as a `DeferredInstrument`). F2.17's arbitration did not
 * disappear — it moved INSIDE composition, as the per-concept cap in
 * `study-session/build.ts`'s fill — so it is no longer observable as a count
 * here, and the assertion that used to read `deferredCount >= 1` would now be
 * asserting a field that structurally cannot be non-zero.
 */
const ROUNDS = 4;

interface SessionRound {
  readonly composedCount: number;
  readonly deferredCount: number;
  readonly rated: readonly RatedItem[];
  /** What actually reached the vault this session — see `ports()`'s `logged` doc. */
  readonly logged: readonly LoggedReview[];
}

/** The distinct instruments one round composed, sorted — the unit of the convergence claim. */
function instrumentSet(round: SessionRound): string {
  return [...new Set(round.rated.map((item) => item.instrumentId))].sort().join('\n');
}

let firstPanel: Awaited<ReturnType<typeof todayPanel>>;
let enumeratedPanel: Awaited<ReturnType<typeof enumeratedDuePanel>>;
/** F6.1's agreement, captured on a pristine vault before anything is rated — see its own test. */
let agreement: {
  readonly panelWhileIdle: number;
  readonly reviewTabItemCount: number;
  readonly panelWhileActive: number;
  readonly holderStatusAfterOpening: string;
};
let rounds: SessionRound[];
let rated: RatedItem[];
/** Every D7.1 write across every sitting, in order — the durable ids, unlike `rated`'s pre-stamp view snapshot. */
let logged: LoggedReview[];

beforeAll(async () => {
  firstPanel = await todayPanel();
  enumeratedPanel = await enumeratedDuePanel();

  // F6.1, on the pristine vault and BEFORE anything is rated: one holder, read
  // by Today and then opened over by the review tab. Nothing here rates, starts
  // or writes — `openReviewSession` composes and enters the holder, which is
  // exactly the transition the claim is about. The holder is discarded
  // afterwards, so the rounds below still each open on an idle one.
  {
    const holder = createStudySessionHolder();
    const panelWhileIdle = await todayPanel(holder);
    const opened = await compose(holder);
    if (!opened.ok) throw opened.error;
    const panelWhileActive = await todayPanel(holder);
    agreement = {
      panelWhileIdle: panelWhileIdle.due?.total ?? -1,
      reviewTabItemCount: opened.itemCount,
      panelWhileActive: panelWhileActive.due?.total ?? -1,
      holderStatusAfterOpening: holder.getSitting().status,
    };
  }

  rounds = [];
  // Fixed, not bounded-by-a-guard: `[SESS-12]` — a composed session over a vault
  // with material in it does not reach zero, so "loop until it empties" is not a
  // terminating condition any more. `ROUNDS` is the claim's own shape.
  for (let round = 1; round <= ROUNDS; round += 1) {
    const { outcome, logged: roundLog } = composeCapturingLog();
    const opened = await outcome;
    if (!opened.ok) throw opened.error;
    if (opened.itemCount === 0) break;
    rounds.push({
      composedCount: opened.itemCount,
      deferredCount: opened.deferredCount,
      rated: await driveToCompletion(opened.session, round),
      logged: roundLog,
    });
  }
  rated = rounds.flatMap((round) => [...round.rated]);
  logged = rounds.flatMap((round) => [...round.logged]);
});

describe('the fixture vault, on disk, produces a real Today panel', () => {
  it('copied the committed fixtures rather than opening them', () => {
    expect(vaultRoot).not.toBe(FIXTURE_VAULT);
    expect(before.size).toBeGreaterThanOrEqual(50);
    expect(before.has('README.md')).toBe(true);
  });

  it('enumerates a real due set from disk — not a substitute zero', () => {
    // The legacy `buildReviewSession` walk, kept as the denominator (see
    // `enumeratedDuePanel`'s doc): what this vault actually has outstanding.
    expect(enumeratedPanel.due).not.toBeNull();
    const due = enumeratedPanel.due;
    if (due === null) throw new Error('unreachable');
    expect(due.total).toBeGreaterThanOrEqual(11);
    // Nothing has ever been reviewed in a freshly copied vault, so every due
    // instrument is new. `newCount` is a subset of `total`, never an addition.
    expect(due.newCount).toBe(due.total);
    expect(due.courses.length).toBe(2);
    expect(due.courses.reduce((sum, course) => sum + course.count, 0)).toBe(due.total);
  });

  // `features/F6-today.md` [SESS-12]: "the session she is served is a choice
  // from the due set, not the whole of it".
  it('counts the composed session she is actually served — a choice out of that due set, at a budget', () => {
    expect(firstPanel.due).not.toBeNull();
    const composed = firstPanel.due;
    const enumerated = enumeratedPanel.due;
    if (composed === null || enumerated === null) throw new Error('unreachable');

    // A real session, not an empty one and not a stand-in.
    expect(composed.total).toBeGreaterThanOrEqual(4);
    expect(composed.courses.reduce((sum, course) => sum + course.count, 0)).toBe(composed.total);
    // Nothing has been retrieved yet, so everything the composer chose is new.
    expect(composed.newCount).toBe(composed.total);

    // The point of `[SESS-12]`, stated as a comparison rather than a literal:
    // C5.5's default budget holds strictly less than the vault has outstanding,
    // and the composition narrows the courses it spends that budget on. If this
    // ever inverted, "the composed session is a budget-fill" would have stopped
    // being true and every convergence claim below would be vacuous.
    expect(composed.total).toBeLessThan(enumerated.total);
    expect(composed.courses.length).toBeLessThanOrEqual(enumerated.courses.length);
  });

  it('reports a streak of zero from a real, empty log — not a stub', () => {
    expect(firstPanel.streak.currentDays).toBe(0);
    expect(firstPanel.streak.studiedToday).toBe(false);
    expect(firstPanel.streak.week.length).toBeGreaterThan(0);
    expect(firstPanel.streak.week.some((day) => day.studied)).toBe(false);
  });
});

describe('complete passes through the real ReviewSession', () => {
  it('composed a session from the vault and rated every item it offered', () => {
    expect(rounds).toHaveLength(ROUNDS);
    const first = rounds[0];
    if (first === undefined) throw new Error('unreachable');
    expect(first.composedCount).toBeGreaterThanOrEqual(4);
    for (const round of rounds) {
      expect(round.rated).toHaveLength(round.composedCount);
      // `[SESS-12]`: `deferredCount` is structurally zero on this path —
      // `executeStudyPlanOverComposedRows` returns `deferred: []`
      // unconditionally. Asserted rather than dropped so that a future row
      // repopulating it has to come past this line and say so.
      expect(round.deferredCount).toBe(0);
    }
  });

  it('reached and rated at least one of each format', () => {
    // No longer a claim about deferral promoting a loser across sessions, as it
    // was under `composeQueue`: the composer's per-concept cap picks by
    // `[D-240]`'s serving rule inside one composition, and this fixture vault's
    // Q&A, cloze and MCQ all arrive within a single composed session. The
    // assertion is unchanged; only the reason it holds is.
    const types = new Set(rated.map((item) => item.type));
    expect(types.has('qa')).toBe(true);
    expect(types.has('cloze')).toBe(true);
    expect(types.has('mcq')).toBe(true);
  });

  // Replaces the deleted "drained the vault: nothing is left to offer".
  // `features/F6-today.md` [SESS-12]: "repeated sessions never empty the vault".
  it('never drains: after every item has been rated four sessions over, a fresh session is still full', async () => {
    const reopened = await compose();
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw reopened.error;
    expect(reopened.itemCount).toBeGreaterThanOrEqual(4);

    // And it is a real, sittable session — enumerated, not merely unreadable.
    await reopened.session.start();
    const view = reopened.session.getViewModel();
    expect(view.phase).not.toBe('empty');
    expect(view.phase).not.toBe('loading');
  });

  // `features/F6-today.md` [SESS-12]: "repeated sessions converge on a stable
  // set rather than growing without bound" + "rating a whole session reaches
  // the next session's composition".
  it('converges: the log reaches the next composition, and the composed set then stands still', () => {
    const sets = rounds.map(instrumentSet);
    const first = sets[0];
    const penultimate = sets[sets.length - 2];
    const last = sets[sets.length - 1];
    if (first === undefined || penultimate === undefined || last === undefined) {
      throw new Error('unreachable');
    }

    // Half one — the round trip. Rating every item of session 1 changes what
    // session 2 composes, and it can only have learnt that from the log on
    // disk: each round opens a fresh holder over a fresh `FolderSource`.
    expect(first).not.toBe(sets[1]);

    // Half two — the fixed point. By the end the composition has stopped
    // moving, which is what "converged" means here and is the assertion that
    // replaces "drained to zero".
    expect(last).toBe(penultimate);

    // Bounded, not growing: no session composes more than the first did.
    for (const round of rounds) {
      expect(round.composedCount).toBeLessThanOrEqual(rounds[0]?.composedCount ?? 0);
    }
  });

  // Replaces the deleted "offered each instrument exactly once across every
  // sitting". `features/F6-today.md` [SESS-12]: "one instrument is offered at
  // most once inside one session".
  it('offers each instrument at most once inside one session — F2.17 over a session, never across sessions', () => {
    for (const round of rounds) {
      const ids = round.rated.map((item) => item.instrumentId);
      expect(new Set(ids).size).toBe(ids.length);
    }

    // Stated positively, because the composer genuinely has no cross-session
    // suppression and a test asserting one would be asserting a rule that does
    // not exist: instruments DO recur across sessions, by design. Rating them
    // demotes their concept's obligation class (`classifyObligation`'s
    // elective branch, `overdueDays: 0`) — a ranking effect, not an exclusion —
    // so the budget is re-filled with the best of what is left.
    const everyId = rated.map((item) => item.instrumentId);
    expect(new Set(everyId).size).toBeLessThan(everyId.length);
  });

  // Re-enabled as an AGREEMENT: `[SESS-8.5]` (`ol-egov.132.5`) put Today on the
  // same holder the review tab opens over, so the two numbers that used to be
  // computed by different modules over different windows are now one number.
  // `features/F6-today.md` [SESS-12]: "the panel's count, the holder's session
  // and the review tab's queue agree, from one vault on disk".
  it('the count she read is the session she got (F6.1)', () => {
    expect(agreement.panelWhileIdle).toBeGreaterThanOrEqual(4);
    // Today read an idle holder and composed through the port; the review tab
    // then composed through the same port and ENTERED the holder.
    expect(agreement.reviewTabItemCount).toBe(agreement.panelWhileIdle);
    expect(agreement.holderStatusAfterOpening).toBe('active');
    // And read back with the session under way, Today counts the held session
    // itself rather than composing anything of its own.
    expect(agreement.panelWhileActive).toBe(agreement.reviewTabItemCount);
  });
});

describe('every rating reached the vault as a D7.1 record (INV-4)', () => {
  const logPath = () => reviewLogPath(TODAY, DEVICE);

  it('wrote this device`s daily log file, and only under `.olea/`', async () => {
    const after = await digestVault(vaultRoot);
    const added = [...after.keys()].filter((path) => !before.has(path));
    expect(added).toEqual([logPath()]);
  });

  it('round-trips through a fresh FolderSource and the real parser', async () => {
    const reader = new FolderSource(vaultRoot);
    expect(await reader.exists(logPath())).toBe(true);
    const parsed = parseReviewLog(await reader.read(logPath()));

    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(rated.length);

    const reviews = parsed.records.filter((record) => record.kind === 'review');
    expect(reviews).toHaveLength(rated.length);
    // Same instruments, same order, same ratings as the session actually
    // wrote — compared against `logged` (captured at the `recordReview`
    // call itself), never `rated` (the pre-`rate()`/`mcqNext()` view
    // snapshot): `ol-2zfj.53`'s first-sight stamping trigger means an
    // unstamped instrument's presented id and its logged id can now differ
    // for the one review that stamps it.
    expect(reviews.map((record) => record.instrumentId)).toEqual(
      logged.map((item) => item.instrumentId),
    );
    expect(reviews.map((record) => record.rating)).toEqual(logged.map((item) => item.rating));
  });

  // `features/F6-today.md` [SESS-12]: "the selection context's dueState is one
  // of the contract's four, and the composer's early choice is on record". The
  // hard-coded `'new'` this used to expect was `composeQueue`'s world, where
  // `'early'` was documented as deliberately unreachable. It is reachable now,
  // and asserting the real set — including that `'early'` genuinely occurs — is
  // the honest version of the same claim.
  it('carries the instrument type and the selection context on every record', async () => {
    const reader = new FolderSource(vaultRoot);
    const parsed = parseReviewLog(await reader.read(logPath()));
    const reviews = parsed.records.filter((record) => record.kind === 'review');

    for (const [index, record] of reviews.entries()) {
      // D7.1's non-sheddable fields. `toBeDefined` is not enough for the two
      // that are legitimately null in v1 — `null` is the *stated* value and an
      // omitted key is not the same record.
      expect(record.instrumentType).toBe(rated[index]?.type);
      expect(record.conceptIds.length).toBeGreaterThanOrEqual(1);
      for (const conceptId of record.conceptIds) expect(conceptId).not.toBe('');
      expect(record.eventId).toMatch(/[0-9a-f-]{36}/);
      expect(record.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(typeof record.wasUnsure).toBe('boolean');
      expect(record.timestamp).toMatch(/[+-]\d{2}:\d{2}$/);

      const context = record.selectionContext;
      // The contract's own enum (`olea-contracts`' `review-log.ts`), not a
      // re-derivation: whatever the composer chose, it must be sayable.
      expect(['due', 'overdue', 'early', 'new']).toContain(context.dueState);
      expect(Object.hasOwn(context, 'yieldRank')).toBe(true);
      expect(Object.hasOwn(context, 'examProximity')).toBe(true);
      expect(Object.hasOwn(context, 'planVersion')).toBe(true);
      // `ol-g6zg`: `selectionContext` never carries it — it moved onto the
      // record itself, beside `conceptIds`.
      expect(Object.hasOwn(context, 'masteryAtTime')).toBe(false);
      // `ol-rpr4`: C5.4's rollup is wired now, so every v4 record carries a
      // per-concept map naming exactly the record's own `conceptIds` — the
      // same agreement `reviewLogRecordV4`'s refinement enforces at write
      // time, re-checked here on what a fresh reader actually finds on disk.
      expect(Object.hasOwn(record, 'masteryAtTime')).toBe(true);
      expect(record.masteryAtTime?.attribution).toBe('per-concept');
      if (record.masteryAtTime?.attribution === 'per-concept') {
        expect(Object.keys(record.masteryAtTime.byConcept).sort()).toEqual(
          [...new Set(record.conceptIds)].sort(),
        );
      }
      expect(context.instrumentTypesOffered.length).toBeGreaterThanOrEqual(1);
      expect(context.instrumentTypesOffered).toContain(record.instrumentType);
    }

    // All three formats are on record, not just in the session's memory.
    expect(new Set(reviews.map((record) => record.instrumentType))).toEqual(
      new Set(['qa', 'cloze', 'mcq']),
    );

    // `[SESS-12]`, the claim the deleted `'new'` assertion was hiding: the
    // composer really does choose material ahead of its own scheduler due day,
    // and the record really does say so rather than mislabelling it `'due'`.
    // Both states occur in this run — `'new'` on the first session, `'early'`
    // once the log has given those instruments a scheduler state.
    const dueStates = new Set(reviews.map((record) => record.selectionContext.dueState));
    expect(dueStates.has('new')).toBe(true);
    expect(dueStates.has('early')).toBe(true);
  });
});

// Re-enabled as AGREEMENTS. Both assertions below used to compare the panel's
// `composeQueue`-driven count against a composer-driven loop, which disagreed
// by construction; `[SESS-8.5]` (`ol-egov.132.5`) put Today on the same holder,
// so the panel here is the production one and the comparison is between two
// reads of one composition. What changed is the SHAPE of the claim, not its
// subject: a composed session does not shrink as she works — what changes is
// that the work is no longer new. `features/F6-today.md` [SESS-12].
describe('re-reading the same vault shows the session that happened', () => {
  it('the Today panel counts nothing as new any more, and the session is still full', async () => {
    const second = await todayPanel();
    expect(second.due).not.toBeNull();
    const due = second.due;
    const first = firstPanel.due;
    if (due === null || first === null) throw new Error('unreachable');

    // Before: everything the composer chose had never been retrieved.
    expect(first.newCount).toBe(first.total);
    // After: nothing has. `newCount` is read off the composed item's
    // `obligationClass === 'unmet'` (`today/data-source.ts`'s
    // `dueInstrumentsFromComposition`), which is the same fact "never
    // reviewed" always meant, at concept scale.
    expect(due.newCount).toBe(0);

    // And the headline did not fall — C5.5's budget is still filled. This is
    // the assertion that used to read `first.total - rated.length`, and the
    // single line that most concisely says what `[SESS-12]` found.
    expect(due.total).toBeGreaterThanOrEqual(first.total);
  });

  it('the log she just wrote is what a fresh read finds', async () => {
    const second = await todayPanel();
    expect(second.streak.studiedToday).toBe(true);
    expect(second.streak.currentDays).toBe(1);
    expect(second.streak.week.some((day) => day.studied)).toBe(true);
  });
});

/**
 * `old` survives, byte-for-byte and in order, somewhere inside `updated` —
 * i.e. every change from `old` to `updated` is an INSERTION, never a
 * deletion or a rewrite of a byte that was already there. This is the
 * generic form of the proof `stampMcqId`/`stampQaCardBlockId`/`stampClozeId`
 * each already carry precisely (`removeSpans` on the exact `insertedSpan`,
 * unit-tested in `packages/plugin/test/instrument-stamping/port.spec.ts`
 * and in `olea-core`'s own format specs); this end-to-end suite does not
 * know each file's exact inserted span, only that whatever changed must
 * still contain the original text intact, so a subsequence check is the
 * right-weight tool here — the byte-exact version is already proven at the
 * unit level.
 */
function isPureInsertion(old: string, updated: string): boolean {
  let i = 0;
  for (let j = 0; j < updated.length && i < old.length; j += 1) {
    if (updated[j] === old[i]) i += 1;
  }
  return i === old.length;
}

describe('INV-2 — every write to her notes is an addition, never a mutation (D-030/D-177)', () => {
  it('no file was removed, and every CHANGED file corresponds to a review this run actually logged against it', async () => {
    const after = await digestVault(vaultRoot);
    const changed: string[] = [];
    const removed: string[] = [];
    for (const [path, digest] of before) {
      const now = after.get(path);
      if (now === undefined) removed.push(path);
      else if (now !== digest) changed.push(path);
    }
    expect(removed).toEqual([]);

    // `ol-2zfj.53`'s first-sight stamping trigger is expected to touch her
    // notes now — the narrower, more legible claim this test replaces
    // ("stamped no instrument ids into her markdown (D-030)") pre-dates that
    // decision. What still must hold: nothing changes a file she has no
    // logged review against.
    const reviewedPaths = new Set(logged.map((item) => item.sourcePath));
    for (const path of changed) {
      expect(reviewedPaths.has(path)).toBe(true);
    }
    // The mechanism actually fired against this fixture vault — otherwise
    // this test would trivially pass on an empty `changed` list.
    expect(changed.length).toBeGreaterThan(0);
  });

  it('every changed note still contains her original text, untouched and in order — the change is a durable-id insertion, nothing else', async () => {
    const after = await digestVault(vaultRoot);
    const changed = [...before.keys()].filter((path) => after.get(path) !== before.get(path));
    expect(changed.length).toBeGreaterThan(0);

    for (const path of changed) {
      // `FIXTURE_VAULT` is never written to (only `vaultRoot`, the copy) —
      // it is still the pristine original to compare against.
      const original = await readFile(join(FIXTURE_VAULT, path), 'utf8');
      const updated = await readFile(join(vaultRoot, path), 'utf8');
      expect(updated.length).toBeGreaterThan(original.length);
      expect(isPureInsertion(original, updated)).toBe(true);
    }
  });
});
