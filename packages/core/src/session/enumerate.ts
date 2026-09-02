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
 * ## Three things that are reported rather than dropped
 *
 *   - **An invalid MCQ block.** The format module already refuses to return one
 *     as an instrument; this carries the refusal up with the note path, so she
 *     can be told which block, in which note, and why.
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
 * ## `[D-181]`'s citation sidecar (`ol-2zfj.52`)
 *
 * Still a read, not a write, in the same sense the cloze-id lookup above is: once an
 * instrument's `[D-177]`-frozen id is derived, this walk asks `../instrument/citation-store.js`
 * whether a generation-time passage citation was minted for it, and copies it onto
 * `sourceProvenance` when one exists. Absent for every hand-authored instrument (nothing mints a
 * sidecar for those) and for a generated one no writer has cited yet — `undefined`, never
 * guessed. See `citationToSourceProvenance`'s own doc for the one field (`charRange`) this can't
 * carry over honestly from the sidecar's smaller grain.
 */

import { parseDocument } from '../block/parse.js';
import type { HeadingBlock } from '../block/types.js';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord, ExtractConceptsOptions } from '../concept/types.js';
import { noteTitle } from '../concept/zettelkasten.js';
import type { CharRange, Provenance } from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList, readScalar, wikilinkTarget } from '../frontmatter/read.js';
import { parseCards } from '../instrument/card-format.js';
import { type InstrumentCitation, readInstrumentCitation } from '../instrument/citation-store.js';
import { readClozeId } from '../instrument/cloze-identity.js';
import { parseMcqBlocks } from '../instrument/mcq-format.js';
import type { CardInstrument, McqInstrument, SourceSpan } from '../instrument/types.js';
import { OLEA_UID_KEY } from '../uid/stamp.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { InstrumentIdSource } from './instrument-id.js';
import { provisionalInstrumentId } from './instrument-id.js';
import type {
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
  readonly invalid: ReturnType<typeof parseMcqBlocks>['invalid'];
} {
  const cards = parseCards(source);
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

  return { instruments, invalid: mcqs.invalid };
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
 * `[D-181]`'s citation grain (`sourcePath`/`page?`/`section?` — `../instrument/citation-store.js`)
 * carries no character-level precision: the sidecar is written long after the extraction pass
 * that produced a real `charRange` is over, and this walk never re-reads the original PDF/PPTX to
 * recover one. `VaultInstrumentRecord.sourceProvenance` is nonetheless typed `Provenance`
 * (`../extract/types.js`, reused verbatim per `[D-085]`/`ol-2zfj.48`), whose `SourceLocation`
 * requires `location.charRange`. This sentinel stands in for "no span" — deliberately never a
 * guessed one — and is safe today because `../registry/build.ts`'s `passageGrain()`, the only
 * reader of this field, reads only `.page`/`.section` and ignores `.charRange` entirely.
 *
 * This is a named, Class B compromise (CLAUDE.md's run-charter decision ladder: non-persisted,
 * in-memory, reversible), flagged for retroactive review rather than resolved here: the honest
 * fix is widening `SourceLocation.charRange` to optional in `../extract/types.js`, which ripples
 * into `../tier3-evidence/build.ts`'s sort comparator (`a.provenance.location.charRange.start`) —
 * out of `ol-2zfj.52`'s owned files (this module and `../instrument/citation-store.ts` only).
 */
const NO_CHAR_RANGE: CharRange = { start: 0, end: 0 };

/**
 * `InstrumentCitation` -> `VaultInstrumentRecord.sourceProvenance`. `SourceLocation.page` is
 * mandatory, so a citation with no `page` (never produced by a real generation-time caller today
 * — `InstrumentCitation`'s own type doesn't rule it out) is treated the same as no citation at
 * all: omitted, never guessed. See `NO_CHAR_RANGE`'s doc for the one field this can't honestly
 * build from the sidecar's own grain.
 */
function citationToSourceProvenance(citation: InstrumentCitation): Provenance | undefined {
  if (citation.page === undefined) return undefined;
  return {
    sourcePath: citation.sourcePath,
    location: {
      page: citation.page,
      charRange: NO_CHAR_RANGE,
      ...(citation.section !== undefined ? { section: citation.section } : {}),
    },
  };
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

  const records: VaultInstrumentRecord[] = [];
  const invalidMcqBlocks: InvalidMcqReport[] = [];
  const unbound: UnboundInstrumentReport[] = [];

  for (const notePath of paths) {
    if (excluded.has(notePath)) continue;
    const source = await vault.read(notePath);
    const { instruments, invalid } = instrumentsOf(source);

    for (const block of invalid) {
      invalidMcqBlocks.push({ notePath, block });
    }
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

    /** anchor key -> how many instruments have already been seen under it. */
    const ordinals = new Map<string, number>();

    for (const instrument of instruments) {
      const heading = headingAbove(headings, instrument.span.start);
      const anchorKey =
        instrument.blockId !== null ? `^${instrument.blockId}` : `h:${heading ?? ''}`;
      const ordinal = (ordinals.get(anchorKey) ?? 0) + 1;
      ordinals.set(anchorKey, ordinal);

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

  return { records, invalidMcqBlocks, unbound, concepts };
}
