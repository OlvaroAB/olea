/**
 * A **persona's history**, loaded behind the workbench's history-bearing
 * surfaces (SYN-1 / `ol-6vyi`, whose first named consumer is this workbench:
 * *"loads a persona so Today, sprig states, and history-bearing surfaces render
 * against plausible depth"*).
 *
 * Without one, every surface in the workbench that is supposed to show the
 * *consequences of past study* renders against nothing: `priorState` is a
 * hand-made "reviewed once, rated good" stub, `selectionContext` is all nulls,
 * and the empty screen's next-due label is a hardcoded word. With one, the FSRS
 * intervals on the reveal screen, the due state and exam proximity stamped onto
 * every review-log write, and the next-due label are all consequences of a
 * ninety-day stream the product's own scheduler produced.
 *
 * ## Three rules this module is built around
 *
 * **1. A synthetic stream never reaches a real vault log path.** The generator
 * refuses any destination under `.olea/` and throws
 * (`olea-synthetic`'s `guard.ts`). Nothing here routes around that: the persona
 * stream is written through `writeSyntheticStream`, which lands it under
 * `.olea-synthetic/reviews/`, while the workbench's *own* session writes go
 * through core's real `appendReviewLogRecord` to `.olea/reviews/`. The two
 * namespaces are disjoint by construction, and `checkVaultBoundary` below
 * re-checks that at runtime rather than trusting it — the in-memory vault makes
 * the check free, so there is no reason to assert it instead of proving it.
 *
 * **2. Nothing here is evidence, and no threshold is tuned on it** (CLAUDE.md's
 * synthetic rule, N-015). Every number below is either a *generator input* (a
 * description of the fiction being fabricated) or arithmetic on the stream the
 * generator declared. The one value that is neither is `masteryAtTime`, and it
 * is not computed here at all — it is echoed verbatim from the persona's own
 * last record for that instrument, so its provenance stays SYN-1's
 * `MASTERY_STABILITY_BANDS`, which that package already marks
 * `synthetic-provisional`. That marking is inherited, not laundered: see
 * `PERSONA_PROVISIONAL_NOTE`. Since `ol-g6zg` the value is a per-concept map
 * on the record rather than one number inside `selectionContext`; the
 * provenance argument is unchanged by the move.
 *
 * **3. No fixture-vault string appears here, and none may be added.** The join
 * between a persona's deck and the vault's real instruments is *positional*
 * (see `entriesFor`), not by name, because the two vocabularies are
 * deliberately disjoint — `olea-synthetic` invents its own coined tokens, and a
 * rename lane is changing the fixture's (`ol-yj9`).
 *
 * ## What the join actually claims, and what it does not
 *
 * The persona supplies **depth**; the fixture vault supplies **content**. There
 * is no sense in which persona instrument *k* "is" fixture instrument *k* — the
 * join says only "give the item in this slot a plausible study history of this
 * shape". That is exactly the claim the workbench needs (a crammer's items look
 * crammed; a lapsed returner's are all overdue) and no more.
 *
 * ## What changed when the composer landed (`ol-mtpn`, done)
 *
 * `queueItemFor` is **gone**. It used to hand `../queue/derive.ts` a
 * `priorState` and a whole `selectionContext` per slot, which made this module
 * the place two D7.1 fields were decided — in a harness. The composer decides
 * both now, from the log, exactly as the README's swap plan said it would.
 *
 * What this module keeps is its other job, and one small new piece of it:
 * *putting the persona's history where the composer will read it*. Two forms,
 * because the composer reads one and the boundary check reads the other:
 *
 *   - `writePersonaHistory` still writes the stream into
 *     `.olea-synthetic/reviews/` through SYN-1's guarded writer, so the
 *     namespace boundary stays observable in the vault.
 *   - `entriesFor` hands the composer the same stream **in memory**, relabelled
 *     onto the vault's real instrument ids. That answers the open question the
 *     README's step 4 left: the workbench feeds the composer parsed records,
 *     rather than pointing the composer at the synthetic namespace — and
 *     emphatically not by pointing the *generator* at `.olea/reviews/`, which
 *     is what the guard exists to refuse.
 *
 * The relabel is the same positional join the old `slotFor` was, moved from the
 * queue item to the log entry. That is a real improvement and not just a move:
 * the depth a surface shows is now a consequence of replaying a history, not of
 * a slot number being copied into a field.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { SchedulerState, VaultPath, VaultSource } from 'olea-core';
import { createFsrsScheduler, parseReviewLog, REVIEW_LOG_FOLDER } from 'olea-core';
import { daysBetween, utcDate, WORKBENCH_NOW } from '../clock.js';
import type { PersonaId, SyntheticStream } from '../synthetic-bridge.js';
import {
  generateStream,
  INSTRUMENTS,
  isSyntheticRecord,
  SYNTHETIC_LOG_FOLDER,
  streamSpec,
  writeSyntheticStream,
} from '../synthetic-bridge.js';

/** `'none'` is the WB-1 behaviour: no history at all. Every other id is a SYN-1 persona. */
export type WorkbenchPersonaId = 'none' | PersonaId;

