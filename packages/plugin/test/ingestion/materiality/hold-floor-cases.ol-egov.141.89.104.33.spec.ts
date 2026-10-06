/**
 * [D-500] / [D-502] (ol-egov.141.89.104.33): the floor column ("Dev3") of the mixed-version cases,
 * service repo docs/direction/papers/knowledge-graph/VALIDATION-FREEZE.md §4.9 (O2, O3, O5) and
 * §4.10 (M1-M11), run against the hold-record reader and the consumer hold check.
 *
 * The fixture world is that document's §2, synthetic (Varn, skell, tamber, Orm): passage π4 is
 * part 9 of the lecture 4 transcript, π8 is page 6 of the lecture 4 slides; instruments i:7 and
 * i:10 and the explanation claim occ:lec4#7 all cite π4, and nothing cites π8. F is cor:9, with
 * holds hold4 (π4) and hold8 (π8).
 *
 * A floor build reads only the hold store. The precise fact F lives in its own family, which a
 * floor build never reads (O1), so "F present", "F absent" and "F unreadable" give the floor the
 * same input: whatever holds it has received. "Held" means an instrument is not shown, not used as
 * support and not reviewable, and an explanation claim is shown withdrawn. "As before" means the
 * hold check adds nothing, so the artifact is decided exactly as it was before F.
 */
import { digestPassage } from 'olea-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CitedPassage,
  checkHolds,
  type HoldStoreRead,
  holdEffect,
  NEWER_FACT_HOLD_REASON,
  type PassageCitingArtifactKind,
  readHoldText,
} from '../../../src/ingestion/materiality/hold-record-reader.js';

const TRANSCRIPT_A4 = 'Orm course/Lecture 4 transcript.md';
const SLIDES_A4 = 'Orm course/Lecture 4 slides.pdf';

let pi4: CitedPassage;
let pi8: CitedPassage;

beforeAll(async () => {
  pi4 = {
    sourcePath: TRANSCRIPT_A4,
    passageDigest: await digestPassage(
      'Skell causes the Orm level to drop. Tamber is measured per second.',
    ),
  };
  pi8 = {
    sourcePath: SLIDES_A4,
    passageDigest: await digestPassage('Skell causes the Orm level to drop.'),
  };
});

interface Artifact {
  readonly id: string;
  readonly kind: PassageCitingArtifactKind;
  readonly cited: () => readonly CitedPassage[];
}

const ARTIFACTS: readonly Artifact[] = [
  { id: 'i:7', kind: 'instrument', cited: () => [pi4] },
  { id: 'i:10', kind: 'instrument', cited: () => [pi4] },
  { id: 'occ:lec4#7', kind: 'explanation-claim', cited: () => [pi4] },
];

const hold = (id: string, factId: string, passage: CitedPassage, reason = NEWER_FACT_HOLD_REASON) =>
  JSON.stringify({ id, factId, passage, reason });

const hold4 = () => hold('hold4', 'cor:9', pi4);
const hold8 = () => hold('hold8', 'cor:9', pi8);
const hold4b = () => hold('hold4b', 'cor:12', pi4);
const hold4c = () => hold('hold4c', 'cor:14', pi4);
const lines = (...records: string[]) => `${records.join('\n')}\n`;

type Outcome = 'held' | 'as before';

function floorOutcomes(read: HoldStoreRead): Record<string, Outcome> {
  const outcomes: Record<string, Outcome> = {};
  for (const artifact of ARTIFACTS) {
    const effect = holdEffect(artifact.kind, checkHolds(read, artifact.cited()));
    if (effect === null) {
      outcomes[artifact.id] = 'as before';
      continue;
    }
    // every case here reads its store: a hold is a hold, never the unavailable state ([D-539])
    expect(effect.status).toBe('held');
    expect(effect.supportUse).toBe(false);
    expect(effect.reviewEligible).toBe(false);
    expect(effect.display).toBe(artifact.kind === 'instrument' ? 'not-shown' : 'shown-withdrawn');
    outcomes[artifact.id] = 'held';
  }
  return outcomes;
}

const ALL_HELD = { 'i:7': 'held', 'i:10': 'held', 'occ:lec4#7': 'held' } as const;
const ALL_AS_BEFORE = {
  'i:7': 'as before',
  'i:10': 'as before',
  'occ:lec4#7': 'as before',
} as const;

