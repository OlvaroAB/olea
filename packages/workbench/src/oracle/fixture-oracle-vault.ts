/**
 * The fixture-vault oracle's own, tiny content extension (`ol-m3ty` / WBF-3
 * follow-on). `fixture-oracle.spec.ts` measured that `packages/core/fixtures/
 * vault/`'s ranked concepts are ALL `coverage-gap` — `mastery-gap` and
 * `material-gap` (`packages/core/src/gap/build.ts`'s `classifyGap`) are
 * structurally unreached on that vault's content as committed. Growing the
 * fixture vault's material is a genuine content decision (the bead's own
 * words), but `packages/core/fixtures/vault/` is not this bead's file to
 * change: it is core's own frozen regression target — `extract.spec.ts`,
 * `tier3-evidence/build.spec.ts` and `fixture-topic-binding.spec.ts` all pin
 * EXACT concept lists and records against it, by design ("the golden suite
 * stays a clean regression target" — `extract.spec.ts`'s own module
 * comment), and this bead's `owns` is `packages/workbench/` only.
 *
 * So this module is the workbench-side answer: a small, read-only overlay
 * over whatever base `VaultSource` `buildFixtureOracle` is given (the real
 * `packages/core/fixtures/vault/`, via `FolderSource` in tests or
 * `loadFixtureVault()`'s `MemoryVaultSource` in the browser). It changes the
 * bytes `olea-core`'s OWN, unmodified extraction/ranking/classification
 * pipeline reads — nothing here computes a `GapClass`, assigns one, or
 * special-cases a concept name; every row still earns its class from
 * `classifyGap` exactly as `gap/build.ts` defines it. The two additions:
 *
 *  - **Mastery-gap.** `classifyGap` returns `'mastery-gap'` when a concept's
 *    material presence has notes AND a positive instrument count
 *    (`gap/build.ts`). "Imbrication" is currently ranked (her past papers
 *    cite it) but tier-3-only — its sole source is its own Zettelkasten note,
 *    which carries no `topic:` property and so contributes no instruments
 *    (`enumerateVaultInstruments` only binds an instrument to a concept via a
 *    `topic:`-tagged note — `session-scenarios.ts`'s own module doc names
 *    this exact mechanism as the root cause it works around for the session
 *    surface). Tagging "Clast Provenance and Imbrication.md" — the
 *    lecture that already narrates the imbrication-forming sequence in
 *    depth — with an ADDITIONAL `[[Imbrication]]` topic makes "Imbrication"
 *    tier 1 (bound the same way, same `provisionalConceptKey`, so the
 *    ranking identity is unchanged) and hands its two existing Q&A cards,
 *    plus one new one asked directly about the fabric's dip direction, to
 *    `buildMaterialPresence` as real evidence. Notes with non-empty
 *    `notePaths` and `instrumentCount > 0` are `mastery-gap` by
 *    `classifyGap`'s own rule — nothing here decides that, the extraction
 *    pipeline does.
 *
 *  - **Material-gap.** `classifyGap` returns `'material-gap'` when a ranked
 *    concept's key has NO entry in `materialPresence` at all —
 *    `oracle/compose.ts`'s `resolveCaseInsensitiveConceptKeys` doc spells out
 *    the live mechanism: "a term absent from `concepts`, in every casing, for
 *    this course, is left exactly as `buildConceptAssessmentEdges` resolved
 *    it — that is a true material-gap." The one way `packages/core/src/
 *    concept/extract.ts` produces exactly that absence is a Zettelkasten
 *    title carried by two notes (`ol-lzwe`): `resolveTitle` reports
 *    `ambiguous`, tier-3 minting requires a single bound note and skips
 *    outright, and the citation matched against the (still-duplicated)
 *    default vocabulary falls back to its own bare name as `conceptKey`
 *    (`evidence-edge/build.ts`) — a real key never looks like that. Adding a
 *    SECOND note titled exactly "Hummocky stratification" reproduces this
 *    precisely: her two past papers already cite the term (real evidence,
 *    untouched), and the duplicate title is what makes her material
 *    genuinely fail to resolve it, exactly as `ol-lzwe` describes for a real
 *    vault. "Hummocky stratification" is chosen over the other three ranked
 *    concepts because it carries zero events in `fixture-oracle-history.ts`
 *    (`seed`, 0 events) — the only one of the four whose removal from
 *    `materialPresence` orphans no review history.
 *
 * Both additions are picked to leave every OTHER measured fact alone:
 * Bioturbation and Paraconformity keep their existing `coverage-gap`
 * classification and mastery reading untouched, and the oracle's own
 * ranking arithmetic (`priorityScore`/`gapScore`, computed before
 * `classifyGap` ever runs — see `gap/build.ts`'s `buildRow`) does not read
 * `materialPresence` at all, so neither change moves any row's rank.
 *
 * **A third responsibility, added when course attribution widened
 * (`ol-2zfj.33`, F1.3): undoing its collateral sweep over these same four
 * concepts.** F1.3 gave `extractConcepts` a second course-attribution path —
 * a course-folder note's own BODY, not just its `topic:` — and, per
 * `ConceptRecord.sourcePaths`'s own doc, that path feeds `sourcePaths` the
 * same way `topic:` always has. `session/enumerate.ts` binds an INSTRUMENT to
 * a concept by `sourcePaths`, not by whether the instrument is actually about
 * it, so a lecture note that merely cross-references a concept in passing
 * prose — "Compare against [[Hummocky stratification]]", "see
 * [[Bioturbation]]" — now hands that concept every card the note happens to
 * carry, real evidence or not. The fixture vault's WEEK 1–3 GEOL204 notes
 * cross-link Hummocky stratification, Bioturbation and Paraconformity this
 * way, in prose, precisely because that is how her real notes read — and
 * that reading swept all three into `mastery-gap` before this file's own
 * additions ever ran, collapsing the three-class demonstration this suite
 * exists to keep working. Restoring it without touching `extract.ts` (the
 * widening is correct — a body cross-reference genuinely is evidence of a
 * course association, `ol-2zfj.33`'s whole point) means undoing only the
 * BYTES this overlay is already licensed to touch: `BODY_LINK_STRIPS` below
 * removes exactly the six passing cross-reference wikilinks that would
 * otherwise hand Hummocky/Bioturbation/Paraconformity someone else's cards —
 * turning `[[Hummocky stratification]]` into plain, unlinked prose so the
 * words she'd still read are there, just no longer resolvable as a citation.
 * Imbrication's own two cross-references are left alone — one is exactly
 * what this file's mastery-gap addition wants a ranked concept to have.
 *
 * Nothing here is written back — this vault is discarded on reload, exactly
 * like `MemoryVaultSource`'s own writes.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { requireReplace } from '../vault/require-replace.js';

/** `Lecture - Clast Provenance and Imbrication.md`'s real, committed frontmatter topic line — matched literally so this file fails loudly (not silently) if that note's topics ever change upstream. */
const IMBRICATION_LECTURE_PATH =
  '01 Courses/GEOL204/WEEK 1/Lecture - Clast Provenance and Imbrication.md' as VaultPath;