export interface PersonaOption {
  readonly id: WorkbenchPersonaId;
  readonly label: string;
  /** What loading this persona changes on screen. Rendered in the inspector. */
  readonly note: string;
}

/**
 * Where the persona's ninety days sit relative to `WORKBENCH_NOW`.
 *
 * The stream ends the day *before* today so that "today's queue" is genuinely
 * the day after the history, and the second assessment falls three days *after*
 * today so `examProximity` on today's records is a real countdown rather than a
 * null. Both are framing choices about the fiction — where the window is put —
 * not thresholds: nothing detects anything against them.
 *
 * The offset is `+00:00` deliberately. SYN-1 supports any offset, and the
 * workbench does not need one: running the persona at UTC makes local days and
 * UTC days the same days, which removes a whole class of off-by-one between the
 * stream's calendar and `WORKBENCH_NOW`'s.
 */
const HISTORY_START_DATE = '2026-10-17';
const HISTORY_DAYS = 90;
const HISTORY_UTC_OFFSET = '+00:00';
const HISTORY_ASSESSMENT_DAY_OFFSETS: readonly number[] = [42, 93];
/** One seed, fixed, so a screenshot taken twice is the same screenshot. */
const HISTORY_SEED = 'workbench';

/** Inherited from SYN-1, not created here. Shown in the inspector wherever a mastery value is. */
export const PERSONA_PROVISIONAL_NOTE =
  'synthetic-provisional: every number behind this surface is replayed from a fabricated ' +
  'olea-synthetic stream, whose mastery bands are MASTERY_STABILITY_BANDS — a placeholder ' +
  'until C5.4’s rollup exists. The composer records no masteryAtTime at all, so no mastery ' +
  'value reaches a review-log write from here. Nothing may be calibrated against any of it ' +
  '(N-015).';

export const PERSONA_OPTIONS: readonly PersonaOption[] = [
  {
    id: 'none',
    label: 'No history',
    note: 'WB-1’s original behaviour: prior scheduling state is a hand-made stub, every selectionContext field is an explicit null, and no mastery is recorded. The baseline every persona is read against.',
  },
  {
    id: 'steady-reviewer',
    label: 'Steady reviewer',
    note: 'SYN-1’s control. Studies every day, takes everything offered. Intervals on the reveal screen are long and the queue is due rather than overdue.',
  },
  {
    id: 'crammer',
    label: 'Crammer',
    note: 'Bursty, pre-assessment clustering. An assessment falls three days after the workbench’s fixed today, so examProximity on every record written here counts down to it.',
  },
  {
    id: 'instrument-skipper',
    label: 'Instrument skipper',
    note: 'Leaves cards, takes MCQs. Her skipped cards accumulate as overdue, so the Q&A and cloze states carry a different dueState from the MCQ ones.',
  },
  {
    id: 'lapsed-returner',
    label: 'Lapsed returner',
    note: 'A ten-day blackout inside the history. Everything sat un-reviewed through it, so the reveal screen’s intervals are the intervals of overdue work.',
  },
  {
    id: 'struggler',
    label: 'Struggler',
    note: 'One course she is losing: high lapse counts, short stabilities, and instruments suspended and later unsuspended (D-020). The shortest intervals of any persona.',
  },
  {
    id: 'empty-history',
    label: 'Empty history (edge)',
    note: 'A valid stream with zero events. Every history-bearing surface has to survive it: prior state is null everywhere and the empty screen has no next-due date to name.',
  },
  {
    id: 'single-session',
    label: 'Single session ever (edge)',
    note: 'One day of first exposures, the day before today. Everything is one review old.',
  },
];

