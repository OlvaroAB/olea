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
 *
 * `[D-171]` adds a second Obsidian hand-off to this same file:
 * `createObsidianOpenSourceLocationPort` opens a concept's or instrument's
 * source location at its known grain (block, then heading, then just the
 * note), and `openRegistryEntryFor` is the one-step affordance target
 * `[D-171]`'s ruling asks the review/explain-why/explain-back surfaces to
 * link to — see each function's own doc.
 */

import type { App, WorkspaceLeaf } from 'obsidian';
import type { RegistryInstrumentSummary, RegistrySourceLocation } from 'olea-core';
import type { EditInstrumentPort, OpenSourceLocationPort } from './provider.js';
import { type RegistryEntryTarget, RegistryView, VIEW_TYPE_OLEA_REGISTRY } from './view.js';

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

/** The linktext an Obsidian `openLinkText` call needs to land on `location` at its most precise known grain — block over heading over the bare note, never guessing past what `location` actually carries (`[D-171]`). */
function sourceLocationLinktext(location: RegistrySourceLocation): string {
  if (location.blockId) return `${location.sourcePath}#^${location.blockId}`;
  if (location.heading) return `${location.sourcePath}#${location.heading}`;
  return location.sourcePath;
}

/**
 * `[D-171]`'s click-through half: open a concept's or instrument's source
 * location at exactly the grain it carries — the same `openLinkText`
 * hand-off `createObsidianEditInstrumentPort` above already uses for
 * instrument editing, so this is a second caller of one mechanism, not a
 * new one.
 */
export function createObsidianOpenSourceLocationPort(app: App): OpenSourceLocationPort {
  return {
    async open(location: RegistrySourceLocation) {
      await app.workspace.openLinkText(
        sourceLocationLinktext(location),
        location.sourcePath,
        'split',
      );
    },
  };
}

/**
 * The one-step affordance target `[D-171]`'s ruling asks every OTHER
 * instrument-rendering surface (review view, explain-why, explain-back) to
 * link to: reveal the registry tab and scroll/highlight straight to one
 * concept's or instrument's row. Mirrors `main.ts`'s own
 * `revealRegistryView` (reveal-or-open the one `VIEW_TYPE_OLEA_REGISTRY`
 * leaf) so there is exactly one registry tab regardless of how many surfaces
 * open it, then hands off to `RegistryView.focusEntry` for the scroll and
 * highlight.
 *
 * Exported from here, not `main.ts` — wiring the CALL SITE into
 * review/explain-why/explain-back is follow-up work on those surfaces' own
 * owned files (this bead does not own them); this function is the target
 * those call sites are meant to import and invoke.
 */
export async function openRegistryEntryFor(app: App, target: RegistryEntryTarget): Promise<void> {
  const workspace = app.workspace;
  const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_REGISTRY);
  const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
  if (leaf === null) return;
  if (existing.length === 0) {
    await leaf.setViewState({ type: VIEW_TYPE_OLEA_REGISTRY, active: true });
  }
  await workspace.revealLeaf(leaf);
  const view = leaf.view;
  if (view instanceof RegistryView) {
    await view.refresh();
    view.focusEntry(target);
  }
}
