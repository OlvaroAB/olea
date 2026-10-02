// PERMANENT GUARD — the closed task-id catalogue (C4.1–C4.3; see tasks.ts's
// header for why "frozen" no longer describes it — ol-jnt0).
//
// A task id is the join key between the client call site, the Worker's routing
// table, the versioned prompt directory (C4.3) and the D-005 telemetry record.
// A rename that compiles cleanly still breaks all four joins *silently* — the
// call 404s, and a semester of cost data loses the rows it used to group by.
// So the literal strings are asserted here, not just their types: this suite
// exists to make a rename a deliberate, visible act.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ALL_TASK_IDS,
  isKnownTaskId,
  isValidRemainingAllowanceUsd,
  knownTaskId,
  refineSourceChunkOriginAlignment,
  SOURCE_CHUNK_ORIGIN_TASK_IDS,
  sourceBlockOriginField,
  sourceChunkOriginsField,
  TASK_ENDPOINT_PATH,
  TASK_IDS,
} from './tasks.js';

describe('the closed task-id catalogue', () => {
  it('is exactly these twenty-five ids, spelled exactly this way', () => {
    // Golden list. Changing it is a contract change: it must move together with
    // the Worker's prompt directory names and be recorded on the owning bead.
    expect(ALL_TASK_IDS).toEqual([
      'audio.transcribe.v1',
      'cards.generate.v1',
      'concepts.classify.v1',
      'concepts.extract.v1',
      'concepts.relations.v1',
      'demand.classify.v1',
      'explain-back.author.v1',
      'explain-back.judge.v1',
      'explain-back.solo.v1',
      'explain-why.generate.v1',
      'grounding.judge.v1',
      'grounding.judge.v2',
      'materiality.judge.v1',
      'oracle.rank.v1',
      'outcomes.align.v1',
      'outcomes.extract.v1',
      'plan.governor.v1',
      'probe-application.generate.v1',
      'probe-application.solve.v1',
      'quiz.generate.v1',
      'retrieval.embed.v1',
      'retrieval.rerank.v1',
      'sections.summarize.v1',
      'vision.extract.v1',
      'vision.extract.v2',
    ]);
  });

  it('covers every workload shape that reaches a model (cost model §1)', () => {
    // W1 retrieval (×2: embed, rerank), W2 perception (vision extraction), W3
    // bulk generation (×3), W4 corpus reasoning (concept extraction), W5
    // interactive, W6 judgment (×4: explain-back, grounding support check,
    // knowledge-kind classification, materiality verdict), W7 long-context.
    //
    // `vision.extract.v1` (`[D-153]` / `ol-egov.53`, built by `ol-3ux7.33`) is
    // W2's entry, minted once `[D-141]`'s deferral condition (`ol-5ggh`)
    // fired — see its own doc comment in `tasks.ts` for the measurement
    // history and for why it is reserved-and-routed but deliberately not yet
    // functional (no image forwarding, no grounding contract — both are the
    // consuming feature's job, flagged there as a hand-back rather than a
    // silent gap).
    //
    // W4's `concepts.extract.v1` was reserved rather than registered here from
    // P3-T02 onward — this comment used to be the reminder that its absence
    // was a decision, not an omission. EXT-7 (`ol-5nle`) is that decision
    // arriving: the client-side reading stage (`ol-2zfj.1`,
    // `packages/core/src/concept/read.ts`) needed a join key to reach the
    // service, and this is it.
    //
    // `retrieval.rerank.v1` and `grounding.judge.v1` (Run 13 Ruling 1) close the
    // near-miss gap E6 (olea-service) measured: no mechanical signal over
    // independent embeddings separates "her notes NAME this" from "her notes
    // ANSWER this". Both read the query and the candidate content TOGETHER.
    //
    // `concepts.classify.v1` (`[D-114]`, KCT-2 `ol-fx1k`) is component register
    // row 1.5's classifier: a verdict over a concept plus its source material,
    // grouped with W6 alongside the other two judgment-shaped tasks rather than
    // with W4's concept extraction, because it judges rather than generates.
    //
    // `concepts.relations.v1` (`[D-118]`, EXT-11 `ol-kw4a`) is the corpus-level
    // relation verdict `[EXT-5]` (`ol-2zfj.7`) left with no task id: grouped
    // with W4 alongside `concepts.extract.v1` (both propose relation edges over
    // real material) rather than with W6's judgments, since a verdict over a
    // candidate pair that may abstain is closer to this stage's own shape than
    // to a closed-label classification.
    //
    // `materiality.judge.v1` (register row 1.4, `TRG-1` `ol-tqy3`, reserved by
    // `ol-2zfj.18`) is the fourth W6 judgment: a verdict over a changed file's
    // previous/current text, grouped with `concepts.classify.v1` and
    // `grounding.judge.v1` for the same "judging, not generating" reason.
    //
    // `explain-back.solo.v1` (`ol-95vv.2` [MAT-5], `[D-117]`) is the fifth W6
    // judgment: the SOLO depth verdict on an explain-back response that
    // already exists (structure, not correctness) — grouped with W6 rather
    // than treated as a second generation task for the same "judging, not
    // generating" reason `explain-back.judge.v1` itself is.
    //
    // `audio.transcribe.v1` (`ol-p4t01`, `[D-007]`, F5.1) carries no W-number
    // at all — see this id's own doc comment in `tasks.ts`. It is reserved,
    // not yet served: `whisper-large-v3-turbo` has no measured output ceiling
    // (`ol-91sr`'s "measure before pinning" rule), so the length below counts
    // it as spellable, not as live.
    //
    // `plan.governor.v1` (`[D-157]`, `ol-itkl`) also carries no W-number: it
    // serves the shadow-observer experiment's pre-registered measurement, not
    // a production workload — see its doc comment in `tasks.ts`. Counted as
    // spellable, not as a workload shape.
    //
    // `explain-back.author.v1` (`[D-165]`, `ol-c0rz`) likewise: it authors
    // synthetic answers for the tier-3 harness's supplementary source on a
    // different model family from the judge — harness-only, no W-number.
    //
    // `outcomes.extract.v1` (`[D-254]`, `ol-2jod.21`) is W4's second entry,
    // grouped with `concepts.extract.v1` and `concepts.relations.v1` for the
    // same reason: it proposes entities (an Outcome, a paper section) read
    // out of her material with a required grounding contract, rather than
    // judging something that already exists. Reserved, not yet served with a
    // production caller — see its own doc comment in `tasks.ts`.
    //
    // `probe-application.generate.v1`/`probe-application.solve.v1`
    // (`[D-263]` rulings 1 and 4, C4.8, `[PROBE-3]` `ol-0r92.79`, reserved
    // and routed by `[PROBE-6]` `ol-0r92.81`) carry no W-number as a pair:
    // the writer is Slot G bulk generation and the independent blind
    // solver is Slot J reasoning-from-source — see each id's own doc
    // comment in `tasks.ts` for the "different family" fence and why the
    // two are never resolved by a third model call (`[D-231]`). A named
    // production caller is still owed by `[PROBE-5]` (`ol-v7r5.46`)'s
    // still-open design ruling.
    //
    // `outcomes.align.v1` and `demand.classify.v1` (`[D-431]`, ruled 2026-09-29 on
    // decision-sheet row 18, built by `ol-egov.141.89.7.24`) are two more W6
    // judgments: a verdict over records and a closed concept list (which listed
    // concepts a record attests), and a verdict over one question part read in
    // its full context (which of `[D-262]`'s five demands, a compound of two,
    // unsupported, or cannot-tell). Both judge material already given rather
    // than generate, so they sit with `concepts.classify.v1` and
    // `grounding.judge.v1`. See each id's own doc comment in `tasks.ts`; the
    // client production caller is the wire stage (`ol-egov.141.89.7.5`).
    //
    // `vision.extract.v2` (`[D-325]`, `ol-egov.141.89.8.7`, registered by
    // `ol-egov.141.89.8.18`) is NOT a second workload shape — it is W2's
    // same perception entry, served beside `v1` only because this file's own
    // naming rule gives an incompatible response shape a new id rather than
    // breaking `v1`'s live client consumer. See `vision.extract.v2`'s own
    // doc comment in `tasks.ts` for what the shape change is.
    expect(ALL_TASK_IDS).toHaveLength(25);
  });

  it('follows <domain>.<verb>.v<N> without exception', () => {
    for (const id of ALL_TASK_IDS) {
      expect(id).toMatch(/^[a-z][a-z-]*\.[a-z][a-z-]*\.v[1-9]\d*$/);
    }
  });

  it('has no duplicate values behind distinct keys', () => {
    const values = Object.values(TASK_IDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('accepts catalogue ids and rejects anything else', () => {
    expect(knownTaskId.safeParse('cards.generate.v1').success).toBe(true);
    // A plausible near-miss — the shape a typo actually takes.
    expect(knownTaskId.safeParse('cards.generate.v2').success).toBe(false);
    expect(knownTaskId.safeParse('cards.generate').success).toBe(false);
    expect(isKnownTaskId('oracle.rank.v1')).toBe(true);
    expect(isKnownTaskId('oracle.rank')).toBe(false);
  });

  it('pins the single task endpoint path', () => {
    expect(TASK_ENDPOINT_PATH).toBe('/v1/task');
  });
});

// [D-333]/[D-341] client wire half (ol-3ux7.103): the optional
// remaining-allowance field's one shared validation rule.
describe('isValidRemainingAllowanceUsd', () => {
  it('accepts zero and positive finite numbers', () => {
    expect(isValidRemainingAllowanceUsd(0)).toBe(true);
    expect(isValidRemainingAllowanceUsd(0.5)).toBe(true);
    expect(isValidRemainingAllowanceUsd(1_000)).toBe(true);
  });

  it('rejects negative numbers, non-finite numbers, and non-numbers rather than throwing', () => {
    expect(isValidRemainingAllowanceUsd(-0.01)).toBe(false);
    expect(isValidRemainingAllowanceUsd(Number.NaN)).toBe(false);
    expect(isValidRemainingAllowanceUsd(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidRemainingAllowanceUsd('1.5')).toBe(false);
    expect(isValidRemainingAllowanceUsd(undefined)).toBe(false);
    expect(isValidRemainingAllowanceUsd(null)).toBe(false);
  });
});

// `ol-egov.141.89.1.67` / [D-465]: the optional per-passage transcript origin fragment.
describe('sourceChunkOrigins (per-passage transcript origin)', () => {
  const request = z
    .object({ sourceChunks: z.array(z.string()), sourceChunkOrigins: sourceChunkOriginsField })
    .superRefine(refineSourceChunkOriginAlignment);
  const origin = { kind: 'transcript', speakerRole: 'lecturer' } as const;

  it("an absent field is valid (today's request)", () => {
    expect(request.safeParse({ sourceChunks: ['a', 'b'] }).success).toBe(true);
  });

  it('a null entry is valid, beside a transcript entry with and without flags', () => {
    const parsed = request.safeParse({
      sourceChunks: ['a', 'b', 'c'],
      sourceChunkOrigins: [
        null,
        origin,
        { ...origin, speakerRole: 'unknown', flags: ['inaudible'] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('a misaligned length is rejected, shorter and longer', () => {
    expect(
      request.safeParse({ sourceChunks: ['a', 'b'], sourceChunkOrigins: [origin] }).success,
    ).toBe(false);
    expect(
      request.safeParse({ sourceChunks: ['a'], sourceChunkOrigins: [origin, null] }).success,
    ).toBe(false);
  });

  it('an unknown role, flag or kind is rejected', () => {
    const bad = (entry: unknown) =>
      request.safeParse({ sourceChunks: ['a'], sourceChunkOrigins: [entry] }).success;
    expect(bad({ ...origin, speakerRole: 'student' })).toBe(false);
    expect(bad({ ...origin, flags: ['mumbled'] })).toBe(false);
    expect(bad({ ...origin, kind: 'note' })).toBe(false);
  });

  it('no speaker name can travel: an extra key is rejected', () => {
    expect(
      request.safeParse({
        sourceChunks: ['a'],
        sourceChunkOrigins: [{ ...origin, speakerName: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('names the seven source-reading tasks, none of which is a task without sourceChunks', () => {
    expect([...SOURCE_CHUNK_ORIGIN_TASK_IDS]).not.toContain('grounding.judge.v1');
    expect([...SOURCE_CHUNK_ORIGIN_TASK_IDS]).not.toContain('explain-back.judge.v1');
    expect(SOURCE_CHUNK_ORIGIN_TASK_IDS).toHaveLength(7);
  });
});

// `ol-egov.141.89.1.69` / [D-465]: explain-back.judge's per-block origin.
describe('sourceBlockOrigin (explain-back.judge per-block transcript origin)', () => {
  const block = z.object({
    blockId: z.string().min(1),
    text: z.string().min(1),
    origin: sourceBlockOriginField,
  });
  const request = z.object({ sourceBlocks: z.array(block) });
  const origin = { kind: 'transcript', speakerRole: 'lecturer' } as const;
  const one = (extra: Record<string, unknown>) =>
    request.safeParse({ sourceBlocks: [{ blockId: 'b1', text: 't', ...extra }] }).success;

  it('absent is valid', () => {
    expect(one({})).toBe(true);
  });
  it('null is valid, and a transcript origin with or without flags', () => {
    expect(one({ origin: null })).toBe(true);
    expect(one({ origin })).toBe(true);
    expect(one({ origin: { ...origin, speakerRole: 'unknown', flags: ['inaudible'] } })).toBe(true);
  });
  it('an unknown role, flag or kind is rejected', () => {
    expect(one({ origin: { ...origin, speakerRole: 'student' } })).toBe(false);
    expect(one({ origin: { ...origin, flags: ['mumbled'] } })).toBe(false);
    expect(one({ origin: { ...origin, kind: 'note' } })).toBe(false);
  });
  it('an extra key is rejected, so no speaker name can travel', () => {
    expect(one({ origin: { ...origin, speakerName: 'x' } })).toBe(false);
  });
  it('misalignment cannot occur: the origin rides on its block', () => {
    expect(one({ origin: [origin] })).toBe(false);
  });
});
