/**
 * F8.4's concept-and-instrument registry mount (`ol-z6x2` [WB-2] F8 tranche),
 * built against the REAL `buildRegistryModel` (`olea-core`) and the REAL
 * `RegistryView` (`packages/plugin`) — the same "workbench mounts the real
 * product view against real deps" discipline `bulk-review-scenarios.ts`'s
 * own module doc states for its surface.
 *
 * Unlike bulk-review this does not run `RegistryView` over
 * `createLocalRegistryProvider`'s own vault walk: that provider composes
 * `RegistryViewDeps.load()` from `enumerateVaultInstruments` +
 * `readReviewLogHistory` over a real vault, which would need markdown notes
 * shaped exactly right for concept/instrument extraction. `buildRegistryModel`
 * itself takes plain `ConceptRecord`/`VaultInstrumentRecord`/log-entry arrays
 * (see `olea-core`'s own `registry/build.spec.ts`), so this file builds those
 * by hand — still the real projection, just fed fixture records instead of a
 * fixture vault, matching `trends-scenarios.ts`'s posture for its own
 * synthetic history.
 *
 * Rename/withdraw/restore run through the REAL pure `overrides.ts` transforms
 * (`renameConcept`/`pruneConcept`/`unpruneConcept`) held in a local mutable
 * `RegistryOverrides` per scenario instance — the same shape
 * `ObsidianRegistryOverridesStore` persists in production, just kept in
 * memory here instead of `data.json`.
 *
 * Course codes, concept names and note paths below are coined vocabulary
 * (`syn:course:…`, `syn:concept:…`), never real course or concept names —
 * same fixture-vocabulary discipline `bulk-review-scenarios.ts` states for
 * its own corpus.
 */

import type { DisputeLogRecord, ReviewLogEntry, SoloLevel } from 'olea-contracts';
import type { ConceptRecord, VaultInstrumentRecord } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import type {
  BuildRegistryModelInput,
  CourseOracleRanking,
  RegistryConceptEntry,
  RegistryInstrumentSummary,
  RegistryModel,
  RegistryOverrides,
  RegistrySourceLocation,
  RegistryViewDeps,
  RegistryViewState,
} from './registry-bridge.js';
import {
  buildRegistryModel,
  EMPTY_REGISTRY_OVERRIDES,
  pruneConcept,
  renameConcept,
  unpruneConcept,
} from './registry-bridge.js';

const NOW = new Date('2027-01-15T09:00:00-08:00');
const HOLDING_CUT = 0.8;
const scheduler = createFsrsScheduler();

export interface RegistryWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'registry';
  readonly note: string;
}

