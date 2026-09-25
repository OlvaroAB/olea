/**
 * Walking her vault for instruments (F2.5, F2.14, F2.17, C5.3, P2-T07).
 *
 * This is the step that was missing. `parseCards` and `parseMcqBlocks` read one
 * note; `extractConcepts` reads the concept spine; `composeQueue` is a pure
 * function over `QueueCandidate[]`. Nothing joined them, so every consumer —
 * the review view, the Today panel, the workbench — built its queue by hand.
 * This module is the join, and it is deliberately the *only* place a note's
 * bytes become an instrument record.
 *
 * ## Reading only
 *
 * Nothing here writes. Not a block id, not an `olea-uid`, not a scheduling
 * comment. Instrument identity is derived from what is already in the note
 * (`instrument-id.ts`), and where that derivation would like a stable id the
 * note does not have yet, it uses a position-based fallback rather than
 * minting one on the spot. D-030 (`ol-5qjz`) is ruled — option (b), stamped
 * identity — and the write half now exists (`mcq-format.ts`'s `stampMcqId`,
 * `card-format.ts`'s `stampQaCardBlockId`, and — `[D-177]` —
 * `instrument/cloze-identity.ts`'s `stampClozeId`), but deliberately not
 * *here*: this walk stays read-only so enumerating the vault to render a
 * panel or compose a queue never itself writes to it. A cloze's stamp
 * (unlike a block id or `id:` field) does not live in the note's parsed
 * bytes at all — it is beside them, in the frontmatter map — so this walk
 * reads it explicitly, with `cloze-identity.ts`'s own `readClozeId`, and
 * hands it to `instrument-id.ts` on the input rather than that module
 * reading the note itself (its own hard constraint). Still a read, not a
 * write: no stamp means no entry to find, and `provisionalInstrumentId`
 * falls through to the position-based rule exactly as before. Whatever
 * drives review decides when a stamp actually happens (`ol-k7eg`'s notes:
 * on first review, not on enumeration).
 *
 * ## Four things that are reported rather than dropped
 *
 *   - **An invalid MCQ block.** The format module already refuses to return one
 *     as an instrument; this carries the refusal up with the note path, so she
 *     can be told which block, in which note, and why.
 *   - **An invalid Q&A card block** (`ol-v7r5.72`). Same shape as the MCQ case,
 *     one paragraph up: `card-format.ts`'s `parseCardsWithInvalid` already
 *     refuses to return a declared-but-empty separator as a card; this carries
 *     that refusal up the same way, into `invalidCardBlocks`. Before this fix
 *     the block simply vanished — no candidate, no diagnostic, nothing read it.
 *   - **An instrument in a note with no `topic:`.** It is a real card with no
 *     concept, which the queue cannot dedupe, the panel cannot count and the
 *     log cannot record. Silently skipping it is how a corpus loses cards
 *     without anyone noticing.
 *   - **Nothing at all for a note with no instruments**, which is most of her
 *     vault, and is not a diagnostic.
 *
 * ## Multi-valued `topic:` — ruled (D-031 `ol-4ekt`, superseded by `ol-t3sd`)
 *
 * A note may name several `topic:` values. `concept/extract.ts` records the
 * note under every one of them, which is right: the note does contribute to all
 * of them. **An instrument bound to that note is evidence for all of them too**
 * — that is the ruling on `ol-t3sd`, and it is what evidence already means
 * everywhere else in the model.
 *
 * D-031 could not deliver it, and said so: the review-log record persisted one
 * `conceptId`, `QueueCandidate` held one field and F2.17's dedupe key was one
 * string, so the interim was bind-to-first, with the concepts that lost the
 * note's instruments recording the fact on `ConceptRecord.ambiguousTopicPaths`.
 * That was a placeholder from the day it was written. v3 of the record carries
 * a list (`contracts/review-log.ts`), the candidate carries a list, and the
 * dedupe key is the set — so the narrowing, and the diagnostic that existed
 * only to make the narrowing visible, are both gone.
 *
 * What survives is her **order**: `conceptIds` keeps the note's `topic:` values
 * exactly as she wrote them, because that is the only ordering in the data and
 * ours would be an invention. It no longer *selects* anything; it is the order
 * the concepts are recorded, offered and logged in.
 *
 * One thing this does **not** do, and must not: emit one candidate per
 * (instrument, concept) pair. The same `instrumentId` would then appear twice
 * in one session and be offered to her twice. One instrument, one candidate,
 * several concepts.
 *
 * ## `ol-8ae9`: a heading's ordinal counts every occupant, stamped or not
 *
 * A Q&A card's block id is both its identity carrier (rule 4 in `instrument-id.ts`) and, before
 * this fix, this walk's own ordinal-counting key — the same string doing two jobs. Two cards
 * sharing a heading anchor (neither block-id'd yet) get heading-ordinal ids 1 and 2; stamp the
 * first and it moves to its own, globally-unique `^blockId` anchor. If the heading's ordinal
 * count only tallied instruments STILL anchored there, the second card would silently recompute
 * to ordinal 1 on the next walk — a different derived id, orphaning whatever scheduling history
 * it already has, which is the exact class of failure D-030 stamped identity exists to prevent.
 * Reproduced and confirmed independent of any plugin code; `packages/plugin/src/
 * instrument-stamping/port.ts` carried a narrower, conservative mitigation (only ever stamp the
 * currently-last occupant) until this landed.
 *
 * The fix: a heading-anchored ordinal is the instrument's 1-based POSITION among every
 * instrument under that heading, in source order — regardless of whether a sibling has already
 * moved to its own block-id anchor. A stamped sibling still occupies its original slot for this
 * count, so nobody after it shifts. A block-id-anchored instrument's own ordinal is counted
 * separately, keyed on the block id itself: since a block id is unique by construction, that
 * count is always `1`, exactly as it was before this fix — stamping never changes a card's own
 * id, only what it does (or no longer does) to a sibling's.
 *
 * What this does not fix, because nothing can without abandoning position entirely: inserting a
 * genuinely new card under a heading before its other occupants are stamped still shifts the
 * unstamped ones' ordinals — the same position-based tradeoff `instrument-id.ts` names in its
 * rule 5, and the same shape as `[D-177]`'s named-open-question cloze heading-rename gap. Once
 * every occupant of a heading is stamped (each on its own block-id anchor), the heading's own
 * ordinal count no longer matters to any of them — insertion, deletion or reordering under that
 * heading from then on touches nobody's id.
 *
 * ## `[D-181]`'s citation sidecar (`ol-2zfj.52`)
 *
 * Still a read, not a write, in the same sense the cloze-id lookup above is: once an
 * instrument's `[D-177]`-frozen id is derived, this walk asks `../instrument/citation-store.js`
 * whether a generation-time passage citation was minted for it, and copies it onto
 * `sourceProvenance` when one exists. Absent for every hand-authored instrument (nothing mints a
 * sidecar for those) and for a generated one no writer has cited yet — `undefined`, never
 * guessed. `SourceLocation.charRange` (`../extract/types.js`) is optional precisely so this
 * conversion can be honest about the sidecar's smaller grain: `citationToSourceProvenance`
 * below builds a `location` with `page`/`section` only, `charRange` simply absent, rather than
 * inventing a range the sidecar never had.
 */

