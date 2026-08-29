/**
 * `classifyMateriality` / `resolveMateriality` — the `[D-101]` source-
 * materiality classifier (knowledge model §3.2), F1's block that
 * `features/F1-sources.md`'s "Two source-materiality facts, assigned
 * structure-first" cluster names (`@auto:core/source/materiality.spec`,
 * this file's own spec) and that `../generate/voice-sources.ts` (F3.8) and
 * `../generate/style-profile.ts` (F3.9) have been waiting on since they were
 * built — both already handle `authorship: 'unknown'` correctly, because
 * until this file existed that was the only honest value anything could
 * supply.
 *
 * **Home.** `[D-101]`'s two facts are themselves an extension of the
 * `Source` model this directory already owns (`./types.ts`'s `SourceRole`,
 * `SourceFormat`, `Source.course` derivation) — the classifier reads
 * exactly the structural cues `./register.ts` and `../concept/course.ts`
 * already produce (format, declared role, folder), so it lives beside them
 * rather than under a new `concept/authorship/` tree that would just
 * re-import all three anyway.
 *
 * **The ruling's cue list, and why this file's cascade re-orders it.**
 * Knowledge model §3.2 lists the admitted cues "in order: format and
 * container; declared role; the folder prior; the arrival path." Taken
 * literally that would let a near-certain FORMAT inference outrank an
 * explicit arrival DECLARATION for the same document — which contradicts
 * `features/C3-ingestion.md`'s own C3.1 scenario ("its materiality
 * assignment records provenance declared — not inferred — and OUTRANKS ANY
 * LATER STRUCTURAL INFERENCE") and the general rule stated two paragraphs
 * later in the same knowledge-model section: "a correction outranks a
 * declaration outranks an inference." This file resolves the tension by
 * reading the list as the order WITHIN each provenance tier, not across
 * them: **correction > declared (frontmatter, then arrival) > inferred
 * (format, then folder prior) > unknown**. Format and folder prior keep
 * their relative order from the ruling; so do frontmatter and arrival
 * declarations. Only the tier boundary moves. This is a Class B reading
 * (non-persisted ordering choice, reversible) flagged here for retroactive
 * review rather than escalated, since the two cited texts already argue
 * for it and no real document exercises the literal conflict today (a
 * binary file rarely also carries a frontmatter-readable role).
 *
 * **No authority-weighing, anywhere in this file.** `[D-101]`'s forbidden-
 * consumers list is absolute: these facts never resolve a disagreement on
 * substance and never weight one adjectivally. This module exports
 * exactly two kinds of thing — a categorical `MaterialityFact` and a
 * `MaterialityProvenance` describing how confident the CLASSIFICATION
 * itself is (for a future repair badge to read) — and nothing that ranks,
 * orders, or picks a winner between sources. `materiality.spec.ts` asserts
 * this module's own export surface carries no such function, as a
 * structural proxy for "source kind never resolves a disagreement on
 * substance."
 *
 * **What this file does NOT build, named rather than silently absent:**
 *  - The arrival-path declaration itself (C3.1's drop-flow gesture,
 *    `features/C3-ingestion.md`'s `plugin/ingestion/drop-kind.spec`) —
 *    `MaterialityCues.arrivalDeclaredRole` is accepted so that bead can
 *    call straight into `classifyMateriality` when it lands, but nothing
 *    here produces a value for it yet.
 *  - The repair badge and its correction STORE (second wave per the
 *    ruling: "once the classification has been visible long enough to be
 *    corrected"). `MaterialityCorrection` and `resolveMateriality` give
 *    that future surface something real to call; `expireCorrectionIfMaterial`
 *    gives it the `[D-093]` drift rule pre-built. No UI, no persistence,
 *    no orchestration of the actual judge call exists here — this module
 *    takes an already-computed material-change verdict as a plain boolean
 *    rather than reaching into `../concept/revision/material-change.ts`
 *    itself, so it stays a pure function with one clear owner for "what a
 *    material verdict does to a correction," not a second, parallel
 *    detector.
 *  - Belief attribution and provenance-display consumption. Both are named
 *    consumers in the ruling; neither is this bead's scope (`ol-2zfj.36`
 *    is specifically F3.8/F3.9's block).
 */