export const REGISTRY_STATES: readonly RegistryWorkbenchState[] = [
  {
    id: 'registry-populated',
    label: 'Two courses, provenance and instrument mix',
    group: 'registry',
    note:
      "F8.4's browsable inventory (`[D-171]`) — two concepts, each with a Sources list drawn " +
      'from real `RegistryConceptEntry.sourceLocations`, plus one instrument each with its own ' +
      'Open source action. Rename and withdraw/restore run through the real overrides.ts ' +
      'transforms held in memory for this state.',
  },
  {
    id: 'registry-empty',
    label: 'Nothing extracted yet — the honest empty state',
    group: 'registry',
    note:
      'No concepts at all. F8.4 asks for a browsable inventory rather than a filtered one, but ' +
      'an inventory of nothing still needs a designed empty state, not a bare blank list — ' +
      "RegistryView's own REGISTRY_EMPTY_LINE.",
  },
  {
    id: 'registry-withdrawn-shown',
    label: 'A withdrawn concept, shown behind the toggle',
    group: 'registry',
    note:
      "F8.5's prune-never-delete: one concept starts withdrawn. It is hidden by default and " +
      'reappears — never re-fetched, never re-derived, the SAME row — once "Show withdrawn" is ' +
      'checked. No control anywhere in this surface offers deletion.',
  },
  {
    id: 'registry-explain-back-history',
    label: 'One instrument with a contested history, one with none',
    group: 'registry',
    note:
      "F8.4b's per-instrument explain-back history (`[D-175]`), rendered right on the " +
      "instrument's own registry row. One instrument carries two real graded attempts at " +
      'different SOLO depths — the current (later) one presently `[D-095]`-quarantined, shown ' +
      'as "under re-review" rather than hidden or discounted. Its sibling instrument, same ' +
      'concept, has never been explained back and renders no history section at all — "never ' +
      'attempted" is omission, not an empty list.',
  },
  {
    id: 'registry-note-offer',
    label: 'The standing note offer — eligible, and gated by tier',
    group: 'registry',
    note:
      "F4.2a's `[D-176]` standing note-offer affordance. One tier-2 concept clears all three " +
      'conditions (accepted instrument, at least one scored review, top band of its own ' +
      "course's F4.2 ranking) and shows the offer with both verbs, Create the note and Not " +
      'now. A second concept clears the same three conditions in its own course but is tier ' +
      '1 — already bound to an authored note — and never shows the offer at all, proving the ' +
      'tier gate rather than the evidence gate is what is being tested.',
  },
  {
    id: 'registry-rename-proposal',
    label: "A rank-gated rename proposal, on the concept's own row",
    group: 'registry',
    note:
      "`[D-183]`'s rank-gated rename proposal (knowledge model §3, `ol-2zfj.58`). One concept " +
      "carries a pending proposal — it renders inline on that row, beside the concept's own " +
      'facts, with one accept ("Use this wording") and one decline ("Keep the current ' +
      'wording"), no banner and no badge anywhere else on the page. Accepting adopts the ' +
      'candidate wording through the real overrides.ts renameConcept transform (the frozen old ' +
      'wording survives as an alias); declining records the (tier, wording) pair in memory, ' +
      'held for this scenario instance, so the same proposal never re-fires — the row keeps its ' +
      'current wording either way.',
  },
  {
    id: 'registry-duplicate-title',
    label: 'A duplicate-title state — the binder refuses, no chooser offered',
    group: 'registry',
    note:
      "`[D-203]`'s duplicate-title state (F8.4, `ol-2zfj.60`). One concept's title is carried " +
      'by two of its notes, so the binder (`ConceptRecord.ambiguousNotePaths`) refuses to bind ' +
      'either — the row shows a badge and one line naming both notes and the structural reason, ' +
      'with no button, dropdown, or any other way to pick between them. The state is fed ' +
      'straight from `buildRegistryModel` itself, not a session overlay: it clears the moment a ' +
      'fresh build hands in a `ConceptRecord` with no `ambiguousNotePaths` at all, which is what ' +
      'renaming one of the two notes in Obsidian produces.',
  },
];

export function findRegistryState(
  id: string,
): { readonly id: string; readonly note: string } | undefined {
  const found = REGISTRY_STATES.find((s) => s.id === id);
  return found === undefined ? undefined : { id: found.id, note: found.note };
}

function concept(
  overrides: Partial<ConceptRecord> & Pick<ConceptRecord, 'key' | 'name'>,
): ConceptRecord {
  return {
    tier: 2,
    courses: ['syn:course:vantrel'],
    sourcePaths: ['01 Courses/syn:course:vantrel/Week 2.md'],
    ...overrides,
  };
}

function instrument(
  overrides: Partial<VaultInstrumentRecord> &
    Pick<VaultInstrumentRecord, 'instrumentId' | 'conceptIds'>,
): VaultInstrumentRecord {
  return {
    instrumentType: 'qa',
    courses: ['syn:course:vantrel'],
    notePath: '01 Courses/syn:course:vantrel/Week 2.md',
    noteTitle: 'Week 2',
    noteUid: null,
    blockId: 'syn-block-1',
    heading: null,
    ordinal: 1,
    card: {
      raw: 'Q: What does the alpha mechanism regulate?\nA: The synthetic rate constant',
      span: { start: 0, end: 40 },
      blockId: 'syn-block-1',
      foreignScheduling: null,
      type: 'qa',
      style: 'single-line',
      front: 'What does the alpha mechanism regulate?',
      back: 'The synthetic rate constant',
      reversed: false,
    },
    ...overrides,
  } as VaultInstrumentRecord;
}