import { parseDocument } from '../block/parse.js';
import type { HeadingBlock } from '../block/types.js';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord, ExtractConceptsOptions } from '../concept/types.js';
import { noteTitle } from '../concept/zettelkasten.js';
import type { Provenance } from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList, readScalar, wikilinkTarget } from '../frontmatter/read.js';
import { parseCardsWithInvalid } from '../instrument/card-format.js';
import { type InstrumentCitation, readInstrumentCitation } from '../instrument/citation-store.js';
import { readClozeId } from '../instrument/cloze-identity.js';
import { parseMcqBlocks } from '../instrument/mcq-format.js';
import type {
  CardInstrument,
  McqInstrument,
  QaCardInstrument,
  SourceSpan,
} from '../instrument/types.js';
import { OLEA_UID_KEY } from '../uid/stamp.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { InstrumentIdSource } from './instrument-id.js';
import { provisionalInstrumentId } from './instrument-id.js';
import type {
  InvalidCardReport,
  InvalidClozeReport,
  InvalidMcqReport,
  UnboundInstrumentReport,
  VaultInstrumentEnumeration,
  VaultInstrumentRecord,
} from './types.js';

export interface EnumerateVaultInstrumentsOptions {
  /** Restrict the walk to a subtree, e.g. `'01 Courses'`. Defaults to the whole vault. */
  readonly under?: VaultPath;
  /**
   * The instrument-identity seam (D-030, ruled). Injected so tests can pin
   * ids without depending on the transient, not-yet-stamped format. Defaults
   * to `provisionalInstrumentId`.
   */
  readonly instrumentId?: InstrumentIdSource;
  /** Passed through to `extractConcepts`, for a caller that needs a non-default Zettelkasten folder. */
  readonly concepts?: Omit<ExtractConceptsOptions, 'under'>;
  /**
   * Notes to walk for round-trip purposes but never mine for instruments —
   * documentation *about* the format, which necessarily quotes the separators
   * it documents. `packages/core/test/instrument/vault-instruments.spec.ts`
   * makes the same exclusion for the same reason, by name rather than by
   * pattern, so a second such file is a visible decision.
   */
  readonly excludePaths?: readonly VaultPath[];
}

