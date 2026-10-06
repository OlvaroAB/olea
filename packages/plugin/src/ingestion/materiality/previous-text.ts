/**
 * `PreviousTextTracker` — the in-memory "what did this path look like last
 * time I saw it" cache `wiring.ts`'s own module doc names as needed by
 * `main.ts`'s `onload` to feed `MaterialityTrigger.evaluate`'s optional
 * `previousText` argument, and explicitly declined to decide itself: "with
 * `previousText` sourced from wherever the caller already holds a pre-edit
 * copy... this bead does not decide that, since it owns no file able to read
 * the keyword index's cache."
 *
 * **Why its own tiny cache, rather than reading the keyword index's stored
 * chunk text** (the source `wiring.ts` names as "most likely"). Coupling row
 * 1.4's trigger to the keyword index's internal cache format would make a
 * later, unrelated change to that format silently break materiality's
 * previous-text signal — two features sharing one cache for reasons neither
 * one's own contract requires. This cache holds nothing else and answers
 * exactly one question, so it can change independently.
 *
 * **In-memory, primed once per load, never persisted.** The map itself is session state, but
 * it no longer starts empty in effect: after a load, `prime-previous-text.ts`
 * (`primePreviousTextFromVault`, called once from `main.ts`, off the critical path) reads each
 * note that has a materiality record from the vault and records its text here ONLY when that
 * text hashes to the record's stored raw hash (it IS the settled baseline). Without that, a
 * note's first small or debounced save after a load had no previous text, so it got no pending
 * record and a later escalating edit was judged against the intermediate save, not the
 * baseline (`ol-egov.141.89.5.66`). An edit observed before priming reaches a path always wins.
 *
 * **The unprimed case.** A note whose text changed while Obsidian was closed (no match), an
 * unreadable note, and a note with no record at all stay empty here, and the next modify event
 * evaluates as a first sighting (`previousText: undefined`), which `MaterialityTrigger.evaluate`
 * treats safely (`'judge-unavailable'` for anything that would otherwise reach the judge).
 */

export interface PreviousTextTracker {
  /** The text last recorded for `path` in this session, or `undefined` on first sighting. */
  get(path: string): string | undefined;
  /** Records `text` as what `get(path)` returns for the next observation. */
  record(path: string, text: string): void;
}

export function createInMemoryPreviousTextTracker(): PreviousTextTracker {
  const seen = new Map<string, string>();
  return {
    get: (path) => seen.get(path),
    record: (path, text) => {
      seen.set(path, text);
    },
  };
}
