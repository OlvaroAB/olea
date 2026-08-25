/**
 * `runGenerationSweep` — F3.3's "generate instruments automatically when
 * material lands," the client-side trigger (`ol-p3t07a`).
 *
 * **What "material lands" means here, and what it deliberately does not
 * (yet) cover.** The ingestion queue (`packages/core/src/ingestion/`) only
 * ever produces `ExtractedUnit`s for non-markdown documents (PDF/PPTX/DOCX/
 * image, C3) — a markdown note's own prose is never routed through it. Of
 * those units, only ones carrying `provenance.embeddedIn` (F1.6: a source
 * embedded in one of her notes via `![[...]]`) have a real markdown note to
 * insert a generated MCQ into (`materialize-mcq.ts` writes through
 * `insertMcqBlock`, which needs a note's own text). A source dropped
 * directly into the vault with no embedding note (F3.1's other case) has
 * nowhere for `accept.ts` to write an accepted instrument, so this sweep
 * skips it — a disclosed, scoped-out case rather than a silent gap; see the
 * `ol-p3t07a` close evidence for the follow-up this implies if standalone
 * drops turn out to be common.
 *
 * **One concept per drafting call, one drafting call per (course, concept)
 * pair, ever (until the cache says otherwise).** `draftQuizCardsForConcept`
 * takes exactly one `conceptName` — there is no batch form — so "which
 * concepts does this landed material introduce" has to be answered before
 * calling it. This module answers that the coarse way, deliberately: it asks
 * `listConceptsForCourse` (normally `extractConcepts` scoped to the
 * material's course folder — see `wiring.ts`) for every concept the course
 * currently has, then drafts whichever of those the cache has never seen
 * before, up to `MAX_CONCEPTS_PER_SWEEP`. It does **not** attempt to
 * determine which concepts *this specific unit* introduced (a real NLP
 * problem, out of scope) — a course-wide "what's still undrafted" sweep,
 * re-run every tick, converges on the same set eventually and is a correct,
 * if coarse-grained, reading of F3.3's "when material lands" for a first
 * build. F3.7's mastery/yield ORDERING is not implemented here either — see
 * `constants.ts`'s `MAX_CONCEPTS_PER_SWEEP` doc for why a small cap bounds
 * that gap's cost rather than needing to close it in this bead.
 *
 * **A refused concept gets no cache entry, by construction (F4.5's
 * grounded-by-construction argument).** `draftQuizCardsForConcept` already
 * guarantees zero transport sends on refusal (`ol-odb0.3`); this module adds
 * nothing on top except "don't cache a draft for it" — which means a refused
 * concept is retried on a LATER sweep once more material has landed for its
 * course, rather than being permanently skipped. That retry costs a local
 * `retrieve()` call and nothing else on every sweep it keeps refusing
 * (bounded by the same `MAX_CONCEPTS_PER_SWEEP` cap), which is the honest
 * price of not inventing a "give up after N refusals" policy nobody asked
 * for.
 */

import type { ConceptRecord, ExtractedUnit, VaultSource } from 'olea-core';
import { courseFromPath, DEFAULT_COURSES_FOLDER } from 'olea-core';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../retrieval/draft-quiz-cards.js';
import { draftQuizCardsForConcept } from '../retrieval/draft-quiz-cards.js';
import type { DraftCacheStore } from './cache-store.js';
import { MAX_CONCEPTS_PER_SWEEP } from './constants.js';
import { extractDraftedProvenance, extractDraftedQuestions } from './response.js';
import type { DraftRecord } from './types.js';

export interface GenerationPipelineDeps {
  readonly vault: VaultSource;
  readonly cache: DraftCacheStore;
  readonly draftDeps: DraftQuizCardsDeps;
  /** Normally `(courseCode) => extractConcepts(vault, { under: \`${coursesFolder}/${courseCode}\` })` — injected so `pipeline.spec.ts` never has to build a real vault to test pacing/dedupe/refusal handling. */
  readonly listConceptsForCourse: (courseCode: string) => Promise<readonly ConceptRecord[]>;
  /** Defaults to the real `draftQuizCardsForConcept` — injected so `pipeline.spec.ts` can fake grounded/refused outcomes without a real Worker or embedding cache. `wiring.ts` never overrides this. */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
  readonly coursesFolder?: string;
  readonly now?: () => Date;
  readonly generateDraftId?: () => string;
}