export const DEFAULT_PERSONA: WorkbenchPersonaId = 'none';

export function findPersona(id: string): PersonaOption | undefined {
  return PERSONA_OPTIONS.find((option) => option.id === id);
}

/** One instrument of the persona's deck, after her whole history has been replayed. */
interface DeckSlot {
  readonly instrumentId: string;
  /** Real FSRS state at the end of the stream, or `null` if she never met it. */
  readonly state: SchedulerState | null;
}

/**
 * The minimum `entriesFor` needs about one of the vault's instruments: its
 * persisted id, and which ring of the persona's deck it draws from.
 *
 * A structural subset of `olea-core`'s `VaultInstrumentRecord`, declared rather
 * than imported so this module still names nothing about a fixture note.
 */
export interface WorkbenchInstrument {
  readonly instrumentId: string;
  readonly instrumentType: string;
}

export interface PersonaHistory {
  readonly id: WorkbenchPersonaId;
  /** `null` for `'none'`. */
  readonly stream: SyntheticStream | null;
  /**
   * Her history, mapped onto the instruments this vault actually holds.
   *
   * Positional, per instrument type, and it names nothing: persona instrument
   * *k* of a type is not fixture instrument *k*, and the join claims only "give
   * the item in this slot a plausible study history of this shape". Returns an
   * empty list for `'none'`, which is a vault of first exposures.
   */
  entriesFor(instruments: readonly WorkbenchInstrument[]): readonly ReviewLogEntry[];
  /**
   * The persona's stream exactly as generated — `conceptIds` still the
   * synthetic vocabulary's own (`syn:concept:…`), `instrumentId` still the
   * synthetic deck's, nothing relabelled onto the fixture vault at all.
   *
   * Added for the oracle surface (`ol-opmb.1` [TB-1]): `entriesFor` above
   * exists so the review queue can offer a plausible history against fixture
   * instruments it does not name, but `computeAllConceptMastery` keys on
   * concept identity and the oracle chain's evidence (`curriculum.ts`) is
   * built over the same `syn:concept:…` ids the stream already carries — so
   * mastery for the oracle surface reads THIS, never the relabelled join.
   * Empty for `'none'`, the same as `entriesFor` returns for it.
   */
  readonly rawEntries: readonly ReviewLogEntry[];
  /** F2.2's next-due line, derived from her deck rather than written down. `null` when nothing is scheduled. */
  readonly nextDueLabel: string | null;
  /** One line for the inspector: what this history actually contains. */
  readonly summary: string;
}

function nextDueLabelOf(slots: readonly DeckSlot[]): string | null {
  const today = utcDate(WORKBENCH_NOW);
  const days = slots
    .map((slot) => slot.state)
    .filter((state): state is SchedulerState => state !== null)
    .map((state) => daysBetween(today, utcDate(new Date(Date.parse(state.due)))))
    .sort((a, b) => a - b);
  const soonest = days[0];
  if (soonest === undefined) return null;
  if (soonest <= 0) return 'now';
  if (soonest === 1) return 'tomorrow';
  return `in ${soonest} days`;
}

/**
 * Replays the stream through a **fresh** scheduler using only the emitted
 * records, exactly as SYN-1's own coherence test does. Nothing is taken on
 * trust from the generator's internals — the generator does not export its deck
 * state, and a state re-derived from the bytes is the only one that can be
 * checked against them.
 */
