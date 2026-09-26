/**
 * File-grain ("note-concepts") gate case replay — `[ILB-CHG-4]` follow-up (`ol-egov.141.89.5.4`).
 *
 * `docs/dev/intelligence-build/chg.md` §5 and `scripts/harness/ilb-chg/lib/matching.mjs`'s
 * `NOTE_CONCEPTS_GATE_GAP_REASON` (olea-service) both record the same standing gap: every
 * `level: "gate", dependant: "note-concepts"` case in `eval/data/ilb/chg/dev/cases.json` was, until
 * this file, either reported as an un-evaluated gap (the harness is a plain Node script that can
 * only `import` `../olea/packages/core/dist`, never `packages/plugin`, which has no built `dist/`),
 * or scored by a hand-written PORT of the gate logic rather than the real code — see
 * `eval/data/ilb/chg/key.dev.json`'s own `today.method` field for five of the nine cases:
 * "simulated: wiring.ts MaterialityTrigger.evaluate and main.ts evaluateMaterialityChange ported
 * over the shipped gate and canonicaliser" (a duplicate, not the real thing) — and the remaining
 * four as "reasoned from the code ... (not simulable here: concurrency, a fault, a reload or the
 * citation path)", written by a static case-authoring pass, never executed.
 *
 * This file is the route this bead's own remaining work named: "run those cases as a vitest spec
 * inside packages/plugin that reads the case files" — no port, no plugin dist, no `obsidian` import
 * (the same seam every sibling file in this test directory already uses). It drives the REAL
 * `MaterialityTrigger` (`../../../src/ingestion/materiality/wiring.js`) against every one of the
 * nine cases, including the four the static script called "not simulable": a vitest spec can control
 * real overlapping promises directly (exactly as `wiring.spec.ts`'s own `[DOS-C3]` test and
 * `revision-guard.spec.ts`'s own `[D-311]` restart test already do for other fixtures), so
 * "concurrency, a fault, a reload" are not actually out of reach here.
 *
 * **Cross-repo read, by design.** `eval/data/ilb/chg/` lives in the service repo (`olea-service`),
 * sibling to this one; the case and key files are read directly from there, never copied. Every case
 * here is `"provenance": "constructed"` (`chg.md` §5: "Constructed edit pairs") and every string this
 * file embeds is either read straight out of those files (subject-neutral invented text, e.g. a rope
 * or a footbridge — never real vault content) or this file's own labels/comments. INV-3 governs real
 * vault content; nothing here is that.
 *
 * **What each case checks, generically:** the judged pairs must chain from the case's initial
 * baseline to its final revision with no gap and no double-count (`chg.md` §5's own matching rule,
 * mirrored from `scripts/harness/ilb-chg/lib/matching.mjs`'s `scoreCitationGateCase`), every committed
 * judgment for a pair the key's `expected.answers` names must equal it, and a provider failure or a
 * lost/dropped call is reported as `judge-unavailable`/never committed — never a fabricated verdict.
 * Where a case's own `maxJudgeCalls` is a plain number, actual judge-call attempts are checked against
 * it; a few cases use a prose bound (`"bounded-by-retry-policy"`) that this file does not try to parse.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityJudgeVerdict,
  MaterialityRecord,
} from '../../../src/ingestion/materiality/types.js';
import { MaterialityTrigger } from '../../../src/ingestion/materiality/wiring.js';

// olea-service is this client repo's sibling — never copied, read directly (see this file's own
// doc). Resolved from this file's own location so it does not depend on the process cwd.
const SERVICE_REPO_ROOT = fileURLToPath(
  new URL('../../../../../../olea-service/', import.meta.url),
);
const CASES_PATH = `${SERVICE_REPO_ROOT}eval/data/ilb/chg/dev/cases.json`;
const KEY_PATH = `${SERVICE_REPO_ROOT}eval/data/ilb/chg/key.dev.json`;
// A public checkout has no olea-service sibling (CI included): skip rather than fail, the same
// failure-closed choice as core's compositeSignals.equivalence.spec.ts.
const CASES_PRESENT = existsSync(CASES_PATH) && existsSync(KEY_PATH);

interface SaveEvent {
  readonly atMs: number;
  readonly kind: 'save';
  readonly path: string;
  readonly revision: string;
  readonly text: string;
}
interface OtherEvent {
  readonly atMs: number;
  readonly kind: 'close' | 'tick' | 'restart';
}
type CaseEvent = SaveEvent | OtherEvent;

interface CaseFile {
  readonly caseId: string;
  readonly level: string;
  readonly dependant: string;
  readonly source: { readonly path: string };
  readonly initial: {
    readonly files: Record<string, { readonly revision: string; readonly text: string }>;
    readonly processedAtMs: number;
  };
  readonly events: readonly CaseEvent[];
}

interface KeyEntry {
  readonly caseId: string;
  readonly expected: {
    readonly answers: Readonly<Record<string, 'material' | 'immaterial'>>;
    readonly maxJudgeCalls: number | string;
    readonly finalBaseline: string;
  };
}

function loadCases(): readonly CaseFile[] {
  const parsed = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { cases: readonly CaseFile[] };
  return parsed.cases.filter((c) => c.level === 'gate' && c.dependant === 'note-concepts');
}

function loadKeys(): ReadonlyMap<string, KeyEntry> {
  const parsed = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as { cases: readonly KeyEntry[] };
  return new Map(parsed.cases.map((k) => [k.caseId, k] as const));
}

const ALL_CASES = CASES_PRESENT ? loadCases() : [];
const ALL_KEYS: ReadonlyMap<string, KeyEntry> = CASES_PRESENT ? loadKeys() : new Map();

function caseById(caseId: string): CaseFile {
  const found = ALL_CASES.find((c) => c.caseId === caseId);
  if (!found)
    throw new Error(`fixture case not found: ${caseId} (eval/data/ilb/chg/dev/cases.json)`);
  return found;
}
function keyById(caseId: string): KeyEntry {
  const found = ALL_KEYS.get(caseId);
  if (!found) throw new Error(`fixture key not found: ${caseId} (eval/data/ilb/chg/key.dev.json)`);
  return found;
}

/** text -> revision label ("r0", "r1", ...), built from a case's own initial file plus every save event. */
function revisionMap(c: CaseFile): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const file of Object.values(c.initial.files)) map.set(file.text, file.revision);
  for (const event of c.events) if (event.kind === 'save') map.set(event.text, event.revision);
  return map;
}