/** One instrument found in a note, before it is bound to a concept. */
interface ParsedInstrument {
  readonly type: 'qa' | 'cloze' | 'mcq';
  readonly span: SourceSpan;
  readonly blockId: string | null;
  readonly explicitId: string | null;
  readonly card?: CardInstrument;
  readonly mcq?: McqInstrument;
}

/** The nearest heading above `offset`, or `null`. Her notes are question-headed, so this is a real anchor. */
function headingAbove(headings: readonly HeadingBlock[], offset: number): string | null {
  let found: string | null = null;
  for (const heading of headings) {
    if (heading.start >= offset) break;
    found = heading.text;
  }
  return found;
}

/**
 * Every instrument in one note's source, in source order.
 *
 * Q&A and cloze come from `parseCards`, MCQ from `parseMcqBlocks`; the two
 * lists are merged by span start so the ordinals below count in the order she
 * would read them, not in the order the two parsers happened to run.
 */
function instrumentsOf(source: string): {
  readonly instruments: readonly ParsedInstrument[];
  readonly invalidMcq: ReturnType<typeof parseMcqBlocks>['invalid'];
  readonly invalidCards: ReturnType<typeof parseCardsWithInvalid>['invalid'];
  /** `[D-334]` (`ol-v7r5.90`): a cloze delimiter she opened and never closed. */
  readonly invalidCloze: ReturnType<typeof parseCardsWithInvalid>['invalidCloze'];
} {
  const { cards, invalid: invalidCards, invalidCloze } = parseCardsWithInvalid(source);
  const mcqs = parseMcqBlocks(source);

  const instruments: ParsedInstrument[] = [
    ...cards.map(
      (card): ParsedInstrument => ({
        type: card.type,
        span: card.span,
        blockId: card.blockId,
        explicitId: null,
        card,
      }),
    ),
    ...mcqs.instruments.map(
      (mcq): ParsedInstrument => ({
        type: 'mcq',
        span: mcq.span,
        blockId: null,
        explicitId: mcq.id,
        mcq,
      }),
    ),
  ].sort((a, b) => a.span.start - b.span.start);

  return { instruments, invalidMcq: mcqs.invalid, invalidCards, invalidCloze };
}

/**
 * Her `topic:` values for one note, in the order she wrote them, dereferencing
 * a wikilink-shaped value to its target.
 *
 * The dereference mirrors `concept/extract.ts`'s meaning path exactly, and the
 * two are kept honest by *resolution* rather than by hope: a topic that does
 * not resolve to a `ConceptRecord` for this path is dropped here, and the
 * extractor's own record set is the fallback. So a drift between the two shows
 * up as a concept binding falling back, never as a binding to a concept that
 * does not exist.
 */
