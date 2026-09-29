/**
 * The vocabulary registry's section 25 forbidden uses, as a check that can fail
 * (`ol-egov.141.89.9.70` item 1, `[D-414]`, `ol-egov.141.89.48`).
 *
 * The registry ratifies the demand-grain gap sentence's SHAPE (what was found, which demand the
 * assessment asks for, where to look) and leaves its copy to a design pass; no such copy exists
 * yet, and none may be written without approval. What the registry does fix is what the sentence
 * may never do, "not a close call":
 *
 *  1. **Name the missing content** (the condition, value or step the material lacks). The
 *     sufficiency judgment's own statement of what is missing never reaches the sentence, so a
 *     sentence that repeats one of the judge's statements, or says in so many words that specific
 *     content is absent, is a violation. ({@link demandGapSentenceViolations}, `judgeStatements`.)
 *  2. **Print a verdict word** (`partial`, `insufficient`, `conflicting`, and `sufficient`, the
 *     fourth word of the same set) **or the word "demand" as a label**: the sentence speaks in the
 *     demand's plain words (registry section 13), not in the word for the concept.
 *  3. **Use a weakness or deficit word** (section 22), or read what she knows: a source gap is not a
 *     reading of her knowledge.
 *  4. **Sit inside an ordinary session**: it belongs to the gap view and the grove only
 *     ({@link DEMAND_GAP_SURFACES}); the existing refusal surfaces keep their own messages.
 *
 * This module is the mechanism, not the copy: it takes a sentence and the surface it is registered
 * on and returns every violation, and a copy pass that adds the sentence runs it through here
 * (`demand-gap-registry-25.spec.ts` pins the checker; `packages/plugin/test/gap/demand-gap-copy-
 * guard.spec.ts` pins that no gap-view copy exists to check today, and fails the moment one appears
 * without being checked). The word lists are declared, never fitted, and errs toward flagging: a
 * forbidden word or a listed word in another sense is a conflict to flag, not a judgement call
 * (`CLAUDE.md`, vocabulary registry). Pure. Reports the rule and the forbidden word matched, never
 * a judge statement's text.
 */

/** The only two surfaces the sentence may appear on (registry section 25, F4.10). */
export const DEMAND_GAP_SURFACES = ['gap-view', 'grove'] as const;
export type DemandGapSurface = (typeof DEMAND_GAP_SURFACES)[number];

export type DemandGapSentenceRule =
  | 'names-missing-content'
  | 'verdict-word'
  | 'demand-word'
  | 'weakness-word'
  | 'placement-outside-gap-view-and-grove';

export interface DemandGapSentenceViolation {
  readonly rule: DemandGapSentenceRule;
  /**
   * What matched: the forbidden word or phrase for a lexical rule, the offending surface for a
   * placement, and the position of the statement (`judge statement 1`) for a leak, never the
   * statement itself.
   */
  readonly matched: string;
}

export interface DemandGapSentenceContext {
  /** The surface the sentence is registered on. Anything but the gap view and the grove is a placement violation. */
  readonly surface: string;
  /** The sufficiency judgment's own statements (its `reason` and every `missing` item), which must not reach the sentence. */
  readonly judgeStatements?: readonly string[];
}

const VERDICT_WORDS = /\b(partial|insufficient|conflicting|sufficient)\b/gi;
const DEMAND_WORD = /\bdemands?\b/gi;

/** Section 22's deficit words, and their nearest comparable forms. Declared. */
const WEAKNESS_WORDS =
  /\b(weak\w*|struggl\w*|behind|catch(?:ing)? up|caught up|deficit\w*|poor\w*|bad(?:ly)?)\b/gi;

/** A statement about what she does or does not know: a source gap is not a reading of her. */
const READING_OF_HER =
  /\byou (?:do not|don't|haven't|have not|cannot|can't|didn't|did not) (?:know|understand|remember|master|learn(?:ed)?|do|get)\b/gi;

/** Phrases that say specific content is absent, which is the unsupported fact C4.7 refuses. */
const ABSENT_CONTENT =
  /\b(?:is|are) missing\b|\bmissing (?:the|a|an)\b|\black(?:s|ing)?\b|\b(?:do(?:es)? not|don't|doesn't) (?:contain|include|state|mention|cover)\b|\bno mention of\b/gi;

/** A leaked judge statement of this many words or more is matched on a run of this length; shorter ones must appear whole. */
const LEAK_RUN_WORDS = 4;
const MIN_STATEMENT_CHARS = 4;

function words(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word.length > 0);
}

function containsRun(haystack: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0 || run.length > haystack.length) return false;
  for (let start = 0; start + run.length <= haystack.length; start += 1) {
    if (run.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/** The judge statement numbers (1-based) the sentence repeats: whole, when short, or on a run of consecutive words, when long. */
function leakedStatements(sentence: string, statements: readonly string[]): readonly number[] {
  const sentenceWords = words(sentence);
  const leaked: number[] = [];
  statements.forEach((statement, index) => {
    if (statement.trim().length < MIN_STATEMENT_CHARS) return;
    const statementWords = words(statement);
    if (statementWords.length === 0) return;
    const leaks =
      statementWords.length <= LEAK_RUN_WORDS
        ? containsRun(sentenceWords, statementWords)
        : statementWords.some(
            (_, start) =>
              start + LEAK_RUN_WORDS <= statementWords.length &&
              containsRun(sentenceWords, statementWords.slice(start, start + LEAK_RUN_WORDS)),
          );
    if (leaks) leaked.push(index + 1);
  });
  return leaked;
}

function distinctMatches(
  sentence: string,
  pattern: RegExp,
  rule: DemandGapSentenceRule,
): DemandGapSentenceViolation[] {
  const seen = new Set<string>();
  const found: DemandGapSentenceViolation[] = [];
  for (const match of sentence.matchAll(pattern)) {
    const matched = match[0].toLowerCase();
    if (seen.has(matched)) continue;
    seen.add(matched);
    found.push({ rule, matched });
  }
  return found;
}

/**
 * Every registry section 25 violation in `sentence`, on `context.surface`. Empty means the sentence
 * breaks none of the four forbidden uses; it does not mean the sentence is approved copy.
 */
export function demandGapSentenceViolations(
  sentence: string,
  context: DemandGapSentenceContext,
): readonly DemandGapSentenceViolation[] {
  const violations: DemandGapSentenceViolation[] = [];

  for (const number of leakedStatements(sentence, context.judgeStatements ?? [])) {
    violations.push({ rule: 'names-missing-content', matched: `judge statement ${number}` });
  }
  violations.push(...distinctMatches(sentence, ABSENT_CONTENT, 'names-missing-content'));
  violations.push(...distinctMatches(sentence, VERDICT_WORDS, 'verdict-word'));
  violations.push(...distinctMatches(sentence, DEMAND_WORD, 'demand-word'));
  violations.push(...distinctMatches(sentence, WEAKNESS_WORDS, 'weakness-word'));
  violations.push(...distinctMatches(sentence, READING_OF_HER, 'weakness-word'));

  if (!(DEMAND_GAP_SURFACES as readonly string[]).includes(context.surface)) {
    violations.push({
      rule: 'placement-outside-gap-view-and-grove',
      matched: context.surface,
    });
  }
  return violations;
}
