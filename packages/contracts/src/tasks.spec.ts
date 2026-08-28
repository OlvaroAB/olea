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
import { ALL_TASK_IDS, isKnownTaskId, knownTaskId, TASK_ENDPOINT_PATH, TASK_IDS } from './tasks.js';

describe('the closed task-id catalogue', () => {
  it('is exactly these fourteen ids, spelled exactly this way', () => {
    // Golden list. Changing it is a contract change: it must move together with
    // the Worker's prompt directory names and be recorded on the owning bead.
    expect(ALL_TASK_IDS).toEqual([
      'cards.generate.v1',
      'concepts.classify.v1',
      'concepts.extract.v1',
      'concepts.relations.v1',
      'explain-back.judge.v1',
      'explain-back.solo.v1',
      'explain-why.generate.v1',
      'grounding.judge.v1',
      'materiality.judge.v1',
      'oracle.rank.v1',
      'quiz.generate.v1',
      'retrieval.embed.v1',
      'retrieval.rerank.v1',
      'sections.summarize.v1',
    ]);
  });

  it('covers every workload shape that reaches a model (cost model §1)', () => {
    // W1 retrieval (×2: embed, rerank), W3 bulk generation (×3), W4 corpus
    // reasoning (concept extraction), W5 interactive, W6 judgment (×4:
    // explain-back, grounding support check, knowledge-kind classification,
    // materiality verdict), W7 long-context. W2 perception is deliberately
    // absent: it is reached *through* an ingestion task rather than called
    // directly by the client (P3-T04 routes to Slot V below the yield
    // threshold).
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
    expect(ALL_TASK_IDS).toHaveLength(14);
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
