/**
 * `[D-598]` (`ol-egov.141.89.5.135`): who decided each source-change verdict, kept on the records
 * that already hold source-change state — the file-level hash record (`MaterialityRecord.settledBy`,
 * `types.ts`) and the citation anchor with its pending fact (`CitationAnchorRecord.settledBy`,
 * `PendingRevalidation.raisedBy` and `.decidedBy`, `citation-hash-store.ts`).
 *
 * A producer is either the judge (`olea-core`'s `PersistedStageProducer` model arm: seat, task id
 * and the D7.3 stamp exactly as the response carried it, or `null`) or a code rule from the table
 * below, by id and version. The fields are optional and additive: a record written before this
 * change has none, and reads unknown (`readStoredProducer`), never a value guessed from its dates.
 *
 * **Nothing reads these to decide anything.** No production code branches on a producer, nothing
 * she sees changes, and no validator rejects a record or a hold because of one: a value this build
 * cannot read is kept as it was by every write that carries the record forward.
 *
 * **The rule table.** Each id names one deterministic rule as it lives in code today, at version 1.
 * The behaviour each version names is frozen by its golden table
 * (`test/ingestion/materiality/verdict-provenance.ol-egov.141.89.5.135.spec.ts`): a change to what a
 * rule does is a new version here, in the same change that alters the table, never the same number
 * reused. Ids and versions only; never content (D-005).
 */

import type { PersistedStageProducer } from 'olea-core';

/**
 * Every code rule that settles a source-change record, raises a hold, or decides a rewrite, with
 * the version of its behaviour.
 *
 * Settling a record (file level, `wiring.ts`):
 *  - `formatting-only`: the text's canonical form (`canonicalizeForMateriality`) equals the
 *    baseline's, so the edit is formatting; also the citation grain's own canonical-equality exit.
 *  - `no-groundable-content`: a first sighting whose canonical text is empty.
 * Settling a citation anchor (`citation-revision-wiring.ts`):
 *  - `passage-reformatted`: the passage ladder found the passage at its anchor unchanged in all but
 *    whitespace and line breaks (`via: 'exact'`).
 *  - `question-blocks-restripped`: a whole-note anchor saved before every question block was
 *    stripped holds the same material once stripped by the current rule, where equal canonical
 *    text alone does not settle it.
 *  - `olea-frontmatter-writes` (`[D-626]`, `ol-egov.141.89.2.39`): a whole cited note reads as its
 *    anchor once the frontmatter Olea writes itself is left out of both (a first-sight stamp, a home
 *    note's `topic:` growth or drafted-for record; `strip-olea-frontmatter.ts`'s
 *    `stripOleaFrontmatterWrites`, the input-note fingerprint's own strip), where
 *    the rules above do not settle it.
 * Where more than one anchor exit holds, the narrowest names it: the reformat, then
 * formatting-only, then the restrip, then Olea's own frontmatter writes.
 *  - `passage-relocated`: a passage-grain anchor's passage stands, exactly, in another note, and the
 *    anchor is healed there.
 *  - `relocated-exact`: a whole-note anchor's material stands, whitespace-normalised, in another
 *    tracked note (`classifyRelocation`'s exact match), and the anchor is healed there.
 *  - `passage-found-again`: a passage-grain anchor whose passage stands unchanged is re-seated: a
 *    hold for a passage reason lifts, a retired rule's digest moves to the current rule.
 *  - `first-sighting`: an instrument with no anchor (or an anchor withheld at first sighting, or one
 *    that holds no transcript passage yet) is baselined by the first-sighting rule.
 * Raising a hold:
 *  - `cited-text-differs`: the cited passage's text hashes differently from the anchor's.
 *  - `passage-unresolved`: the passage cannot be located (missing, ambiguous, a retired rule, a
 *    re-bind proposal, or a whole cited note with no groundable content).
 *  - `passage-seed-unresolved`: a citation's passage digest does not resolve to exactly one passage
 *    at first sighting.
 *  - `transcript-seed-unresolved`: a transcript citation cannot be seeded at the version it was
 *    drafted from.
 *  - `source-bytes-changed`: a cited non-markdown file's bytes differ from the recorded revision,
 *    or cannot be checked.
 *  - `input-note-changed` (`[D-626]`, `[D-628]`): a note a drafted item was drawn from no longer
 *    reads as its recorded fingerprint says (a content change past the code's free exits, or the
 *    note is gone or unreadable).
 *  - `input-notes-unrecorded` (`[D-628]`): an item drafted through a draft record was recorded
 *    before its input notes were, so its support cannot be established.
 * Deciding a rewrite:
 *  - `landed-source-rewrite`: re-extracted text for the very bytes a hold was raised for has
 *    landed, so the question is rewritten from it (`[D-518]`).
 *  - `transcript-part-unrelocatable`: a part-named transcript question whose part cannot be
 *    relocated in a version that reads is rewritten at whole grain (`[D-578]`).
 *  - `input-note-rewrite` (`[D-626]`, `[D-628]`): a hold raised by `input-note-changed` or
 *    `input-notes-unrecorded` is rewritten from the cited note as it stands, at whole-note grain,
 *    as a change to its cited note is.
 * A rewrite the judge decided is the model arm (task `materiality.judge.v1`), not a rule here.
 */
export const VERDICT_CODE_RULES = {
  'formatting-only': 1,
  'no-groundable-content': 1,
  'passage-reformatted': 1,
  'question-blocks-restripped': 1,
  'olea-frontmatter-writes': 1,
  'passage-relocated': 1,
  'relocated-exact': 1,
  'passage-found-again': 1,
  'first-sighting': 1,
  'cited-text-differs': 1,
  'passage-unresolved': 1,
  'passage-seed-unresolved': 1,
  'transcript-seed-unresolved': 1,
  'source-bytes-changed': 1,
  'landed-source-rewrite': 1,
  'transcript-part-unrelocatable': 1,
  'input-note-changed': 1,
  'input-notes-unrecorded': 1,
  'input-note-rewrite': 1,
} as const satisfies Readonly<Record<string, number>>;

export type VerdictCodeRule = keyof typeof VERDICT_CODE_RULES;

/** The stored producer for `rule` at its current version. A fresh object per call. */
export function codeRule(rule: VerdictCodeRule): PersistedStageProducer {
  return { kind: 'code', rule, ruleVersion: VERDICT_CODE_RULES[rule] };
}

/**
 * The `settledBy` a write that keeps the settled state carries: the record's own value, verbatim
 * (an unreadable one included), or no key at all when it had none — a legacy record gains nothing.
 */
export function carriedSettledBy(
  record: { readonly settledBy?: PersistedStageProducer | undefined } | null | undefined,
): { readonly settledBy?: PersistedStageProducer } {
  return record?.settledBy !== undefined ? { settledBy: record.settledBy } : {};
}

/** A content-free label for a caught error (D-005: an error message may name a path). */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
