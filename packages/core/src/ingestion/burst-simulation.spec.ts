/**
 * THE HEADLINE TEST (P3-T03 acceptance, now driven through DF-21's real
 * runner rather than a fake): a simulated 24-lecture burst has to drain
 * across multiple sessions with zero failed jobs.
 *
 * **The scenario is not invented here, and it is not quoted here either.**
 * The cost model sets the worst case this queue has to survive: a whole
 * course's worth of slide decks handed to ingestion all at once, large enough
 * that a second such run inside the same day pushes past the daily
 * allocation, at which point the inference platform rejects calls outright
 * rather than degrading. The burst size, the daily cap and that failure mode
 * all come from that document, not from this file — see
 * `olea-service/docs/Olea_ai_workload_and_cost_model.md` §4. It is
 * private-classified, so it is cited by path and never reproduced.
 *
 * **What changed for DF-21.** Every "lecture" below is now a real, distinct,
 * hand-built one-page PDF living in an in-memory `VaultSource`, and the
 * `JobRunner` under test is `createExtractionJobRunner` — the same one
 * `extraction-runner.spec.ts` unit-tests — not a hand-rolled stand-in. Two
 * consequences follow directly from that:
 *
 * - **Content hashes are real.** Each lecture's `contentHash` is
 *   `hashContent` of its actual PDF bytes (D-002's own definition of the
 *   job's identity), not an arbitrary label hash. The content-hash
 *   idempotency property this test now proves is therefore the real
 *   mechanism: a second `enqueue` of the identical bytes never re-reads the
 *   vault or re-bills the (simulated) Worker.
 * - **Extraction genuinely happens.** Every lecture's real text reaches the
 *   `ExtractedUnitSink` with real `Provenance` before this test calls it
 *   done, not just an opaque `{ ok: true }`.
 *
 * **What's still simulated, and why.** No Worker client exists anywhere in
 * this codebase yet (P3-T02 froze the envelope; nothing implements it) —
 * that is a separate, later task. `FakeWorker` still stands in for the
 * neuron ledger and budget-headroom signal exactly as it did under P3-T03,
 * composed *after* the real extraction runner succeeds (`composeWithFakeWorker`
 * below) rather than replacing it. This keeps the genuinely-exercised
 * property honest: the queue-scheduling mechanics (backoff, pacing,
 * exhaustion, crash-and-resume) are real `IngestionQueueEngine` behaviour
 * reacting to a simulated cost signal sitting *downstream* of real,
 * non-simulated extraction.
 *
 * The five things this test still has to be a genuine simulation of, not a
 * loop that trivially succeeds (unchanged from P3-T03, restated because
 * they're still exactly what's being protected):
 *
 * 1. **Real budget pressure, not a friendly number.** `FakeWorker` holds its
 *    own neuron ledger and starts the day already partway spent (2,600
 *    neurons), so the burst's own ~8,000 neurons genuinely crosses the
 *    10,000/day cap partway through.
 * 2. **A real interrupted-mid-drain job.** One lecture's (simulated) Worker
 *    submission hangs forever; the engine instance handling it is discarded
 *    without awaiting that stuck call.
 * 3. **A real backgrounding pause.** `pause()`/`resume()` exercised
 *    mid-drain.
 * 4. **Real multi-session restarts.** Every exhaustion discards the
 *    in-memory engine and rebuilds one from nothing but `QueueStore.load()`
 *    — the real runner (and its `deferredEnqueuer`) is rebound to the fresh
 *    engine each time, exactly as a real host would reconstruct it.
 * 5. **Real content-hash idempotency and real mobile non-draining** —
 *    exercised against the real runner at the end of this file, see the two
 *    trailing tests below.
 *
 * **Named assumption**, unchanged from P3-T03: the crash is modelled as
 * happening *before* the Worker recorded any cost for that call. See
 * `engine.ts`'s module doc for the residual, out-of-scope risk this accepts.
 */
import { describe, expect, it } from 'vitest';
import type { ExtractedUnit } from '../extract/types.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { IngestionQueueEngine } from './engine.js';
import {
  createExtractionJobRunner,
  deferredEnqueuer,
  type ExtractedUnitSink,
  type ExtractionJobPayload,
} from './extraction-runner.js';
import { hashContent } from './hash.js';
import type {
  Clock,
  DeviceCapability,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  PersistedQueue,
  QueueStore,
  RandomSource,
} from './types.js';

