/**
 * The one registry port that genuinely needs Obsidian (INV-1: this file is
 * the only place under `registry/` allowed to import `obsidian`) — same
 * split `review/obsidian-ports.ts` draws, and for the same reason: an
 * `App`-shaped dependency cannot be loaded under Vitest, so it stays out of
 * every file this bead wants unit-testable.
 *
 * F8.4: "Editing an instrument hands off to Obsidian — instruments are
 * markdown in her vault and Olea does not build a text editor for them."
 * This is that handoff, and nothing more — mirrors
 * `review/obsidian-ports.ts`'s `createObsidianEditPort` exactly (open the
 * note, jump to the block if one is recorded), rather than reusing that
 * function directly: it types its parameter as `ReviewInstrument`
 * (`sourcePath`), a shape this bead does not own and should not couple to,
 * where the registry's own `RegistryInstrumentSummary` carries `notePath`
 * instead. Same one-line behaviour, named locally so this bead's owned
 * files have no import into `review/`.
 */

import type { App } from 'obsidian';
import type { RegistryInstrumentSummary } from 'olea-core';
import type { EditInstrumentPort } from './provider.js';

export function createObsidianEditInstrumentPort(app: App): EditInstrumentPort {
  return {
    async edit(instrument: RegistryInstrumentSummary) {
      const linktext = instrument.blockId
        ? `${instrument.notePath}#^${instrument.blockId}`
        : instrument.notePath;
      await app.workspace.openLinkText(linktext, instrument.notePath, 'split');
    },
  };
}