const IMBRICATION_LECTURE_ORIGINAL_TOPIC_LINE =
  'topic: [[[Sediment provenance]], Diagenetic burial]';
const IMBRICATION_LECTURE_EXTENDED_TOPIC_LINE =
  'topic: [[[Sediment provenance]], Diagenetic burial, [[Imbrication]]]';
const IMBRICATION_NEW_CARD =
  "\nWhich direction does a clast's long axis dip in an imbricated fabric?::Upstream — opposite " +
  'the direction of the flow that last moved it\n';

/** A second note titled exactly "Hummocky stratification" — `ol-lzwe`'s ambiguous-title case, reproduced deliberately. Plainly synthetic: a duplicate concept note, nothing quoted from any real vault. */
const HUMMOCKY_DUPLICATE_PATH =
  '05 Zettelkasten/zz-duplicate-titles/Hummocky stratification.md' as VaultPath;
const HUMMOCKY_DUPLICATE_CONTENT =
  '---\ntype: concept\ncourse: [GEOL204]\n---\n\n# Hummocky stratification\n\n' +
  'A second pass at this note, started over in a new session and never merged with the first ' +
  "one — same title, different folder, her mistake rather than Olea's invention.\n";

/**
 * F1.3's collateral sweep, undone (module doc's third responsibility). Six
 * passing cross-reference wikilinks, across the four GEOL204 lecture notes
 * that actually carry instruments, each turned into the same words unlinked —
 * so a reader sees no change and `extractWikilinks` sees no citation. Every
 * literal is matched exactly once per `requireReplace`, so a note whose prose
 * moves upstream fails this loudly rather than silently leaving the sweep in
 * place.
 */
