/**
 * Component 2.2's routing consultation, wired into F3.3's generation sweep
 * (`ol-tz7v` / `[WIRE-7]`).
 *
 * `docs/dev/routing-policy.md` (olea-service, private) §10 names the gap
 * this module closes: `routeKnowledgeKindClassification` and
 * `instrumentMixGaps` (`olea-core`'s `routing/instrument-mix.js`) had no
 * production caller, and `ConceptInstrumentInventory` was "this module's own
 * minimal shape for the third input, not a claim that a real
 * inventory-tracking component exists." Both gaps close here:
 *
 * - `buildConceptInstrumentInventory` is the real inventory reader, built on
 *   `enumerateVaultInstruments` (component register row 2.5/session
 *   plumbing) rather than inventing a second vault walk. An instrument bound
 *   to several concepts (her multi-`topic:` case, D-031/`ol-t3sd`) counts as
 *   evidence for every one of them — the same reading `enumerateVaultInstruments`
 *   itself already gives `conceptIds`, so this module adds no new judgement,
 *   only the type-to-group fold.
 * - `classifyForRouting` reaches component 1.5's classifier
 *   (`classifyKnowledgeKind`) with a **disclosed, minimal** source-material
 *   builder: the concept's own bound note (`boundNotePath`, when one exists)
 *   first, then each of `sourcePaths`, read whole, one passage per note. This
 *   is deliberately NOT component 1's `readConcepts` (a model-assisted
 *   passage extraction with its own budget and its own not-yet-wired
 *   trigger, `concept/wiring.ts`'s `readConceptsFromVault`) — building that
 *   here would be a second bead's scope wearing this one's name. Whole-note
 *   text is the honest floor: real material, not invented, at the cost of
 *   coarser passages than a dedicated extractor would offer.
 *
 *   **`boundNotePath` was missing from this builder's input until
 *   `ol-egov.141.89.3.8` [ILB-CPT-B1] (gap 1).** `ConceptRecord.sourcePaths`
 *   is "every note whose `topic` property... named this concept" (`olea-core`
 *   `concept/types.ts`) — the notes that *introduce* or *mention* the
 *   concept, never her own concept note. For a tier-1 concept those are two
 *   different files, so reading `sourcePaths` alone sent the classifier only
 *   the surrounding lecture material and never the concept's own defining
 *   text, exactly the failure this fix closes. `boundNotePath` is read first
 *   so a caller reading only the first passage (a future budget, say) still
 *   sees the concept's own note before any surrounding material.
 *
 * **Never guessed, on either failure path.** A classifier that is
 * unavailable (`classifier === null`, F7.8), a call that could not run
 * (`outcome: 'not-run'` — no source material, offline, budget exhausted,
 * whatever the reason), and a call that ran but declined
 * (`status: 'unclassified'`) are three different facts upstream, and
 * `classifyForRouting` deliberately flattens all three to the same
 * `{ status: 'unclassified' }` **for routing purposes only** — this module's
 * output is fed straight to `routeKnowledgeKindClassification`, and every one
 * of those three cases must route the same way (KLI Application rule 4:
 * "unclassified routes to the retrieval baseline alone, never guessed").
 * Callers that need to distinguish *why* should read `classifyKnowledgeKind`
 * directly; this module answers "what should route" only.
 *
 * **What this deliberately does NOT do.** It does not call
 * `CARDS_FOR_EVERYTHING_NULL` a real fallback — that constant is
 * `instrument-mix.ts`'s own strawman comparator ("nothing here treats it as
 * a real routing option"), not a degraded path. The degraded path this
 * module actually uses when the classifier is unavailable or declines is
 * `UNCLASSIFIED_MIX` (`routeKnowledgeKind(null)`), which is the routing
 * policy's own documented answer to "nothing is known to route on" — §2 rule
 * 4 and §5 of the rationale document.
 */

