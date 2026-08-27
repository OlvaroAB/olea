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
 * **Session-scoped only, by construction — never persisted.** A plugin
 * reload starts with an empty cache, and the next modify event for any path
 * evaluates as a first sighting (`previousText: undefined`), which
 * `MaterialityTrigger.evaluate` already treats safely (`'judge-unavailable'`
 * for anything that would otherwise reach the judge, rather than a guess at
 * what the text used to be). This is the same "current as of this session's
 * own edits" posture `keyword-index/wiring.ts`'s module doc argues for its
 * own, unrelated limitation — deliberate, not an oversight, and cheap to
 * revisit later if a persisted or richer source is wired in.
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
