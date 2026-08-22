# olea-synthetic

**Dev tooling.** A seeded, deterministic generator of contracts-valid D7.1 review-log streams
from behavioural personas with known ground truth. `[SYN-1] / ol-6vyi`.

Not a product surface, and never evidence about anyone.

## The rule this package exists under (N-015)

N-015 is recorded in `../olea-service/docs/Olea_product_notebook.md` — the private repo, not
this one — and it draws the line this package lives on. A synthetic corpus is licensed to
exercise machinery and to test detectors against personas whose ground truth we planted. It is
never a substitute for evidence about the alpha user, and **no threshold may be calibrated
against a distribution this package produced.**

A persona built to contain a cramming pattern is a fair test of a cramming detector — the
dependent variable is *our code*. It is not evidence about how she studies. Any value derived
from data this package produces is marked `synthetic-provisional` and revisited on real data.

There is exactly one such value in here, and it is marked in place:
`MASTERY_STABILITY_BANDS` in `src/generate.ts` (C5.4's mastery rollup does not exist yet, so
the generator needs *some* rule to stamp `masteryAtTime`). Under review-log v4 (`ol-g6zg`) it
is stamped **per concept** — a synthetic instrument names exactly one, so the map always has a
single entry — and the marking travels with it.

## Usage

```ts
import { generateStream, streamSpec, toJsonl, writeSyntheticStream } from 'olea-synthetic';

const stream = generateStream(streamSpec('crammer', 'my-seed'));
stream.entries;      // readonly ReviewLogEntry[] — contracts-valid, chronological
stream.groundTruth;  // what was planted, in the vocabulary the tests measure in
toJsonl(stream.entries);            // the exact bytes core's writer would produce
await writeSyntheticStream(vault, stream);   // into .olea-synthetic/reviews/, never .olea/
```

## The personas

| persona | planted pattern | carried by |
| --- | --- | --- |
| `steady-reviewer` | the control — every day, everything offered, no bursts, no gaps | *(nothing)* |
| `crammer` | reviews cluster into the five days before each assessment, on few very dense days, with many items pulled early | `cramWindowDays`, `cramEarlyPull`, `cramDailyCap` |
| `instrument-skipper` | leaves cards, takes MCQs — the spec amendment's **second early-warning signal** | `cardTakeRateWhenMcqAvailable` |
| `lapsed-returner` | ten consecutive days with no events, ordinary study either side | `blackout` |
| `struggler` | one course she is losing: high `again` rate, recurring failure, explain-back routing (F2.12), suspend/unsuspend (F2.6) | `successByCourse`, `explainBackAfterConsecutiveAgain`, `suspendAfterLapses` |
| `empty-history` | edge: a valid stream with zero events | — |
| `single-session` | edge: one day of first exposures | — |
| *two-device same-day* | edge: two files, one day, a shared subset that a correct merge must collapse | `twoDeviceSameDayStreams()` |

## The four properties this package is accountable for

**1. Determinism.** Same seed, byte-identical stream (`test/determinism.spec.ts`). No
`Math.random`, no `Date.now`, no `randomUUID`, no ambient timezone — asserted by a source scan,
not by discipline, because a stray clock call would make byte-identity fail *intermittently*
rather than visibly.

**2. Contract validity.** Every entry validates against `olea-contracts`' frozen v2 union and
round-trips through `olea-core`'s own `parseReviewLog` with zero invalid lines
(`test/contract.spec.ts`). `planVersion` and `yieldRank` are explicit nulls everywhere (pre-P5,
Phase A).

**3. FSRS coherence.** Intervals come from `createFsrsScheduler()` — the product's scheduler,
driven for real. **`dueState` is derived, never assigned.** `test/fsrs-coherence.spec.ts`
replays each stream through a *fresh* scheduler from the emitted bytes alone and requires every
`dueState` to match. A stream whose intervals contradict the scheduler is not a harder test, it
is a different and useless one.

**4. Provenance and the refusal.** Every `eventId` begins `syn:evt:` — a stamp in a field the
frozen contract already has, chosen because it survives JSON round-trips, schema validation, the
v1→v2 upgrade, and merges (`src/provenance.ts` explains why an off-schema key would not).
`writeSyntheticStream` refuses any destination inside `.olea/`, and `test/guard.spec.ts` proves
it by aiming the writer at `olea-core`'s own `reviewLogPath` and requiring a throw with nothing
written. The event log in her vault is the truth (plan §7.1).

## Falsifiability is structural, not promised

`test/personas.spec.ts` runs every discriminating claim twice: once against the persona, where
it must hold, and once against the same seed with `planted.neutralise` applied — the pattern
removed from the generator, nothing else changed — where it must **fail**. A claim that passes
both is not asserting the pattern, and the suite says so by name.

Each persona therefore carries the exact override that removes its own pattern
(`PERSONAS[id].planted.neutralise`), so "remove the pattern and watch it go red" is a thing
anyone can do in one line rather than a claim in a report.

## For SYN-2 (`ol-c9yf`)

`src/pairs.ts` has the two pair constructors, and nothing else — no analysis, no detector.

- `plantedPair(spec, effect)` — two streams from **one seed** differing by exactly one behaviour
  knob.
- `nullPair(spec, seedA, seedB)` — two streams from **one spec** under two seeds, with no effect
  planted between them.
- `specDelta` / `behaviourDelta` — so the "differs by exactly one thing" promise is checkable
  rather than assumed.

`src/analysis.ts` is the analysis those pairs exist to dry-run: `abInstrumentShareEffect`, a
two-proportion z-test over `instrumentShareWhenBothOffered` (`src/measures.ts`), applied to two
streams. `test/ab-analysis.spec.ts` runs it against both pairs above (planted effect detected,
null pair silent) and records a hand-run mutation — loosening the module's one threshold
(`Z_CRITICAL_ALPHA_05`) until the null-pair test goes red, then reverting — as the demonstration
that the null result means something rather than just being quiet. `Z_CRITICAL_ALPHA_05` is
marked `synthetic-provisional` (N-015): it's the ordinary alpha=0.05 convention, not fit to
anything this package generates, but the test's independence assumption is unchecked against real
review-log behaviour.

## INV-3

Every course and concept token here is a **coined nonsense word**, checked whole-token against
the read-only real-vault snapshot with zero hits required, in content and in filenames. Nothing
reads a fixture-vault string either: the fixture vocabulary was renamed twice in one day
(`ol-yj9`), and a package coupled to it would break on the next rename.
