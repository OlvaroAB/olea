/**
 * `buildScopeSnapshotAt` / `FrozenSittingScope` export tests
 * (`ol-egov.141.89.10.46`).
 *
 * `ol-egov.141.89.10.14` found the shared session holder's entry for Start
 * could never compute real staleness because the ONE thing that turns a
 * frozen sitting scope plus an as-of date into a fresh `SittingScopeSnapshot`
 * — this file's own `buildScopeSnapshotAt` — was private, along with the two
 * interfaces (`FrozenScopeConcept`, `FrozenScopeAssessment`) it is built
 * from. This suite drives the newly-exported function directly, over a
 * hand-built `FrozenSittingScope`, and feeds both ends into `olea-core`'s
 * `diffSittingScopeSnapshots` — the same two-call shape `load()` below
 * already uses internally, so a second holder (`session/holder.ts`'s shared
 * session holder) can compute `[D-162]`'s three facts through this one
 * definition rather than a second, independently-drifting copy (D-033,
 * `docs/dev/one-assembly-path.md`).
 *
 * `firstSeen` is passed as a plain injected function here, never a
 * `VaultSource` — proving the export needs no vault capability at all, only
 * whatever stat read its caller already has in hand.
 *
 * Every identifier below (course/concept/note names) is invented, per INV-3.
 */
import { diffSittingScopeSnapshots, EMPTY_SITTING_SCOPE_SNAPSHOT } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildScopeSnapshotAt,
  type FrozenScopeAssessment,
  type FrozenScopeConcept,
  type FrozenSittingScope,
} from '../../src/session-builder/provider.js';

const CONCEPTS: readonly FrozenScopeConcept[] = [
  {
    conceptKey: 'concept-a',
    notePaths: ['Course A/note-a.md'],
    masteryState: 'sprout',
    // `sprout`'s baseline gap is 5 days (RETRIEVAL_BASELINE_STAGE_LADDER_DAYS),
    // so this concept comes due on 2026-08-06 — after the freeze asOf below,
    // on or before the later re-check asOf.
    lastRetrievalDay: '2026-08-01',
    recallDueDay: null,
  },
];

const ASSESSMENTS: readonly FrozenScopeAssessment[] = [
  {
    path: 'Course A/midterm.md',
    // 17 days out from the freeze asOf ('far'), 5 days out from the later
    // re-check asOf ('near') — a real band crossing, not a date edit.
    due: '2026-08-20',
  },
];

const SCOPE: FrozenSittingScope = { concepts: CONCEPTS, assessments: ASSESSMENTS };

const FREEZE_AS_OF = '2026-08-03';
const CURRENT_AS_OF = '2026-08-15';

describe('buildScopeSnapshotAt (exported)', () => {
  it('re-derives itemsDueInScope purely from asOf moving past the baseline due day', async () => {
    const freeze = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF);
    const current = await buildScopeSnapshotAt(SCOPE, CURRENT_AS_OF);

    expect(freeze.dueConceptKeys.has('concept-a')).toBe(false);
    expect(current.dueConceptKeys.has('concept-a')).toBe(true);

    const diff = diffSittingScopeSnapshots(freeze, current);
    expect(diff.itemsDueInScope).toBe(true);
  });

  it('re-derives assessmentProximityBandCrossedInScope purely from elapsed time', async () => {
    const freeze = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF);
    const current = await buildScopeSnapshotAt(SCOPE, CURRENT_AS_OF);

    expect(freeze.assessmentProximityBands.get('Course A/midterm.md')).toBe('far');
    expect(current.assessmentProximityBands.get('Course A/midterm.md')).toBe('near');

    const diff = diffSittingScopeSnapshots(freeze, current);
    expect(diff.assessmentProximityBandCrossedInScope).toBe(true);
  });

  it('takes firstSeen as an injected function, never a VaultSource, for the material-arrival watermark', async () => {
    // Freeze: the host cannot say yet (mirrors an absent/unsupported
    // `VaultSource.firstSeen`, or a not-yet-answered stat).
    const freeze = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF, async () => null);
    // Re-check: the same injected function, now answering — a light re-read
    // over the frozen scope's own notePaths, no VaultSource involved.
    const current = await buildScopeSnapshotAt(SCOPE, CURRENT_AS_OF, async () =>
      new Date('2026-08-10T12:00:00Z').getTime(),
    );

    expect(freeze.materialArrivalWatermark).toBeUndefined();
    expect(current.materialArrivalWatermark).toBe('2026-08-10');

    const diff = diffSittingScopeSnapshots(freeze, current);
    expect(diff.materialArrivedInScope).toBe(true);
  });

  it('drives all three [D-162] facts at once through the export and diffSittingScopeSnapshots', async () => {
    const freeze = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF, async () => null);
    const current = await buildScopeSnapshotAt(SCOPE, CURRENT_AS_OF, async () =>
      new Date('2026-08-10T12:00:00Z').getTime(),
    );

    const diff = diffSittingScopeSnapshots(freeze, current);
    expect(diff).toEqual({
      itemsDueInScope: true,
      materialArrivedInScope: true,
      assessmentProximityBandCrossedInScope: true,
    });
  });

  it('reports nothing changed when asOf and firstSeen do not move (no false positives)', async () => {
    const first = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF, async () => null);
    const second = await buildScopeSnapshotAt(SCOPE, FREEZE_AS_OF, async () => null);

    expect(diffSittingScopeSnapshots(first, second)).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });
  });

  it('an empty scope against EMPTY_SITTING_SCOPE_SNAPSHOT is itself unchanged', async () => {
    const empty = await buildScopeSnapshotAt({ concepts: [], assessments: [] }, FREEZE_AS_OF);
    expect(diffSittingScopeSnapshots(EMPTY_SITTING_SCOPE_SNAPSHOT, empty)).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });
  });
});