const INTRO_TO_CLASTIC_PATH =
  '01 Courses/GEOL204/WEEK 1/Lecture - Introduction to Clastic Sediment.md' as VaultPath;
const DEPOSITION_PATH =
  '01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md' as VaultPath;
const CEMENTATION_PATH =
  '01 Courses/GEOL204/WEEK 3/Lecture - Cementation and Burial Diagenesis.md' as VaultPath;

function withImbricationCard(original: string): string {
  if (!original.includes(IMBRICATION_LECTURE_ORIGINAL_TOPIC_LINE)) {
    throw new Error(
      'fixture-oracle-vault: expected topic line not found in ' +
        `${IMBRICATION_LECTURE_PATH} — the fixture vault's frontmatter has moved; update this ` +
        'extension to match.',
    );
  }
  const withTopic = original.replace(
    IMBRICATION_LECTURE_ORIGINAL_TOPIC_LINE,
    IMBRICATION_LECTURE_EXTENDED_TOPIC_LINE,
  );
  // The other two ranked concepts this note's prose casually cross-references
  // — Hummocky stratification (once) and Paraconformity (twice) — stripped so
  // this note's real cards (plus the one just appended) do not also become
  // material presence for them. Imbrication's own cross-reference two lines
  // below is left exactly as she wrote it.
  const withoutHummockyRef = requireReplace(
    withTopic,
    'Compare against [[Hummocky stratification]].',
    'Compare against Hummocky stratification.',
    IMBRICATION_LECTURE_PATH,
  );
  const withoutFirstParaconformityRef = requireReplace(
    withoutHummockyRef,
    '5. The [[Paraconformity]] above may then remove all record of what came next',
    '5. The Paraconformity above may then remove all record of what came next',
    IMBRICATION_LECTURE_PATH,
  );
  const withoutSecondParaconformityRef = requireReplace(
    withoutFirstParaconformityRef,
    '- The [[Paraconformity]] marks a pause long enough for the fabric to be cemented in place',
    '- The Paraconformity marks a pause long enough for the fabric to be cemented in place',
    IMBRICATION_LECTURE_PATH,
  );
  return `${withoutSecondParaconformityRef.trimEnd()}\n${IMBRICATION_NEW_CARD}`;
}

/** Strips the one line that hands both Hummocky stratification and Bioturbation this note's real cards. */
function withoutIntroCrossReferences(original: string): string {
  return requireReplace(
    original,
    'See [[Hummocky stratification]] and [[Bioturbation]].',
    'See Hummocky stratification and Bioturbation.',
    INTRO_TO_CLASTIC_PATH,
  );
}

/** Strips the one line that hands Bioturbation this note's MCQ. */
function withoutDepositionCrossReference(original: string): string {
  return requireReplace(original, 'see [[Bioturbation]].', 'see Bioturbation.', DEPOSITION_PATH);
}

