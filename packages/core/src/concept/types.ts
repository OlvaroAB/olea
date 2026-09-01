/**
 * Concept extraction, tiers 1–3 (C7.2, C7.3, F1.4, F4.1, P1-T05, P5-T02).
 *
 * Source hierarchy in precedence order (knowledge model §3):
 *
 *   1. A concept note of her own, where one exists — the canonical case. The
 *      record takes its identity from that note and binds to it.
 *   2. Her `topic` properties — curated, and reaching wider than the
 *      Zettelkasten does.
 *   3. Anything derived from her material — past-paper clusters, generated
 *      content, headings.
 *
 * `./extract.js` extracts tier 2 (`topic` properties) and layers tier 1
 * (concept-note binding) on top when a name matches a note in her
 * Zettelkasten exactly. Tier 3 (`ExtractConceptsOptions.includeTier3`) was a
 * flag scaffold only through P1-T05; P5-T02 turns it on for two of the
 * hierarchy's three tier-3 sources — past-paper clusters and generated
 * content, via `./evidence.js` — and mints a `ConceptRecord` for a concept
 * that has a Zettelkasten note but has never been used as anyone's `topic`
 * value, which is otherwise invisible to this module entirely. Heading-
 * derived tier-3 extraction (the hierarchy's third source) is not covered;
 * see `./evidence.js`'s module doc for why.
 */

import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultPath } from '../vault/types.js';
import type { ConceptSize } from './size.js';

/** Which tier of the source hierarchy (knowledge model §3) produced this record. */
export type ConceptTier = 1 | 2 | 3;

/**
 * A concept extracted from her vault.
 *
 * **Identity is `key`, not `name` (C7.11, `[D-088]`, `[D-109]`, `ol-il6m`).**
 * `key` is the opaque, immutable join key — the field every review-log
 * record, mastery rollup and scheduling reference is meant to key on — and
 * `name` is a *mutable display attribute* on that key: it renders her wording
 * but no longer identifies the record. This is `ol-il6m`'s whole point:
 * before it, renaming a note or editing a `topic:` value severed a concept's
 * event history because the display string *was* the identity. See
 * `./concept-key.js`'s module doc for what `key` can and cannot yet promise —
 * the derivation shipped today is a provisional stand-in, not the ruled,
 * stable mechanism C7.11 describes.
 *
 * **R1/R2 — student-scoped, verbatim display names — still governs `name`.**
 * `name` is copied character-for-character from her `topic` property (or,
 * for a tier-1 binding, her Zettelkasten note's filename — the two are
 * identical by construction, since binding requires an exact match). It is
 * never title-cased, trimmed into a canonical form, or fuzzy-deduplicated:
 * two topic strings differing only by case produce two distinct
 * `ConceptRecord`s, because nothing in the contract says otherwise for that
 * case. See `extract.spec.ts` for the case that proves this.
 *
 * **A concept carries identity, provenance tier and KC-type — and nothing
 * else (`[D-070]`, `ol-s7wh`). Standing prohibition, not a style
 * preference.** The knowledge model (§2, the identity-layer table) closes
 * the list at six fields: `key`, `name`, `aliases`, `discipline`,
 * provenance tier, KC-type. On `ConceptRecord` — the extraction-time record,
 * tiers 1–3 — that maps to `key` and `name` (identity) and `tier`
 * (provenance tier: *which* of the source hierarchy's three tiers found
 * this concept, §3). `aliases` and KC-type are not yet fields here: aliases
 * only exist once passage-level reads are reconciled (`./read.ts`'s
 * `ReadConcept.aliases`), and KC-type is a separate service-side
 * classification output (`./knowledge-kind.ts`) with no production caller
 * joining it onto a record yet — their absence is a pipeline gap, not
 * license to invent a local stand-in field here. `discipline` has no field
 * of its own on this record either; `courses` is the closest existing thing
 * and the two have not been reconciled — flagged, not resolved, by this
 * comment.
 *
 * **Explicitly excluded, and why each is excluded rather than merely
 * unlisted:** difficulty, importance, examinability and troublesomeness are
 * the four characteristics people reach for first. Examinability is an
 * EDGE — the concept-to-assessment edge — because it is evidential: whether
 * a concept is examinable is a fact about the assessments that touch it,
 * not about the concept in isolation, so it belongs on that edge, never
 * here. Difficulty, importance and troublesomeness are each EVIDENCE THAT
 * MUST BE COMPUTED, never asserted: they are exactly the kind of summary
 * judgement the graph and the review-log evidence exist to produce on
 * demand, and stamping one onto the concept record turns a computation into
 * a stale cache with no invalidation path. The tenet already held for
 * instruments applies unchanged: finer typologies are unfalsifiable at n=1
 * and reintroduce exactly the classification habit principle 12 excludes.
 * A concept should be thin; the graph and the evidence carry the weight.
 *
 * A compile-time tripwire for exactly these four sits right below this
 * interface (`ForbiddenConceptCharacteristicKey` /
 * `_assertNoForbiddenConceptCharacteristics`) — the same `keyof` +
 * template-literal-narrowing technique `../scheduler/surface.spec.ts` uses
 * for R3, inlined here rather than in a sibling `.spec.ts` because this
 * bead's ownership is this file alone
 * (`owns: packages/core/src/concept/types.ts`). If any of the four is ever
 * added as a field, `pnpm -r typecheck` fails on that assertion.
 */