import type { SourceFormat } from '../extract/types.js';
import { extractWikilinks } from '../frontmatter/read.js';
import type {
  PassageAuthorship as MaterialityAuthorship,
  PassageCurationAuthority as MaterialityCurationAuthority,
} from '../generate/voice-sources.js';
import type { VaultPath } from '../vault/types.js';
import type { SourceRole } from './types.js';

export type { MaterialityAuthorship, MaterialityCurationAuthority };

/** The two `[D-101]` facts, resolved for one document or one passage. */
export interface MaterialityFact {
  readonly authorship: MaterialityAuthorship;
  readonly curationAuthority: MaterialityCurationAuthority;
}

/** How an assignment was reached — "declared / corrected / inferred", the ruling's own vocabulary. Correction outranks declaration outranks inference. */
export type MaterialityProvenanceSource = 'declared' | 'corrected' | 'inferred';

export interface MaterialityProvenance {
  readonly source: MaterialityProvenanceSource;
  /**
   * `0..1`. Always `1` for `'declared'`/`'corrected'` — her word or the
   * document's own word is not a matter of degree. Meaningful only for
   * `'inferred'`, where it is a DECLARED constant (component register's
   * declared/derived line: defensible in plain English, not fitted against
   * a corpus — there is no `[D-101]` eval set yet to fit against). For a
   * future repair badge only; no consumer in this codebase may read it as
   * an evidentiary weight (see the module doc's "no authority-weighing").
   */
  readonly confidence: number;
}

export interface ClassifiedMateriality {
  readonly fact: MaterialityFact;
  readonly provenance: MaterialityProvenance;
}

/** The honest default: nothing here decided anything. Never a "hole" — `assembleVoiceExemplars` and `computeStyleProfile` already treat this as a complete, valid answer. */
export const UNKNOWN_MATERIALITY: ClassifiedMateriality = {
  fact: { authorship: 'unknown', curationAuthority: 'unknown' },
  provenance: { source: 'inferred', confidence: 0 },
};

// Declared confidence constants (component register's declared/derived
// line) — plain-English defensible, never fitted. Ordered so a reader can
// see the ranking at a glance: format's near-certainty sits well above the
// folder prior's "informs and is never load-bearing."
const FORMAT_CONFIDENCE = 0.95;
const DECLARED_CONFIDENCE = 1;
const CORRECTED_CONFIDENCE = 1;
const FOLDER_PRIOR_CONFIDENCE = 0.55;
/** Her own structural link signature overriding a not-hers folder prior — still inferred, but a stronger per-document signal than the folder alone (scenario: "her filing bends the prior, never the reverse"). */
const HERS_OVERRIDE_CONFIDENCE = 0.6;
/** An embedded/slide structural fragment inside otherwise-hers material — a passage-grain override, not a document-grain one. */
const FRAGMENT_CONFIDENCE = 0.8;

/**
 * Format/container cue (knowledge model §3.2): "a PDF or slide export is
 * not-hers with near certainty." Deliberately narrow — `docx` and `image`
 * are genuinely ambiguous by extension alone (a DOCX could be her own essay
 * exported for submission; an image could be a photo of her own
 * handwriting) and are left to fall through to the weaker cues rather than
 * guessed here.
 */
const SLIDE_EXPORT_FORMATS: ReadonlySet<SourceFormat> = new Set(['pdf', 'pptx']);

function factForRole(role: SourceRole): MaterialityFact {
  switch (role) {
    case 'past-paper':
    case 'objectives':
      return { authorship: 'not-hers', curationAuthority: 'instructor' };
    case 'course-material':
      // F3.1's own doc: "the honest name for what that path mostly
      // carries — a lecture PDF, a coursebook, a slide deck." Treated as
      // published rather than instructor: a registered course-material
      // file is as likely to be a purchased textbook chapter as an
      // instructor handout, and `'published'` is the value that claims
      // less when the two are genuinely indistinguishable from role alone.
      return { authorship: 'not-hers', curationAuthority: 'published' };
  }
}

