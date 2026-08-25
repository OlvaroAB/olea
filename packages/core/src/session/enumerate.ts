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
 * `card-format.ts`'s `stampQaCardBlockId`), but deliberately not *here*: this
 * walk stays read-only so enumerating the vault to render a panel or compose
 * a queue never itself writes to it. Whatever drives review decides when a
 * stamp actually happens (`ol-k7eg`'s notes: on first review, not on
 * enumeration).
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
 */

import { parseDocument } from '../block/parse.js';
import type { HeadingBlock } from '../block/types.js';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord, ExtractConceptsOptions } from '../concept/types.js';
import { noteTitle } from '../concept/zettelkasten.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList, readScalar, wikilinkTarget } from '../frontmatter/read.js';
import { parseCards } from '../instrument/card-format.js';
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
    // DELIBERATELY still `.name`, not `.key` (`ol-il6m`, C7.11, `[D-109]`).
    // `ConceptRecord.key` exists now, but flipping this mint site alone would
    // silently break every reader that still joins review-log `conceptIds`
    // against a display name — `../oracle/compose.ts`'s `conceptNames`
    // (sourced from `ConceptAssessmentEdge.conceptName`, itself a display
    // name), and through it `plugin/src/gap/provider.ts`,
    // `plugin/src/session-builder/provider.ts` and `plugin/src/plan/provider.ts`
    // in production. That is a coordinated, cross-package flip (evidence-edge,
    // oracle, gap, plan all key on the same string today) tracked on a
    // follow-up bead, not a mechanical rename — see that bead for the full
    // list of sites that have to move together.
    const conceptIds = ordered.map((concept) => concept.name);
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

      const instrumentId = deriveId({
        noteUid,
        notePath,
        blockId: instrument.blockId,
        heading,
        ordinal,
        explicitId: instrument.explicitId,
        instrumentType: instrument.type,
      });

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
