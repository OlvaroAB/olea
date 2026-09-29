/**
 * The ask a practice need carries, from each origin, before it is routed to a generator
 * (`[D-437]`; design `docs/dev/intelligence-build/demand-carriage.md` §4 and §4.1, in the
 * `olea-service` repo, cited by path; row 35 of the 2026-09-29 rulings).
 *
 * **The words she wrote are the primary request; the mapping onto the five demand words is a
 * secondary reading of them (row 35).** A heading travels whole, with the question word read from
 * it, in `DemandAsk.source`; `DemandAsk.mapping` is `demandForHeading`'s answer, which can be a word
 * (`mapped`), the honest statement that the words alone fix no operation (`unmapped`), or, only
 * when nothing at all was asked, `none`. "How" alone is not a complete demand: a question word
 * never travels or maps without its heading, and a heading with a question word and no mapping is
 * `underspecified`, never "no demand". So an ask cannot silently vanish here.
 *
 * **Transient.** Nothing in this module is persisted, and none of it reaches a stored record: the
 * heading in her note is the durable source and the ask is re-derived from it each time
 * (`demandForHeading` is pure). A cross-session record of unmet asks would be a new persisted shape
 * (Class C; design Open question 4).
 *
 * **Which asks are `outside-vocabulary` and which `underspecified` is the taxonomy ruling's cue
 * list** (`demand-taxonomy-proposal.md`; design Open question 7), which does not exist yet. Until
 * it does, every heading with no mapping is `underspecified` (kept with its source, neither served
 * nor called unsupported), so none is dropped and none is coerced. `outside-vocabulary` is a value
 * a future cue list produces; nothing here does.
 *
 * **One declared constant, for one origin.** {@link SWEEP_RECALL_ASK} is explicit recall intent for
 * the ordinary generation sweep and no other origin (row 38: authoring intent only; it establishes
 * neither recall coverage nor recall evidence). `demand-ask-callers.spec.ts` pins that no source
 * file outside the sweep refers to it.
 */

import { stripEmphasis } from '../heading-offer/detect.js';
import { demandForHeading } from '../heading-offer/operation.js';
import type { InstrumentDemandReading } from '../instrument/demand-reading.js';
import type { InstrumentTargetOrigin } from '../instrument/target-store.js';
import type { PaperDemand } from '../oracle/paper-types.js';

/** Where a need came from. The record's own origins, plus the paper slot (which hands off, and is checked by `[D-438]`, rather than being authored for a practice need). */
export type DemandOrigin = InstrumentTargetOrigin | 'paper-slot';

/** The words the ask was read from, exactly as she wrote them. */
export interface AskSource {
  /** The heading exactly as it was given: never trimmed inside, never normalised, never reduced to a mapped word. */
  readonly heading: string;
  /** The question word read from it, as written (case kept); `null` when the heading has none. Never a mapped word. */
  readonly questionWord: string | null;
}

/** The secondary reading of the ask onto `[D-262]`'s five words. */
export type DemandMapping =
  | { readonly kind: 'mapped'; readonly demand: PaperDemand }
  /**
   * `outside-vocabulary`: an attested operation no word covers (explain how, discuss, critically
   * analyse). `underspecified`: the words alone fix no operation (a bare how or why). Neither is
   * ever coerced to a word and neither reads as `none`. `operation` is the taxonomy ruling's label,
   * absent until that ruling exists.
   */
  | {
      readonly kind: 'unmapped';
      readonly reason: 'outside-vocabulary' | 'underspecified';
      readonly operation?: string;
    }
  /** Nothing was asked: no heading and no declared constant. */
  | { readonly kind: 'none' };

export interface DemandAsk {
  /** PRIMARY. `null` only for a need that did not come from a heading (the sweep constant, a planner need, a revision, a paper slot). */
  readonly source: AskSource | null;
  /** SECONDARY. */
  readonly mapping: DemandMapping;
}

/**
 * The words that open a question and name what is asked. The same closed list `heading-offer/
 * detect.ts` uses for its wh-inversion rule, restated here because that list is private to its
 * module. Declared, not fitted.
 */
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  'who',
  'whom',
  'whose',
  'what',
  'which',
  'when',
  'where',
  'why',
  'how',
]);

/**
 * The question word read from `heading`, as written, or `null`: the first wh-word anywhere in the
 * heading ("What is X" and "Explain how X works" both have one; "Does X extend Y" has none, since a
 * yes/no question has no question word). It travels beside the whole heading and never stands for
 * it. Pure.
 */
export function questionWordOf(heading: string): string | null {
  for (const token of stripEmphasis(heading).split(/[^\p{L}]+/u)) {
    if (token !== '' && QUESTION_WORDS.has(token.toLowerCase())) return token;
  }
  return null;
}

/** Nothing was asked. Frozen: a shared value, never mutated. */
export const NO_DEMAND_ASKED: DemandAsk = Object.freeze({
  source: null,
  mapping: Object.freeze({ kind: 'none' } as const),
});

/**
 * Builds the ask from one heading: the full heading and its question word as the primary request,
 * and `demandForHeading`'s reading as the secondary one. A word gives `mapped`; no word gives
 * `unmapped` (`underspecified`, until the taxonomy's cue list exists), never `none`, so the ask
 * cannot silently vanish. A blank heading asks nothing.
 *
 * This is `demandForHeading`'s production caller (through the heading offer's accept path,
 * `packages/plugin/src/review/heading-offer.ts`).
 */
export function askFromHeading(headingText: string): DemandAsk {
  if (stripEmphasis(headingText) === '') return NO_DEMAND_ASKED;
  const source: AskSource = { heading: headingText, questionWord: questionWordOf(headingText) };
  const demand = demandForHeading(headingText);
  return {
    source,
    mapping:
      demand === undefined
        ? { kind: 'unmapped', reason: 'underspecified' }
        : { kind: 'mapped', demand },
  };
}

/**
 * A demand named directly, with no heading behind it: a planner need for an unmet demand
 * (`[D-414]`'s demand-grain need, not built yet), a paper slot's intended demand, or a
 * predecessor's declared demand restated on a revision.
 */
export function askFromDemand(demand: PaperDemand): DemandAsk {
  return { source: null, mapping: { kind: 'mapped', demand } };
}

/**
 * The explicit recall intent for the ordinary generation sweep (row 38): the sweep is meant to
 * generate recall practice, so it says so. **Authoring intent only.** It establishes neither recall
 * coverage nor recall evidence, the produced instrument's response form is read from its answer
 * options (a multiple-choice item reads as recognition), and no other origin uses this constant.
 *
 * @provenance declared
 */
export const SWEEP_RECALL_ASK: DemandAsk = Object.freeze({
  source: null,
  mapping: Object.freeze({ kind: 'mapped', demand: 'recall-a-fact' } as const),
});

/**
 * The ask a revision restates from its predecessor's demand reading. Only a `declared` reading is
 * restated. A `stale` one (the block was edited after the record was written, so the demand no
 * longer describes the block the successor replaces), an `unspecified` one (no record: history is
 * never upgraded) and an `unreadable` one give `NO_DEMAND_ASKED`, so the successor is authored
 * exactly as today. Never a guess.
 */
export function askFromInstrumentReading(reading: InstrumentDemandReading): DemandAsk {
  return reading.kind === 'declared' ? askFromDemand(reading.demand) : NO_DEMAND_ASKED;
}
