/**
 * Barrel for `[D-133]`'s block-metadata home (`ol-w00s`) — see
 * `predecessor.ts`'s module doc for scope and the core dependency this is
 * blocked on before production wiring.
 */

export type { StampPredecessorFieldResult } from './predecessor.js';
export {
  PREDECESSOR_FIELD_NAME,
  readPredecessorField,
  stampPredecessorField,
} from './predecessor.js';