import type {
  ConceptInstrumentInventory,
  ConceptRecord,
  DerivedTextUnit,
  InstrumentMix,
  InstrumentMixGap,
  KnowledgeKindClassification,
  KnowledgeKindClassifierPort,
  KnowledgeKindSourcePassage,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  classifyKnowledgeKind,
  DEFAULT_COURSES_FOLDER,
  EMPTY_INVENTORY,
  enumerateVaultInstruments,
  extractTier3Evidence,
  findMentionedTermsAfter,
  instrumentMixGaps,
  projectRegisteredFiles,
  ROUTING_GROUP_INSTRUMENT_TYPES,
  ROUTING_GROUPS,
  readReviewLogHistory,
  routeKnowledgeKindClassification,
} from 'olea-core';
import { PROVISIONAL_CONFIDENCE_FLOOR } from './constants.js';
import { isOleaHomeNote } from './home-note.js';
import { stripOleaFrontmatter } from './strip-olea-frontmatter.js';

/**
 * Component 2.2's routing consultation, as opted into by a caller of
 * `runGenerationSweep`. Absent entirely, the sweep keeps its pre-`ol-tz7v`
 * unconditional-draft behaviour (see `pipeline.ts`'s module doc) — every
 * existing caller and every `pipeline.spec.ts` case predates routing and
 * never supplies this, so omission is not a degraded mode, it is "not asked
 * for."
 */
export interface GenerationRoutingDeps {
  /** `null` when the Worker (and therefore the classifier) is not configured — F7.8, `concept/wiring.ts`'s `KnowledgeKindWiring.classifier`. */
  readonly classifier: KnowledgeKindClassifierPort | null;
  /**
   * `ClassifyKnowledgeKindOptions.confidenceFloor` — DERIVED per the
   * component register (row 1.5), not yet ratified by a decision bead.
   * Caller-supplied so this module never hardcodes the number itself;
   * defaults to `PROVISIONAL_CONFIDENCE_FLOOR` (KCT-3's provisional 0.0,
   * `findings/KCT-3-confidence-floor.md` in olea-service) when omitted.
   */
  readonly confidenceFloor?: number;
}

/** One concept's routing verdict — everything a caller needs to decide whether to draft. */
export interface ConceptRoutingDecision {
  readonly classification: KnowledgeKindClassification;
  readonly mix: InstrumentMix;
  readonly gaps: readonly InstrumentMixGap[];
}

/**
 * Reads the concept's own bound note (`boundNotePath`, when it has one) and
 * then each of `concept.sourcePaths` whole, as one passage per note — the
 * disclosed minimal reading this module doc explains. `boundNotePath` comes
 * first and is never read twice if it also happens to appear in
 * `sourcePaths`. Only a markdown note (`.md`) is ever read, and only as
 * text: any other source path (a PDF above all, whose bytes and metadata must
 * never reach a classifier, `ol-pdfmeta`) contributes nothing and is never
 * passed to `vault.read`. A missing or empty note, or one whose read throws,
 * contributes nothing (never fabricated); a concept with no readable source note at all returns `[]`,
 * which `classifyKnowledgeKind`'s own INV-5 guard turns into a clean
 * `'not-run'` — no network call is ever made on empty context.
 *
 * **Why `boundNotePath` has to be read at all (gap 1, `ol-egov.141.89.3.8`).**
 * `sourcePaths` is her *introducing* material — the notes whose `topic:`
 * property named this concept — never her own concept note. Without this,
 * a tier-1 concept's classification input was built entirely from the
 * lecture notes that merely mention it, and never from the note that
 * actually defines it.
 */