const ALPHA = concept({
  key: 'syn:concept-key:alpha',
  name: 'syn:concept:alpha',
  sourcePaths: [
    '01 Courses/syn:course:vantrel/Week 2.md',
    '01 Courses/syn:course:vantrel/Objectives.md',
  ],
});
const BETA = concept({
  key: 'syn:concept-key:beta',
  name: 'syn:concept:beta',
  courses: ['syn:course:melspar'],
  sourcePaths: ['01 Courses/syn:course:melspar/Week 4.md'],
});

const ALPHA_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:alpha:1',
  conceptIds: ['syn:concept-key:alpha'],
});
const BETA_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:beta:1',
  conceptIds: ['syn:concept-key:beta'],
  courses: ['syn:course:melspar'],
  notePath: '01 Courses/syn:course:melspar/Week 4.md',
  noteTitle: 'Week 4',
  blockId: 'syn-block-2',
});

// ---------------------------------------------------------------------------
// F8.4b (`[D-175]`) — per-instrument explain-back history.
// ---------------------------------------------------------------------------

const BRIVANE = concept({
  key: 'syn:concept-key:brivane',
  name: 'syn:concept:brivane',
});

/** No graded explain-back attempt anywhere in `entries` — "an instrument with none". */
const BRIVANE_INSTRUMENT_BARE = instrument({
  instrumentId: 'qa:syn:concept-key:brivane:1',
  conceptIds: ['syn:concept-key:brivane'],
  blockId: 'syn-block-brivane-1',
});

/** Carries two graded explain-back attempts in `entries` below, the later one contested. */
const BRIVANE_INSTRUMENT_HISTORY = instrument({
  instrumentId: 'qa:syn:concept-key:brivane:2',
  conceptIds: ['syn:concept-key:brivane'],
  blockId: 'syn-block-brivane-2',
});

/** Fixture-only — never a real Worker call, matching `explainBackGradeEntry`'s own doc. */
const EXPLAIN_BACK_FIXTURE_PROVENANCE = {
  taskId: 'workbench.explain-back.fixture.v1',
  promptVersion: 'wb-fixture',
  modelId: 'workbench:fixture-model',
} as const;

/** One graded explain-back review record, hand-built the same way `session-scenarios.ts`'s `borrowedHistory` builds a plain scored review — see this file's own module doc on why fixture records rather than a vault walk. */
function explainBackGradeEntry(input: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
  readonly soloLevel: SoloLevel;
}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: input.eventId,
    timestamp: input.timestamp,
    instrumentId: input.instrumentId,
    instrumentType: 'explain-back',
    conceptIds: [...input.conceptIds],
    rating: null,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    explainBackGrade: {
      soloLevel: input.soloLevel,
      contentRef: `content:${input.eventId}`,
      revisionOf: null,
      artifactProvenance: EXPLAIN_BACK_FIXTURE_PROVENANCE,
    },
  } as ReviewLogEntry;
}

/** An OPEN `[D-095]` grade dispute on one instrument — never resolved, so `quarantinedGradeInstrumentIds` keeps marking its current attempt contested. */
function openGradeDispute(input: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
}): DisputeLogRecord {
  return {
    schemaVersion: 5,
    kind: 'dispute',
    eventId: input.eventId,
    timestamp: input.timestamp,
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: [...input.conceptIds],
    instrumentId: input.instrumentId,
    evidenceBasis: 'syn:evidence-basis:brivane-history-1',
    effect: 'quarantined',
  };
}

