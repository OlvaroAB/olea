/**
 * A labelled synthetic query set — answerable / unanswerable / near-miss —
 * matching the RATIFIED grounding set's shape
 * (`olea-service/eval/grounding/grounding-set-v1.0.1.json`: `id`, `kind`,
 * `query`, `course`, `reasoning`) over `./retrieval-corpus.js`'s coined
 * vocabulary (`olea-service`'s `ol-opmb.2` [TB-2]).
 *
 * ## Why three labels, not the real set's nested `kind`/`subkind`
 *
 * The ratified set nests `unanswerable` into `gibberish` / `out-of-syllabus` /
 * `near-miss` subkinds. The parent and this bead's own brief both state the
 * split flatly as "answerable / unanswerable / near-miss" — three siblings,
 * not two-plus-a-nested-three — so `QueryLabel` mirrors that flat shape
 * rather than reproducing the real set's nesting for no reason this corpus
 * needs.
 *
 * ## Which query gets which label, and why
 *
 * `conceptToken` ties each labelled query to `retrieval-corpus.ts`'s own
 * coverage classes, so the label is a claim about ACTUAL corpus shape rather
 * than a guess:
 *
 *  - `answerable` — one query per `RICH_CONCEPT_TOKENS` (11 blocks each):
 *    real keyword and semantic signal to ground on.
 *  - `near-miss` — one query per `SPARSE_CONCEPT_TOKENS` (3 blocks each):
 *    her material names the concept, barely.
 *  - `unanswerable` — one query per `ABSENT_CONCEPT_TOKENS` (curriculum-cited,
 *    zero corpus blocks) plus pure gibberish with no vocabulary token and no
 *    real word at all (mirrors the ratified set's own gibberish subkind,
 *    `gib-01`: `"zzqx wibblefrotz nnnk"`).
 *
 * ## The hard limit (parent bead, `ol-opmb`)
 *
 * Which `GroundingRefusalReason` (or `'grounded'`) each of these queries
 * ACTUALLY produces against real embeddings is not predicted or asserted
 * here — retrieval ranking quality on this coined-token corpus is
 * uninterpretable by construction, so `retrieve.ts`'s workbench states cite
 * specific query ids only after an empirical, once-embedded run showed which
 * mechanism each one demonstrates. This file only asserts the INTENT behind
 * each query's construction (does it target rich/sparse/absent coverage),
 * never the outcome.
 *
 * ## INV-3
 *
 * Same discipline as `retrieval-corpus.ts`: vetted vocabulary tokens, a
 * small closed list of ordinary English words, bare numbers, or (for the
 * gibberish query only) letter strings that are not real words in any
 * language and were never entered anywhere near a real vault — the same
 * device the ratified set's own `gib-01` uses.
 */

import {
  ABSENT_CONCEPT_TOKENS,
  RICH_CONCEPT_TOKENS,
  SPARSE_CONCEPT_TOKENS,
} from './retrieval-corpus.js';

export type QueryLabel = 'answerable' | 'unanswerable' | 'near-miss';

export interface SyntheticQuery {
  readonly id: string;
  readonly label: QueryLabel;
  readonly query: string;
  /** The concept token this query targets, or `null` for the pure-gibberish case. */
  readonly conceptToken: string | null;
  readonly reasoning: string;
}

function answerableQuery(token: string, index: number): SyntheticQuery {
  return {
    id: `ans-${String(index).padStart(2, '0')}`,
    label: 'answerable',
    query: `What do the notes say about ${token}?`,
    conceptToken: token,
    reasoning: `${token} is one of retrieval-corpus.ts's RICH_CONCEPT_TOKENS — 11 varied passages, real keyword and semantic signal.`,
  };
}

function nearMissQuery(token: string, index: number): SyntheticQuery {
  return {
    id: `near-${String(index).padStart(2, '0')}`,
    label: 'near-miss',
    query: `What do the notes say about ${token}?`,
    conceptToken: token,
    reasoning: `${token} is one of retrieval-corpus.ts's SPARSE_CONCEPT_TOKENS — named in only 3 thin passages.`,
  };
}

function unanswerableAbsentQuery(token: string, index: number): SyntheticQuery {
  return {
    id: `unans-${String(index).padStart(2, '0')}`,
    label: 'unanswerable',
    query: `What do the notes say about ${token}?`,
    conceptToken: token,
    reasoning: `${token} is one of retrieval-corpus.ts's ABSENT_CONCEPT_TOKENS — curriculum-cited elsewhere in this package, never mentioned in the retrieval corpus at all.`,
  };
}

/**
 * Pure nonsense: no vocabulary token, no real word in any language, carried
 * over in spirit from the ratified set's own `gib-01`
 * (`"zzqx wibblefrotz nnnk"`) rather than reusing its exact string, so this
 * corpus's adversarial case is not a copy of the private eval set's fixture.
 */
const GIBBERISH_QUERY: SyntheticQuery = {
  id: 'unans-gib-01',
  label: 'unanswerable',
  query: 'vrelqz xoffnamp thwiggle nzzrkt',
  conceptToken: null,
  reasoning:
    "Pure nonsense — no vocabulary token, no real word in any language. Mirrors the ratified set's own gibberish subkind (gib-01).",
};

/** The whole labelled query set — 4 answerable + 2 near-miss + 2 unanswerable-absent + 1 gibberish = 9 queries. */
export const QUERIES: readonly SyntheticQuery[] = [
  ...RICH_CONCEPT_TOKENS.map((token, i) => answerableQuery(token, i + 1)),
  ...SPARSE_CONCEPT_TOKENS.map((token, i) => nearMissQuery(token, i + 1)),
  ...ABSENT_CONCEPT_TOKENS.map((token, i) => unanswerableAbsentQuery(token, i + 1)),
  GIBBERISH_QUERY,
];

export function findQuery(id: string): SyntheticQuery | undefined {
  return QUERIES.find((q) => q.id === id);
}

/** Every distinct query string in the set — what a precompute pass needs to embed alongside the corpus. */
export function queryTexts(): readonly string[] {
  return QUERIES.map((q) => q.query);
}