export async function buildKnowledgeKindSourceMaterial(
  vault: VaultSource,
  concept: Pick<ConceptRecord, 'sourcePaths' | 'boundNotePath'> & {
    readonly name?: string;
    readonly courses?: readonly (string | undefined)[];
  },
  derivedUnits?: DerivedUnitSupplier,
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): Promise<readonly KnowledgeKindSourcePassage[]> {
  const passages: KnowledgeKindSourcePassage[] = [];
  const orderedPaths: readonly VaultPath[] =
    concept.boundNotePath !== undefined
      ? [concept.boundNotePath, ...concept.sourcePaths.filter((p) => p !== concept.boundNotePath)]
      : concept.sourcePaths;
  for (const sourcePath of orderedPaths) {
    if (!sourcePath.toLowerCase().endsWith('.md')) continue;
    if (!(await vault.exists(sourcePath))) continue;
    let raw: string;
    try {
      raw = await vault.read(sourcePath);
    } catch {
      // A read that throws is treated exactly as a missing note: nothing, never fabricated.
      continue;
    }
    const text = stripOleaFrontmatter(raw);
    if (text.trim().length === 0) continue;
    passages.push({
      text,
      anchor: {
        sourcePath,
        // `page: 1` mirrors `extract/types.ts`'s DOCX convention: a markdown
        // note has no page structure of its own, so it is one logical page,
        // same as `readConcepts`' own reading would treat it.
        location: { page: 1, charRange: { start: 0, end: text.length } },
      },
    });
  }
  // `[D-547]`, ruled over by `[D-553]`: an identity introduced ONLY by non-markdown sources (a PDF,
  // a deck: its assessment wording) has no note to read. Its input is, first, the passage of its
  // own course's reading set that names it; only when that course has none, the extracted units of
  // those same documents that name it. Under `[D-544]` the reading set is that course's alone.
  if (
    passages.length === 0 &&
    concept.name !== undefined &&
    orderedPaths.length > 0 &&
    !orderedPaths.some((p) => p.toLowerCase().endsWith('.md'))
  ) {
    passages.push(
      ...(await readingSetPassages(vault, concept.name, concept.courses ?? [], coursesFolder)),
    );
    if (passages.length === 0 && derivedUnits !== undefined) {
      passages.push(...(await namingUnitPassages(derivedUnits, concept.name, orderedPaths)));
    }
  }
  return passages;
}

/**
 * `[D-547]` (`ol-egov.141.89.3.56` part 2, under `[D-544]`): where a PDF-only identity's routing
 * input comes from. The units are tier 3's own derived text (`extractTier3Evidence`'s
 * `includeDerivedUnits`): text only, no PDF metadata (`ol-pdfmeta`), and the file's bytes are never
 * handed to `vault.read` here. A throw yields no units. Built once per sweep, on first need.
 */
export type DerivedUnitSupplier = () => Promise<readonly DerivedTextUnit[]>;

/** Declared (plain-English, never fitted) bounds on one identity's unit input. The LOOP probe measured at most about 16k characters per identity (1 to 7 units of 579 to 3,334 characters), inside both. */
export const MAX_ROUTING_UNITS_PER_IDENTITY = 8;
export const MAX_ROUTING_UNIT_CHARS = 4000;

export function createDerivedUnitSupplier(vault: VaultSource): DerivedUnitSupplier {
  let pending: Promise<readonly DerivedTextUnit[]> | null = null;
  return () => {
    pending ??= (async () => {
      try {
        const { entries } = await readReviewLogHistory(vault);
        const result = await extractTier3Evidence(vault, {
          // Units do not depend on the vocabulary; naming is decided per identity below.
          vocabulary: [],
          registeredFiles: projectRegisteredFiles(entries),
          includeDerivedUnits: true,
          binaryObjectivesAsObjectives: true,
        });
        return result.derivedUnits ?? [];
      } catch {
        return [];
      }
    })();
    return pending;
  };
}

/**
 * `[D-553]` (`ol-egov.141.89.3.58`, under `[D-544]`): the blocks of a course's own reading set that
 * name a concept known only from assessment wording. The reading set is the markdown notes under
 * that course's folder (`courseFromPath`'s rule): never another course's, never a concept known
 * for no course, never Olea's own home notes (generated practice is not her reading). One passage
 * per blank-line-separated block that names the concept (the same word-boundary rule as the unit
 * input, `findMentionedTermsAfter`), anchored to its own note and character range, bounded by the
 * same declared limits. A note that cannot be listed or read contributes nothing.
 */
