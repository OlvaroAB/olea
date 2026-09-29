/**
 * What an extraction pass found in one source, as the unit manifest's starting states (`[D-445]`,
 * `ol-egov.141.89.8.43`). Pure: it reads an `ExtractionResult` the caller already holds and decides
 * nothing about storage.
 *
 * **The rule, page by page.** The text layer answers only for a page it actually served:
 *
 *  - `route: 'text-layer'` and not furniture: read by `text-layer`, which carries no producer
 *    provenance because no model produced it (`./types.ts`, `UnitReadingState`).
 *  - `route: 'text-layer'` and furniture (a running head and a page number, nothing else): a page
 *    read that held no text worth reading, `unreadable: 'no-text-on-page'`. The census counts it as a
 *    finished read that found nothing (`./manifest.ts#isFullyRead`), which is what the extractor's own
 *    `'furniture-only'` verdict says of a document made of such pages.
 *  - `route: 'vision'`: no state at all, so the page reads `pending` (queued) until the vision pass
 *    lands its reading. The text layer found nothing usable there; saying "read" would be the false
 *    completeness this store exists to prevent.
 *  - `route: 'both'`: no state either. Its text was kept, and it still owes a figure to the image
 *    reading (`../../extract/types.ts`, `RouteDecision`), so the page is not read until that lands.
 *
 * **A source that yielded no pages.** `'empty-document'` is a finished read of a document with
 * nothing in it: an enumeration with no pages, a manifest with no units, which the consumers already
 * treat as "nothing to classify". Every other zero-page outcome (`'no-pages-found'`, `'unreadable'`,
 * `'reached-but-unreadable'`) means the pass could not enumerate the source at all, so there is
 * nothing true to record and this returns `null`: the source stays unknown here, and the census's own
 * verdict on it (`../../source/unreadable.ts`) is not overridden by a manifest that never existed.
 */

import type { ExtractionResult, PageExtraction } from '../../extract/types.js';
import type { UnitReadingState } from './types.js';

/** One page's starting reading state, for the pages whose state is not simply pending. */
export interface EnumeratedUnitState {
  readonly page: number;
  readonly readingState: UnitReadingState;
}

export interface SourceEnumeration {
  /** Every page the source holds, ascending. */
  readonly pages: readonly number[];
  /** The pages the text layer settled, ascending. A page in `pages` and not here starts pending. */
  readonly settled: readonly EnumeratedUnitState[];
}

function startingState(page: PageExtraction): UnitReadingState | null {
  if (page.route !== 'text-layer') return null;
  if (page.furniture) return { kind: 'unreadable', reason: 'no-text-on-page' };
  return { kind: 'read', method: 'text-layer' };
}

/** The enumeration of one extraction result, or `null` when the pass could not enumerate the source (module doc). */
export function enumerationOfExtraction(result: ExtractionResult): SourceEnumeration | null {
  if (result.pages.length === 0) {
    return result.outcome === 'empty-document' ? { pages: [], settled: [] } : null;
  }
  // A page number that is not a positive integer cannot be a unit's identity (`stableUnitId`), and
  // dropping such a page would leave it absent from the manifest: the pass could not enumerate.
  if (result.pages.some((page) => !Number.isInteger(page.page) || page.page < 1)) return null;
  const ordered = [...result.pages].sort((a, b) => a.page - b.page);
  const pages: number[] = [];
  const settled: EnumeratedUnitState[] = [];
  for (const page of ordered) {
    // A page number the extractor repeated is one page, not two units.
    if (pages[pages.length - 1] === page.page) continue;
    pages.push(page.page);
    const readingState = startingState(page);
    if (readingState !== null) settled.push({ page: page.page, readingState });
  }
  return { pages, settled };
}