// ---- a tiny hand-built-PDF constructor (same "hand-built objects/xref"
// style as pdf.spec.ts and extraction-runner.spec.ts — see fixtures/vault's
// README) so every "lecture" here exercises the real PDF parser.

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** A single-page PDF whose one page's text clears the text-layer threshold comfortably — every synthetic lecture in this file is a text-layer-only document, since the vision-routing path is `extraction-runner.spec.ts`'s concern, not this file's. */
function buildOnePagePdfBytes(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(pageText)}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

class MemoryVaultSource implements VaultSource {
  readonly readBinaryCalls: VaultPath[] = [];
  private readonly files = new Map<string, Uint8Array>();

  set(path: VaultPath, bytes: Uint8Array): void {
    this.files.set(path, bytes);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const paths = [...this.files.keys()].sort();
    if (options.under === undefined) return paths;
    const under = options.under;
    return paths.filter((p) => p === under || p.startsWith(`${under}/`));
  }

  async read(path: VaultPath): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    this.readBinaryCalls.push(path);
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`not found: ${path}`);
    return bytes;
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, new TextEncoder().encode(content));
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

class CollectingSink implements ExtractedUnitSink {
  readonly batches: (readonly ExtractedUnit[])[] = [];
  async receive(units: readonly ExtractedUnit[]): Promise<void> {
    this.batches.push(units);
  }
  get all(): readonly ExtractedUnit[] {
    return this.batches.flat();
  }
}

class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;

  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }

  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

class ManualClock implements Clock {
  constructor(private ms: number) {}
  now(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

/** Deterministic PRNG (mulberry32) — reproducible, non-uniform sequences without a test dependency on `Math.random`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRandomSource(seed: number): RandomSource {
  const next = mulberry32(seed);
  return { next };
}

const DAILY_CAP_NEURONS = 10_000;
/** Per-lecture costs are chosen so the largest one still sits under `budget.ts`'s 5% `EXHAUSTED_HEADROOM_THRESHOLD` margin, which is what lets the guard always stop cleanly before a call would overrun. The per-lecture cost band this is modelled on belongs to the cost model — see `olea-service/docs/Olea_ai_workload_and_cost_model.md` §4, cited by path rather than restated here. */
const MIN_LECTURE_COST = 250;
const MAX_LECTURE_COST = 420;
/** Other same-day AI feature usage before the burst starts. */
const BASELINE_USED_NEURONS = 2_600;

function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Stands in for the Worker submission step *downstream* of real extraction
 * (D-005: a stateless calculator with its own neuron ledger the client never
 * sees directly). No real Worker client exists in this codebase to replace
 * it with (see this file's module doc). `run` is composed after the real
 * `createExtractionJobRunner` outcome via `composeWithFakeWorker`.
 */
class FakeWorker {
  invocations = 0;
  /** Every call the guard let through that would have overspent the day's cap — must stay zero for the whole simulation. */
  overrunAttempts = 0;
  private usedToday: number;
  private dayKey: string;
  private crashed = false;

  constructor(
    private readonly clock: ManualClock,
    private readonly costs: ReadonlyMap<string, number>,
    /** Content hash of the one lecture whose first submission hangs forever, simulating a killed process. */
    private readonly crashHash: string,
  ) {
    this.usedToday = BASELINE_USED_NEURONS;
    this.dayKey = dayKeyOf(clock.now());
  }

  private rolloverIfNewDay(): void {
    const key = dayKeyOf(this.clock.now());
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.usedToday = 0; // the daily allocation resets at 00:00 UTC (cost model §4)
    }
  }

  run: JobRunner = (job) => {
    this.invocations++;
    this.rolloverIfNewDay();

    if (job.contentHash === this.crashHash && !this.crashed) {
      this.crashed = true;
      // Never resolves — the caller must not await this; see the module doc.
      return new Promise<JobRunOutcome>(() => {});
    }

    const cost = this.costs.get(job.contentHash) ?? 0;
    if (this.usedToday + cost > DAILY_CAP_NEURONS) {
      // The guard should have deferred this job before ever attempting it.
      this.overrunAttempts++;
      return Promise.resolve({ ok: false, retryable: true, budgetHeadroom: 0 });
    }
    this.usedToday += cost;
    const headroom = Math.max(0, (DAILY_CAP_NEURONS - this.usedToday) / DAILY_CAP_NEURONS);
    return Promise.resolve({ ok: true, budgetHeadroom: headroom });
  };
}

/** Real extraction first, simulated Worker cost second. A genuine extraction failure short-circuits before any simulated billing — see the module doc. */
function composeWithFakeWorker(extractionRunner: JobRunner, worker: FakeWorker): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    const extracted = await extractionRunner(job);
    if (!extracted.ok) return extracted;
    return worker.run(job);
  };
}

