// PERMANENT GUARD — the frozen task-id catalogue (P3-T02, C4.1–C4.3).
//
// A task id is the join key between the client call site, the Worker's routing
// table, the versioned prompt directory (C4.3) and the D-005 telemetry record.
// A rename that compiles cleanly still breaks all four joins *silently* — the
// call 404s, and a semester of cost data loses the rows it used to group by.
// So the literal strings are asserted here, not just their types: this suite
// exists to make a rename a deliberate, visible act.
import { describe, expect, it } from 'vitest';
import { ALL_TASK_IDS, isKnownTaskId, knownTaskId, TASK_ENDPOINT_PATH, TASK_IDS } from './tasks.js';

describe('the frozen task-id catalogue', () => {
  it('is exactly these nine ids, spelled exactly this way', () => {
    // Golden list. Changing it is a contract change: it must move together with
    // the Worker's prompt directory names and be recorded on the owning bead.
    expect(ALL_TASK_IDS).toEqual([
      'cards.generate.v1',
      'explain-back.judge.v1',
      'explain-why.generate.v1',
      'grounding.judge.v1',
      'oracle.rank.v1',
      'quiz.generate.v1',
      'retrieval.embed.v1',
      'retrieval.rerank.v1',
      'sections.summarize.v1',
    ]);
  });

  it('covers every workload shape that reaches a model (cost model §1)', () => {
    // W1 retrieval (×2: embed, rerank), W3 bulk generation (×3), W5
    // interactive, W6 judgment (×2: explain-back, grounding support check),
    // W7 long-context. W2 perception and W4 corpus reasoning are deliberately
    // absent: W2 is reached *through* an ingestion task rather than called
    // directly by the client (P3-T04 routes to Slot V below the yield
    // threshold), and W4's concept extraction is a P5 task whose payload shape
    // does not exist yet. Both are registered when their bead lands, and this
    // comment is the reminder that their absence is a decision, not an omission.
    //
    // `retrieval.rerank.v1` and `grounding.judge.v1` (Run 13 Ruling 1) close the
    // near-miss gap E6 (olea-service) measured: no mechanical signal over
    // independent embeddings separates "her notes NAME this" from "her notes
    // ANSWER this". Both read the query and the candidate content TOGETHER.
    expect(ALL_TASK_IDS).toHaveLength(9);
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
