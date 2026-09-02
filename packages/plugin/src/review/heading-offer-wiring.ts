/**
 * `heading-offer-wiring.ts` — F2.10's surface wiring (`ol-i19f`), the piece
 * `heading-offer.ts`'s own module doc names as still missing: matching a
 * live note's headings to a `ConceptRecord` and deciding *where and when*
 * `review/view.ts`'s `renderHeadingOfferBanner` mounts.
 *
 * **What this module is, and is not.** `olea-core`'s `detectHeadingOffers`
 * (F2.10) finds question-shaped headings with no card in one note's parsed
 * source — agnostic to which note, which course, which concept. `heading-
 * offer.ts`'s `HeadingOfferPort` is the accept/dismiss verb pair — agnostic
 * to *which* candidate or *which* concept a caller hands it
 * (`HeadingOfferContext.concept` is "a caller-supplied fact", that module's
 * own words). This file is the caller: given the note a review item's
 * instrument came from, it reads that note, runs detection, resolves a
 * concept, and hands `review/view.ts` one ready-to-render offer — or
 * `null`, honestly, whenever there is nothing safe to offer.
 *
 * **Scoped to review, by this bead's brief — not to "whichever note she has
 * open" in general.** `review/view.ts`'s own module doc flags that F2.10's
 * offer conceptually belongs to a live, open note rather than to "the
 * currently reviewed instrument," and may end up living outside a review
 * session entirely. This bead wires the narrower, concretely reachable
 * case first: the note a review item's own instrument was drafted from,
 * checked as she reaches that item. A future bead may widen the trigger to
 * the active editor generally; this file's `HeadingOfferForItem` shape
 * (sourcePath + courseCode in, a banner or nothing out) does not need to
 * change for that — only its caller would.
 *
 * **Concept resolution is deliberately conservative, same bias `detect.ts`
 * itself argues for.** A `ConceptRecord` is bound at NOTE grain
 * (`ConceptRecord.sourcePaths`), never at heading grain — nothing on the
 * record says which of a note's several concepts (if it has several) a
 * given heading is "about." Where exactly one `ConceptRecord` in
 * `conceptRecords()` names this note, that is the unambiguous, safe
 * resolution. Where zero or more than one do, this module offers nothing
 * rather than guess — a missed offer is recoverable (F2.10's own
 * "detection proposes" posture, and `ol-i19f`'s parent bead's "a missed pass
 * is non-failing" note); drafting against the wrong concept is not.
 *
 * **"Offer one" (F2.10's own phrase) is enforced here, not in `detect.ts`.**
 * `detectHeadingOffers` returns every uncovered question-shaped heading in
 * the note; this module keeps only the first not already dismissed this
 * session (`HeadingOfferPort.isDismissed`) — one candidate, one banner, per
 * note, per check.
 *
 * **Accepting also dismisses, in this module's own bookkeeping only.**
 * `HeadingOfferPort.dismiss` is F2.10's DECLINE verb and writes nothing —
 * see `heading-offer.ts`'s own D7.1 paragraph. Reusing that same in-memory
 * set to also suppress a heading she just ACCEPTED is not a second, hidden
 * meaning for "dismissed": it is the same fact from this caller's point of
 * view — "do not offer this candidate again this session" — and inventing a
 * second in-memory set for the identical purpose would be the duplication
 * this codebase's own conventions argue against elsewhere. Nothing about
 * D7.1/D-005 changes: still nothing written, still forgotten on reload.
 *
 * **The settings toggle F2.10's own clause asks for ("Toggleable in
 * settings") is a seam here, not a built control.** `HeadingOfferWiringDeps
 * .enabled` is read fresh on every check, same "never captured once"
 * reasoning `HeadingOfferPortDeps.draftDeps` documents for the identical
 * F7.8 reason. No production settings field exists yet to back it — this
 * bead's owned files do not include `settings/settings-tab.ts` — so
 * `main.ts` wires `enabled` to a constant `() => true` for now. That is a
 * disclosed gap (F2.10's "toggleable off, cleanly" `@manual` scenario is
 * not yet satisfiable), not a silent omission: the seam exists so the next
 * bead that adds the real field only has to change what `main.ts` passes in.
 *
 * INV-3: every fixture in this module's own spec is invented.
 */

