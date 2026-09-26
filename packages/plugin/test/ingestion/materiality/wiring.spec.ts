import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityRecord,
  MaterialityVerdictEvent,
} from '../../../src/ingestion/materiality/types.js';
import {
  buildRegionAwareMaterialityRequest,
  MaterialityTrigger,
} from '../../../src/ingestion/materiality/wiring.js';

class FakeStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  async load(path: string): Promise<MaterialityRecord | null> {
    return this.byPath.get(path) ?? null;
  }
  async save(record: MaterialityRecord): Promise<void> {
    this.byPath.set(record.path, record);
  }
}

function fakeClock(now: number) {
  return { now: () => now };
}

/** A clock whose `now()` can be advanced between calls, for tests that need
 * ONE `MaterialityTrigger` instance (so its in-memory pending/revision
 * bookkeeping persists) across multiple simulated points in time. */
function steppedClock(initial: number) {
  let current = initial;
  return { now: () => current, set: (next: number) => (current = next) };
}

const PATH = 'Courses/GEO101/Lecture 3.md';

async function seed(store: FakeStore, text: string, lastChangedAt: number): Promise<void> {
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path: PATH,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt,
    lastVerdictAt: null,
  });
}

describe('MaterialityTrigger.evaluate', () => {
  it('reports unchanged and never calls the judge when the text is identical', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(1000), judge });

    const result = await trigger.evaluate(
      PATH,
      'Basalt weathers quickly.',
      'Basalt weathers quickly.',
    );

    expect(result).toEqual({ kind: 'unchanged' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports formatting-only and never calls the judge for a pure reflow', async () => {
    const store = new FakeStore();
    await seed(store, '# Weathering\n\nBasalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(PATH, '## Weathering\n\nBasalt weathers quickly.');

    expect(result).toEqual({ kind: 'formatting-only' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports debounced immediately after a change, and does not call the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(1), judge });

    const result = await trigger.evaluate(PATH, 'Basalt weathers slowly in cold climates.');

    expect(result.kind).toBe('debounced');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports below-floor for a tiny edit past the debounce window, and does not call the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    // One character added — a typo fix, well under the floor.
    const result = await trigger.evaluate(PATH, 'Basalt weathers quickly!');

    expect(result.kind).toBe('below-floor');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports judge-unavailable when every free gate clears but no judge is configured', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge: null,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result).toEqual({ kind: 'judge-unavailable' });
  });

  it('reports judge-unavailable when a judge exists but no previousText was supplied', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
    );

    expect(result).toEqual({ kind: 'judge-unavailable' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('calls the judge and surfaces its verdict unchanged when every gate clears and previousText is supplied', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = {
      judge: vi.fn(async () => ({ material: true, reason: 'claim reversed' })),
    };
    const now = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;
    const onVerdict = vi.fn();
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(now), judge, onVerdict });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    const expectedVerdict: MaterialityVerdictEvent = {
      path: PATH,
      at: now,
      material: true,
      reason: 'claim reversed',
    };
    // `ol-egov.141.89.39`: the same judge call read through the Decision
    // contract, unstamped here (the stub judge attaches no `.stamp`) — see
    // the `readMaterialityJudgeStamp` describe block below for the stamped
    // case.
    expect(result).toEqual({
      kind: 'verdict',
      verdict: expectedVerdict,
      decision: {
        kind: 'verdict',
        verdict: 'material',
        payload: { reason: 'claim reversed' },
        provenance: {
          producer: {
            kind: 'model',
            seat: 'candidate',
            taskId: 'materiality.judge.v1',
            stamp: null,
          },
          evidenceDigests: [],
        },
      },
    });
    expect(judge.judge).toHaveBeenCalledWith({
      path: PATH,
      previousText: 'Basalt weathers quickly.',
      currentText: 'Basalt does not weather at all in cold, dry climates.',
    });
    expect(onVerdict).toHaveBeenCalledWith(expectedVerdict);
  });

  it("ol-egov.141.89.39: carries the Worker D7.3 stamp into the adapted decision's provenance when the judge verdict has one", async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    // A `const` variable, not an inline literal, so TypeScript does not
    // reject `stamp` as an excess property of the declared
    // `MaterialityJudgeVerdict` — the production `WorkerMaterialityJudge`
    // returns exactly this wider shape (`workerJudge.ts`'s
    // `StampedMaterialityJudgeVerdict`) and `readMaterialityJudgeStamp` in
    // `wiring.ts` reads it the same defensive way.
    const stampedVerdict = {
      material: true,
      reason: 'claim reversed',
      stamp: { promptVersion: '1.4.0', modelId: 'materiality-test-model' },
    };
    const judge: MaterialityJudge = { judge: vi.fn(async () => stampedVerdict) };
    const now = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(now), judge });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result.kind).toBe('verdict');
    if (result.kind !== 'verdict') throw new Error('unreachable');
    expect(result.decision).toEqual({
      kind: 'verdict',
      verdict: 'material',
      payload: { reason: 'claim reversed' },
      provenance: {
        producer: {
          kind: 'model',
          seat: 'candidate',
          taskId: 'materiality.judge.v1',
          stamp: { promptVersion: '1.4.0', modelId: 'materiality-test-model' },
        },
        evidenceDigests: [],
      },
    });
  });

  it('surfaces a not-material judge verdict unchanged too — the cheap gates never override the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: false })) };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.verdict.material).toBe(false);
    }
  });

  it('an onVerdict hook that throws never fails the evaluation it rode in on', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const onVerdict = vi.fn(() => {
      throw new Error('downstream consumer exploded');
    });
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
      onVerdict,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result.kind).toBe('verdict');
  });

  it('[DOS-C3] escalates a same-length edit (a sign flip) to the judge on its SECOND occurrence, even though its length delta is zero', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // First same-length edit (a sign flip): zero length delta, well under
    // the floor — deferred, not decided.
    const first = await trigger.evaluate(PATH, 'The reading was -5 degrees.');
    expect(first.kind).toBe('below-floor');
    expect(judge.judge).not.toHaveBeenCalled();

    // Second same-length edit on the same path, after debounce clears again
    // — the length gate already deferred once; it must not defer forever.
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      'The reading was -5 degrees, not +5.',
      'The reading was -5 degrees.',
    );
    expect(second.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it('[DOS-C3] escalates a same-length digit swap the same way a sign flip does', async () => {
    const store = new FakeStore();
    await seed(store, 'The count reached 3 units.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });
    const first = await trigger.evaluate(PATH, 'The count reached 9 units.');
    expect(first.kind).toBe('below-floor');

    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      'The count reached 9 units, confirmed twice.',
      'The count reached 9 units.',
    );
    expect(second.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it('[DOS-C3] escalates a negation-word insert (below the floor) on its second recurrence', async () => {
    const store = new FakeStore();
    await seed(store, 'The signal is present.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });
    // "not " inserted — 4 chars, under the 8-char floor.
    const first = await trigger.evaluate(PATH, 'The signal is not present.');
    expect(first.kind).toBe('below-floor');
    expect(judge.judge).not.toHaveBeenCalled();

    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      'The signal is not weak.',
      'The signal is not present.',
    );
    expect(second.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it('[DOS-C3] a below-floor edit does not permanently exempt the path — the accumulated delta against the ORIGINAL baseline eventually clears the floor', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers.', 0); // 17 chars
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // A below-floor edit is deferred (pending flag set); this test asserts
    // the delta-preservation property specifically: the persisted baseline
    // (hashes/canonicalLength) is NOT reset to the immediately-preceding
    // save on a below-floor, so a later comparison still measures against
    // the ORIGINAL baseline rather than a drifted one.
    await trigger.evaluate(PATH, 'Basalt weathers a.'); // +2 chars, below floor, pending set
    const record = await store.load(PATH);
    expect(record?.canonicalLength).toBe('Basalt weathers.'.length);

    // A later save on a FRESH trigger instance (simulating a new plugin
    // session with no in-memory pending state) still compares against the
    // ORIGINAL persisted baseline length, not a drifted one — a several-char
    // cumulative delta clears the floor in one step even without the
    // same-instance escalation path.
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const trigger2 = new MaterialityTrigger({ store, clock, judge });
    const result = await trigger2.evaluate(
      PATH,
      'Basalt weathers a great deal indeed.', // cumulative delta vs the ORIGINAL baseline clears the floor
      'Basalt weathers a.',
    );
    expect(result.kind).toBe('verdict');
  });

  it('[DOS-C3] a "stale response" race: an older in-flight judge call never marks newer content as processed', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);

    let resolveFirst: (v: { material: boolean }) => void = () => {};
    const firstCallPromise = new Promise<{ material: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const judge: MaterialityJudge = {
      judge: vi
        .fn()
        .mockImplementationOnce(() => firstCallPromise)
        .mockImplementationOnce(async () => ({ material: false, reason: 'reworded only' })),
    };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    // Start an older evaluation (a large edit, well clear of the floor); its
    // judge call hangs.
    const stalePromise = trigger.evaluate(
      PATH,
      'Basalt undergoes rapid chemical and physical weathering under acidic conditions.',
      'Basalt weathers quickly.',
    );

    // A newer evaluation for the SAME path starts and completes first (also
    // a large edit, so it clears the floor on its own terms too).
    const fresh = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry, low-acidity climates.',
      'Basalt undergoes rapid chemical and physical weathering under acidic conditions.',
    );
    expect(fresh.kind).toBe('verdict');

    // The older call's judge now resolves — its response must be dropped,
    // never committed as a baseline for content that has since moved on.
    resolveFirst({ material: true });
    const stale = await stalePromise;
    expect(stale).toEqual({ kind: 'judge-unavailable' });
  });

  it('a first sighting (no prior record) always calls the judge when one is configured and previousText is given', async () => {
    const store = new FakeStore();
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(0), judge });

    const result = await trigger.evaluate(PATH, 'Basalt weathers quickly.', '');

    expect(result.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  describe('defect 4 (ol-egov.141.89.5.7): an empty new note does not count as new material', () => {
    it("reports 'no-groundable-content', never 'judge-unavailable', for a brand new empty note", async () => {
      const store = new FakeStore();
      const judge: MaterialityJudge = { judge: vi.fn() };
      const trigger = new MaterialityTrigger({ store, clock: fakeClock(0), judge });

      // A genuinely new path — the store has never seen it — with no text
      // (an empty note just created), and so no previousText to hand either.
      const result = await trigger.evaluate(PATH, '');

      expect(result).toEqual({ kind: 'no-groundable-content' });
      expect(judge.judge).not.toHaveBeenCalled();
    });

    it('a later real edit to that same path is judged as an ordinary change, not another first sighting', async () => {
      const store = new FakeStore();
      const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
      const clock = steppedClock(0);
      const trigger = new MaterialityTrigger({ store, clock, judge });

      await trigger.evaluate(PATH, '');
      clock.set(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
      const result = await trigger.evaluate(PATH, 'Basalt weathers quickly in humid climates.', '');

      expect(result.kind).toBe('verdict');
      expect(judge.judge).toHaveBeenCalledWith({
        path: PATH,
        previousText: '',
        currentText: 'Basalt weathers quickly in humid climates.',
      });
    });

    it('a first sighting with real, non-empty content is unaffected — still calls the judge', async () => {
      const store = new FakeStore();
      const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
      const trigger = new MaterialityTrigger({ store, clock: fakeClock(0), judge });

      const result = await trigger.evaluate(PATH, 'Basalt weathers quickly.', '');

      expect(result.kind).toBe('verdict');
      expect(judge.judge).toHaveBeenCalledOnce();
    });
  });
});

/**
 * `buildRegionAwareMaterialityRequest` — `[D-293]`'s target-request builder.
 * See `wiring.ts`'s own doc on that function for why it is not (yet) called
 * from `dispatchJudgeAndCommit` above.
 *
 * INV-3: every string here is coined. No course code, note title or wording
 * comes from any real vault.
 */
describe('buildRegionAwareMaterialityRequest', () => {
  it('attaches the purpose and computes regions from previous/current text', () => {
    const request = buildRegionAwareMaterialityRequest({
      path: PATH,
      previousText: 'one\ntwo\nthree\nfour\nfive',
      currentText: 'one\ntwo\nCHANGED\nfour\nfive',
      purpose: 'note-concepts',
    });
    expect(request.path).toBe(PATH);
    expect(request.purpose).toBe('note-concepts');
    expect(request.regions).toHaveLength(1);
    expect(request.regions[0]!.currentText).toContain('CHANGED');
  });

  it('reports no regions, and never a purpose-less request, for a cited-passage rewrite of nothing', () => {
    const request = buildRegionAwareMaterialityRequest({
      path: PATH,
      previousText: 'the mineral is stable at room temperature',
      currentText: 'the mineral is stable at room temperature',
      purpose: 'cited-passage',
    });
    expect(request.purpose).toBe('cited-passage');
    expect(request.regions).toEqual([]);
  });

  it('passes options through to the extractor (contextLines/mergeGapLines)', () => {
    const previous = 'a\nb\nc\nd\ne\nf\ng';
    const current = 'a\nb\nc\nCHANGED\ne\nf\ng';
    const wide = buildRegionAwareMaterialityRequest({
      path: PATH,
      previousText: previous,
      currentText: current,
      purpose: 'note-concepts',
      options: { contextLines: 3 },
    });
    const narrow = buildRegionAwareMaterialityRequest({
      path: PATH,
      previousText: previous,
      currentText: current,
      purpose: 'note-concepts',
      options: { contextLines: 0 },
    });
    expect(wide.regions[0]!.currentText.split('\n')).toHaveLength(7);
    expect(narrow.regions[0]!.currentText).toBe('CHANGED');
  });

  it('measures a materially smaller judge-input size on a realistic single-edit fixture', () => {
    // A coined, moderate-length note (five short sections) with exactly one
    // sentence changed in the fourth section — the common case row 1.4
    // exists for: one real edit inside an otherwise-unchanged file.
    const section = (heading: string, body: string) => `## ${heading}\n\n${body}\n`;
    const unchangedBody =
      'This section restates settled background material at some length ' +
      'so the fixture reads like a realistic study note rather than a toy ' +
      'example, without changing on either side of the edit under test.';
    const previousText = [
      section('Formation', unchangedBody),
      section('Cooling Rate', unchangedBody),
      section('Crystal Size', unchangedBody),
      section(
        'Weathering Behavior',
        'Different igneous rocks weather at different rates depending on ' +
          'their mineral composition and crystal size. Basalt weathers ' +
          'relatively quickly in humid climates because it typically ' +
          'contains reactive minerals such as olivine and pyroxene, which ' +
          'break down fast when exposed to water and oxygen over long ' +
          'periods of geological time.',
      ),
      section('Field Identification', unchangedBody),
    ].join('\n');
    const currentText = previousText.replace(
      'Basalt weathers relatively quickly in humid climates',
      'Basalt weathers unusually quickly in humid, low-pH climates',
    );
    expect(currentText).not.toBe(previousText);

    const request = buildRegionAwareMaterialityRequest({
      path: PATH,
      previousText,
      currentText,
      purpose: 'note-concepts',
    });

    // Rough token estimate: ~4 characters per token, the same heuristic
    // `docs/dev/intelligence-build/README.md` uses for a quick order-of-
    // magnitude check (never a billing figure).
    const wholeDocumentChars = previousText.length + currentText.length;
    const regionChars = request.regions.reduce(
      (sum, region) => sum + region.previousText.length + region.currentText.length,
      0,
    );
    const wholeDocumentTokensEstimate = Math.ceil(wholeDocumentChars / 4);
    const regionTokensEstimate = Math.ceil(regionChars / 4);
    // eslint-disable-next-line no-console -- reported in the bead's close evidence, not left as silent coverage.
    console.log(
      `[ol-egov.141.89.5.4] region-vs-whole-document estimate on fixture: ` +
        `whole document ~${wholeDocumentTokensEstimate} tokens (${wholeDocumentChars} chars) vs ` +
        `regions ~${regionTokensEstimate} tokens (${regionChars} chars), ` +
        `${request.regions.length} region(s)`,
    );

    expect(request.regions).toHaveLength(1);
    // The single changed sentence sits inside one ~1,700-character section
    // out of a ~2,300-character document; the region (context-padded) must
    // still be well under half the whole-document size to demonstrate the
    // "fewer input tokens per judgment" effect this bead exists to produce.
    expect(regionChars).toBeLessThan(wholeDocumentChars * 0.5);
  });
});