function replay(stream: SyntheticStream): readonly DeckSlot[] {
  const scheduler = createFsrsScheduler();
  const states = new Map<string, SchedulerState>();

  for (const entry of stream.entries) {
    if (entry.kind !== 'review') continue;
    // Explain-back is never FSRS-scheduled and carries no rating (F2.16).
    if (entry.instrumentType === 'explain-back' || entry.rating === null) continue;
    const output = scheduler.schedule({
      instrumentId: entry.instrumentId,
      state: states.get(entry.instrumentId) ?? null,
      rating: entry.rating,
      now: new Date(Date.parse(entry.timestamp)),
    });
    states.set(entry.instrumentId, output.state);
  }

  return INSTRUMENTS.map((instrument) => ({
    instrumentId: instrument.instrumentId,
    state: states.get(instrument.instrumentId) ?? null,
  }));
}

function specFor(persona: PersonaId) {
  const base = {
    startDate: HISTORY_START_DATE,
    days: HISTORY_DAYS,
    utcOffset: HISTORY_UTC_OFFSET,
    assessmentDayOffsets: HISTORY_ASSESSMENT_DAY_OFFSETS,
  };
  // The single-session edge case is a persona *plus* a one-day window, per
  // SYN-1's own `singleSessionStream`. Anchored to the last day of the window
  // so it is still "the day before today" rather than three months ago.
  if (persona === 'single-session') {
    return streamSpec(persona, HISTORY_SEED, {
      ...base,
      startDate: '2027-01-14',
      days: 1,
      assessmentDayOffsets: [4],
    });
  }
  return streamSpec(persona, HISTORY_SEED, base);
}

/** The `'none'` history: no events at all, so every instrument is a first exposure. */
export const NO_PERSONA_HISTORY: PersonaHistory = {
  id: 'none',
  stream: null,
  entriesFor: () => [],
  rawEntries: [],
  nextDueLabel: null,
  summary:
    'No persona loaded. Every instrument in the fixture vault is a first exposure, so the ' +
    'composer offers each with dueState “new” and a null prior state.',
};

export function buildPersonaHistory(id: WorkbenchPersonaId): PersonaHistory {
  if (id === 'none') return NO_PERSONA_HISTORY;

  const stream = generateStream(specFor(id));
  const slots = replay(stream);

  /**
   * The positional join, now over her *entries* rather than over a queue item.
   *
   * One ring of persona instrument ids per instrument type, in deck order, so a
   * Q&A card is handed a Q&A instrument's stream and index `k` always lands on
   * the same one. Deterministic, and it names nothing on either side.
   */
  const ringsByType = new Map<string, string[]>();
  for (const instrument of INSTRUMENTS) {
    const ring = ringsByType.get(instrument.instrumentType);
    if (ring) ring.push(instrument.instrumentId);
    else ringsByType.set(instrument.instrumentType, [instrument.instrumentId]);
  }

  /** Persona instrument id -> its whole stream, in the order the generator emitted it. */
  const byPersonaInstrument = new Map<string, ReviewLogEntry[]>();
  for (const entry of stream.entries) {
    const bucket = byPersonaInstrument.get(entry.instrumentId);
    if (bucket) bucket.push(entry);
    else byPersonaInstrument.set(entry.instrumentId, [entry]);
  }

  const reviewCount = stream.entries.filter((e) => e.kind === 'review').length;

  return {
    id,
    stream,
    rawEntries: stream.entries,
    nextDueLabel: nextDueLabelOf(slots),
    summary:
      stream.entries.length === 0
        ? `${id}: a valid stream with zero events over ${String(HISTORY_DAYS)} days — the edge case every history-bearing surface has to survive.`
        : `${id}: ${String(stream.entries.length)} events (${String(reviewCount)} reviews) across ${String(stream.groundTruth.sessionDates.length)} sessions, ending ${String(stream.groundTruth.sessionDates.at(-1))}.`,

    entriesFor(instruments) {
      const seenPerType = new Map<string, number>();
      const relabelled: ReviewLogEntry[] = [];

      for (const instrument of instruments) {
        const index = seenPerType.get(instrument.instrumentType) ?? 0;
        seenPerType.set(instrument.instrumentType, index + 1);

        const ring = ringsByType.get(instrument.instrumentType);
        const personaId = ring?.[index % ring.length];
        if (personaId === undefined) continue;

        for (const entry of byPersonaInstrument.get(personaId) ?? []) {
          relabelled.push({
            ...entry,
            instrumentId: instrument.instrumentId,
            // The ring wraps, so two vault instruments can draw the same
            // persona stream. Their event ids must still differ or the merge
            // reads them as one event and throws on the content mismatch. The
            // `syn:evt:` stamp survives at the front, so `isSyntheticRecord`
            // still recognises every one of them.
            eventId: `${entry.eventId}#${String(index)}`,
          });
        }
      }

      return relabelled;
    },
  };
}

