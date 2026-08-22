/**
 * Real, Obsidian-backed implementations of `ports.ts`'s interfaces (INV-1:
 * this file and `view.ts` are the only places under `review/` allowed to
 * import `obsidian`). Kept separate from `view.ts` so each port's own
 * reasoning is easy to find without wading through DOM-building code.
 *
 * **Three ports are not here, deliberately, and it is the same rule three
 * times.** A port belongs in this file when its implementation genuinely
 * requires the Obsidian API — opening a split leaf — not merely because it
 * is a port. `createVaultNoteExistsPort` moved to `ports.ts` under `ol-t5lj`:
 * it needs a `VaultSource` and nothing else, and taking an `App` cost the
 * review wiring a dependency it did not have.
 *
 * `createVaultReviewLogPort` followed it, when the review view was wired to
 * the product (run 9, Lane 3), for exactly the same reason and with a sharper
 * consequence. It wraps `olea-core`'s `appendReviewLogRecord` over a
 * `VaultSource`; the only Obsidian in it was its neighbours. Living here made
 * **the D7.1 write path untestable** — a module importing `obsidian` cannot
 * be loaded under Vitest at all — so the single most consequential behaviour
 * in the review loop, the one INV-4 exists to protect, had no test that could
 * even import it. It has one now (`test/review/open-session.spec.ts`, which
 * rates a real item and reads the resulting log file back).
 *
 * `createVaultSuspendPort` followed the same path for the same reason
 * (`ol-xvmx`): this file used to hold a `createObsidianSuspendPort` whose only
 * Obsidian dependency was a `Notice` telling her the durable half wasn't
 * built. Once `SuspendPort` could carry enough to write a conforming record,
 * the honest placeholder was no longer honest, and the real writer needs a
 * `VaultSource` and a device id, exactly like its sibling above.
 *
 * What is left below genuinely needs the host: a split leaf.
 */

import type { App } from 'obsidian';
import type { EditPort } from './ports.js';

/**
 * Opens the instrument's source note in a split leaf, so the review tab
 * stays open beside it and the session's place is never lost (F2.6) —
 * closing the edit split leaves review exactly where she left it, since
 * `ReviewSession` never advances on its own. Jumps straight to the anchoring
 * block when one is recorded (C1.4), via Obsidian's own block-link syntax
 * rather than any bespoke navigation.
 */
export function createObsidianEditPort(app: App): EditPort {
  return {
    async edit(instrument) {
      const linktext = instrument.blockId
        ? `${instrument.sourcePath}#^${instrument.blockId}`
        : instrument.sourcePath;
      await app.workspace.openLinkText(linktext, instrument.sourcePath, 'split');
    },
  };
}