import {
  type ConceptRecord,
  detectHeadingOffers,
  type HeadingOfferCandidate,
  parseCards,
  parseDocument,
  parseMcqBlocks,
  type SourceSpan,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import {
  HEADING_OFFER_PROMPT_TEXT,
  type HeadingOfferAcceptOutcome,
  type HeadingOfferContext,
  type HeadingOfferPort,
} from './heading-offer.js';

/** The one review item field this module needs — never the whole `ReviewInstrument`, so a caller can supply it from any instrument kind. */
export interface HeadingOfferItem {
  readonly sourcePath: VaultPath;
  readonly courseCode: string;
}

/** One ready-to-render offer: F2.10's own prompt text, plus the two verbs already bound to the resolved candidate/concept/note. `review/view.ts` never sees a `HeadingOfferCandidate` or a `ConceptRecord` — only this. */
export interface HeadingOfferBannerState {
  readonly promptText: string;
  accept(): Promise<HeadingOfferAcceptOutcome>;
  dismiss(): void;
}

export type HeadingOfferForItem = (
  item: HeadingOfferItem,
) => Promise<HeadingOfferBannerState | null>;

export interface HeadingOfferWiringDeps {
  readonly vault: Pick<VaultSource, 'exists' | 'read'>;
  readonly port: HeadingOfferPort;
  /**
   * The session's own already-folded concepts (`main.ts`'s
   * `this.conceptRecords`, read the same thunk way
   * `registry/provider.ts`'s `conceptRecords` param already is) — never a
   * fresh extraction or a network call. `null` before the first
   * corpus-relation-batch tick has completed, same as every other reader of
   * this field; this module treats that exactly like "no concept resolved,"
   * not an error.
   */
  readonly conceptRecords: () => readonly ConceptRecord[] | null;
  /** See this module's own doc, "the settings toggle... is a seam here." Omitted or returning `true` means "on," matching F2.10's default-on framing. */
  readonly enabled?: () => boolean;
}

/**
 * Every note-order-independent instrument span in `source` — `detect.ts`'s
 * own "has no card" check only tests each span's `start` against a
 * heading's coverage window, so unlike `session/enumerate.ts`'s
 * `instrumentsOf` (private to that file, and itself sorts only to give a
 * stable *ordinal*), no merge-by-start-offset is needed here.
 */
function existingInstrumentSpans(source: string): readonly SourceSpan[] {
  return [
    ...parseCards(source).map((card) => card.span),
    ...parseMcqBlocks(source).instruments.map((mcq) => mcq.span),
  ];
}

/**
 * Resolves one heading's concept — see this module's doc, "concept
 * resolution is deliberately conservative." `null` for zero or ambiguous
 * matches; never a guess.
 */
function resolveConceptForNote(
  concepts: readonly ConceptRecord[] | null,
  sourcePath: VaultPath,
): ConceptRecord | null {
  if (concepts === null) return null;
  const matches = concepts.filter((concept) => concept.sourcePaths.includes(sourcePath));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function pickOffer(
  candidates: readonly HeadingOfferCandidate[],
  port: HeadingOfferPort,
  sourcePath: VaultPath,
): HeadingOfferCandidate | null {
  // "Offer one" — F2.10's own phrase — and never one she has already
  // dismissed (or, per this module's own reuse note, already accepted)
  // this session.
  for (const candidate of candidates) {
    if (!port.isDismissed(candidate, sourcePath)) return candidate;
  }
  return null;
}

/**
 * Checks one review item's source note for F2.10's offer. Never throws on
 * an unreadable or missing note, an unresolved concept, or the toggle being
 * off — every one of those is the same honest `null` a caller renders as
 * "no banner," matching `detectHeadingOffers`'s own conservative-bias
 * posture. A thrown vault error (as opposed to a normal "not found")
 * propagates, same as `heading-offer.ts`'s own `accept` contract.
 */
export function createHeadingOfferForItem(deps: HeadingOfferWiringDeps): HeadingOfferForItem {
  return async ({ sourcePath, courseCode }) => {
    if (deps.enabled?.() === false) return null;
    if (!(await deps.vault.exists(sourcePath))) return null;

    const source = await deps.vault.read(sourcePath);
    const doc = parseDocument(source);
    const candidates = detectHeadingOffers(doc, existingInstrumentSpans(source));
    const candidate = pickOffer(candidates, deps.port, sourcePath);
    if (candidate === null) return null;

    const concept = resolveConceptForNote(deps.conceptRecords(), sourcePath);
    if (concept === null) return null;

    const context: HeadingOfferContext = { courseCode, concept, sourcePath };
    return {
      promptText: HEADING_OFFER_PROMPT_TEXT,
      async accept(): Promise<HeadingOfferAcceptOutcome> {
        const outcome = await deps.port.accept(candidate, context);
        // See module doc, "accepting also dismisses" — same in-memory set,
        // no new write, no new field.
        deps.port.dismiss(candidate, sourcePath);
        return outcome;
      },
      dismiss(): void {
        deps.port.dismiss(candidate, sourcePath);
      },
    };
  };
}

/**
 * Caches the last checked item's banner and re-checks only when the
 * *current* item's note actually changes — so `review/view.ts`'s `render()`
 * (called after every keystroke and rating) can call `bannerFor` on every
 * pass for free instead of re-reading and re-parsing the note each time.
 *
 * The check itself is async (a vault read); this returns synchronously
 * with whatever is already known and kicks off a background check on a
 * path it has not seen yet, calling `onUpdate` only when that check
 * produces something worth a re-render (a fresh `null` result changes
 * nothing on screen, so it never fires `onUpdate`).
 *
 * **Superseded checks are dropped, not raced.** If the current item's path
 * changes again before an in-flight check resolves, that check's result is
 * discarded when it lands (`checkedPath` no longer matches) — the same
 * "later state wins outright" shape `explainWhyPanel`'s own instrument-id
 * guard in `review/view.ts` already uses for the identical reason.
 */
export interface HeadingOfferBannerTracker {
  bannerFor(item: HeadingOfferItem | null, onUpdate: () => void): HeadingOfferBannerState | null;
}

export function createHeadingOfferBannerTracker(
  detect: HeadingOfferForItem,
): HeadingOfferBannerTracker {
  let checkedPath: VaultPath | null = null;
  let current: HeadingOfferBannerState | null = null;

  function wrap(state: HeadingOfferBannerState): HeadingOfferBannerState {
    return {
      promptText: state.promptText,
      async accept() {
        const outcome = await state.accept();
        // Resolved either way (drafted, refused, unparseable, not
        // configured) — F2.10's own "offer one" means it does not linger
        // once she has acted on it.
        current = null;
        return outcome;
      },
      dismiss() {
        state.dismiss();
        current = null;
      },
    };
  }

  return {
    bannerFor(item, onUpdate) {
      if (item === null) {
        checkedPath = null;
        current = null;
        return null;
      }
      if (checkedPath !== item.sourcePath) {
        checkedPath = item.sourcePath;
        current = null;
        void detect(item).then((result) => {
          if (checkedPath !== item.sourcePath) return; // superseded — see module doc
          if (result === null) return; // nothing changed on screen
          current = wrap(result);
          onUpdate();
        });
        return null;
      }
      return current;
    },
  };
}
