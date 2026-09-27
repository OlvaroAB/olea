/**
 * Barrel for Olea's block-metadata fields: `[D-133]`'s `predecessor`
 * (`ol-w00s`, see `predecessor.ts`) and `[D-407]`'s `paper-origin`
 * (`ol-0r92.118`, see `paper-origin.ts`).
 */

export type { PaperOrigin, StampPaperOriginFieldResult } from './paper-origin.js';
export {
  PAPER_ORIGIN_FIELD_NAME,
  readPaperOriginField,
  stampPaperOriginField,
} from './paper-origin.js';
export type { StampPredecessorFieldResult } from './predecessor.js';
export {
  PREDECESSOR_FIELD_NAME,
  readPredecessorField,
  stampPredecessorField,
} from './predecessor.js';