interface FolderPriorRule {
  readonly pattern: RegExp;
  readonly fact: MaterialityFact;
}

/**
 * The folder prior (knowledge model §3.2): "a folder organised by kind is
 * the strongest cheap cue a vault offers." Generic English terms already
 * public in this repo's own default folder constants
 * (`../concept/course.ts`'s `01 Courses`, `../concept/zettelkasten.ts`'s
 * `05 Zettelkasten`, `./register.ts`'s `03 Research`) — not vault-specific,
 * not fitted, matched against ANY vault's own folder names rather than one
 * student's literal paths. Checked deepest-segment-first (see
 * `folderPriorFor`), so a kind-named subfolder nested inside a differently-
 * classified parent (the mixed-vault case the ruling calls out) wins.
 */
const FOLDER_PRIOR_RULES: readonly FolderPriorRule[] = [
  {
    pattern: /\b(lecture|slides?|handouts?)\b/i,
    fact: { authorship: 'not-hers', curationAuthority: 'instructor' },
  },
  {
    pattern: /\bzettelkasten\b/i,
    fact: { authorship: 'hers', curationAuthority: 'unknown' },
  },
  {
    pattern: /\b(research|readings?|references?)\b/i,
    fact: { authorship: 'unknown', curationAuthority: 'published' },
  },
  {
    pattern: /\b(assignments?|daily[\s-]?notes?)\b/i,
    fact: { authorship: 'hers', curationAuthority: 'unknown' },
  },
];

/**
 * The folder prior for one path, or `undefined` when no folder segment
 * matches any rule — "a student with no folder discipline loses nothing"
 * (§3.2): an unmatched folder is not an error, it just contributes no cue,
 * and `classifyMateriality` falls through to `UNKNOWN_MATERIALITY` exactly
 * as honestly as it would for any other cue-free document.
 */
export function folderPriorFor(path: VaultPath): MaterialityFact | undefined {
  const segments = path.split('/').slice(0, -1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment === undefined) continue;
    for (const rule of FOLDER_PRIOR_RULES) {
      if (rule.pattern.test(segment)) return rule.fact;
    }
  }
  return undefined;
}

/** Below this many `[[wikilinks]]`, a note's own body is not treated as carrying her characteristic interlinking structure — one incidental link is not a signature. Declared, not fitted. */
const MIN_WIKILINKS_FOR_HERS_STRUCTURE = 2;

/**
 * A STRUCTURAL (not stylometric) signal that a markdown note is hers:
 * dense `[[wikilink]]` interlinking is how she writes her own Zettelkasten
 * prose, and pasted third-party text does not natively carry Obsidian's
 * link syntax. This is what lets "her filing bends the prior, never the
 * reverse" work without reading it as a style judgment — it is a syntactic
 * count, exactly like `../generate/style-profile.ts`'s `enumeratesList`,
 * not a model of her voice.
 */
export function hasHersLinkStructure(text: string): boolean {
  return extractWikilinks(text).length >= MIN_WIKILINKS_FOR_HERS_STRUCTURE;
}

const EMBED_SYNTAX_RE = /!\[\[[^\]]+\]\]/;
const SLIDE_FRAGMENT_RE = /\bslide\s*\d+\b/i;
const SLIDE_HEADING_RE = /^#{1,6}\s*(lecture|slides?)\b/im;

/**
 * A structural (not stylometric) signal that ONE PASSAGE, inside a document
 * that otherwise reads as hers, is an embedded not-hers fragment — a
 * transclusion (`![[...]]`) or an obvious slide-deck artifact pasted
 * inline. This is `[D-101]`'s "passage grain exists only where a document
 * signals mixture" made concrete: it is checked against whatever text
 * `classifyMateriality` was given (a whole document or one retrieval
 * chunk), so calling it once per chunk — which `../../plugin`'s hook does —
 * already gives correct per-passage overrides without a separate mixture-
 * detection pass.
 */
