/**
 * `ol-egov.141.89.7.82` ([D-518]): the re-extracted text of each cited non-markdown file, by the
 * bytes it was read from, that `CitationRevisionTrigger`'s rewrite drafts a held question's
 * successor from. Memory only, like the rest of that trigger's rewrite state: a restart forgets it,
 * the hold stands, and the file's next extraction lands again.
 *
 * **Pages of one version are merged, never replaced.** A file's text reaches the rewrite in more
 * than one delivery: the extraction runner's text-layer delivery covers every text-layer page of
 * the bytes it read, in one call (core `ingestion/extraction-runner.ts`), and, once the vision page
 * runner delivers its revision digest (`deliverRevisionDigest`, `ingestion/vision-page-runner.ts`,
 * off by default), each page read from its image arrives alone. Each delivery is kept apart under
 * the set of pages it covered: a later delivery of the same bytes covering the same pages replaces
 * that one (a repeat, or a note embedding the file), and one covering other pages is added beside
 * it. A page's text is every delivery that covered it, the delivery covering more pages first
 * (the text layer before an image reading of the same page), so a page read both ways keeps both.
 *
 * **Other bytes start afresh.** A delivery of different bytes becomes the file's current version
 * with only its own pages, exactly as every delivery did before this module (the rewrite reads the
 * current version only, and only for a hold raised for those very bytes). The version it displaces
 * is set aside, at most {@link SET_ASIDE_VERSIONS} per file, and comes back with its pages when a
 * later delivery of its bytes lands, so a late delivery of older bytes (a reading that drained
 * before the file changed) never loses the newer version's pages: the newer version's next
 * delivery brings them back. Text of one version is never mixed with another's.
 *
 * **Today's composition reads exactly as before.** With the vision digest off, only the text-layer
 * delivery carries a digest, and it always covers the same pages for the same bytes, so the
 * current version's text is always the latest delivery's, whole: the rule this replaced
 * (`citation-revision-digest-off-unchanged.ol-egov.141.89.7.82.spec.ts` pins it).
 */

/** One delivery's text for one file: each page it covered, with its units' texts joined. */
export type DeliveredPages = ReadonlyMap<number, string>;

/**
 * How many displaced versions of one file are kept for their bytes' next delivery. Declared, not
 * fitted: one is enough for a single late delivery of older bytes; two leaves room for a second
 * change landing while the first is still being read, and bounds the memory to three versions'
 * text per cited file.
 */
export const SET_ASIDE_VERSIONS = 2;

/** The landed text of one version of one file, as the rewrite reads it. */
export interface LandedVersion {
  /** The content hash of the bytes this text was extracted from. */
  readonly hash: string;
  /** The page's text: every delivery that covered it, joined, the one covering more pages first; `''` when none did. */
  pageText(page: number): string;
  /** Every landed page's text, in page order, joined. */
  wholeText(): string;
}

interface VersionText {
  readonly hash: string;
  /** Each delivery's pages, keyed by the sorted page numbers it covered. */
  readonly deliveries: Map<string, DeliveredPages>;
}

interface FileText {
  readonly current: VersionText;
  /** Displaced versions, the most recently displaced first. */
  readonly setAside: readonly VersionText[];
}

const SEPARATOR = '\n\n';

function coverageKey(pages: DeliveredPages): string {
  return [...pages.keys()].sort((a, b) => a - b).join(',');
}

/** Deliveries covering more pages first; equal coverage by key, so the order never depends on landing. */
function orderedDeliveries(version: VersionText): DeliveredPages[] {
  return [...version.deliveries.entries()]
    .sort(([keyA, a], [keyB, b]) => b.size - a.size || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([, pages]) => pages);
}

function readable(version: VersionText): LandedVersion {
  const pageText = (page: number): string =>
    orderedDeliveries(version)
      .flatMap((pages) => {
        const text = pages.get(page);
        return text === undefined ? [] : [text];
      })
      .join(SEPARATOR);
  return {
    hash: version.hash,
    pageText,
    wholeText: () => {
      const landedPages = new Set<number>();
      for (const pages of version.deliveries.values()) {
        for (const page of pages.keys()) landedPages.add(page);
      }
      return [...landedPages]
        .sort((a, b) => a - b)
        .map(pageText)
        .join(SEPARATOR);
    },
  };
}

export class LandedSourceText {
  private readonly byPath = new Map<string, FileText>();

  /** How many files have landed text. */
  get size(): number {
    return this.byPath.size;
  }

  /** The file's current version, or `undefined` when none of its text has landed. */
  current(path: string): LandedVersion | undefined {
    const file = this.byPath.get(path);
    return file === undefined ? undefined : readable(file.current);
  }

  /** Records one delivery of `path`'s pages, extracted from the bytes hashing to `hash`. Synchronous, so concurrent landings never interleave inside it. */
  record(path: string, hash: string, pages: DeliveredPages): void {
    const key = coverageKey(pages);
    const file = this.byPath.get(path);
    if (file !== undefined && file.current.hash === hash) {
      file.current.deliveries.set(key, pages);
      return;
    }
    const restored = file?.setAside.find((version) => version.hash === hash);
    const version: VersionText = restored ?? { hash, deliveries: new Map() };
    version.deliveries.set(key, pages);
    const displaced =
      file === undefined
        ? []
        : [file.current, ...file.setAside.filter((candidate) => candidate !== restored)];
    this.byPath.set(path, {
      current: version,
      setAside: displaced.slice(0, SET_ASIDE_VERSIONS),
    });
  }
}