/**
 * A `MaterialityJudge` double that answers from `key.dev.json`'s own `expected.answers` — truth by
 * construction (`chg.md` §5), never a real model call, exactly the "you act as the model" posture
 * `LANE-RULES`/`D-182`/`D-236` set for this lane. Throws on a pair `answers` does not name, so a
 * wrong route surfaces as an assertion failure rather than a silently-fabricated verdict.
 */
function truthByConstructionJudge(
  revisions: ReadonlyMap<string, string>,
  answers: Readonly<Record<string, 'material' | 'immaterial'>>,
): { judge: MaterialityJudge; calls: { from: string; to: string }[] } {
  const calls: { from: string; to: string }[] = [];
  const judge: MaterialityJudge = {
    judge: vi.fn(async ({ previousText, currentText }) => {
      const from = revisions.get(previousText) ?? `unmapped:${previousText.slice(0, 12)}`;
      const to = revisions.get(currentText) ?? `unmapped:${currentText.slice(0, 12)}`;
      calls.push({ from, to });
      const key = `${from}>${to}`;
      const answer = answers[key];
      if (answer === undefined) {
        throw new Error(
          `judge asked about a pair the key's expected.answers does not name: ${key}`,
        );
      }
      return { material: answer === 'material', reason: 'test double: truth by construction' };
    }),
  };
  return { judge, calls };
}

class FakeStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  async load(path: string): Promise<MaterialityRecord | null> {
    return this.byPath.get(path) ?? null;
  }
  async save(record: MaterialityRecord): Promise<void> {
    this.byPath.set(record.path, record);
  }
  peek(path: string): MaterialityRecord | null {
    return this.byPath.get(path) ?? null;
  }
}

async function seedInitial(store: FakeStore, c: CaseFile, path: string): Promise<void> {
  const { computeMaterialityHashes } = await import('../../../src/ingestion/materiality/hashes.js');
  const { canonicalizeForMateriality } = await import(
    '../../../src/ingestion/materiality/canonical.js'
  );
  const text = c.initial.files[path]?.text;
  if (text === undefined) throw new Error(`no initial file for ${path}`);
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt: c.initial.processedAtMs,
    lastVerdictAt: null,
    revision: 0,
  });
}

function steppedClock(initial: number) {
  let current = initial;
  return { now: () => current, set: (next: number) => (current = next) };
}

describe.skipIf(!CASES_PRESENT)(
  '[ILB-CHG-4] file-grain ("note-concepts") gate cases, replayed through the real MaterialityTrigger',
  () => {
    it('CHG-8500128517cba2fc (exit-unchanged): identical bytes exit before any judge call', async () => {
      const c = caseById('CHG-8500128517cba2fc');
      const key = keyById('CHG-8500128517cba2fc');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const save = c.events.find((e) => e.kind === 'save') as SaveEvent;
      clock.set(save.atMs);
      const result = await trigger.evaluate(path, save.text, c.initial.files[path]!.text);
      expect(result.kind).toBe('unchanged');

      const tick = c.events.find((e) => e.kind === 'tick');
      if (tick) {
        const drained = await trigger.drainDuePendingEdits(tick.atMs);
        expect(drained).toHaveLength(0);
      }
      expect(calls).toHaveLength(0);
      expect(key.expected.finalBaseline).toBe('r0');
    });

    it('CHG-ab7d66b355692198 (same-length-once, lone-edit-drain): a below-floor edit with no second one still reaches the judge, via the final tick', async () => {
      const c = caseById('CHG-ab7d66b355692198');
      const key = keyById('CHG-ab7d66b355692198');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const save = c.events.find((e) => e.kind === 'save') as SaveEvent;
      clock.set(save.atMs);
      const first = await trigger.evaluate(path, save.text, c.initial.files[path]!.text);
      expect(first.kind).toBe('below-floor');
      expect(calls).toHaveLength(0);

      const tick = c.events.find((e) => e.kind === 'tick')!;
      const drained = await trigger.drainDuePendingEdits(tick.atMs);
      expect(drained).toHaveLength(1);
      expect(drained[0]?.material).toBe(true);
      expect(calls).toEqual([{ from: 'r0', to: 'r1' }]);

      // No gap, no double-count: exactly one committed judgment, covering the whole span.
      const final = store.peek(path);
      expect(final?.revision).toBe(1);
      expect(typeof key.expected.maxJudgeCalls).toBe('number');
      expect(calls.length).toBeLessThanOrEqual(key.expected.maxJudgeCalls as number);
    });

    it('CHG-834504f06f755d21 (debounce-burst): a below-floor edit followed by a debounced one is judged once, cumulatively, once the quiet window elapses', async () => {
      const c = caseById('CHG-834504f06f755d21');
      const key = keyById('CHG-834504f06f755d21');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const saves = c.events.filter((e): e is SaveEvent => e.kind === 'save');
      clock.set(saves[0]!.atMs);
      const r1 = await trigger.evaluate(path, saves[0]!.text, c.initial.files[path]!.text);
      expect(r1.kind).toBe('below-floor');

      clock.set(saves[1]!.atMs);
      const r2 = await trigger.evaluate(path, saves[1]!.text, saves[0]!.text);
      expect(r2.kind).toBe('debounced');
      expect(calls).toHaveLength(0); // no judge call yet -- still waiting out the window

      const tick = c.events.find((e) => e.kind === 'tick')!;
      const drained = await trigger.drainDuePendingEdits(tick.atMs);
      expect(drained).toHaveLength(1);
      expect(drained[0]?.material).toBe(true);
      // The chain from the last committed baseline (r0) to the final revision (r2) in one call --
      // never against the intervening, undecided r1 (this bead's own defect-1 fix).
      expect(calls).toEqual([{ from: 'r0', to: 'r2' }]);
      expect(store.peek(path)?.revision).toBe(1);
    });

    it('CHG-d9e612022ef7b30d (accumulated-small-edits): two individually below-floor edits are judged once, cumulatively, without waiting for the drain', async () => {
      const c = caseById('CHG-d9e612022ef7b30d');
      const key = keyById('CHG-d9e612022ef7b30d');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const saves = c.events.filter((e): e is SaveEvent => e.kind === 'save');
      clock.set(saves[0]!.atMs);
      const r1 = await trigger.evaluate(path, saves[0]!.text, c.initial.files[path]!.text);
      expect(r1.kind).toBe('below-floor');
      expect(calls).toHaveLength(0);

      clock.set(saves[1]!.atMs);
      const r2 = await trigger.evaluate(path, saves[1]!.text, saves[0]!.text);
      // The cumulative delta from the stored baseline (r0), not the immediate previous save (r1),
      // already clears the floor -- straight to the judge, no drain needed.
      expect(r2.kind).toBe('verdict');
      expect(calls).toEqual([{ from: 'r0', to: 'r2' }]);
      expect(calls.length).toBeLessThanOrEqual(key.expected.maxJudgeCalls as number);
      expect(store.peek(path)?.revision).toBe(1);

      const tick = c.events.find((e) => e.kind === 'tick');
      if (tick) {
        const drained = await trigger.drainDuePendingEdits(tick.atMs);
        expect(drained).toHaveLength(0); // nothing left pending
      }
    });

    it('CHG-c8d5986e6368cabf (same-length-twice): a second same-length edit on an already-deferred path escalates immediately, regardless of its own length', async () => {
      const c = caseById('CHG-c8d5986e6368cabf');
      const key = keyById('CHG-c8d5986e6368cabf');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const saves = c.events.filter((e): e is SaveEvent => e.kind === 'save');
      clock.set(saves[0]!.atMs);
      const r1 = await trigger.evaluate(path, saves[0]!.text, c.initial.files[path]!.text);
      expect(r1.kind).toBe('below-floor');

      clock.set(saves[1]!.atMs);
      const r2 = await trigger.evaluate(path, saves[1]!.text, saves[0]!.text);
      expect(r2.kind).toBe('verdict');
      // The "escalate" named route in the key: chained from r0 (the true last-processed baseline),
      // never r1 (an intervening, still-undecided save).
      expect(calls).toEqual([{ from: 'r0', to: 'r2' }]);
      expect(calls.length).toBeLessThanOrEqual(key.expected.maxJudgeCalls as number);
      // Every committed judgment for a pair `answers` names must match it -- r0>r2 is material here.
      expect(key.expected.answers['r0>r2']).toBe('material');
    });

    it('CHG-bc8e20c1aae8a840 (provider-unavailable, persistent fault): a judge that always fails is never read as a verdict, and nothing commits', async () => {
      const c = caseById('CHG-bc8e20c1aae8a840');
      const key = keyById('CHG-bc8e20c1aae8a840');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const before = store.peek(path);
      const failingJudge: MaterialityJudge = {
        judge: vi.fn(async () => {
          throw new Error('http-401 (simulated, persistent)');
        }),
      };
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge: failingJudge });

      const save = c.events.find((e) => e.kind === 'save') as SaveEvent;
      clock.set(save.atMs);
      const result = await trigger.evaluate(path, save.text, c.initial.files[path]!.text);
      expect(result.kind).toBe('judge-unavailable');
      expect(failingJudge.judge).toHaveBeenCalledOnce();

      const tick = c.events.find((e) => e.kind === 'tick')!;
      const drained = await trigger.drainDuePendingEdits(tick.atMs);
      expect(drained).toHaveLength(0); // an unconfigured-outcome path was never deferred, nothing to drain

      // Never a fabricated verdict, and no silent commit: the record is exactly as it was.
      expect(store.peek(path)).toEqual(before);
      expect(key.expected.finalBaseline).toBe('r0-or-r1'); // the key's own way of saying "ambiguous, by design"
    });

    it('CHG-8c0b1ef74e44cd7d (malformed-response, valid-on-retry): at this grain the port returns one valid response — retry is a server-side concern outside wiring.ts', async () => {
      const c = caseById('CHG-8c0b1ef74e44cd7d');
      const key = keyById('CHG-8c0b1ef74e44cd7d');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);
      const { judge, calls } = truthByConstructionJudge(revisions, key.expected.answers);
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const save = c.events.find((e) => e.kind === 'save') as SaveEvent;
      clock.set(save.atMs);
      const result = await trigger.evaluate(path, save.text, c.initial.files[path]!.text);
      expect(result.kind).toBe('verdict');
      expect(calls).toEqual([{ from: 'r0', to: 'r1' }]);
      expect(key.expected.answers['r0>r1']).toBe('material');
    });

    it('CHG-7206eb0f3a443533 (stale-response, older call finishes last): the older response is dropped, and the newer commit already chains from the last committed baseline', async () => {
      const c = caseById('CHG-7206eb0f3a443533');
      const key = keyById('CHG-7206eb0f3a443533');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);
      const revisions = revisionMap(c);

      let resolveOlder: (v: MaterialityJudgeVerdict) => void = () => {};
      const olderResponse = new Promise<MaterialityJudgeVerdict>((resolve) => {
        resolveOlder = resolve;
      });
      let resolveOlderCallStarted: () => void = () => {};
      const olderCallStarted = new Promise<void>((resolve) => {
        resolveOlderCallStarted = resolve;
      });
      const calls: { from: string; to: string }[] = [];
      const judge: MaterialityJudge = {
        judge: vi.fn(async ({ previousText, currentText }) => {
          const from = revisions.get(previousText) ?? 'unmapped';
          const to = revisions.get(currentText) ?? 'unmapped';
          calls.push({ from, to });
          if (calls.length === 1) {
            // The older call (higher simulated latency, 600000ms in the fixture's
            // decisionStage.latencyMsByCallOrder): hangs until explicitly released below, mirroring
            // wiring.spec.ts's own "[DOS-C3] a stale response race" test.
            resolveOlderCallStarted();
            return olderResponse;
          }
          // The newer call (lower simulated latency, 5000ms): resolves immediately, from the same
          // truth-by-construction answers the key names.
          const answer = key.expected.answers[`${from}>${to}`];
          if (answer === undefined) throw new Error(`unnamed pair: ${from}>${to}`);
          return { material: answer === 'material', reason: 'test double: truth by construction' };
        }),
      };
      const clock = steppedClock(c.initial.processedAtMs);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      const saves = c.events.filter((e): e is SaveEvent => e.kind === 'save');
      clock.set(saves[0]!.atMs);
      const olderCall = trigger.evaluate(path, saves[0]!.text, c.initial.files[path]!.text);
      await olderCallStarted;

      // The newer save arrives while the older call is still in flight (240000ms later in the
      // fixture, well inside the older call's 600000ms simulated latency).
      clock.set(saves[1]!.atMs);
      const newer = await trigger.evaluate(path, saves[1]!.text, saves[0]!.text);
      expect(newer.kind).toBe('verdict');
      // Defect 2's fix: the newer call chains from the last COMMITTED baseline (r0), never the
      // intervening save (r1) that the older call's own in-flight judgment is still deciding --
      // this is exactly what lets the newer commit cover the whole span, not just its own delta.
      expect(calls[1]).toEqual({ from: 'r0', to: 'r2' });

      // The older call's response now arrives. It must be dropped: a newer dispatch for this path
      // already committed its own (newer) baseline while it was in flight.
      resolveOlder({ material: true, reason: 'older, now-superseded response' });
      const olderResult = await olderCall;
      expect(olderResult).toEqual({ kind: 'judge-unavailable' });

      // Exactly one committed judgment for the whole span, no gap, no double-count.
      const final = store.peek(path);
      expect(final?.revision).toBe(1);
      expect(key.expected.answers['r0>r2']).toBe('material');
      expect(final?.canonicalLength).toBeGreaterThan(0);

      // `key.dev.json`'s own `today` field (written by a static, non-executing case-authoring pass —
      // its own `method` says "reasoned from the code ... not simulable here") records
      // `meetsTarget: false` for this case, with the gap "the newer call compares against the
      // previous save (r1)". Replayed against the REAL code, the newer call in fact chains from r0
      // (asserted two lines above) -- the persisted-revision guard drops the stale older response, and
      // the one committed judgment (r0>r2, material) already covers the substantive r0>r1 change. This
      // is a finding for this bead's report, not a change to eval/data/ilb/chg/ (outside this lane's
      // owns): the fixture's own `today.meetsTarget`/`gap` fields for CHG-7206eb0f3a443533 read as
      // stale against the code as it stands now (post defect-2, ol-egov.141.89.5.7).
    });

    it('CHG-57f55b30941e3290 (restart-pending-escalation): an in-flight call lost to a restart is not recovered by the final tick — a real, reproduced gap', async () => {
      const c = caseById('CHG-57f55b30941e3290');
      const key = keyById('CHG-57f55b30941e3290');
      const path = c.source.path;
      const store = new FakeStore();
      await seedInitial(store, c, path);

      // Instance A: dispatches a judge call and never gets an answer back — the process dies with
      // the call still in flight. `never()` deliberately never settles; the call is issued but not
      // awaited (nothing in a real crash ever resumes it either).
      const neverSettles: MaterialityJudge = {
        judge: vi.fn((): Promise<MaterialityJudgeVerdict> => new Promise(() => {})),
      };
      const clock = steppedClock(c.initial.processedAtMs);
      const triggerA = new MaterialityTrigger({ store, clock, judge: neverSettles });
      const save = c.events.find((e) => e.kind === 'save') as SaveEvent;
      clock.set(save.atMs);
      void triggerA.evaluate(path, save.text, c.initial.files[path]!.text);
      // Let the dispatch reach the (never-resolving) judge call -- the hash/store hops in between
      // are real microtasks (async SHA-256, an async FakeStore load), so this polls rather than
      // assuming a fixed number of ticks (a fixed `setTimeout(0)` flaked under full-suite load).
      await vi.waitFor(() => expect(neverSettles.judge).toHaveBeenCalledOnce());

      // "restart": a brand-new instance, sharing only the persisted store — every in-memory map
      // (`pendingSmallEdit`, `pendingDebounced`, `lastProcessedText`, the in-flight `revisions` guard)
      // starts empty, exactly as after a real process restart.
      const restart = c.events.find((e) => e.kind === 'restart')!;
      clock.set(restart.atMs);
      const revisions = revisionMap(c);
      const { judge: freshJudge } = truthByConstructionJudge(revisions, key.expected.answers);
      const triggerB = new MaterialityTrigger({ store, clock, judge: freshJudge });

      const tick = c.events.find((e) => e.kind === 'tick')!;
      const drained = await triggerB.drainDuePendingEdits(tick.atMs);

      // The reproduced gap (matches key.dev.json's own recorded `today.gap`): nothing about the
      // lost-in-flight edit was ever persisted, and a fresh instance's drain has nothing of its own
      // to act on — the file's next OBSERVATION (a future save) is what would pick this back up, not
      // a periodic tick alone. This is a genuine, confirmed limitation, not a build defect this
      // bead's own owns can fix without a persisted "dispatched, awaiting response" record (a new
      // stored shape -- Class C, needs its own decision bead).
      expect(drained).toHaveLength(0);
      expect(store.peek(path)?.revision).toBe(0);
      expect(key.expected.finalBaseline).toBe('r1'); // the TARGET baseline this gap keeps it from reaching
    });
  },
);