export interface ConceptRecord {
  /**
   * Opaque, immutable, never displayed to her (C7.11). The join key: what a
   * review-log record, a mastery rollup or a scheduling reference should key
   * on, once callers migrate to it (`ol-il6m`'s notes track which callers
   * still key on `name` and why that is deliberate for now, not an oversight
   * — flipping a join site without flipping every reader of that join would
   * silently corrupt it).
   *
   * **Provisional** (`./concept-key.js`, `PROVISIONAL_CONCEPT_KEY_PREFIX`):
   * minted fresh on every extraction call from `boundNotePath` or `name`,
   * because there is no persisted lookup yet that could hand back an existing
   * key instead of deriving one. It is therefore stable *within* one run and
   * NOT yet stable across a note rename or a `topic:` edit — the exact
   * property C7.11's key exists to guarantee, and the exact property this
   * stand-in does not yet deliver. A follow-up bead tracks the persisted
   * mechanism (a vault-frontmatter stamp or a review-log lineage replay) that
   * closes that gap.
   */
  readonly key: string;
  /** Exactly as written in her vault — see the R1/R2 note above. Mutable: two extraction runs may see two different names for the same `key` if she renames in between. */
  readonly name: string;
  /**
   * 1 when a `topic`-derived or course-reference-derived name (`./extract.js`
   * module doc, `ol-2zfj.33`, F1.3) also matches a Zettelkasten note exactly,
   * 2 when only `topic`- or reference-derived with no such match, 3 when
   * minted purely from tier-3 material (`includeTier3: true`, `./evidence.js`)
   * with no `topic` occurrence anywhere in the vault — even though such a
   * record still carries `boundNotePath`. See `./extract.js`'s module doc for
   * why tier 3 is the honest label there rather than 1. Tier answers "does
   * the name match a Zettelkasten note exactly", never "which of the two
   * course-attribution sources supplied it" — that is `courses`' concern, not
   * this field's.
   */
  readonly tier: ConceptTier;
  /**
   * Course codes this concept is associated with. **M:N** — a concept can
   * belong to several courses (one course has many concepts; nothing here
   * assumes the reverse holds).
   *
   * Sourced per contributing note, F1.3's way (`./course.js`, `ol-jbnu`): the
   * note's own `course` property when it has one — read via the meaning path,
   * so both a bare scalar (`course: GEOL204`) and a flow list
   * (`course: [GEOL204, MUSTH104]`) contribute correctly — and otherwise the
   * course **folder** it lives under. The property is an override, never the
   * only path: a vault that does not use that key still gets its courses, and
   * a note that names its own course is still believed over its location.
   * Empty when neither is available, which is a statement and not a failure —
   * nothing is guessed. Sorted for a deterministic result.
   *
   * **Two contributing-note rules, unioned (`ol-2zfj.33`, F1.3, widened Aug
   * 2026).** A note contributes its course here either by naming this
   * concept in its own `topic:` property, or — new — by being a note under
   * the course folder whose body plainly wikilinks the Zettelkasten note this
   * concept is bound to. Production's `topic:`-only rule reached 29 of a real
   * vault's 131 concept notes; adding the reference rule reaches 115 (see
   * `olea-service/findings/embedding-proximity-threshold.md` Part II §12). A
   * concept named by both carries the union of the two note sets' courses,
   * never a preference between them.
   */
  readonly courses: readonly string[];
  /**
   * Vault-relative paths of every note whose `topic` property, or whose body
   * wikilink into this concept's bound Zettelkasten note (`ol-2zfj.33`,
   * F1.3), named this concept — for a tier-1/2 record. For a tier-3-only
   * record (no `topic` occurrence anywhere — see `tier`'s doc), this is
   * `[boundNotePath]` instead: her own concept note is the one path that
   * authoritatively names it. Richer tier-3 evidence (every past-paper
   * question, every generated-content citation) lives in `./evidence.js`'s
   * `ExtractTier3EvidenceResult`, not folded in here. Sorted for a
   * deterministic result.
   */
  readonly sourcePaths: readonly VaultPath[];
  /**
   * Tier-1 binding target: the Zettelkasten note whose filename matches
   * `name` exactly, when one exists. `undefined` for a tier-2-only concept.
   * A tier-3 mint (`./extract.js`'s module doc) also sets this — it binds by
   * the same exact-title match, just without a `topic` occurrence
   * corroborating it — which is why `definition` below is captured there too.
   */
  readonly boundNotePath?: VaultPath;
  /**
   * Her definition, read verbatim from `boundNotePath` at bind time
   * (`[DF-13]`, knowledge model §3: a bound concept note is canonical
   * because it "adopts her name, her definition, and binds to that note").
   * `undefined` when there is no `boundNotePath`, or when the bound note's
   * body is empty once its own heading is set aside.
   *
   * **Extraction, not synthesis** — see `./extract.js`'s `noteDefinition` for
   * exactly what "the note's body" means and why nothing here paraphrases,
   * renders, or strips her markup: her wording is preserved exactly, the same
   * rule `name` already follows (R1/R2).
   *
   * **Instance-layer data (knowledge model §2), not identity-layer** — it is
   * personal, unlike every other field this record already carries from
   * identity. It is captured here because extraction is the one place that
   * already reads the bound note to resolve the binding; nothing downstream
   * yet reads this field; see `./extract.js`'s module doc for which bead
   * would wire a consumer.
   */
  readonly definition?: string;
  /**
   * The several Zettelkasten notes whose filenames all match `name` exactly,
   * when more than one does — present only in that case, sorted, and always
   * alongside an **absent** `boundNotePath` and `tier: 2`.
   *
   * A duplicated title is a question only she can answer, so it is surfaced
   * rather than resolved: binding to one of them would make the target a
   * function of `vault.list` order (`ol-lzwe`), and choosing between them by
   * any rule of ours would assert an identity nothing in her vault states.
   * A consumer that wants to prompt her reads this; a consumer that wants a
   * binding reads `boundNotePath` and correctly finds none.
   */
  readonly ambiguousNotePaths?: readonly VaultPath[];
  /**
   * How much of her material grounds this concept (`[D-066]`, component
   * register row 1.3, `./size.js`). Derived from `sourcePaths` and
   * `boundNotePath` alone — a whole-note-grounding proxy, since this record
   * carries no passage-grain provenance; `./read.js`'s `ReadConcept` derives
   * a finer version from passage anchors. Read by the two consumers `[D-066]`
   * named: honest scope counting (F8.1, F8.3) and session composition
   * (F2.17) — see `./size.js`'s module doc for what those integrations look
   * like and why they are not wired from here.
   *
   * **Optional rather than required, deliberately, and only for now.** Both
   * of this module's own mint sites (`./extract.js`) always set it, as does
   * `packages/synthetic/src/corpus.ts`'s fixture builder. It is optional so a
   * `ConceptRecord` literal built elsewhere in the tree during this round —
   * `gap/build.spec.ts`'s test helper is the one found — is not forced to
   * adopt a field from a bead outside that file's ownership mid-round. A
   * follow-up tightens this to required once every construction site is
   * updated; until then, absence here should read as "not yet updated," not
   * as "this concept has no size."
   */
  readonly size?: ConceptSize;
  // `ambiguousTopicPaths` was here, and is deliberately gone (`ol-t3sd`).
  //
  // It recorded, on each concept, the notes whose instruments had been
  // attributed to a *co-listed* name instead — D-031's diagnostic for a
  // narrowing that a one-`conceptId` review-log record forced. The ruling on
  // `ol-t3sd` removed the narrowing: an instrument is now evidence for every
  // concept its note names, and v3 of the record persists all of them. Nothing
  // is attributed away from anything, so the field's own sentence is false for
  // every note, and its documented complement — "`sourcePaths` minus these
  // paths is the set of notes whose instruments this concept actually
  // receives" — is now just `sourcePaths`.
  //
  // Retaining it as diagnostics was considered and rejected. A diagnostic here
  // exists to make an otherwise-invisible loss visible (that is exactly what
  // `ambiguousNotePaths` above still does for a duplicated Zettelkasten title,
  // an ambiguity only she can resolve). There is no loss left to see: the
  // co-listing it reported is now ordinary, correct, many-to-many membership,
  // and a field that flagged it would be flagging the normal case. A field
  // whose name asserts a problem that no longer exists is worse than no field,
  // because a later reader believes it.
}