const BRIVANE_HISTORY_ENTRIES: readonly ReviewLogEntry[] = [
  explainBackGradeEntry({
    eventId: 'wb-explain-back-brivane-1',
    timestamp: '2027-01-05T09:00:00-08:00',
    instrumentId: BRIVANE_INSTRUMENT_HISTORY.instrumentId,
    conceptIds: ['syn:concept-key:brivane'],
    soloLevel: 'unistructural',
  }),
  explainBackGradeEntry({
    eventId: 'wb-explain-back-brivane-2',
    timestamp: '2027-01-10T09:00:00-08:00',
    instrumentId: BRIVANE_INSTRUMENT_HISTORY.instrumentId,
    conceptIds: ['syn:concept-key:brivane'],
    soloLevel: 'relational',
  }),
];

const BRIVANE_DISPUTES: readonly DisputeLogRecord[] = [
  openGradeDispute({
    eventId: 'wb-dispute-brivane-1',
    timestamp: '2027-01-11T09:00:00-08:00',
    instrumentId: BRIVANE_INSTRUMENT_HISTORY.instrumentId,
    conceptIds: ['syn:concept-key:brivane'],
  }),
];

// ---------------------------------------------------------------------------
// F4.2a (`[D-176]`) — the standing note-offer affordance, gated by tier.
// ---------------------------------------------------------------------------

/** Tier 2, eligible: an accepted instrument, a scored review below, and a top-band ranking. */
const WORVENN = concept({
  key: 'syn:concept-key:worvenn',
  name: 'syn:concept:worvenn',
  courses: ['syn:course:vantrel'],
  sourcePaths: ['01 Courses/syn:course:vantrel/Week 5.md'],
});

/** Same evidence shape as `WORVENN`, in its own course — but tier 1 (already has an authored note), so `[D-176]`'s gate must stay closed regardless. */
const CAPRIST = concept({
  key: 'syn:concept-key:caprist',
  name: 'syn:concept:caprist',
  tier: 1,
  courses: ['syn:course:melspar'],
  sourcePaths: ['01 Courses/syn:course:melspar/Week 5.md'],
});

const WORVENN_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:worvenn:1',
  conceptIds: ['syn:concept-key:worvenn'],
  notePath: '01 Courses/syn:course:vantrel/Week 5.md',
  noteTitle: 'Week 5',
  blockId: 'syn-block-worvenn-1',
});

const CAPRIST_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:caprist:1',
  conceptIds: ['syn:concept-key:caprist'],
  courses: ['syn:course:melspar'],
  notePath: '01 Courses/syn:course:melspar/Week 5.md',
  noteTitle: 'Week 5',
  blockId: 'syn-block-caprist-1',
});

/** "Has been reviewed at least once" — a plain scored (never explain-back) review. */
function scoredReviewEntry(input: {
  readonly eventId: string;
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: input.eventId,
    timestamp: '2027-01-08T09:00:00-08:00',
    instrumentId: input.instrumentId,
    instrumentType: 'qa',
    conceptIds: [...input.conceptIds],
    rating: 'good',
    wasUnsure: false,
    durationMs: 12_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  } as ReviewLogEntry;
}

const NOTE_OFFER_ENTRIES: readonly ReviewLogEntry[] = [
  scoredReviewEntry({
    eventId: 'wb-scored-worvenn-1',
    instrumentId: WORVENN_INSTRUMENT.instrumentId,
    conceptIds: ['syn:concept-key:worvenn'],
  }),
  scoredReviewEntry({
    eventId: 'wb-scored-caprist-1',
    instrumentId: CAPRIST_INSTRUMENT.instrumentId,
    conceptIds: ['syn:concept-key:caprist'],
  }),
];

