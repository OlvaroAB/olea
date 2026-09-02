/**
 * `heading-offer.ts` — F2.10's accept/dismiss verb pair, per
 * `[D-170]`/`[GEN-2]` (`ol-egov.62`, ratified 2026-09-02, `ol-0r92.27`):
 *
 * > "The heading offer is its own affordance, with its own accept and
 * > dismiss verbs — it is not a re-entry into `[D-063]`'s withdrawn-draft
 * > lifecycle. Before she accepts, there is no draft to withdraw, so
 * > *dismiss* is the correct verb for declining the offer itself; accepting
 * > is what creates the draft, and only from that point does it enter
 * > `[D-063]`'s existing draft lifecycle (F3.3, F3.7) like any other
 * > generated instrument."
 *
 * **What this module is, and is not.** Detection lives in `olea-core`'s
 * `heading-offer/detect.ts` (`detectHeadingOffers`, F2.10) and only ever
 * proposes a `HeadingOfferCandidate` — it never creates anything and never
 * decides which concept a heading is "about." This module is the ACTION
 * half: what happens when she accepts or dismisses one candidate. It does
 * not detect candidates and does not resolve a heading to a `ConceptRecord`
 * — that match is a caller-supplied fact here (`HeadingOfferContext.concept`),
 * the same "caller supplies the fact" split `detect.ts` itself uses for
 * `existingInstrumentSpans`. Matching a live, open note's headings to real
 * concepts and deciding *when* to show the banner is `ol-0r92`'s
 * surface-wiring bead (`ol-i19f`, still open) — this module is the
 * destination it wires against (`ol-0r92.23`'s "the destination exists
 * behind the surface `ol-i19f` wires").
 *
 * **`accept` does not re-implement generation.** It calls the exact same
 * `draftQuizCardsForConcept` (`retrieval/draft-quiz-cards.ts`) the F3.3
 * automatic sweep uses, and shapes the result into a `DraftRecord` the same
 * way `generation/pipeline.ts`'s inner loop does (`deriveDraftId`,
 * `extractDraftedQuestions`, `extractDraftedProvenance`, then
 * `cache.put`) — reusing those exported building blocks rather than
 * duplicating the sweep's own logic. A heading-offer-accepted draft is
 * therefore indistinguishable in the cache from a sweep-drafted one: it
 * lands as an ordinary `status: 'pending'` `DraftRecord`, is picked up by
 * `open-session.ts`'s pending-draft merge exactly the same way, and is
 * resolved later by the existing `DraftAcceptPort` (`generation/accept.ts`)
 * when she actually reviews it — which is what "then enters `[D-063]`'s
 * existing draft lifecycle" means operationally. This module never calls
 * `DraftAcceptPort` itself; there is nothing to accept/edit/reject yet at
 * the moment of a heading-offer accept, only a pending draft to create.
 *
 * A refusal (`[D-089]`'s grounding band) is a real, honest outcome here —
 * accepting the offer does not guarantee a card, exactly as an automatic
 * sweep candidate can refuse. `describeRefusal` (`retrieval/draft-cards-copy.ts`)
 * is reused verbatim for that copy rather than inventing a second refusal
 * vocabulary.
 *
 * **`dismiss` persists nothing.** D7.1's six authorised additions
 * (`docs/Olea_alpha_functional_scope.md` §7, `[D-109]`/`[D-117]`) name
 * "Accept / edit / reject on generated material" (#3) as the one
 * accept/reject-shaped fact the review log may carry — and that is a
 * verdict on an instrument that already exists. Declining a heading OFFER
 * happens strictly before any draft exists (this module's whole point,
 * per `[D-170]` above), so it is not that fact and D7.1 authorises no field
 * for it. Per D-005's "never log content" and the general rule that an
 * unauthorised capture is a stop, not a judgement call: `dismiss` writes
 * nothing to the vault and appends nothing to the review log. It only
 * marks the candidate dismissed **in memory, for this plugin session** —
 * `HeadingOfferPort.isDismissed` lets a live surface (`ol-i19f`) avoid
 * re-offering a heading she just declined without re-scanning her intent
 * into anything durable. Reopening the vault (or Obsidian) forgets every
 * dismissal, which is the honest shape of "not persisted."
 */

