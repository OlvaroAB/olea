/**
 * `formatClassOf` — the declared word→class mapping F4.8 uses to pick a
 * practice format (`[D-246]` / `[VOC-7]`).
 *
 * **Her `type` stays her word.** `readAssessments` (./read.ts) preserves
 * `AssessmentRecord.type` verbatim — no rename, no retyping, no vault edit —
 * and this module never touches that value. What F4.8 needs from it is only
 * the FORMAT CLASS: a small, DECLARED (component-register sense — defensible
 * in plain English, never fitted) three-value internal enum that is never
 * shown to her. `'quiz'` colliding with Olea's own generated quiz instrument,
 * and her two sources already disagreeing on the words she uses, are why a
 * fixed rename (Test/Assignment/Lab/Exam) was considered and rejected in
 * favour of this mapping.
 *
 * **An unrecognised word is not a failure.** It falls to `'written'` — the
 * safest default, since a written response is the least format-committal
 * guess — and `isDeclaredAssessmentType` reports the miss so a caller can
 * ask her once, at the point it matters, the same precedence shape F1.7
 * already uses for assessment scope. No caller does that yet; see
 * `../gap/readiness.js`'s `assessmentFormatOf` doc for the reachability
 * note.
 */

/** The three format classes F4.8 picks a practice format from. Non-persisted, Class B. */
export type AssessmentFormatClass = 'recall-style' | 'written' | 'practical';

/**
 * The declared word→class table. Matched case-insensitively on the trimmed
 * value, because `type` is her free text and `Quiz`/`quiz` are not two
 * words. Every value seen in the real-vault snapshot (Assignment, Lab,
 * Quiz, Test) and her tracker (Assignment, Exam, Project) resolves here —
 * see the decision bead for the legacy-handling note.
 */
const FORMAT_CLASS_BY_ASSESSMENT_TYPE: ReadonlyMap<string, AssessmentFormatClass> = new Map([
  // recall-style: closed-book, closed-answer-set recall or recognition.
  ['quiz', 'recall-style'],
  ['test', 'recall-style'],
  ['exam', 'recall-style'],
  ['midterm', 'recall-style'],
  ['final', 'recall-style'],
  ['mcq', 'recall-style'],
  // written: open-ended production.
  ['assignment', 'written'],
  ['essay', 'written'],
  ['report', 'written'],
  ['project', 'written'],
  ['commentary', 'written'],
  ['reflection', 'written'],
  ['discussion', 'written'],
  // practical: performed/demonstrated rather than written or recalled.
  ['lab', 'practical'],
  ['practical', 'practical'],
]);

function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

/**
 * The format class an assessment's verbatim `type` resolves to.
 *
 * An absent `type` and any word the declared table does not cover both fall
 * to `'written'` — never a guess at `'recall-style'` or `'practical'`, and
 * never `undefined`: F4.8 always has a format to prefer, even when that
 * preference is the least committal one. See `isDeclaredAssessmentType` for
 * the separate "was this word actually recognised" signal the ask-once path
 * needs.
 */
export function formatClassOf(type: string | undefined): AssessmentFormatClass {
  if (type === undefined) return 'written';
  return FORMAT_CLASS_BY_ASSESSMENT_TYPE.get(normalizeType(type)) ?? 'written';
}

/**
 * Whether `type` matched a word the declared table actually names — the
 * signal a future ask-once caller needs, kept separate from
 * {@link formatClassOf}'s always-a-class return so "resolved to written
 * because that's what it is" and "resolved to written because Olea does not
 * recognise the word" stay distinguishable.
 */
export function isDeclaredAssessmentType(type: string | undefined): boolean {
  if (type === undefined) return false;
  return FORMAT_CLASS_BY_ASSESSMENT_TYPE.has(normalizeType(type));
}