/** "Sits in the top band" — one ranked entry, alone, in a list of one: `ceil(1/3)` floors to 1, so rank 1 of 1 always qualifies (`note-offer.ts`'s `isInTopBand`). */
function topBandRanking(input: {
  readonly course: string;
  readonly conceptKey: string;
  readonly conceptName: string;
}): CourseOracleRanking {
  const assessmentPath = `02 Assignments/syn:assessment:${input.conceptKey}.md`;
  return {
    course: input.course,
    status: 'ranked',
    ranked: [
      {
        conceptName: input.conceptName,
        conceptKey: input.conceptKey,
        course: input.course,
        rank: 1,
        priorityScore: 1,
        factors: {
          citations: [
            {
              sourcePath: assessmentPath,
              questionLabel: 'Q1',
              questionText: 'syn:question-text:fixture-1',
              provenance: { sourcePath: assessmentPath, location: { page: 1 } },
            },
          ],
          distinctSourceCount: 1,
          contributions: [
            {
              assessmentPath,
              yieldRank: 1,
              yieldScore: 1,
              confidence: 1,
              assessmentWeightKnown: true,
              assessmentWeightScore: 1,
              daysUntilDue: 14,
              examProximityScore: 1,
              evidenceStrength: 1,
              contribution: 1,
            },
          ],
          preMasteryScore: 1,
          masteryState: 'unknown',
          masteryNeedWeight: 1,
          priorityScore: 1,
        },
        citations: [
          {
            sourcePath: assessmentPath,
            questionLabel: 'Q1',
            questionText: 'syn:question-text:fixture-1',
            provenance: { sourcePath: assessmentPath, location: { page: 1 } },
          },
        ],
        reasoning: 'syn:reasoning:top-band-fixture',
      },
    ],
  };
}

const NOTE_OFFER_RANKINGS: readonly CourseOracleRanking[] = [
  topBandRanking({
    course: 'syn:course:vantrel',
    conceptKey: 'syn:concept-key:worvenn',
    conceptName: 'syn:concept:worvenn',
  }),
  topBandRanking({
    course: 'syn:course:melspar',
    conceptKey: 'syn:concept-key:caprist',
    conceptName: 'syn:concept:caprist',
  }),
];

// ---------------------------------------------------------------------------
// `[D-183]` (`ol-2zfj.58`) — the rank-gated rename proposal, on its own row.
// ---------------------------------------------------------------------------

/** `RegistryConceptEntry.renameProposal`'s non-null shape, by indexed access rather than a named import — `RenameProposal` is not re-exported from `olea-core`'s index (out of `ol-2zfj.58`'s `owns`), the identical situation `packages/plugin/src/registry/view.ts` and `./provider.ts` already document for the same type. */
type RenameProposal = NonNullable<RegistryConceptEntry['renameProposal']>;

/**
 * Tier 2, no override yet — its raw extraction wording is what the row
 * currently shows and what `[D-183]` freezes as `currentDisplayName` while
 * the proposal below is pending.
 */
const RENWICK = concept({
  key: 'syn:concept-key:renwick',
  name: 'syn:concept:renwick',
  tier: 2,
  courses: ['syn:course:vantrel'],
  sourcePaths: ['01 Courses/syn:course:vantrel/Week 6.md'],
});

const RENWICK_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:renwick:1',
  conceptIds: ['syn:concept-key:renwick'],
  notePath: '01 Courses/syn:course:vantrel/Week 6.md',
  noteTitle: 'Week 6',
  blockId: 'syn-block-renwick-1',
});

/**
 * The candidate a tier-1 source (her own concept note, outranking `RENWICK`'s
 * tier 2) has proposed — never applied to `RENWICK.name` itself, which stays
 * the frozen "current" wording per `[D-183]`'s own rule until she acts.
 */
const RENAME_PROPOSAL_CANDIDATE: RenameProposal['candidate'] = {
  tier: 1,
  wording: 'syn:concept:renwick-clarified',
  sourceLocation: {
    sourcePath: '01 Courses/syn:course:vantrel/Renwick.md',
    heading: 'Renwick',
  },
};