/**
 * The four characteristics `[D-070]` / `ol-s7wh` names and excludes — see
 * `ConceptRecord`'s doc comment above for why each one is excluded (edge vs
 * computed-evidence) rather than merely unlisted. Kept as a named type,
 * rather than inlined into the assertion below, so a future reader who
 * greps for one of these words lands on the prohibition, not just its
 * enforcement.
 */
type ForbiddenConceptCharacteristicKey =
  | 'difficulty'
  | 'importance'
  | 'examinability'
  | 'troublesomeness';

/** `T` collapses to `never` only when it already is one — used below to fail a build rather than silently accept a widened type. */
type AssertNever<T extends never> = T;

/**
 * Compile-time tripwire for the standing prohibition above. If any of
 * `ForbiddenConceptCharacteristicKey`'s four names is ever added as a field
 * on `ConceptRecord`, `Extract<keyof ConceptRecord, ForbiddenConceptCharacteristicKey>`
 * stops being `never`, `AssertNever` no longer accepts it, and this line
 * fails `pnpm -r typecheck` — the same `keyof` + narrowing technique
 * `../scheduler/surface.spec.ts` uses for R3's "no concept-shaped key"
 * guarantee, run here in reverse (asserting a key is ABSENT rather than
 * present) because this bead's ownership is `types.ts` alone, with no
 * sibling `.spec.ts` to hold a runtime companion.
 */