/** Drives `engine` until it stops making progress this session: fully drained, or the budget guard reports exhaustion. Pacing gaps are honoured by fast-forwarding the clock, matching what an open app actually does (waits, doesn't restart). */
async function drainSession(
  engine: IngestionQueueEngine,
  clock: ManualClock,
  maxTicks = 2_000,
): Promise<'drained' | 'exhausted'> {
  for (let i = 0; i < maxTicks; i++) {
    const result = await engine.tick();
    if (result.kind === 'blocked') {
      throw new Error(`drainSession: unexpectedly blocked (${result.reason})`);
    }
    if (result.kind === 'ran') continue;
    // idle
    if (result.reason === 'pacing') {
      const pacingUntil = engine.snapshot().pacingUntil;
      if (pacingUntil === null) continue;
      clock.set(pacingUntil + 1);
      continue;
    }
    if (result.reason === 'budget-exhausted') return 'exhausted';
    return 'drained'; // nothing-eligible: session is caught up
  }
  throw new Error('drainSession: exceeded maxTicks — likely an infinite loop, not a real drain');
}

describe('24-lecture burst — drains across sessions with zero failed jobs, against the real runner (P3-T03 headline test, DF-21)', () => {
  it('enqueues 24 real lecture PDFs, extracts every one for real, and drains them all across restarts, a background pause, and an interrupted job, without a single failure — then proves content-hash idempotency against the same real runner', async () => {
    const LECTURE_COUNT = 24;
    const costSeed = mulberry32(20260809);

    const vault = new MemoryVaultSource();
    const lectures = await Promise.all(
      Array.from({ length: LECTURE_COUNT }, (_, i) => i + 1).map(async (n) => {
        const label = `Synthetic Lecture ${n}`;
        const path = `Lectures/${label}.pdf`;
        // ASCII only: `buildOnePagePdfBytes`, like `pdf.spec.ts`'s own fixture
        // builder, round-trips through a Latin-1 byte space and would mangle
        // a multi-byte character such as an em dash.
        const text = `${label} - a slide with genuinely substantial text, comfortably clearing the text-layer threshold.`;
        const bytes = buildOnePagePdfBytes(text);
        vault.set(path, bytes);
        const hash = await hashContent(bytes);
        return { label, path, text, hash };
      }),
    );
    const contentHashes = lectures.map((l) => l.hash);
    const costs = new Map<string, number>();
    let totalCost = 0;
    for (const { hash } of lectures) {
      const cost =
        MIN_LECTURE_COST + Math.floor(costSeed() * (MAX_LECTURE_COST - MIN_LECTURE_COST));
      costs.set(hash, cost);
      totalCost += cost;
    }
    // Sanity check on the simulation's own premise: the burst plus the
    // baseline must genuinely cross the cap, or "stops cleanly and resumes
    // later" is never actually exercised below.
    expect(BASELINE_USED_NEURONS + totalCost).toBeGreaterThan(DAILY_CAP_NEURONS);

    // A Saturday afternoon back-catalogue session, per the cost model's own scenario.
    const clock = new ManualClock(Date.UTC(2026, 7, 8, 15, 0, 0)); // 2026-08-08T15:00:00Z
    const store = new MemoryStore();
    const capability: DeviceCapability = { canDrain: true };
    // The 7th lecture (arbitrary, mid-burst) is the one whose first
    // (simulated) Worker submission "crashes".
    const seventhLecture = lectures[6];
    if (!seventhLecture) throw new Error('expected at least 7 synthetic lectures');
    const crashHash = seventhLecture.hash;
    const worker = new FakeWorker(clock, costs, crashHash);
    const random = seededRandomSource(4242);
    const sink = new CollectingSink();
    const enqueuer = deferredEnqueuer();
    const extractionRunner = createExtractionJobRunner({ vault, enqueuer, sink });
    const composedRunner = composeWithFakeWorker(extractionRunner, worker);

    let engine = await IngestionQueueEngine.create({
      store,
      capability,
      runner: composedRunner,
      clock,
      random,
    });
    enqueuer.bind(engine);

    for (const { label, path, hash } of lectures) {
      const payload: ExtractionJobPayload = { kind: 'source', sourcePath: path, format: 'pdf' };
      const result = await engine.enqueue({ contentHash: hash, label, payload });
      expect(result.status).toBe('queued');
    }
    expect(engine.snapshot()).toMatchObject({ queued: LECTURE_COUNT, done: 0 });

    // --- Drain the first few jobs, then simulate backgrounding. ---
    for (let i = 0; i < 3; i++) {
      const result = await engine.tick();
      expect(result.kind).toBe('ran');
      if (result.kind === 'ran') expect(result.outcome).toBe('done');
    }
    expect(engine.snapshot().done).toBe(3);

    engine.pause();
    const blocked = await engine.tick();
    expect(blocked).toEqual({ kind: 'blocked', reason: 'paused' });
    expect(worker.invocations).toBe(3); // the pause genuinely prevented a 4th call
    engine.resume();

    // --- Drain forward until the crash-hang job (#7) is hit. ---
    for (let i = 3; i < 6; i++) {
      const result = await engine.tick();
      expect(result).toMatchObject({ kind: 'ran', outcome: 'done' });
    }
    expect(engine.snapshot().done).toBe(6);

    // This tick starts job #7: real extraction runs to completion, then the
    // simulated Worker submission hangs forever. Deliberately not awaited:
    // the process "dies" while it's outstanding.
    void engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // "Restart": a fresh engine built only from what the store has on disk,
    // with the real runner (same `vault`/`sink`/`worker`) rebound to it.
    engine = await IngestionQueueEngine.create({
      store,
      capability,
      runner: composedRunner,
      clock,
      random,
    });
    enqueuer.bind(engine);
    const afterCrashRestore = engine.list().find((j) => j.contentHash === crashHash);
    expect(afterCrashRestore?.status).toBe('queued');
    expect(engine.snapshot()).toMatchObject({ inFlight: 0, done: 6 });

    // --- Drain the rest of session 1: either fully drains or the budget guard stops it cleanly. ---
    const session1Outcome = await drainSession(engine, clock);

    expect(worker.overrunAttempts).toBe(0); // the guard never let a call through that would overspend
    expect(engine.snapshot().failed).toBe(0); // zero failed jobs, the headline promise

    // The crashed job resumed and completed exactly once — never lost, never double-recorded.
    const crashedJobsDone = engine
      .list()
      .filter((j) => j.contentHash === crashHash && j.status === 'done');
    expect(crashedJobsDone).toHaveLength(1);

    let sessionsUsed = 1;
    let currentOutcome = session1Outcome;

    while (currentOutcome === 'exhausted') {
      const resumeAt = engine
        .list()
        .find(
          (j) => j.status === 'deferred' && j.deferReason === 'budget-exhausted',
        )?.resumeNotBefore;
      expect(resumeAt).toBeDefined();
      clock.set((resumeAt as number) + 1);

      // "Next session": another fresh engine from the store, exactly as a
      // new Obsidian launch the following day would construct one.
      engine = await IngestionQueueEngine.create({
        store,
        capability,
        runner: composedRunner,
        clock,
        random,
      });
      enqueuer.bind(engine);
      sessionsUsed++;
      currentOutcome = await drainSession(engine, clock);

      expect(worker.overrunAttempts).toBe(0);
      expect(engine.snapshot().failed).toBe(0);

      if (sessionsUsed > 5) {
        throw new Error('burst simulation did not converge within 5 sessions — investigate');
      }
    }

    // Multiple sessions were genuinely required, not just available.
    expect(sessionsUsed).toBeGreaterThan(1);

    const finalSnapshot = engine.snapshot();
    expect(finalSnapshot).toMatchObject({
      queued: 0,
      inFlight: 0,
      deferred: 0,
      failed: 0,
      done: LECTURE_COUNT,
    });

    // Every lecture completed exactly once at the job-accounting level — no
    // duplicates, nothing missing.
    const doneHashes = engine
      .list()
      .filter((j) => j.status === 'done')
      .map((j) => j.contentHash)
      .sort();
    expect(doneHashes).toEqual([...contentHashes].sort());
    expect(worker.overrunAttempts).toBe(0);

    // Real extraction genuinely happened for every lecture, with real,
    // per-lecture-distinct provenance — not merely 24 opaque `done` jobs.
    // (The crashed lecture may have been extracted twice across its two
    // attempts — a legitimate, documented consequence of "resume, not
    // vanish", see engine.ts's module doc — so this checks coverage by
    // source path, not raw batch count.)
    const extractedSourcePaths = new Set(sink.all.map((u) => u.provenance.sourcePath));
    expect(extractedSourcePaths).toEqual(new Set(lectures.map((l) => l.path)));
    for (const { path, text } of lectures) {
      const unit = sink.all.find((u) => u.provenance.sourcePath === path);
      expect(unit?.text).toBe(text);
      expect(unit?.provenance.location.page).toBe(1);
    }

    // --- Content-hash idempotency, against this same real runner and vault. ---
    // A second device rediscovers lecture #1's identical bytes and tries to
    // enqueue it again. D-002's guarantee: never re-read, never re-extract,
    // never re-bill.
    const readsBefore = vault.readBinaryCalls.length;
    const invocationsBefore = worker.invocations;
    const firstLecture = lectures[0];
    if (!firstLecture) throw new Error('expected at least one synthetic lecture');
    const duplicate = await engine.enqueue({
      contentHash: firstLecture.hash,
      label: firstLecture.label,
      payload: { kind: 'source', sourcePath: firstLecture.path, format: 'pdf' },
    });
    expect(duplicate).toEqual({ status: 'duplicate', existingStatus: 'done' });
    await engine.tick(); // nothing eligible — the duplicate is already done
    expect(vault.readBinaryCalls.length).toBe(readsBefore); // no re-read, let alone re-extraction
    expect(worker.invocations).toBe(invocationsBefore); // no re-billing
  });
});