/** Mirrors `../../core/registry/rename-proposal.ts`'s `declineSignature` — same "(tier, wording), not the concept alone" unit, kept local for the same reason `RenameProposal` above is an indexed-access type rather than an import. */
function renameProposalDeclineSignature(candidate: RenameProposal['candidate']): string {
  return `${candidate.tier}:${candidate.wording}`;
}

// ---------------------------------------------------------------------------
// `[D-203]` (`ol-2zfj.60`) — the duplicate-title state on the concept row.
// ---------------------------------------------------------------------------

/**
 * Two Zettelkasten notes, invented, that would share one title in a real
 * vault — never a real note name (INV-3). `CORVALE.ambiguousNotePaths`
 * carries both, matching the shape `../../core/src/concept/extract.ts`'s
 * `resolveTitle` mints when it refuses to bind: `boundNotePath` absent,
 * tier 2.
 */
const DUPLICATE_TITLE_NOTE_PATHS: readonly string[] = [
  '05 Zettelkasten/syn:concept:corvale.md',
  // `Outcrop Sketches` is the same cleared subfolder name
  // `../../core/src/concept/extract.spec.ts` already uses for its own
  // duplicate-title fixture — reused rather than a second phrase invented
  // and re-screened for the same purpose (INV-3, `node
  // scripts/check-fixture-vocabulary.mjs --term`).
  '05 Zettelkasten/Outcrop Sketches/syn:concept:corvale.md',
];

const CORVALE = concept({
  key: 'syn:concept-key:corvale',
  name: 'syn:concept:corvale',
  tier: 2,
  courses: ['syn:course:vantrel'],
  sourcePaths: ['01 Courses/syn:course:vantrel/Week 7.md'],
  ambiguousNotePaths: DUPLICATE_TITLE_NOTE_PATHS,
});

/** Proves the state coexists with an ordinary instrument mix — the duplicate-title note is one more fact on the row, not a replacement for the rest of it. */
const CORVALE_INSTRUMENT = instrument({
  instrumentId: 'qa:syn:concept-key:corvale:1',
  conceptIds: ['syn:concept-key:corvale'],
  notePath: '01 Courses/syn:course:vantrel/Week 7.md',
  noteTitle: 'Week 7',
  blockId: 'syn-block-corvale-1',
});

function inputFor(stateId: string): BuildRegistryModelInput {
  if (stateId === 'registry-empty') {
    return {
      concepts: [],
      instrumentRecords: [],
      entries: [],
      scheduler,
      now: NOW,
      holdingCut: HOLDING_CUT,
      overrides: EMPTY_REGISTRY_OVERRIDES,
      suspendedInstrumentIds: new Set(),
    };
  }
  if (stateId === 'registry-explain-back-history') {
    return {
      concepts: [BRIVANE],
      instrumentRecords: [BRIVANE_INSTRUMENT_BARE, BRIVANE_INSTRUMENT_HISTORY],
      entries: BRIVANE_HISTORY_ENTRIES,
      disputes: BRIVANE_DISPUTES,
      scheduler,
      now: NOW,
      holdingCut: HOLDING_CUT,
      overrides: EMPTY_REGISTRY_OVERRIDES,
      suspendedInstrumentIds: new Set(),
    };
  }
  if (stateId === 'registry-note-offer') {
    return {
      concepts: [WORVENN, CAPRIST],
      instrumentRecords: [WORVENN_INSTRUMENT, CAPRIST_INSTRUMENT],
      entries: NOTE_OFFER_ENTRIES,
      courseRankings: NOTE_OFFER_RANKINGS,
      scheduler,
      now: NOW,
      holdingCut: HOLDING_CUT,
      overrides: EMPTY_REGISTRY_OVERRIDES,
      suspendedInstrumentIds: new Set(),
    };
  }
  if (stateId === 'registry-rename-proposal') {
    return {
      concepts: [RENWICK],
      instrumentRecords: [RENWICK_INSTRUMENT],
      entries: [],
      scheduler,
      now: NOW,
      holdingCut: HOLDING_CUT,
      overrides: EMPTY_REGISTRY_OVERRIDES,
      suspendedInstrumentIds: new Set(),
    };
  }
  if (stateId === 'registry-duplicate-title') {
    return {
      concepts: [CORVALE],
      instrumentRecords: [CORVALE_INSTRUMENT],
      entries: [],
      scheduler,
      now: NOW,
      holdingCut: HOLDING_CUT,
      overrides: EMPTY_REGISTRY_OVERRIDES,
      suspendedInstrumentIds: new Set(),
    };
  }
  const entries: readonly ReviewLogEntry[] = [];
  return {
    concepts: [ALPHA, BETA],
    instrumentRecords: [ALPHA_INSTRUMENT, BETA_INSTRUMENT],
    entries,
    scheduler,
    now: NOW,
    holdingCut: HOLDING_CUT,
    overrides: EMPTY_REGISTRY_OVERRIDES,
    suspendedInstrumentIds: new Set(),
  };
}