function topicsOf(source: string): readonly string[] {
  const first = parseDocument(source).blocks[0];
  if (first?.kind !== 'frontmatter') return [];
  const fm = parseFrontmatter(first.inner);
  return readList(fm, 'topic').items.map((item) => wikilinkTarget(item) ?? item);
}

function uidOf(source: string): string | null {
  const first = parseDocument(source).blocks[0];
  if (first?.kind !== 'frontmatter') return null;
  const uid = readScalar(parseFrontmatter(first.inner), OLEA_UID_KEY).scalar;
  return uid === '' ? null : uid;
}

/**
 * `InstrumentCitation` -> `VaultInstrumentRecord.sourceProvenance`. `SourceLocation.page` is
 * mandatory, so a citation with no `page` (never produced by a real generation-time caller today
 * — `InstrumentCitation`'s own type doesn't rule it out) is treated the same as no citation at
 * all: omitted, never guessed.
 *
 * `[D-181]`'s citation grain (`sourcePath`/`page?`/`section?` — `../instrument/citation-store.js`)
 * carries no character-level precision: the sidecar is written long after the extraction pass
 * that produced a real `charRange` is over, and this walk never re-reads the original PDF/PPTX to
 * recover one. `SourceLocation.charRange` (`../extract/types.js`) is optional for exactly this
 * case, so the `location` built below simply omits it rather than fabricating a zero-length
 * placeholder — the same "absent, never guessed" posture `section` already had. This used to be a
 * `{ start: 0, end: 0 }` sentinel (a named, flagged Class B compromise); `ol-2zfj.54` widened the
 * field and this is the honest fix landing.
 */
function citationToSourceProvenance(citation: InstrumentCitation): Provenance | undefined {
  if (citation.page === undefined) return undefined;
  return {
    sourcePath: citation.sourcePath,
    location: {
      page: citation.page,
      ...(citation.section !== undefined ? { section: citation.section } : {}),
    },
  };
}

// ---- M5: an embedded asset that does not resolve (`[D-334]`, ol-v7r5.90) --
//
// MCQ and Q&A only (cloze is out of this ruling's M5 scope; its own gap is
// `invalidCloze` above). This cannot live in `mcq-format.ts`/`card-format.ts`
// — neither has vault access — so it runs here, the one place that already
// reads every note and can list every path.

/**
 * Matches `![[target]]`, `![[target#heading]]`, `![[target|alias]]` (and the
 * combination), capturing only `target` — the same embed shape
 * `../extract/embeds.ts` recognises for source ingestion, reproduced here
 * (rather than imported) because that module's own resolver is private and
 * this walk needs a different question answered: not "which C3.1 ingestion
 * format is this" but "does this MCQ/Q&A text's own embedded asset exist
 * anywhere in the vault". Constructed fresh per call rather than kept as a
 * module-level global-flag regex, so no caller has to reason about
 * `lastIndex` state carrying across calls.
 */
function embedTargetsIn(text: string): readonly string[] {
  const re = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const targets: string[] = [];
  for (const m of text.matchAll(re)) {
    const target = (m[1] ?? '').trim();
    if (target !== '') targets.push(target);
  }
  return targets;
}