export function structuralNotHersFragment(text: string): boolean {
  return EMBED_SYNTAX_RE.test(text) || SLIDE_FRAGMENT_RE.test(text) || SLIDE_HEADING_RE.test(text);
}

const DOI_RE = /\bdoi:\s*10\.\d{4,9}\/\S+/i;
const ISBN_RE = /\bISBN(?:-1[03])?:?\s*[\d-]{10,17}\b/i;
const COPYRIGHT_RE = /©|\bcopyright\b/i;
const CITATION_RE =
  /\([A-Z][a-zA-Z'-]+(?:\s(?:&|and|et al\.?)\s[A-Z][a-zA-Z'-]+)?,\s*(?:19|20)\d{2}\)/g;
/** Two or more in-text citations reads as reference prose, not a stray parenthetical she happened to write. Declared, not fitted. */
const MIN_CITATIONS_FOR_DEMOTION = 2;

/**
 * Stylometry's asymmetric, DEMOTE-ONLY licence (§3.2): "style evidence may
 * demote a passage from presumed-hers to unknown; it may never promote to
 * hers on its own." Deliberately cheap and syntactic — DOI/ISBN/copyright
 * markers and in-text citation density — never a model of her voice, and
 * `classifyMateriality` only ever calls this when the cascade has already
 * concluded `'hers'` from structure; it is never consulted to conclude
 * anything on its own.
 */
export function carriesNotHersMarkers(text: string): boolean {
  if (DOI_RE.test(text) || ISBN_RE.test(text) || COPYRIGHT_RE.test(text)) return true;
  const citationCount = text.match(CITATION_RE)?.length ?? 0;
  return citationCount >= MIN_CITATIONS_FOR_DEMOTION;
}

export interface MaterialityCues {
  /** Vault-relative path — feeds the folder prior and, indirectly via the caller, the format cue. */
  readonly path: VaultPath;
  /** `formatFromExtension(path)` (`../extract/registry.js`), or `null` for markdown. Caller-supplied so this module never re-derives extension rules that file already owns. */
  readonly format: SourceFormat | null;
  /** F1.5's frontmatter `role`, when the note declares one — honoured, never required. */
  readonly declaredRole?: SourceRole;
  /** C3.1's drop-flow declaration (`features/C3-ingestion.md`) — no production source yet; see the module doc. */
  readonly arrivalDeclaredRole?: SourceRole;
  /**
   * The text to run structural/stylometric passage checks against — a
   * whole document for document-grain classification, or one retrieval
   * chunk for passage-grain classification (both are the same cascade;
   * see `structuralNotHersFragment`'s doc). `undefined` skips every
   * text-dependent check and returns the structural cue's own default —
   * never promotes and never demotes anything on an absent value.
   */
  readonly text?: string;
}

/**
 * The `[D-101]` cascade for one document or passage. See the module doc for
 * the exact tier ordering and its citation.
 *
 * `features/F1-sources.md`'s scenarios, one per branch:
 *  - format alone → not-hers/instructor, no text ever read (the `SLIDE_EXPORT_FORMATS` branch returns before any text-dependent check runs).
 *  - the folder prior informs and is never load-bearing (no cue → `UNKNOWN_MATERIALITY`, never left "unclassified").
 *  - her filing bends the prior, never the reverse (the `hasHersLinkStructure` override, folder-prior tier only).
 *  - stylometry demotes, never promotes (`carriesNotHersMarkers`, `'hers'`-only branch).
 *  - passage grain exists only where the mixture is (`structuralNotHersFragment`, checked against whatever grain `cues.text` is).
 */
