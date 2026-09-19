/**
 * `PaperDemand` — re-derived here because `olea-core`'s barrel
 * (`packages/core/src/index.ts`) does not re-export it (nor `PaperDemandReading`,
 * `PaperFaceDemandGap`, or `PaperEmptySlotReasonCode`) even though it exports
 * `PaperBlueprintSlot`/`PaperGeneratedItem`, both of which carry an `intendedDemand: PaperDemand`
 * field — confirmed by grep against `packages/core/src/index.ts` before writing this file.
 *
 * **Parked, not fixed here.** `packages/core/src/index.ts` is outside this bead's `owns`
 * (`packages/plugin/src/paper/`) and has live, concurrent DEMAND- and PAPER-prefixed lane activity
 * on it as of this bead (`ol-egov.141.6.1`'s brief). Adding the missing export there risks a merge
 * collision with whichever lane owns that file right now, for a one-line fix that costs nothing
 * to work around instead: this type alias derives `PaperDemand` from an ALREADY-exported field's
 * type (`PaperGeneratedItem['intendedDemand']`), so it can never drift from whatever `olea-core`
 * actually ships, and needs no manual sync if the five-value union is ever extended. Reported on
 * the bead as a park, per this bead's own brief ("if you need a core export that does not exist,
 * park it and report, do not add it").
 */

import type { PaperGeneratedItem } from 'olea-core';

export type PaperDemand = PaperGeneratedItem['intendedDemand'];
