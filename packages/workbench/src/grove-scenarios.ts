/**
 * F1.5/F8.1's grove fixture states (`ol-z6x2` [WB-2], `olea-service`'s
 * `features/F1-sources.md`) — the REAL `GroveView` (`grove-bridge.ts`) mounted
 * over a hand-built `GroveCourseModel`, never a real vault walk.
 *
 * **Scope, per the bead brief: only the F1/F8.1 risk that does NOT live in
 * the Obsidian runtime** — the three-way registration status rendered
 * honestly, F8.3's count-and-denominator summary (never a ratio) and F4.10's
 * material gap named in plain language. `createLocalGroveProvider`'s own
 * vault walk (`enumerateVaultInstruments`, `extractTier3Evidence`, the
 * ground-streak store) stays untouched here — same posture
 * `registry-scenarios.ts`'s own module doc states for its surface: feeding
 * `GroveView` a hand-built `GroveCourseModel` directly is still the real
 * projection's own type, just fed fixture data instead of a fixture vault.
 *
 * Course codes, concept names and note paths below are coined vocabulary
 * (`syn:course:…`, `syn:concept:…`), never real course or concept names —
 * same fixture-vocabulary discipline `registry-scenarios.ts` states for its
 * own corpus.
 */

import type {
  GroveCourseModel,
  GroveCourseSection,
  GroveViewDeps,
  GroveViewState,
} from './grove-bridge.js';
import { Notice } from './obsidian-shim/index.js';

export interface GroveWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'grove';
  readonly note: string;
}

export const GROVE_STATES: readonly GroveWorkbenchState[] = [
  {
    id: 'grove-no-source',
    label: 'No source registered yet',
    group: 'grove',
    note:
      "F8.1 scenario 2's designed empty state: no registered objectives document or past paper " +
      "for this course, and nothing of her own extracted either — GroveView's own " +
      '"No grove yet" heading and body, never a bare empty grid.',
  },
  {
    id: 'grove-declared',
    label: 'Declared — built, material gap and a volunteer',
    group: 'grove',
    note:
      "F8.3's count-and-source summary (never a ratio), F4.10's material gap in plain language " +
      "(never a fourth olive noun) and F8.2's volunteer concept, shown outside the declared count " +
      'and never hidden.',
  },
];

export function findGroveState(
  id: string,
): { readonly id: string; readonly note: string } | undefined {
  const found = GROVE_STATES.find((s) => s.id === id);
  return found === undefined ? undefined : { id: found.id, note: found.note };
}

const COURSE = 'syn:course:vantrel';
const OBJECTIVES_SOURCE_PATH = '01 Courses/syn:course:vantrel/Objectives.md';

function modelFor(stateId: string): GroveCourseModel {
  if (stateId === 'grove-declared') {
    return {
      status: 'declared',
      course: COURSE,
      cells: [
        {
          conceptKey: 'syn:grove-key:alpha',
          conceptName: 'syn:concept:alpha',
          state: 'sprout',
          stall: false,
        },
      ],
      materialGaps: [{ conceptName: 'syn:concept:beta' }],
      volunteers: [{ conceptKey: 'syn:grove-key:florzik', conceptName: 'syn:concept:florzik' }],
      summary: {
        builtCount: 1,
        denominatorCount: 2,
        denominatorSourcePaths: [OBJECTIVES_SOURCE_PATH],
      },
    };
  }
  // 'grove-no-source', and anything else: no registered source and nothing extracted.
  return { status: 'no-registered-source', course: COURSE };
}

export interface GroveScenario {
  readonly stateId: string;
  readonly deps: GroveViewDeps;
  readonly dismissed: string[];
}

export function buildGroveScenario(stateId: string): GroveScenario {
  const dismissed: string[] = [];
  const deps: GroveViewDeps = {
    async load(): Promise<GroveViewState> {
      const section: GroveCourseSection = {
        course: COURSE,
        model: modelFor(stateId),
        offerCards: [],
        // `[D-196]` is not this workbench pane's scenario — no synthetic
        // unreadable-file fixture exists here, so this is honestly empty
        // rather than invented.
        unreadableFiles: [],
      };
      return { kind: 'model', courses: [section] };
    },
    openRetrospective(): void {
      new Notice(
        'Workbench: opening the retrospective would open the real retrospective view in the ' +
          'product. This pane does not navigate — neither fixture state offers a standing card.',
      );
    },
    async dismiss(assessmentPath): Promise<void> {
      dismissed.push(assessmentPath);
    },
  };
  return { stateId, deps, dismissed };
}