describe('the floor column of the publishing-holds cases (§4.10)', () => {
  it('M1: the writer crashed after the holds, before F; the floor holds all three', () => {
    expect(floorOutcomes(readHoldText(lines(hold4(), hold8())))).toEqual(ALL_HELD);
  });

  it('M2: hold4 is corrupt and hold8 readable; before the republished hold4, nothing citing π4 is held', () => {
    const corrupt = hold4().slice(0, 23);
    const before = readHoldText(lines(corrupt, hold8()));
    // an unreadable hold is not one this device knows; hold8 is readable but nothing cites π8
    expect(floorOutcomes(before)).toEqual(ALL_AS_BEFORE);
    expect(before.unreadable.map((entry) => [entry.line, entry.kind])).toEqual([[1, 'not-json']]);
    expect(before.holds.map((record) => record.id)).toEqual(['hold8']);
    // after: the corrupt bytes stay where they were; the republished hold4 arrives and holds
    const after = readHoldText(lines(corrupt, hold8(), hold4()));
    expect(floorOutcomes(after)).toEqual(ALL_HELD);
    expect(after.unreadable).toEqual(before.unreadable);
  });

  it('M3: holds first, then F; the floor holds at t1 and t2', () => {
    const t1 = readHoldText(lines(hold4(), hold8()));
    expect(floorOutcomes(t1)).toEqual(ALL_HELD);
    // t2: F has arrived in its own family, which the floor does not read; the holds are unchanged
    expect(floorOutcomes(readHoldText(lines(hold4(), hold8())))).toEqual(ALL_HELD);
  });

  it('M4: F first, then holds; as before at t1, held at t2', () => {
    expect(floorOutcomes({ status: 'absent' })).toEqual(ALL_AS_BEFORE);
    expect(floorOutcomes(readHoldText(''))).toEqual(ALL_AS_BEFORE);
    expect(floorOutcomes(readHoldText(lines(hold4(), hold8())))).toEqual(ALL_HELD);
  });

  it('M5: F missing for good; the holds hold', () => {
    expect(floorOutcomes(readHoldText(lines(hold4(), hold8())))).toEqual(ALL_HELD);
  });

  it('M6: F unreadable or of a newer version; the holds hold', () => {
    expect(floorOutcomes(readHoldText(lines(hold4(), hold8())))).toEqual(ALL_HELD);
  });

  it('M7: two reasons on π4, one of which an aware device could release; the floor holds all three', () => {
    expect(floorOutcomes(readHoldText(lines(hold4(), hold4b(), hold8())))).toEqual(ALL_HELD);
  });

  it('M8: a resolvable reason plus an unknown one; held', () => {
    const unknown = hold('hold4z', 'cor:20', pi4, 'zz-future');
    expect(floorOutcomes(readHoldText(lines(hold4(), unknown)))).toEqual(ALL_HELD);
    expect(floorOutcomes(readHoldText(lines(unknown)))).toEqual(ALL_HELD);
  });

  it("M8b: a resolvable reason plus [D-473]'s lecturer-correction reason; held", () => {
    const lecturer = hold('hold4l', 'cor:21', pi4, 'lecturer-correction');
    expect(floorOutcomes(readHoldText(lines(hold4(), lecturer)))).toEqual(ALL_HELD);
  });

  it('M9: every reason resolvable by an aware device; the floor still holds all three', () => {
    expect(floorOutcomes(readHoldText(lines(hold4(), hold4c())))).toEqual(ALL_HELD);
  });

  it('M10: a repeated publication is one hold, one id', () => {
    const read = readHoldText(lines(hold4(), hold8(), hold4(), hold4()));
    expect(read.holds.map((record) => record.id)).toEqual(['hold4', 'hold8']);
    expect(floorOutcomes(read)).toEqual(ALL_HELD);
  });

  it('M11: after M9, the floor opens the same vault; held, and reading changes nothing', () => {
    const stored = lines(hold4(), hold4c(), hold8());
    const read = readHoldText(stored);
    const frozen = Object.freeze(read);
    expect(floorOutcomes(frozen)).toEqual(ALL_HELD);
    expect(readHoldText(stored)).toEqual(read);
    // the reader has no write path: the stored text is a string, and nothing hands it back
    expect(stored).toBe(lines(hold4(), hold4c(), hold8()));
  });
});

describe('the floor column of the mixed-version cases (§4.9)', () => {
  it('O2 and O5: a new reason value in the hold store keeps the hold', () => {
    const read = readHoldText(lines(hold('hold4n', 'cor:30', pi4, 'withdrawn-proposition-v3')));
    expect(read.holds[0]?.reasonRecognised).toBe(false);
    expect(floorOutcomes(read)).toEqual(ALL_HELD);
  });

  it('O3: new fields are ignored; the hold is unchanged', () => {
    const withNewFields = JSON.stringify({
      ...JSON.parse(hold4()),
      version: 4,
      sequence: 118,
      integrity: 'sha256-unknown',
      passage: { ...pi4, quote: 'Skell causes', window: [0, 9], textLayer: 'pdfx-2' },
    });
    expect(floorOutcomes(readHoldText(lines(withNewFields)))).toEqual(ALL_HELD);
  });

  it('a hold on π8 alone holds nothing here, because nothing cites π8', () => {
    expect(floorOutcomes(readHoldText(lines(hold8())))).toEqual(ALL_AS_BEFORE);
  });
});