function basenameOf(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Whether `target` (an embed's raw wikilink text) resolves to some file this
 * listing currently knows about — an exact vault-relative path first, then
 * any file anywhere in the vault sharing its basename, mirroring
 * `../extract/embeds.ts`'s own resolution rule for the same reason that
 * module gives: an exact vault-relative path wins outright, and a bare
 * filename is the common case her notes actually use.
 *
 * **Deliberately lenient toward ambiguity, and toward "listed but not yet
 * downloaded":** any candidate at all — even more than one, even in the
 * wrong folder — counts as resolved. M5 asks this check to distinguish a
 * genuinely missing asset from one only temporarily unavailable through
 * vault syncing or offline access, and a file listing cannot see *why* a
 * name is absent, only that it currently is — a cloud-sync placeholder
 * typically has a directory entry before its bytes finish downloading, so a
 * name present in `allPaths` is never genuinely missing regardless of
 * whether its content has actually arrived on this device yet. The honest
 * answer available from a listing alone is one-directional: presence proves
 * "not missing"; only the *absence* of every candidate — not the exact path,
 * not any file sharing the basename — is treated as the defect, which is the
 * same "not-found" test `embeds.ts` already applies to source ingestion.
 * What this cannot see, and does not claim to: a device that is itself
 * offline or mid-sync may have a listing that is momentarily incomplete
 * relative to another device's — the same honest limit `embeds.ts`'s own
 * header names for its `'ambiguous'` case.
 */
function embedResolves(target: string, allPaths: readonly VaultPath[]): boolean {
  const trimmed = target.trim();
  if (trimmed.includes('/') && allPaths.includes(trimmed)) return true;
  const base = basenameOf(trimmed);
  return allPaths.some((p) => basenameOf(p) === base);
}

/** The first embed target across `texts` that does not resolve, or `null` when every one does (or there are none). */
function firstUnresolvedEmbed(
  texts: readonly string[],
  allPaths: readonly VaultPath[],
): string | null {
  for (const text of texts) {
    for (const target of embedTargetsIn(text)) {
      if (!embedResolves(target, allPaths)) return target;
    }
  }
  return null;
}

/** Every text field an MCQ block renders to her — anywhere one of these embeds an asset, M5 applies. */
function mcqAssetTexts(mcq: McqInstrument): readonly string[] {
  return [mcq.stem, mcq.answer, ...mcq.distractors, mcq.feedback ?? ''];
}

/** Every text field a Q&A card renders to her. Cloze is not called here — M5 is scoped to MCQ and Q&A only. */
function qaAssetTexts(card: QaCardInstrument): readonly string[] {
  return [card.front, card.back];
}

/**
 * Every schedulable instrument in the vault, bound to its concept and courses.
 *
 * Vault order (`VaultSource.list` is sorted) then source order within a note,
 * so the result is stable across hosts and runs. `composeQueue` preserves
 * caller order for instruments due at the same instant, which makes this
 * ordering the tiebreaker a never-reviewed corpus is composed in.
 */
export async function enumerateVaultInstruments(
  vault: VaultSource,
  options: EnumerateVaultInstrumentsOptions = {},
): Promise<VaultInstrumentEnumeration> {
  const deriveId = options.instrumentId ?? provisionalInstrumentId;
  const excluded = new Set(options.excludePaths ?? []);

  const concepts = await extractConcepts(vault, {
    ...(options.concepts ?? {}),
    ...(options.under !== undefined ? { under: options.under } : {}),
  });
  const byPath = new Map<VaultPath, ConceptRecord[]>();
  for (const concept of concepts) {
    for (const path of concept.sourcePaths) {
      const bucket = byPath.get(path);
      if (bucket === undefined) byPath.set(path, [concept]);
      else bucket.push(concept);
    }
  }

  const paths = await vault.list({
    ...(options.under !== undefined ? { under: options.under } : {}),
    extensions: ['md'],
  });
  // M5's own listing (`[D-334]`): unfiltered and unscoped by `under`, because
  // an embedded asset can live anywhere in the vault regardless of where this
  // walk was asked to look for notes — the same whole-vault default
  // `../extract/embeds.ts`'s `discoverEmbeddedSources` uses when it is not
  // handed a narrower `knownPaths`.
  const allPaths = await vault.list();

  const records: VaultInstrumentRecord[] = [];
  const invalidMcqBlocks: InvalidMcqReport[] = [];
  const invalidCardBlocks: InvalidCardReport[] = [];
  const invalidClozeBlocks: InvalidClozeReport[] = [];
  const unbound: UnboundInstrumentReport[] = [];

  for (const notePath of paths) {
    if (excluded.has(notePath)) continue;
    const source = await vault.read(notePath);
    const {
      instruments: parsedInstruments,
      invalidMcq,
      invalidCards,
      invalidCloze,
    } = instrumentsOf(source);

    for (const block of invalidMcq) {
      invalidMcqBlocks.push({ notePath, block });
    }
    for (const block of invalidCards) {
      invalidCardBlocks.push({ notePath, block });
    }
    for (const block of invalidCloze) {
      invalidClozeBlocks.push({ notePath, block });
    }

    // M5 (`[D-334]`), MCQ and Q&A only: a block that otherwise parsed cleanly
    // is withheld here, the same way a format-level failure already is
    // above, when a text field it renders embeds an asset that resolves to
    // no file anywhere in the vault. Filtered out before the rest of this
    // walk (ordinal counting, id derivation, concept binding) ever sees it —
    // exactly as a format-invalid block already never reaches `instruments`
    // at all — so a withheld instrument never consumes an ordinal slot a
    // sibling would otherwise get.
    const instruments = parsedInstruments.filter((instrument) => {
      if (instrument.mcq !== undefined) {
        const unresolved = firstUnresolvedEmbed(mcqAssetTexts(instrument.mcq), allPaths);
        if (unresolved === null) return true;
        invalidMcqBlocks.push({
          notePath,
          block: {
            reason: 'unresolved-asset',
            detail: `embedded asset ${JSON.stringify(unresolved)} does not resolve to any file in the vault`,
            raw: instrument.mcq.raw,
            span: instrument.mcq.span,
          },
        });
        return false;
      }
      if (instrument.card !== undefined && instrument.card.type === 'qa') {
        const unresolved = firstUnresolvedEmbed(qaAssetTexts(instrument.card), allPaths);
        if (unresolved === null) return true;
        invalidCardBlocks.push({
          notePath,
          block: {
            reason: 'unresolved-asset',
            detail: `embedded asset ${JSON.stringify(unresolved)} does not resolve to any file in the vault`,
            raw: instrument.card.raw,
            span: instrument.card.span,
          },
        });
        return false;
      }
      return true;
    });

    if (instruments.length === 0) continue;

    // The note's concepts, ordered by her own `topic:` order. `noteConcepts` is
    // what the extractor authoritatively recorded for this path; the order is
    // hers.
    const noteConcepts = byPath.get(notePath) ?? [];
    const byName = new Map(noteConcepts.map((concept) => [concept.name, concept]));
    const ordered: ConceptRecord[] = [];
    for (const topic of topicsOf(source)) {
      const concept = byName.get(topic);
      if (concept !== undefined && !ordered.includes(concept)) ordered.push(concept);
    }
    // Anything the extractor bound to this note that her `topic:` order did not
    // reach — a drift between the two meaning paths — still counts, just last.
    for (const concept of noteConcepts) {
      if (!ordered.includes(concept)) ordered.push(concept);
    }

    // An instrument in a note that resolves to no concept at all is still
    // reported rather than logged: `conceptIds` is non-empty by schema, and
    // inventing an entry to satisfy it is exactly the guess this whole bead
    // forbids.
    if (ordered.length === 0) {
      for (const instrument of instruments) {
        unbound.push({ notePath, instrumentType: instrument.type, span: instrument.span });
      }
      continue;
    }

    const doc = parseDocument(source);
    const headings = doc.blocks.filter((block): block is HeadingBlock => block.kind === 'heading');
    const noteUid = uidOf(source);
    const title = noteTitle(notePath);
    // `.key`, not `.name` — the coordinated flip (`ol-63e1`, `[D-088]`/
    // `[D-109]`). Every reader that joins review-log `conceptIds` moved in the
    // same change: `evidence-edge/build.ts` (`ConceptAssessmentEdge.conceptKey`),
    // `oracle/compose.ts`'s mastery join, `gap/build.ts` (`GapRow.conceptKey`,
    // `buildMaterialPresence`), `plan/build.ts` (`PlannedConcept.conceptId`),
    // `plugin/src/today/data-source.ts` (`listConceptCourses`), and
    // `study-session/build.ts`'s instrument-index lookup. `concept.name`
    // remains available on `ConceptRecord` for display; nothing here renders
    // `conceptIds` to her, so the flip changes no student-visible surface.
    const conceptIds = ordered.map((concept) => concept.key);
    // F2.5's course membership follows concept membership: the instrument
    // belongs to every course any of its concepts belongs to (M:N, R1/R2 —
    // verbatim strings, never case-folded). Sorted for a deterministic result,
    // and identical to the single concept's own list when there is one.
    const courses = [...new Set(ordered.flatMap((concept) => concept.courses))].sort();

    // `ol-8ae9`: two independent counters, not one shared by anchor key — see this module's
    // doc for the failure this fixes. `headingOrdinals` counts every instrument under a
    // heading regardless of whether it has since moved to its own block-id anchor, so a
    // sibling's stamp never vacates another instrument's slot. `blockOrdinals` counts each
    // block id on its own; a block id is unique by construction, so this is always `1`.
    /** heading text (or '' for none) -> how many instruments, of any anchor, seen under it. */
    const headingOrdinals = new Map<string, number>();
    /** block id -> how many instruments seen anchored on it (always 1 in practice). */
    const blockOrdinals = new Map<string, number>();

    for (const instrument of instruments) {
      const heading = headingAbove(headings, instrument.span.start);
      const headingKey = heading ?? '';
      const headingPosition = (headingOrdinals.get(headingKey) ?? 0) + 1;
      headingOrdinals.set(headingKey, headingPosition);

      let ordinal: number;
      if (instrument.blockId !== null) {
        ordinal = (blockOrdinals.get(instrument.blockId) ?? 0) + 1;
        blockOrdinals.set(instrument.blockId, ordinal);
      } else {
        ordinal = headingPosition;
      }

      // `[D-177]`'s cloze branch: this walk already holds everything
      // `cloze-identity.ts`'s `ClozeIdAnchor` needs (the same root/anchor/
      // ordinal `instrument-id.ts` computes for every other type), so the
      // read happens here — `instrument-id.ts` itself never reads a note's
      // bytes (its own module doc's hard constraint) — and only for a cloze,
      // since a `readClozeId` call for a non-cloze instrument at this anchor
      // would risk matching a cloze stamped at the same position by
      // coincidence. This is a READ ONLY: `enumerateVaultInstruments`'s own
      // module doc ("nothing here writes") is unchanged, and mints nothing
      // when no stamp exists yet — `provisionalInstrumentId` falls through to
      // the position-based rule exactly as it did before this field existed.
      const stampedClozeId: string | null =
        instrument.type === 'cloze'
          ? (readClozeId(source, { noteUid, notePath, heading, ordinal }) ?? null)
          : null;

      const instrumentId = deriveId({
        noteUid,
        notePath,
        blockId: instrument.blockId,
        heading,
        ordinal,
        explicitId: instrument.explicitId,
        instrumentType: instrument.type,
        stampedClozeId,
      });

      // `[D-181]`'s passage-citation sidecar (`ol-2zfj.52`): a targeted read by the
      // `[D-177]`-frozen id, never a scan — `citation-store.ts`'s own addressing
      // discipline. `undefined` (no sidecar, or one page couldn't honestly convert —
      // see `citationToSourceProvenance`) leaves `sourceProvenance` absent, exactly
      // like every record `enumerate.ts` produced before this citation existed.
      const citation = await readInstrumentCitation(vault, instrumentId);
      const sourceProvenance =
        citation === undefined ? undefined : citationToSourceProvenance(citation);

      const common = {
        instrumentId,
        conceptIds,
        courses,
        notePath,
        noteTitle: title,
        noteUid,
        blockId: instrument.blockId,
        heading,
        ordinal,
        ...(sourceProvenance !== undefined ? { sourceProvenance } : {}),
      };

      if (instrument.mcq !== undefined) {
        records.push({ ...common, instrumentType: 'mcq', mcq: instrument.mcq });
        continue;
      }
      const card = instrument.card;
      if (card === undefined) continue;
      if (card.type === 'qa') {
        records.push({ ...common, instrumentType: 'qa', card });
      } else {
        records.push({ ...common, instrumentType: 'cloze', card });
      }
    }
  }

  return {
    records,
    invalidMcqBlocks,
    invalidCardBlocks,
    invalidClozeBlocks,
    unbound,
    concepts,
  };
}