describe("device capability — mobile enqueues through the real runner's job vocabulary but never drains it (D-002), DF-21", () => {
  it('mobile never invokes the real runner at all; a desktop sharing the same store and vault later drains it for real', async () => {
    const vault = new MemoryVaultSource();
    const path = 'Lectures/Mobile-Queued Lecture.pdf';
    const text = 'A lecture enqueued on the go, comfortably above the text-layer threshold.';
    vault.set(path, buildOnePagePdfBytes(text));
    const hash = await hashContent(await vault.readBinary(path));
    vault.readBinaryCalls.length = 0; // discount the read just used to compute the fixture's own hash

    const store = new MemoryStore();
    const sink = new CollectingSink();
    const enqueuer = deferredEnqueuer();
    const runner = createExtractionJobRunner({ vault, enqueuer, sink });

    const onMobile = await IngestionQueueEngine.create({
      store,
      capability: { canDrain: false },
      runner,
    });
    enqueuer.bind(onMobile);

    const payload: ExtractionJobPayload = { kind: 'source', sourcePath: path, format: 'pdf' };
    const enqueueResult = await onMobile.enqueue({
      contentHash: hash,
      label: 'Mobile lecture',
      payload,
    });
    expect(enqueueResult).toEqual({ status: 'queued' });

    const tickResult = await onMobile.tick();
    expect(tickResult).toEqual({ kind: 'blocked', reason: 'device-cannot-drain' });
    // The strongest possible proof the real runner never ran: the vault was
    // never even asked to read the PDF's bytes.
    expect(vault.readBinaryCalls).toEqual([]);
    expect(onMobile.snapshot()).toMatchObject({ queued: 1, drainBlocked: 'device-cannot-drain' });
    expect(sink.batches).toEqual([]);

    // A desktop device shares the same persisted store (as a real synced
    // vault would) and drains the job the real runner left waiting.
    const onDesktop = await IngestionQueueEngine.create({
      store,
      capability: { canDrain: true },
      runner,
    });
    enqueuer.bind(onDesktop);
    const drained = await onDesktop.tick();
    expect(drained).toEqual({ kind: 'ran', contentHash: hash, outcome: 'done' });
    expect(vault.readBinaryCalls).toEqual([path]); // the real runner really read it, this time
    expect(sink.all).toHaveLength(1);
    expect(sink.all[0]?.text).toBe(text);
  });
});
