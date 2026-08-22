// PERMANENT SUITE — the whole review loop, end to end, over a real filesystem.
//
// Scenarios: `features/F2-review.md` (F2.2, F2.14, F2.16), `features/F6-today.md`
// (F6.1) — @auto:plugin/review/end-to-end.spec
//
// Every other suite in this package proves one join. `open-session.spec.ts`
// drives the real composition but over a hand-written in-memory vault;
// `core/test/session/fixture-vault.spec.ts` drives the real corpus but stops at
// the composed queue and never rates anything. Neither can fail on the thing
// this one is here for: that the loop *closes*. Compose from a vault on disk,
// rate real items through the real ports, and then read the vault again with a
// fresh reader and find the session she just did reflected in it.
//
// Four claims, and each is the reason a different failure would be invisible:
//
//  1. **The Today panel and the queue agree, from the same disk.** F6.1's
//     `@manual` scenario is "the count she reads is the session she gets", and
//     the two are computed by different modules over different windows. Here
//     both read one `FolderSource` over one temp vault.
//  2. **Every format survives being rated.** Q&A, cloze and MCQ take three
//     different paths through `ReviewSession` (front/reveal/rate vs.
//     mcq-open/answer/next) and three different rating mappings. A loop that
//     only ever reached Q&A would pass while MCQ was broken.
//  3. **The write round-trips (D7.1 / INV-4).** The records are read back with a
//     *new* `FolderSource` and the *real* `parseReviewLog`, then fed back into
//     the Today panel and the queue composer. Logging is the one thing in this
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
import { openReviewSession, type ReviewSessionPorts } from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  type EditPort,
  type SuspendPort,
} from '../../src/review/ports.js';
import type { ReviewSession } from '../../src/review/session.js';
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

function todayPanel() {
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

/** The real ports, over the real vault. Only `suspend`/`edit` are recorders —
 * this session neither suspends nor edits, and a throwing stub would hide it if
 * it did. */
function ports(): { readonly ports: ReviewSessionPorts; readonly touched: string[] } {
  const touched: string[] = [];
  const source = vault();
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
    ports: {
      reviewLog: createVaultReviewLogPort(source, DEVICE),
      suspendPort,
      editPort,
      noteExists: createVaultNoteExistsPort(source),
      clock,
    },
  };
}

