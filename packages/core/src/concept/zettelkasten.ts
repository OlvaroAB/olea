/**
 * Shared Zettelkasten helpers (P1-T05, P5-T02).
 *
 * Split out of `./extract.js` so `./extract.js` (tier-1/2/3 identity) and
 * `./evidence.js` (tier-3 evidence gathering) can both depend on this
 * without depending on each other — `extract.js` calls into `evidence.js`
 * for its tier-3 pass, so the reverse dependency would be circular.
 */

import type { VaultPath } from '../vault/types.js';

/** Default folder searched for tier-1 concept-note binding (`./extract.js`) and tier-3 vocabulary (`./evidence.js`). */
export const DEFAULT_ZETTELKASTEN_FOLDER = '05 Zettelkasten';

/** Vault-relative path's filename with a trailing `.md` removed, verbatim otherwise. */
export function noteTitle(path: VaultPath): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
}
