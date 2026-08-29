/**
 * Calendar-events note discovery — the evidence-based half of RHY-3's
 * extraction design (`ol-4chx`, step 1 of the build chain `ol-4chx` ->
 * `ol-r6s0` -> `ol-hna1` -> `ol-at1a`). Locates candidate calendar notes
 * ANYWHERE in the vault by scanning for the bounded event grammar
 * `./event-line.ts` recognises, never by a hardcoded folder or filename —
 * `[D-068]`'s "never require a particular way of keeping notes," the same
 * discipline `../assessment/read.ts` already applies to the folder its
 * `.base` file names. Where nothing matches anywhere, the caller sees an
 * empty report and degrades globally to "no calendar signal" (RHY-3 §6, row
 * 1) — this module never blocks and never asks her to move a note.
 *
 * **Recompute-on-read, no caching, no persistence** (RHY-3 §8 Class C stop
 * 1): every call re-reads and re-scans the vault. A future bead wanting to
 * cache this for performance would be adding a new persisted schema — that
 * needs its own decision bead, not a quiet addition here.
 *
 * **Scope, exactly RHY-3 §10 build-bead 1's boundary**: raw
 * `(label, weekday?, timeRange?, date)` records per matched line, plus an
 * honest per-note count of task-list lines that looked like an attempt at
 * this grammar but did not fit. No course association (`ol-r6s0`), no
 * recurrence/extrapolation or freshness measure (`ol-hna1`), and no wiring
 * into any displayed surface (`ol-at1a`) — all three are later beads in the
 * same design's build chain, not this file's job.
 *
 * INV-3 note: the real vault's calendar-events note is never named here, in
 * this bead's evidence, or in any report — cited only as "the
 * calendar-events note under the snapshot's Calendar directory," per RHY-3
 * §0's own citation rule.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { isTaskListLine, parseScheduleEventLine } from './event-line.js';
import type { ScheduleDiscoveryReport, ScheduleEventRecord, ScheduleNoteScan } from './types.js';

// Re-exported so the package barrel (`../index.ts`) can name the report
// shapes from this one module, per this bead's `owns` scope limiting the
// barrel to a single export statement.
export type {
  ScheduleDiscoveryReport,
  ScheduleEventRecord,
  ScheduleNoteScan,
  ScheduleTimeRange,
} from './types.js';

/**
 * Scans one note's already-read text for the event grammar. Exported
 * separately from `discoverScheduleEvents` so a caller (or a test) can
 * exercise the per-note scan without a `VaultSource` at all.
 */
export function scanNoteForScheduleEvents(content: string, path: VaultPath): ScheduleNoteScan {
  const lines = content.split(/\r\n|\n/);
  const events: ScheduleEventRecord[] = [];
  let unparseableLineCount = 0;

  lines.forEach((line, index) => {
    // Only a task-list line is even an attempt at this grammar (RHY-3 §9) —
    // an ordinary paragraph, heading or blank line was never a candidate in
    // the first place, so it is not counted as "unparseable" either.
    if (!isTaskListLine(line)) return;

    const parsed = parseScheduleEventLine(line);
    if (parsed === undefined) {
      unparseableLineCount += 1;
      return;
    }
    events.push({
      sourcePath: path,
      lineNumber: index + 1,
      label: parsed.label,
      weekday: parsed.weekday,
      timeRange: parsed.timeRange,
      date: parsed.date,
    });
  });

  return { path, events, unparseableLineCount };
}

/**
 * Evidence-based discovery over the whole vault (RHY-3 §9's discovery rule).
 * Reads every markdown note — there is no folder or filename to narrow the
 * scan to, by design (`[D-068]`) — so cost scales with vault size; that is a
 * known property of "never require a particular structure," not an
 * oversight left for a later bead to fix.
 */
export async function discoverScheduleEvents(vault: VaultSource): Promise<ScheduleDiscoveryReport> {
  const notesScanned = await vault.list({ extensions: ['md'] });

  const scans: ScheduleNoteScan[] = [];
  for (const path of notesScanned) {
    const content = await vault.read(path);
    scans.push(scanNoteForScheduleEvents(content, path));
  }

  const candidateNotes = scans.filter((scan) => scan.events.length > 0);
  const totalUnparseableLines = scans.reduce((sum, scan) => sum + scan.unparseableLineCount, 0);

  return {
    notesScanned,
    candidateNotes,
    events: candidateNotes.flatMap((scan) => scan.events),
    totalUnparseableLines,
  };
}