import type {
  ConceptRecord,
  GroundingRefusalReason,
  HeadingOfferCandidate,
  VaultPath,
} from 'olea-core';
import type { DraftCacheStore } from '../generation/cache-store.js';
import { deriveDraftId } from '../generation/cache-store.js';
import { extractDraftedProvenance, extractDraftedQuestions } from '../generation/response.js';
import type { DraftRecord } from '../generation/types.js';
import { describeRefusal, type RefusalCopy } from '../retrieval/draft-cards-copy.js';
import {
  type DraftQuizCardsDeps,
  type DraftQuizCardsRequest,
  type DraftQuizCardsResult,
  draftQuizCardsForConcept,
} from '../retrieval/draft-quiz-cards.js';

// ---------------------------------------------------------------------------
// Copy — F2.10's own wording for the offer prompt; the two verbs are
// [D-170]'s, not F3.3's. Kept here rather than in `review/copy.ts` because
// this offer's copy is fixed, unconditional and meaningless away from the
// banner it labels — the same line `view.ts`'s own module doc draws for
// "fixed labels on controls it builds," applied to a module that is not a
// DOM builder itself.
// ---------------------------------------------------------------------------

/** F2.10's own prompt wording, verbatim from the contract clause. */
export const HEADING_OFFER_PROMPT_TEXT = 'This looks like a question but has no card yet.';

/** [D-170]'s accept verb: accepting is what creates the draft. */
export const HEADING_OFFER_ACCEPT_LABEL = 'Create a card';

/** [D-170]'s dismiss verb: declining the offer itself, before any draft exists. */
export const HEADING_OFFER_DISMISS_LABEL = 'Not now';

// ---------------------------------------------------------------------------
// Accept / dismiss
// ---------------------------------------------------------------------------

/** Everything `accept` needs about WHERE this candidate lives, resolved by the caller — see the module doc's "caller supplies the fact" note. */
export interface HeadingOfferContext {
  /** Which course this heading's note belongs to (`courseFromPath`, `olea-core`) — the same value `draftQuizCardsForConcept` keys its request on. */
  readonly courseCode: string;
  /**
   * The concept this heading is offering to draft against. Resolving a
   * heading to a `ConceptRecord` (rather than passing `headingText` straight
   * through as an ad hoc concept name) is deliberate: `DraftRecord.conceptIds`
   * requires the opaque, immutable `ConceptRecord.key` (`types.ts`'s own
   * doc), not a display string, because mastery rollups and scheduling key
   * on it. Minting that match is `ol-i19f`'s job, using the same concept
   * extraction `generation/pipeline.ts` already runs — not re-derived here.
   */
  readonly concept: ConceptRecord;
  /** The note this heading is in — `DraftRecord.sourcePath`, where `accept.ts` inserts the MCQ block once she resolves this draft in review. */
  readonly sourcePath: VaultPath;
}

export type HeadingOfferAcceptOutcome =
  | {
      /** At least one question was drafted and cached as a `status: 'pending'` `DraftRecord` — same shape an automatic sweep produces. */
      readonly kind: 'drafted';
      readonly draftIds: readonly string[];
    }
  | {
      /** F7.8: no Worker connection configured — the same "grey out, don't crash" outcome `sweep()` already gives a `null` for; nothing was attempted, nothing cached. */
      readonly kind: 'not-configured';
    }
  | {
      /** `[D-089]`'s grounding band refused before any generative call — the honest "nothing to draft from" outcome, not an error. */
      readonly kind: 'refused';
      readonly reason: GroundingRefusalReason;
      readonly copy: RefusalCopy;
    }
  | {
      /** The Worker responded but not with a shape `extractDraftedQuestions`/`extractDraftedProvenance` can use — nothing cached, matching `pipeline.ts`'s own "unparseable — revisited next sweep" posture (there is no next sweep here, but nothing is silently lost: she can re-trigger the offer). */
      readonly kind: 'unparseable';
    };