export interface RecordedOpen {
  readonly notePath: string;
  readonly blockId: string | null;
}

export interface RegistryScenario {
  readonly stateId: string;
  readonly deps: RegistryViewDeps;
  readonly editHandoffs: RecordedOpen[];
  readonly sourceOpens: RegistrySourceLocation[];
  /** F8.4a's `[D-176]` accept half (`ol-r1by`) — recorded rather than written anywhere, matching `sourceOpens`'/`editHandoffs`' own posture of proving the CALL reached this mock, never a real vault write (this package has none to make). */
  readonly noteOfferAccepts: RegistryConceptEntry[];
  /** `[D-183]` accept half — recorded, AND applied through the real `renameConcept` transform below, so a subsequent `load()` shows the candidate wording and the old wording demoted to an alias. */
  readonly renameProposalAccepts: RenameProposal[];
  /** `[D-183]` decline half — recorded, AND the (tier, wording) signature is remembered so `buildModel()` never re-attaches this exact proposal again for this scenario instance. */
  readonly renameProposalDeclines: RenameProposal[];
}

/**
 * Builds one fresh `RegistryViewDeps` per open, with a local mutable
 * `RegistryOverrides` closing over `rename`/`withdrawConcept`/
 * `restoreConcept`/`withdrawInstrument`/`restoreInstrument` — the real
 * `overrides.ts` pure transforms, applied in memory rather than through
 * `ObsidianRegistryOverridesStore`'s `data.json`, matching this file's own
 * module doc.
 */