type _assertNoForbiddenConceptCharacteristics = AssertNever<
  Extract<keyof ConceptRecord, ForbiddenConceptCharacteristicKey>
>;

export interface ExtractConceptsOptions {
  /** Restrict `topic` scanning to this subtree. Defaults to the whole vault. */
  readonly under?: VaultPath;
  /** Folder searched for tier-1 concept-note binding and, when `includeTier3` is on, tier-3 vocabulary. Defaults to `05 Zettelkasten`. */
  readonly zettelkastenFolder?: VaultPath;
  /** Folder whose immediate subdirectories are course codes (F1.3). Defaults to `01 Courses` (`./course.js`'s `DEFAULT_COURSES_FOLDER`). */
  readonly coursesFolder?: VaultPath;
  /**
   * Tier-3 extraction — past-paper clusters and generated content
   * (`./evidence.js`; heading-derived extraction is not covered, see that
   * module's doc). **Off by default.** When `true`, mints a `ConceptRecord`
   * for a Zettelkasten-bound concept that no note's `topic` property ever
   * named, discovered instead through a past paper, an objectives
   * document, or content extracted from an embedded PDF/PPTX/DOCX/image.
   * See `./extract.js`'s module doc for exactly how a record's `tier` is
   * decided once this is on.
   */
  readonly includeTier3?: boolean;
  /** Folder `registerSources` scans for past papers and objectives, when `includeTier3` is on. Defaults to `03 Research` (`../source/register.js`'s `DEFAULT_SOURCES_FOLDER`). */
  readonly sourcesFolder?: VaultPath;
  /**
   * Files registered explicitly, with no embedding note required (F3.1,
   * `ol-ep3.2`), when `includeTier3` is on. Passed straight through to
   * `../source/register.js`; see `RegisterSourcesOptions.registeredFiles` for
   * why this is an option rather than persisted state.
   */
  readonly registeredFiles?: readonly RegisteredFileSpec[];
  /**
   * Resolve `ConceptRecord.key` through the `[D-174]` sidecar (`./key-store.js`) — reading an
   * existing `ConceptKeyRecord` back verbatim when one matches this candidate's anchor, minting
   * and persisting a new one under `.olea/concepts/` otherwise. **Off by default.** This
   * function is called against fixture vaults shared read-only across many tests
   * (`extract.spec.ts`'s `FIXTURE_ROOT`); an unconditional write here would mutate a tracked
   * fixture tree on every test run. Every real caller building toward `[D-174]`'s durable-key
   * promise should pass `true`; `false` preserves today's `provisionalConceptKey` derivation
   * (re-minted fresh on every call, not yet stable across a rename) for callers that have not
   * opted in yet.
   */
  readonly stampConceptKeys?: boolean;
}
