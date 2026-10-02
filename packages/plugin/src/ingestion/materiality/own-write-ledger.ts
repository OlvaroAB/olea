/**
 * `ol-egov.141.89.5.41`: Olea's first-sight stamp (`instrument-stamping/port.ts`, permitted by
 * `[D-030]`/`[D-177]`, F2.15b) writes an identity marker into her authored note. That write comes
 * back as a vault modify event, which the materiality gate read as a change of hers and answered
 * with a new generation sweep. This ledger holds the exact text Olea wrote, by path, until that
 * event is seen; the watch then recognises an Olea-only edit and skips the gate and the sweep.
 *
 * Matching is on the whole written text, never on "looks like only a stamp": if she edits the
 * note at the same moment, the text differs and her edit is judged as usual. Entries are
 * consumed by the first event for the path, match or not, so a stale entry never hides a later
 * edit. In memory, session-scoped, never persisted.
 */
export interface OwnWriteLedger {
  /** Records the exact text Olea just wrote to `path`. */
  note(path: string, writtenText: string): void;
  /** True when `currentText` is exactly what Olea last wrote to `path` (the entry is consumed either way). */
  consumeIfOleaOnly(path: string, currentText: string): boolean;
}

export function createOwnWriteLedger(): OwnWriteLedger {
  const written = new Map<string, string>();
  return {
    note: (path, writtenText) => {
      written.set(path, writtenText);
    },
    consumeIfOleaOnly: (path, currentText) => {
      const expected = written.get(path);
      if (expected === undefined) return false;
      written.delete(path);
      return expected === currentText;
    },
  };
}