async function readingSetPassages(
  vault: VaultSource,
  name: string,
  courses: readonly (string | undefined)[],
  coursesFolder: VaultPath,
): Promise<KnowledgeKindSourcePassage[]> {
  const passages: KnowledgeKindSourcePassage[] = [];
  const courseCodes = [
    ...new Set(courses.filter((c): c is string => c !== undefined && c !== '')),
  ].sort();
  for (const course of courseCodes) {
    const root = `${coursesFolder}/${course}/`;
    let paths: readonly VaultPath[];
    try {
      paths = await vault.list({ under: `${coursesFolder}/${course}`, extensions: ['md'] });
    } catch {
      continue;
    }
    for (const path of paths) {
      if (passages.length >= MAX_ROUTING_UNITS_PER_IDENTITY) return passages;
      if (!path.startsWith(root) || !path.toLowerCase().endsWith('.md')) continue;
      let raw: string;
      try {
        raw = await vault.read(path);
      } catch {
        continue;
      }
      if (isOleaHomeNote(raw)) continue;
      const text = stripOleaFrontmatter(raw);
      let offset = 0;
      for (const block of text.split(/\n[ \t]*\n/)) {
        const start = text.indexOf(block, offset);
        offset = start + block.length;
        if (block.trim().length === 0) continue;
        if (findMentionedTermsAfter(block, [name], 0).length === 0) continue;
        const bounded = block.slice(0, MAX_ROUTING_UNIT_CHARS);
        passages.push({
          text: bounded,
          anchor: {
            sourcePath: path,
            location: { page: 1, charRange: { start, end: start + bounded.length } },
          },
        });
        if (passages.length >= MAX_ROUTING_UNITS_PER_IDENTITY) return passages;
      }
    }
  }
  return passages;
}

async function namingUnitPassages(
  supplier: DerivedUnitSupplier,
  name: string,
  introducingPaths: readonly VaultPath[],
): Promise<KnowledgeKindSourcePassage[]> {
  let units: readonly DerivedTextUnit[];
  try {
    units = await supplier();
  } catch {
    return [];
  }
  const own = new Set<string>(introducingPaths);
  const pageOf = new Map<string, number>();
  const passages: KnowledgeKindSourcePassage[] = [];
  for (const unit of units) {
    const page = (pageOf.get(unit.sourcePath) ?? 0) + 1;
    pageOf.set(unit.sourcePath, page);
    if (!own.has(unit.sourcePath) && !unit.duplicateSourcePaths.some((p) => own.has(p))) continue;
    // Tier 3's own "names it" rule, template heading excluded.
    if (findMentionedTermsAfter(unit.text, [name], unit.templateHeadEnd).length === 0) continue;
    const text = unit.text.slice(0, MAX_ROUTING_UNIT_CHARS);
    if (text.trim().length === 0) continue;
    passages.push({
      text,
      anchor: {
        sourcePath: unit.sourcePath,
        location: { page, charRange: { start: 0, end: text.length } },
      },
    });
    if (passages.length >= MAX_ROUTING_UNITS_PER_IDENTITY) break;
  }
  return passages;
}

/**
 * Classifies one concept for routing purposes, flattening every "nothing
 * real is known" outcome to `status: 'unclassified'` — see the module doc's
 * "never guessed, on either failure path" section for why this collapse is
 * deliberate rather than a loss of information a caller needed.
 */
