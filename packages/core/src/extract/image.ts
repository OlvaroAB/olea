/**
 * The image extractor (C3.1, C3.3, P3-T04).
 *
 * **This is a real implementation, not a stub of a missing one.** An image
 * has no text layer by construction — there is nothing to attempt to
 * extract, and no library, minimal or otherwise, would change that. C3.3
 * routes images down the vision/OCR path — photographed handwriting and
 * snapped slides included — which makes them Slot V's (W2) job, and W2 runs
 * server-side, reached through ingestion rather than called directly by the
 * client (see the task-id catalogue note in `types.ts`). So the only
 * correct thing for this extractor to do is report the true, honest yield —
 * zero characters — and let `routePage` do exactly what it does for any
 * other zero-yield page: send it to vision. Faking a non-zero yield, or
 * skipping the routing computation as "obviously vision," would both be
 * worse than what's here: they'd special-case image handling instead of
 * letting it fall out of the same char-yield rule every other format uses,
 * which is the whole point of one interface across formats.
 */

import { routePage } from './threshold.js';
import type { ExtractionResult, ExtractOptions, Extractor, ExtractorInput } from './types.js';

export const imageExtractor: Extractor = {
  format: 'image',

  async extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult> {
    const route = routePage(0, options?.textLayerCharThreshold);
    return {
      sourcePath: input.path,
      format: 'image',
      // Always `'extracted'`: a single image is a single page by
      // construction, and a page record really was produced. `outcome`
      // reports whether pages were *reached*, not whether they yielded text
      // — the zero yield is already stated, honestly, by `charCount` and
      // `route` (see `ExtractionOutcome`).
      outcome: 'extracted',
      // `'absent'`, never `'unreadable'`: an image genuinely has no text layer
      // to fail to read, which is exactly the distinction `PageTextLayer`
      // exists to draw (ol-x1ch). Vision is the right answer here, not a
      // reported defect.
      pages: [{ page: 1, charCount: 0, textLayer: 'absent', route, units: [] }],
    };
  },
};