/** Strips the one (pipe-aliased) line that hands Bioturbation this note's cards. */
function withoutCementationCrossReference(original: string): string {
  return requireReplace(
    original,
    'never reaches [[Bioturbation|the burrowed interval]] as a compaction surface',
    'never reaches the burrowed interval as a compaction surface',
    CEMENTATION_PATH,
  );
}

const EXTRA_FILES: ReadonlyMap<VaultPath, string> = new Map([
  [HUMMOCKY_DUPLICATE_PATH, HUMMOCKY_DUPLICATE_CONTENT],
]);

const OVERRIDDEN_FILES: ReadonlyMap<VaultPath, (original: string) => string> = new Map([
  [IMBRICATION_LECTURE_PATH, withImbricationCard],
  [INTRO_TO_CLASTIC_PATH, withoutIntroCrossReferences],
  [DEPOSITION_PATH, withoutDepositionCrossReference],
  [CEMENTATION_PATH, withoutCementationCrossReference],
]);

function extensionOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

/** Same matching rules `FolderSource`/`MemoryVaultSource` apply to their own listings — an extra path must obey the same `under`/`extensions` filters a real file would. */
function matchesListOptions(path: string, options: ListOptions): boolean {
  const under = options.under;
  if (under !== undefined && under !== '') {
    const prefix = `${under.replace(/\/$/, '')}/`;
    if (!path.startsWith(prefix)) return false;
  }
  if (options.extensions !== undefined) {
    const ext = extensionOf(path);
    const allowed = options.extensions.map((e) => e.toLowerCase());
    if (ext === undefined || !allowed.includes(ext)) return false;
  }
  return true;
}

/**
 * A read-only overlay over `base`: `EXTRA_FILES` are added as new paths,
 * `OVERRIDDEN_FILES` rewrite one existing path's content on read, and
 * everything else is `base`, byte for byte. `write`/`delete` throw — this
 * extension, like the pipeline it feeds, never mutates the vault it reads.
 */
class FixtureOracleVaultExtension implements VaultSource {
  constructor(private readonly base: VaultSource) {}

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const baseList = await this.base.list(options);
    const extra = [...EXTRA_FILES.keys()].filter((path) => matchesListOptions(path, options));
    return [...new Set([...baseList, ...extra])].sort();
  }

  async read(path: VaultPath): Promise<string> {
    const extra = EXTRA_FILES.get(path);
    if (extra !== undefined) return extra;
    const override = OVERRIDDEN_FILES.get(path);
    if (override !== undefined) return override(await this.base.read(path));
    return this.base.read(path);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const extra = EXTRA_FILES.get(path);
    if (extra !== undefined) return new TextEncoder().encode(extra);
    const override = OVERRIDDEN_FILES.get(path);
    if (override !== undefined) {
      return new TextEncoder().encode(override(await this.base.read(path)));
    }
    return this.base.readBinary(path);
  }

  async exists(path: VaultPath): Promise<boolean> {
    if (EXTRA_FILES.has(path)) return true;
    return this.base.exists(path);
  }

  write(): Promise<void> {
    throw new Error('FixtureOracleVaultExtension: read-only, never written to');
  }

  delete(): Promise<void> {
    throw new Error('FixtureOracleVaultExtension: read-only, never written to');
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.base.watch(handler);
  }
}

/**
 * Wraps `base` with the fixture-oracle's own extension. Called once, at the
 * top of `buildFixtureOracle`, so every consumer of that function — the real
 * walkthrough render (`main.ts`, over `loadFixtureVault()`'s result) and this
 * package's own tests (`FolderSource` over the real, UNCHANGED, on-disk
 * `packages/core/fixtures/vault/`) — sees the same extended content, and
 * `packages/core`'s own test suite, which reads the base vault directly and
 * never through this wrapper, sees none of it.
 */
export function withGapClassExtension(base: VaultSource): VaultSource {
  return new FixtureOracleVaultExtension(base);
}