function compose() {
  return openReviewSession({
    vault: vault(),
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports().ports,
    random: seeded(20260814),
  });
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
 * due date past the end of today, which is what makes the "no longer offered"
 * assertion below mean something.
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
        session.mcqAnswer(correct);
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
 * Consecutive sittings against the one vault on disk, driven once and shared by
 * every assertion below. Split across `it`s for readable failures; run once
 * because the whole point is that these are claims about *the same* passes over
 * *the same* vault.
 *
 * **Why more than one sitting, and why that is the honest shape.** F2.17's
 * per-session dedupe offers at most one instrument per concept, and the fixture
 * vault's clozes all sit on concepts that a Q&A or an MCQ already occupies — so
 * a single pass through the production path *cannot* reach a cloze, and a test
 * that forced one would have to reach past `openReviewSession` for
 * `buildReviewSession`'s `formatPreference`, which the plugin never sets. Rating
 * the winner is exactly what promotes the deferred instrument to the next
 * sitting, so the second and third sittings are where cloze arrives — by the
 * mechanism, not by a switch. Each sitting is a fresh `openReviewSession` over
 * the same directory, so every round after the first is *also* a round-trip: it
 * re-reads the log the previous round wrote, replays it, and composes from it.
 */
interface Sitting {
  readonly composedCount: number;
  readonly deferredCount: number;
  readonly rated: readonly RatedItem[];
}

let firstPanel: Awaited<ReturnType<typeof todayPanel>>;
let sittings: Sitting[];
let rated: RatedItem[];

beforeAll(async () => {
  firstPanel = await todayPanel();

  sittings = [];
  // Bounded: 13 instruments and at least one per sitting, so anything past this
  // is a queue that stopped draining, which must fail rather than spin.
  for (let round = 1; round <= 15; round += 1) {
    const opened = await compose();
    if (!opened.ok) throw opened.error;
    if (opened.itemCount === 0) break;
    sittings.push({
      composedCount: opened.itemCount,
      deferredCount: opened.deferredCount,
      rated: await driveToCompletion(opened.session, round),
    });
  }
  rated = sittings.flatMap((sitting) => [...sitting.rated]);
});

describe('the fixture vault, on disk, produces a real Today panel', () => {
  it('copied the committed fixtures rather than opening them', () => {
    expect(vaultRoot).not.toBe(FIXTURE_VAULT);
    expect(before.size).toBeGreaterThanOrEqual(50);
    expect(before.has('README.md')).toBe(true);
  });

  it('counts a due set it actually enumerated — not a substitute zero', () => {
    expect(firstPanel.due).not.toBeNull();
    const due = firstPanel.due;
    if (due === null) throw new Error('unreachable');
    expect(due.total).toBeGreaterThanOrEqual(11);
    // Nothing has ever been reviewed in a freshly copied vault, so every due
    // instrument is new. `newCount` is a subset of `total`, never an addition.
    expect(due.newCount).toBe(due.total);
    expect(due.courses.length).toBe(2);
    expect(due.courses.reduce((sum, course) => sum + course.count, 0)).toBe(due.total);
  });

  it('reports a streak of zero from a real, empty log — not a stub', () => {
    expect(firstPanel.streak.currentDays).toBe(0);
    expect(firstPanel.streak.studiedToday).toBe(false);
    expect(firstPanel.streak.week.length).toBeGreaterThan(0);
    expect(firstPanel.streak.week.some((day) => day.studied)).toBe(false);
  });
});

describe('complete passes through the real ReviewSession', () => {
  it('composed a queue from the vault and rated every item it offered', () => {
    expect(sittings.length).toBeGreaterThanOrEqual(2);
    const first = sittings[0];
    if (first === undefined) throw new Error('unreachable');
    expect(first.composedCount).toBeGreaterThanOrEqual(4);
    // F2.17: the first sitting really did defer instruments, so the sittings
    // after it are not testing an empty mechanism.
    expect(first.deferredCount).toBeGreaterThanOrEqual(1);
    for (const sitting of sittings) {
      expect(sitting.rated).toHaveLength(sitting.composedCount);
    }
  });

  it('reached and rated at least one of each format', () => {
    const types = new Set(rated.map((item) => item.type));
    expect(types.has('qa')).toBe(true);
    expect(types.has('cloze')).toBe(true);
    expect(types.has('mcq')).toBe(true);
  });

  it('drained the vault: nothing is left to offer', async () => {
    const drained = await compose();
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw drained.error;
    expect(drained.itemCount).toBe(0);
    expect(drained.deferredCount).toBe(0);

    // The empty screen is a claim, and it is allowed to make it here: the queue
    // was enumerated, not merely unreadable.
    await drained.session.start();
    const view = drained.session.getViewModel();
    expect(view.phase).toBe('empty');
    if (view.phase !== 'empty') throw new Error('unreachable');
    expect(view.nextDueLabel).not.toBeNull();
  });

  it('offered each instrument exactly once across every sitting', () => {
    const ids = rated.map((item) => item.instrumentId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  it('the count she read is the session she got (F6.1)', () => {
    // The Today panel's headline and the queue are computed by different
    // modules over different windows. Draining the vault is what makes them
    // comparable as one number: everything the panel counted as due today is
    // exactly what the sittings went on to offer her, no more and no less.
    expect(firstPanel.due?.total).toBe(rated.length);
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
    // Same instruments, same order, same ratings as the session actually gave.
    expect(reviews.map((record) => record.instrumentId)).toEqual(
      rated.map((item) => item.instrumentId),
    );
    expect(reviews.map((record) => record.rating)).toEqual(rated.map((item) => item.rating));
  });

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
      expect(context.dueState).toBe('new');
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
  });
});

describe('re-reading the same vault shows the session that happened', () => {
  it('the Today panel now counts fewer new items and a streak of one', async () => {
    const second = await todayPanel();
    expect(second.due).not.toBeNull();
    const due = second.due;
    const first = firstPanel.due;
    if (due === null || first === null) throw new Error('unreachable');

    expect(due.newCount).toBe(first.newCount - rated.length);
    expect(due.total).toBe(first.total - rated.length);

    expect(second.streak.studiedToday).toBe(true);
    expect(second.streak.currentDays).toBe(1);
  });

  it('each sitting stops offering what the sitting before it rated', async () => {
    // The promotion mechanism, stated directly: every instrument a later
    // sitting offered was deferred by an earlier one, and no instrument is
    // ever offered twice. Composed fresh each time from the log on disk, so
    // this is the replay working, not a working set carried in memory.
    const seen = new Set<string>();
    for (const sitting of sittings) {
      for (const item of sitting.rated) {
        expect(seen.has(item.instrumentId)).toBe(false);
        seen.add(item.instrumentId);
      }
    }
    expect(sittings.length).toBeGreaterThanOrEqual(2);

    // And after the last one, a fresh composition offers none of them.
    const reopened = await compose();
    if (!reopened.ok) throw reopened.error;
    expect(reopened.itemCount).toBe(0);
  });
});

describe('INV-2 — the review loop wrote nothing to her notes', () => {
  it('leaves every pre-existing file byte-identical', async () => {
    const after = await digestVault(vaultRoot);
    const changed: string[] = [];
    const removed: string[] = [];
    for (const [path, digest] of before) {
      const now = after.get(path);
      if (now === undefined) removed.push(path);
      else if (now !== digest) changed.push(path);
    }
    expect(removed).toEqual([]);
    expect(changed).toEqual([]);
  });

  it('stamped no instrument ids into her markdown (D-030)', async () => {
    // The narrower, more legible half of the same claim: provisional ids are
    // derived at read time, so no note may have gained an `id:` line. If
    // identity is ever stabilised by writing to the vault, that is a decision
    // with a bead, and this is the test that must be updated deliberately.
    const after = await digestVault(vaultRoot);
    const markdown = [...before.keys()].filter((path) => path.endsWith('.md'));
    expect(markdown.length).toBeGreaterThanOrEqual(30);
    for (const path of markdown) {
      expect(after.get(path)).toBe(before.get(path));
    }
  });
});