export function buildRegistryScenario(stateId: string): RegistryScenario {
  const baseInput = inputFor(stateId);
  let overrides: RegistryOverrides =
    stateId === 'registry-withdrawn-shown'
      ? pruneConcept(EMPTY_REGISTRY_OVERRIDES, BETA.key)
      : EMPTY_REGISTRY_OVERRIDES;

  const withdrawnInstrumentIds = new Set<string>();
  const editHandoffs: RecordedOpen[] = [];
  const sourceOpens: RegistrySourceLocation[] = [];
  const noteOfferAccepts: RegistryConceptEntry[] = [];
  const renameProposalAccepts: RenameProposal[] = [];
  const renameProposalDeclines: RenameProposal[] = [];
  const declinedRenameSignatures = new Set<string>();

  function buildModel(): RegistryModel {
    const model = buildRegistryModel({
      ...baseInput,
      overrides,
      suspendedInstrumentIds: withdrawnInstrumentIds,
    });
    if (stateId !== 'registry-rename-proposal') return model;

    // `buildRegistryModel` never computes `renameProposal` itself (`./view.ts`'s
    // own doc: that field is overlaid AFTER the pure build, by
    // `packages/plugin/src/registry/provider.ts` in production). This mirrors
    // that overlay for one fixture concept: present exactly while no override
    // has been accepted yet (`overrides.renames[RENWICK.key]` unset — the same
    // "hers already wins" gate `gateRenameCandidate` reads off `displayName
    // !== originalName`) and this exact candidate has not been declined.
    const hasAcceptedOverride = overrides.renames[RENWICK.key] !== undefined;
    const declined = declinedRenameSignatures.has(
      renameProposalDeclineSignature(RENAME_PROPOSAL_CANDIDATE),
    );
    const showProposal = !hasAcceptedOverride && !declined;
    return {
      concepts: model.concepts.map((entry): RegistryConceptEntry => {
        if (entry.key !== RENWICK.key) return entry;
        if (!showProposal) return { ...entry, renameProposal: null };
        const proposal: RenameProposal = {
          key: entry.key,
          currentDisplayName: entry.displayName,
          currentTier: entry.tier,
          candidate: RENAME_PROPOSAL_CANDIDATE,
        };
        return { ...entry, renameProposal: proposal };
      }),
    };
  }

  const deps: RegistryViewDeps = {
    async load(): Promise<RegistryViewState> {
      return { kind: 'model', model: buildModel() };
    },
    async rename(entry: RegistryConceptEntry, newDisplayName: string): Promise<void> {
      overrides = renameConcept(overrides, entry.key, entry.originalName, newDisplayName);
    },
    async withdrawConcept(entry: RegistryConceptEntry): Promise<void> {
      overrides = pruneConcept(overrides, entry.key);
    },
    async restoreConcept(entry: RegistryConceptEntry): Promise<void> {
      overrides = unpruneConcept(overrides, entry.key);
    },
    async withdrawInstrument(instrumentSummary: RegistryInstrumentSummary): Promise<void> {
      withdrawnInstrumentIds.add(instrumentSummary.instrumentId);
    },
    async restoreInstrument(instrumentSummary: RegistryInstrumentSummary): Promise<void> {
      withdrawnInstrumentIds.delete(instrumentSummary.instrumentId);
    },
    async editInstrument(instrumentSummary: RegistryInstrumentSummary): Promise<void> {
      editHandoffs.push({
        notePath: instrumentSummary.notePath,
        blockId: instrumentSummary.blockId,
      });
    },
    async openSourceLocation(location: RegistrySourceLocation): Promise<void> {
      sourceOpens.push(location);
    },
    async acceptNoteOffer(entry: RegistryConceptEntry): Promise<void> {
      noteOfferAccepts.push(entry);
    },
    /**
     * `[D-183]` accept half. Reuses `renameConcept` exactly as `rename()`
     * above does, and exactly as `../../plugin/src/registry/provider.ts`'s
     * own `acceptRenameProposal` does in production: `proposal.currentDisplayName`
     * (the frozen old wording), never `entry.originalName`, is what must be
     * passed as `renameConcept`'s `originalName` parameter — the other order
     * silently no-ops and drops the alias (see
     * `../../core/registry/rename-proposal.ts`'s own doc on `acceptRenameProposal`).
     */
    async acceptRenameProposal(
      _entry: RegistryConceptEntry,
      proposal: RenameProposal,
    ): Promise<void> {
      overrides = renameConcept(
        overrides,
        proposal.key,
        proposal.currentDisplayName,
        proposal.candidate.wording,
      );
      renameProposalAccepts.push(proposal);
    },
    /**
     * `[D-183]` decline half. Session-scoped, matching production's own
     * documented gap: records the (tier, wording) signature so `buildModel()`
     * above never re-attaches this exact proposal again for this scenario
     * instance, but the row's own wording is untouched.
     */
    async declineRenameProposal(
      _entry: RegistryConceptEntry,
      proposal: RenameProposal,
    ): Promise<void> {
      declinedRenameSignatures.add(renameProposalDeclineSignature(proposal.candidate));
      renameProposalDeclines.push(proposal);
    },
  };

  return {
    stateId,
    deps,
    editHandoffs,
    sourceOpens,
    noteOfferAccepts,
    renameProposalAccepts,
    renameProposalDeclines,
  };
}
