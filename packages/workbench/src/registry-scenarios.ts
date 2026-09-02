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

import type { ReviewLogEntry } from 'olea-contracts';
import type { ConceptRecord, VaultInstrumentRecord } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import type {
  BuildRegistryModelInput,
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

  function buildModel(): RegistryModel {
    return buildRegistryModel({
      ...baseInput,
      overrides,
      suspendedInstrumentIds: withdrawnInstrumentIds,
    });
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
  };

  return { stateId, deps, editHandoffs, sourceOpens, noteOfferAccepts };
}