export interface GenerationSweepReport {
  /** Concepts a drafting call was actually made for this sweep — always `<= MAX_CONCEPTS_PER_SWEEP`. */
  readonly attempted: number;
  /** Of those, how many produced a cached draft. */
  readonly drafted: number;
  /** Of those, how many refused (no transport send, per `draftQuizCardsForConcept`'s own guarantee) — retried on a later sweep. */
  readonly refused: number;
  /** Concepts skipped because the cache already has a record for that (course, concept) pair. */
  readonly skippedDuplicate: number;
}

const ZERO_REPORT: GenerationSweepReport = {
  attempted: 0,
  drafted: 0,
  refused: 0,
  skippedDuplicate: 0,
};

function defaultGenerateDraftId(): string {
  return globalThis.crypto.randomUUID();
}

/** Every distinct note path that embedded at least one of `units` (F1.6) — the only units this sweep can act on, per the module doc. */
function embeddingNotePaths(units: readonly ExtractedUnit[]): readonly string[] {
  const seen = new Set<string>();
  for (const unit of units) {
    const notePath = unit.provenance.embeddedIn?.notePath;
    if (notePath !== undefined) seen.add(notePath);
  }
  return [...seen].sort();
}

/**
 * Runs one sweep over the units one ingestion job just produced (or, when a
 * caller wants a course-wide catch-up, any batch of previously-accumulated
 * units — see `wiring.ts`). Never throws: a drafting call's own failure
 * (a Worker error, a malformed response) is caught per-concept so one bad
 * concept cannot stop the rest of the sweep or the ingestion tick it rides
 * on.
 */
export async function runGenerationSweep(
  units: readonly ExtractedUnit[],
  deps: GenerationPipelineDeps,
): Promise<GenerationSweepReport> {
  const notePaths = embeddingNotePaths(units);
  if (notePaths.length === 0) return ZERO_REPORT;

  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const courseCodes = new Set<string>();
  for (const notePath of notePaths) {
    const course = courseFromPath(notePath, coursesFolder);
    if (course !== undefined) courseCodes.add(course);
  }
  if (courseCodes.size === 0) return ZERO_REPORT;

  const generateDraftId = deps.generateDraftId ?? defaultGenerateDraftId;
  const now = deps.now ?? (() => new Date());
  const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;

  let attempted = 0;
  let drafted = 0;
  let refused = 0;
  let skippedDuplicate = 0;

  for (const courseCode of [...courseCodes].sort()) {
    if (attempted >= MAX_CONCEPTS_PER_SWEEP) break;

    const candidates = await deps.listConceptsForCourse(courseCode);
    // Stable order (by name) so which concepts win the per-sweep cap does
    // not depend on `extractConcepts`' own internal iteration order.
    const sorted = [...candidates].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const candidate of sorted) {
      if (attempted >= MAX_CONCEPTS_PER_SWEEP) break;
      if (!candidate.courses.includes(courseCode)) continue;

      const existing = await deps.cache.findByKey(courseCode, candidate.name);
      if (existing !== null) {
        skippedDuplicate += 1;
        continue;
      }

      attempted += 1;
      let result: Awaited<ReturnType<typeof draftQuizCardsForConcept>>;
      try {
        result = await draftForConcept(deps.draftDeps, {
          courseCode,
          conceptName: candidate.name,
        });
      } catch {
        // A generative call failing outright (network, malformed transport
        // response) is not a refusal (which never throws) and not cached —
        // the concept is simply revisited next sweep, same as a refusal.
        continue;
      }

      if (result.status === 'refused') {
        refused += 1;
        continue;
      }

      const questions = extractDraftedQuestions(result.response);
      const provenance = extractDraftedProvenance(result.response);
      if (questions === null || provenance === null) continue; // unparseable — nothing content-bearing to cache; revisited next sweep

      const notePath = notePaths.find((path) => courseFromPath(path, coursesFolder) === courseCode);
      if (notePath === undefined) continue; // unreachable given how courseCodes was built, guarded rather than assumed

      const createdAt = now().toISOString();
      for (const question of questions) {
        const record: DraftRecord = {
          draftId: generateDraftId(),
          status: 'pending',
          courseCode,
          conceptName: candidate.name,
          // The opaque key, matching `session/enumerate.ts`'s `ol-63e1` flip
          // — see `types.ts`'s doc on `DraftRecord.conceptIds`.
          conceptIds: [candidate.key],
          sourcePath: notePath,
          createdAt,
          question,
          provenance,
          firstServedAt: null,
        };
        await deps.cache.put(record);
      }
      drafted += 1;
    }
  }

  return { attempted, drafted, refused, skippedDuplicate };
}