export async function classifyForRouting(
  routing: GenerationRoutingDeps,
  vault: VaultSource,
  concept: ConceptRecord,
  derivedUnits: DerivedUnitSupplier = createDerivedUnitSupplier(vault),
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): Promise<KnowledgeKindClassification> {
  const UNCLASSIFIED: KnowledgeKindClassification = {
    status: 'unclassified',
    confidence: undefined,
    method: 'model',
  };
  if (routing.classifier === null) return UNCLASSIFIED;

  const sourceMaterial = await buildKnowledgeKindSourceMaterial(
    vault,
    concept,
    derivedUnits,
    coursesFolder,
  );
  const result = await classifyKnowledgeKind(
    routing.classifier,
    { conceptName: concept.name, sourceMaterial },
    { confidenceFloor: routing.confidenceFloor ?? PROVISIONAL_CONFIDENCE_FLOOR },
  );
  return result.outcome === 'classified' ? result.classification : UNCLASSIFIED;
}

/** `ROUTING_GROUP_INSTRUMENT_TYPES` inverted once, module-load time — the single source of truth stays the routing module's own table. */
const INSTRUMENT_TYPE_TO_GROUP = new Map(
  ROUTING_GROUPS.flatMap((group) =>
    ROUTING_GROUP_INSTRUMENT_TYPES[group].map((type) => [type, group] as const),
  ),
);

/**
 * The real per-concept instrument inventory (routing-policy.md §10's own
 * caveat, resolved): walks the vault once via `enumerateVaultInstruments`
 * and folds every found instrument into its concept(s) and routing group.
 *
 * **Disclosed gap, not silently dropped:** `enumerateVaultInstruments` only
 * ever produces `qa`/`cloze`/`mcq` records (`session/enumerate.ts` parses
 * card and MCQ blocks only) — nothing in either package enumerates
 * `explain-back` instruments from vault text today, so this inventory's
 * `explainBack` count is always `0`. That is an honest reading of "nothing
 * counts these yet," not a claim that explain-back attempts don't exist;
 * building that reader is out of this bead's scope (no explain-back vault
 * format exists to enumerate — grading is a live model exchange, not a
 * persisted block, per `grading/wiring.ts`).
 */
export async function buildConceptInstrumentInventory(
  vault: VaultSource,
  options: { readonly under?: VaultPath } = {},
): Promise<ReadonlyMap<string, ConceptInstrumentInventory>> {
  // `[D-357]`: the permanent concept key. A subtree walk (`under`) still keys each concept by its
  // vault-wide identity — `extractConcepts`' own rule for a stamped subtree pass — so this
  // inventory joins the same keys a whole-vault reader holds.
  const { records } = await enumerateVaultInstruments(vault, {
    ...options,
    concepts: { stampConceptKeys: true },
  });

  const mutableCounts = new Map<string, { retrieval: number; quiz: number; explainBack: number }>();
  for (const record of records) {
    const group = INSTRUMENT_TYPE_TO_GROUP.get(record.instrumentType);
    if (group === undefined) continue; // a type this walk cannot currently produce — see the module doc's disclosed gap
    for (const conceptId of record.conceptIds) {
      const entry = mutableCounts.get(conceptId) ?? { retrieval: 0, quiz: 0, explainBack: 0 };
      mutableCounts.set(conceptId, { ...entry, [group]: entry[group] + 1 });
    }
  }

  const result = new Map<string, ConceptInstrumentInventory>();
  for (const [conceptId, counts] of mutableCounts) result.set(conceptId, counts);
  return result;
}

/**
 * The routing decision for one concept, pure once its inputs are in hand —
 * mirrors `instrument-mix.ts`'s own "pure, total" posture rather than mixing
 * judgement into the I/O above.
 */
export function decideConceptRouting(
  classification: KnowledgeKindClassification,
  inventory: ConceptInstrumentInventory,
): ConceptRoutingDecision {
  const mix = routeKnowledgeKindClassification(classification);
  const gaps = instrumentMixGaps(mix, inventory);
  return { classification, mix, gaps };
}

/** Convenience: does this concept's routing decision warrant this sweep's one generation capability (quiz/MCQ drafting)? */
export function quizDeficit(decision: ConceptRoutingDecision): number {
  return decision.gaps.find((gap) => gap.group === 'quiz')?.deficit ?? 0;
}

export { EMPTY_INVENTORY };