export function classifyMateriality(cues: MaterialityCues): ClassifiedMateriality {
  // TIER 1 — inferred, format/container. Near-certain; no text is read.
  if (cues.format !== null && SLIDE_EXPORT_FORMATS.has(cues.format)) {
    return {
      fact: { authorship: 'not-hers', curationAuthority: 'instructor' },
      provenance: { source: 'inferred', confidence: FORMAT_CONFIDENCE },
    };
  }

  // TIER 2 — declared. Frontmatter first (closer to the page than a
  // drop-time gesture), then the arrival declaration.
  const declaredRole = cues.declaredRole ?? cues.arrivalDeclaredRole;
  if (declaredRole !== undefined) {
    return {
      fact: factForRole(declaredRole),
      provenance: { source: 'declared', confidence: DECLARED_CONFIDENCE },
    };
  }

  // TIER 3 — inferred, the folder prior. Weak by design ("never load-bearing").
  const prior = folderPriorFor(cues.path);
  if (prior === undefined) {
    return { ...UNKNOWN_MATERIALITY };
  }

  let fact = prior;
  let confidence = FOLDER_PRIOR_CONFIDENCE;

  // "Her filing bends the prior, never the reverse" — her own structural
  // signature in the document outranks a not-hers folder prior. Never
  // touches a format or declared-role conclusion (tiers 1-2, already
  // returned above) — only ever the folder prior itself.
  if (
    fact.authorship === 'not-hers' &&
    cues.text !== undefined &&
    hasHersLinkStructure(cues.text)
  ) {
    fact = { authorship: 'hers', curationAuthority: 'unknown' };
    confidence = HERS_OVERRIDE_CONFIDENCE;
  }

  // Passage-grain structural override: an embedded not-hers fragment inside
  // otherwise not-already-not-hers material. Structural, not stylometric —
  // it may assert a fact, not merely demote one.
  if (
    fact.authorship !== 'not-hers' &&
    cues.text !== undefined &&
    structuralNotHersFragment(cues.text)
  ) {
    return {
      fact: { authorship: 'not-hers', curationAuthority: 'instructor' },
      provenance: { source: 'inferred', confidence: FRAGMENT_CONFIDENCE },
    };
  }

  // Stylometry: demote-only, and only ever from a presumed-hers conclusion.
  if (fact.authorship === 'hers' && cues.text !== undefined && carriesNotHersMarkers(cues.text)) {
    return {
      fact: { ...fact, authorship: 'unknown' },
      provenance: { source: 'inferred', confidence: 0 },
    };
  }

  return { fact, provenance: { source: 'inferred', confidence } };
}

/**
 * Her explicit correction — the repair badge's future payload. Anchored to
 * the content it judged (`anchorContentHash`), not to the file, per §3.2's
 * drift rule; see `expireCorrectionIfMaterial`.
 */
export interface MaterialityCorrection {
  readonly fact: MaterialityFact;
  readonly anchorContentHash: string;
}

/**
 * The top-level entry point: correction outranks declaration outranks
 * inference. A caller with a live correction for this document/passage
 * passes it here rather than calling `classifyMateriality` directly —
 * nothing below this function needs to know corrections exist.
 */
export function resolveMateriality(
  cues: MaterialityCues,
  correction?: MaterialityCorrection,
): ClassifiedMateriality {
  if (correction !== undefined) {
    return {
      fact: correction.fact,
      provenance: { source: 'corrected', confidence: CORRECTED_CONFIDENCE },
    };
  }
  return classifyMateriality(cues);
}

/**
 * `[D-093]`-anchored expiry (§3.2's drift rule): "a correction is anchored
 * to the content it judged... trivial edits never dissolve a correction."
 * This function owns only that one rule — what a material-change verdict
 * does to a correction — never the detection itself. A caller runs the
 * SAME batch-boundary detector row 1.4's file trigger and
 * `../concept/revision/material-change.ts` already use, and passes the
 * resulting boolean here; there is no second, competing detector in this
 * module. `wavesMaterialChange: true` expires the correction (the text it
 * judged no longer exists as it was judged); `false` — a typo, a
 * formatting pass — leaves it standing.
 */
export function expireCorrectionIfMaterial(
  correction: MaterialityCorrection,
  wasMaterialChange: boolean,
): MaterialityCorrection | undefined {
  return wasMaterialChange ? undefined : correction;
}