export interface HeadingOfferPort {
  /**
   * Accepts one heading offer: drafts against `context.concept` through the
   * SAME `draftQuizCardsForConcept` the automatic pipeline calls, and caches
   * every question it returns as a `status: 'pending'` `DraftRecord` —
   * `[D-170]`'s "accepting is what creates the draft." Never throws on a
   * refusal, an unparseable response, or a missing Worker connection (all
   * three are real `AcceptOutcome` kinds); a thrown transport error
   * propagates, matching `draftQuizCardsForConcept`'s own contract.
   */
  accept(
    candidate: HeadingOfferCandidate,
    context: HeadingOfferContext,
  ): Promise<HeadingOfferAcceptOutcome>;
  /**
   * Declines the offer. Writes nothing — see the module doc's D7.1
   * paragraph — and only records the candidate as dismissed in this port's
   * own in-memory set, keyed on `(sourcePath, headingStart)` (stable for as
   * long as the note is not edited above the heading; a live surface that
   * wants dismissal to survive a heading shifting position is out of scope
   * here, same "not persisted" honesty this whole verb is built on).
   */
  dismiss(candidate: HeadingOfferCandidate, sourcePath: VaultPath): void;
  /** Whether `dismiss` was called on this candidate during this port's lifetime (i.e. this plugin session — the port is reconstructed on reload, per the module doc). */
  isDismissed(candidate: HeadingOfferCandidate, sourcePath: VaultPath): boolean;
}

export interface HeadingOfferPortDeps {
  /**
   * Read fresh on every `accept()` call, never captured once at
   * construction — the same reason `generation/wiring.ts`'s `GenerationWiring.sweep`
   * takes `draftDeps` as a call-time parameter rather than a constructor
   * field: F7.8's Worker connection can come and go across the plugin's
   * lifetime (reconnection un-greys AI features), and a port built once
   * near the top of `onload` would otherwise freeze whatever was true at
   * that moment. `null` means "no Worker configured right now" — `accept`
   * reports `{ kind: 'not-configured' }` rather than throwing or drafting
   * against nothing.
   */
  readonly draftDeps: () => DraftQuizCardsDeps | null;
  readonly cache: DraftCacheStore;
  /** Injectable clock, defaults to the real one — matches `accept.ts`'s own `DraftAcceptPortDeps.now`. */
  readonly now?: () => Date;
  /**
   * Defaults to the real `draftQuizCardsForConcept` — injected so this
   * module's own spec can fake grounded/refused/unparseable outcomes
   * without a real Worker or embedding cache, the same seam
   * `generation/pipeline.ts`'s `GenerationPipelineDeps.draftForConcept`
   * already uses for the identical reason. `wiring.ts`/`main.ts` never
   * override this.
   */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
}

function dismissalKey(candidate: HeadingOfferCandidate, sourcePath: VaultPath): string {
  return `${sourcePath}::${candidate.headingStart}`;
}

export function createHeadingOfferPort(deps: HeadingOfferPortDeps): HeadingOfferPort {
  const now = deps.now ?? (() => new Date());
  const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
  const dismissed = new Set<string>();

  return {
    async accept(_candidate, context) {
      const draftDeps = deps.draftDeps();
      if (draftDeps === null) return { kind: 'not-configured' };

      const result = await draftForConcept(draftDeps, {
        courseCode: context.courseCode,
        conceptName: context.concept.name,
      });

      if (result.status === 'refused') {
        return { kind: 'refused', reason: result.reason, copy: describeRefusal(result.reason) };
      }

      const questions = extractDraftedQuestions(result.response);
      const provenance = extractDraftedProvenance(result.response);
      if (questions === null || provenance === null) {
        return { kind: 'unparseable' };
      }

      const createdAt = now().toISOString();
      const draftIds: string[] = [];
      let sequence = 0;
      for (const question of questions) {
        const draftId = await deriveDraftId(context.courseCode, context.concept.name, sequence);
        const record: DraftRecord = {
          draftId,
          status: 'pending',
          courseCode: context.courseCode,
          conceptName: context.concept.name,
          conceptIds: [context.concept.key],
          sourcePath: context.sourcePath,
          createdAt,
          question,
          provenance,
          firstServedAt: null,
        };
        await deps.cache.put(record);
        draftIds.push(draftId);
        sequence += 1;
      }

      // A refusal-shaped Worker reply that nonetheless parsed as "drafted"
      // with zero questions is treated the same as unparseable, rather than
      // a silent no-op "accepted, drafted nothing" — she asked for a card,
      // and this is the honest report that none arrived.
      if (draftIds.length === 0) return { kind: 'unparseable' };

      return { kind: 'drafted', draftIds };
    },

    dismiss(candidate, sourcePath) {
      dismissed.add(dismissalKey(candidate, sourcePath));
    },

    isDismissed(candidate, sourcePath) {
      return dismissed.has(dismissalKey(candidate, sourcePath));
    },
  };
}