/**
 * Writes the persona's history into the vault, through SYN-1's guarded writer.
 *
 * The guard is not disabled, softened or bypassed. It refuses the entire
 * `.olea/` namespace and this call keeps its default resolver, so the stream
 * can only land under `.olea-synthetic/reviews/`. The workbench writes to an
 * in-memory vault, so this is free — and if it ever stops being free, that is a
 * finding and not a reason to reach for the resolver override.
 */
export async function writePersonaHistory(
  vault: VaultSource,
  history: PersonaHistory,
): Promise<readonly VaultPath[]> {
  if (history.stream === null) return [];
  return writeSyntheticStream(vault, history.stream);
}

export interface VaultBoundaryReport {
  /** Files under `.olea/reviews/` — the product's real log path. */
  readonly realLogFiles: number;
  readonly realLogRecords: number;
  /** Files under `.olea-synthetic/reviews/` — where the persona's history went. */
  readonly syntheticLogFiles: number;
  readonly syntheticLogRecords: number;
  /**
   * Synthetic-stamped records found in the real log path. **Always zero.** A
   * non-zero value is a live INV-4/§7.1 violation, not a cosmetic one.
   */
  readonly syntheticRecordsInRealLog: readonly string[];
}

/**
 * Every record under a log folder, and how many files actually carry one.
 *
 * Files are counted by *content*, not by listing, because switching persona
 * blanks the previous one's day-files rather than deleting them
 * (`MemoryVaultSource` has no delete). A path that still exists but holds
 * nothing is not a day she studied, and a count that says otherwise would make
 * the inspector's boundary line grow every time somebody clicked a persona.
 */
async function entriesUnder(
  vault: VaultSource,
  folder: string,
): Promise<{ readonly entries: readonly ReviewLogEntry[]; readonly files: number }> {
  const paths = await vault.list({ under: folder, extensions: ['jsonl'] });
  const entries: ReviewLogEntry[] = [];
  let files = 0;
  for (const path of paths) {
    const records = parseReviewLog(await vault.read(path)).records;
    if (records.length === 0) continue;
    files += 1;
    entries.push(...records);
  }
  return { entries, files };
}

/**
 * Reads both log namespaces back out of the vault and reports the boundary.
 *
 * This is the runtime half of rule 1 in this module's header. SYN-1's own guard
 * proves the *writer* refuses a real log path; this proves the *outcome* in the
 * vault the workbench actually assembled, after a real session has appended
 * through core's real `appendReviewLogRecord`. `MemoryVaultSource.list()` does
 * not skip dot-directories the way `FolderSource` does, so both namespaces are
 * genuinely enumerable here — which is the only reason this check is possible
 * at all, and worth knowing before anyone tries the same thing on disk.
 */
export async function checkVaultBoundary(vault: VaultSource): Promise<VaultBoundaryReport> {
  const real = await entriesUnder(vault, REVIEW_LOG_FOLDER);
  const synthetic = await entriesUnder(vault, SYNTHETIC_LOG_FOLDER);

  return {
    realLogFiles: real.files,
    realLogRecords: real.entries.length,
    syntheticLogFiles: synthetic.files,
    syntheticLogRecords: synthetic.entries.length,
    syntheticRecordsInRealLog: real.entries.filter(isSyntheticRecord).map((e) => e.eventId),
  };
}
