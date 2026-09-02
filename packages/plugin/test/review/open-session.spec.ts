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
 */

import { type Rating, STUDY_PLAN_BODY_VERSION, type StudyPlanEnvelope } from 'olea-contracts';
import type { ConceptRelation, RandomSource, VaultPath, VaultSource } from 'olea-core';
import {
  appendReviewLogRecord,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  parseReviewLog,
  provisionalConceptKey,
  reviewLogPath,
  suspendedInstrumentIds,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  nextDueLabel,
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

async function open(
  vault: ReturnType<typeof memoryVault>,
  clock: Clock = fixedClock(),
  plan?: StudyPlanEnvelope | null,
) {
  return openReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault, clock).ports,
    random: fixedRandom,
    probeDays: 30,
    ...(plan !== undefined ? { plan } : {}),
  });
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

    // Two concepts, three instruments: F2.17 offers one per concept and defers
    // the rest. That the numbers below are 2 and 1 is `composeQueue`'s decision
    // arriving settled, not this module's.
    expect(outcome.itemCount).toBe(2);
    expect(outcome.deferredCount).toBe(1);

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

  it('threading a live part-of edge drops the container candidate, keeping the part', async () => {
    const vault = studyVault();
    const outcome = await openReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(vault).ports,
      random: fixedRandom,
      probeDays: 30,
      relations: [partOfAlphaBeta()],
    });
    if (!outcome.ok) throw new Error('expected a composed session');

    // Alpha (the container, `Week one.md`) is dropped before composeQueue
    // ever sees it; only Beta's two instruments (`Week two.md`) remain, and
    // F2.17 still offers one of them.
    expect(outcome.itemCount).toBe(1);
    expect(outcome.deferredCount).toBe(1);

    await outcome.session.start();
    const vm = outcome.session.getViewModel();
    if (vm.phase !== 'front' && vm.phase !== 'mcq-open') {
      throw new Error(`expected an offered item, got phase ${vm.phase}`);
    }
    expect(vm.instrument.sourcePath).toBe('Courses/TEST101/Week two.md');
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
  it('reports the failure instead of handing back an empty session', async () => {
    const outcome = await openReviewSession({
      vault: unreadableVault('disk went away'),
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: ports(memoryVault()).ports,
      probeDays: 30,
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
    // of `minSpacedDays`), not `tree` (3 distinct days INCLUDING the
    // just-written rating's day, which is what a caller that folded its own
    // event into the slice would compute — the spacing gate opens, the
    // recent window is all recall successes, and the state jumps straight
    // past `sapling` to `tree`). A regression that reorders the read and the
    // append above turns this into `tree` and this assertion goes red.
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
  it("an instrument with a logged review carries that review's state, not null", async () => {
    // Compose once, rate once, then compose again over the same vault: the
    // second session must see the state the first one produced. That is the
    // whole of "scheduling state is replayed from the log, never stored".
    const vault = studyVault();
    const first = await open(vault);
    if (!first.ok) throw new Error('expected a composed session');
    await first.session.start();
    const ratedId = first.session.currentItem?.instrument.instrumentId;
    first.session.reveal();
    await first.session.rate('easy');

    const second = await open(vault, fixedClock(new Date('2026-08-11T14:00:00-04:00')));
    if (!second.ok) throw new Error('expected a composed session');
    await second.session.start();

    // Rated Easy yesterday, so it is not due today — and the item that *is*
    // offered is a different instrument entirely.
    expect(second.session.currentItem?.instrument.instrumentId).not.toBe(ratedId);
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

  it("a cached plan reorders the real session and completes D7.1's context", async () => {
    const vault = studyVault();
    const outcome = await open(vault, fixedClock(), PLAN);
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();

    // Phase A (no plan, the untouched tests above) offers Alpha's `qa` first.
    // With this plan, Beta — ranked, weight 10 — sorts before Alpha, which the
    // plan never mentions and which therefore stays unranked.
    const first = outcome.session.currentItem;
    expect(first?.instrument.conceptIds).toContain(unboundKey('Beta'));
    expect(first?.selectionContext.planVersion).toBe(PLAN.policyVersion);
    expect(first?.selectionContext.yieldRank).toBe(1);
    expect(first?.selectionContext.examProximity).toBe(3);

    await advancePastCurrentItem(outcome.session);

    // C7.6/D7.1: the version reaches EVERY offered item, ranked or not — the
    // second item is Alpha's, which the plan did not rank, so its own
    // yieldRank/examProximity stay the queue's nulls while planVersion still
    // names the plan that was in force.
    const second = outcome.session.currentItem;
    expect(second?.instrument.conceptIds).toContain(unboundKey('Alpha'));
    expect(second?.selectionContext.planVersion).toBe(PLAN.policyVersion);
    expect(second?.selectionContext.yieldRank).toBeNull();
    expect(second?.selectionContext.examProximity).toBeNull();
  });

  it('no cached plan degrades to exactly Phase A, item for item', async () => {
    const vault = studyVault();
    const withoutPlan = await open(vault, fixedClock(), null);
    const omittedPlan = await open(vault, fixedClock());
    if (!withoutPlan.ok || !omittedPlan.ok) throw new Error('expected composed sessions');

    await withoutPlan.session.start();
    await omittedPlan.session.start();

    // `plan: null` and omitting `plan` entirely reach the identical Phase A
    // shape through the same `executeStudyPlan` call — no second branch to
    // drift from it.
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
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: { ...ports(vault).ports, explainWhyPort },
      random: fixedRandom,
      probeDays: 30,
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
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: {
        ...ports(vault).ports,
        evaluateConfusionRouting: () => ({
          shouldOffer: true,
          lapses: 4,
          promptText: 'offer text',
        }),
      },
      random: fixedRandom,
      probeDays: 30,
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
