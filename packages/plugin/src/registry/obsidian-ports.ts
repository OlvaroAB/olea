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
 *
 * F8.4a/`[D-176]` (`ol-r1by`) adds a third hand-off, and a real vault WRITE
 * rather than a read-only navigation: `createObsidianAcceptNoteOfferPort`
 * creates the new Zettelkasten note the offer promised. It is named and
 * placed alongside the other two Obsidian hand-offs for consistency, but —
 * see its own doc — the write itself goes through `VaultSource`, not
 * `app.vault`, following this package's `README.md` shim-ledger precedent
 * (row 1, `ol-t5lj`): a vault existence/write question is core-ward via
 * `VaultSource`, never a reason to grow the workbench's `App` shim.
 */

import type { App, WorkspaceLeaf } from 'obsidian';
import type {
  RegistryConceptEntry,
  RegistryInstrumentSummary,
  RegistrySourceLocation,
  VaultSource,
} from 'olea-core';
import type {
  AcceptNoteOfferPort,
  EditInstrumentPort,
  OpenSourceLocationPort,
} from './provider.js';
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

/**
 * Characters no common filesystem accepts in a filename, plus a trim — the
 * same defensive minimum `homeNotePathForSource` (`../generation/home-note.ts`)
 * does not need (it derives its name from an existing source path, already
 * filesystem-legal) but a note named after HER free-text display name does.
 */
function sanitizeNoteFileName(displayName: string): string {
  const cleaned = displayName.replace(/[\\/:*?"<>|]/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'Untitled concept';
}

/**
 * A vault-root path at `fileName`.md, disambiguated with " 2", " 3", … the
 * first time it collides with an existing file — never overwriting
 * something already there, since whatever already sits at that path was not
 * created by this offer and this port has no business deciding it is safe
 * to replace. `VaultSource.exists` (never `app.vault.getAbstractFileByPath`)
 * — see this file's module doc and `createObsidianAcceptNoteOfferPort`'s own
 * doc on why.
 */
async function uniqueNotePath(vault: VaultSource, fileName: string): Promise<string> {
  let candidate = `${fileName}.md`;
  let attempt = 2;
  while (await vault.exists(candidate)) {
    candidate = `${fileName} ${attempt}.md`;
    attempt += 1;
  }
  return candidate;
}

/**
 * F8.4a's `[D-176]` accept half (`ol-r1by`): creates a brand-new note in her
 * Zettelkasten, named for her display name (C7.4) — the clause's own words,
 * "a new authored note." Named and placed alongside this file's other two
 * Obsidian hand-offs, but the write itself goes through `VaultSource`
 * (`vault.exists`/`vault.write`), never `app.vault` — a vault existence/write
 * question is core-ward per this package's own `README.md` shim-ledger row 1
 * (`ol-t5lj`, `createObsidianNoteExistsPort`'s identical call), and keeping
 * this port on `VaultSource` alone means it needs no Obsidian `App` member
 * the workbench's INV-1 shim does not already carry, and is directly
 * unit-testable under Vitest against a plain `VaultSource` fixture.
 *
 * Neither existing note-creation path this codebase already has fits: writes
 * an ordinary note (an "hers, authored" note is the clause's own shape, not
 * Olea's layer), where `generation/home-note.ts`'s `ensureHomeNoteForConcept`
 * is INV-6 Part Two's "Olea's own layer... never prompting first" (a bare-
 * document home note, silently reusable, marked so Olea may freely rewrite
 * it) — the opposite posture from a note she just consented to by clicking
 * Accept; and `retrospective/note-writer.ts`'s `writeRetrospectiveNote`
 * writes into Olea's own folder with retrospective-specific content. So this
 * is a third, minimal writer, not a second disguised as one of them.
 *
 * **Location: her vault's root**, never a hardcoded Zettelkasten folder name
 * — this codebase has no ratified one anywhere (the real vault's own
 * `05 Zettelkasten` convention is evidence, never a specification — see this
 * repo's CLAUDE.md on why nothing here may be inferred as a requirement from
 * it), so inventing a folder name would be exactly the fabricated-location
 * mistake `[D-171]`'s own scenarios forbid for source locations. Obsidian's
 * own "default location for new notes" setting (`app.fileManager.
 * getNewFileParent`) would be the more natural choice but is Obsidian-`App`
 * chrome this port deliberately does not reach for, per the `VaultSource`-
 * only design above — root is the honest, zero-fabrication default until a
 * clause or a settings field names somewhere better.
 *
 * **KNOWN GAP, reported rather than hacked around: this does not yet bind
 * the concept's existing key (`[D-088]`) onto the new note.** `[D-176]`'s
 * clause requires it, but the mechanism that could do it —
 * `../../core/concept/key-store.ts`'s `resolveConceptKey` — resolves by
 * ANCHOR MATCH, not by a caller-supplied key: a topic-anchored (tier-2/3)
 * concept's `TopicAnchor` never matches the new note's `NoteAnchor` (`kind`
 * differs), so calling it here would MINT A SECOND KEY for the same concept
 * rather than rebinding the existing one — silently duplicating identity,
 * which `[D-088]`'s conservation property exists to prevent. Fixing this
 * needs a key-driven rebind entry point added to `key-store.ts` (`packages/
 * core/src/concept/`), a file outside this bead's owned paths
 * (`packages/core/src/registry/**`, `packages/plugin/src/registry/**`); a
 * raw read/write of that module's `.olea/concepts/<key>.json` file format
 * from here was considered and rejected — that module's own doc calls
 * `resolveConceptKey` "the single seam," and duplicating its file-naming and
 * serialization logic outside that seam is the same "second ranking
 * algorithm" mistake this bead's `courseRankingsForNoteOffer` doc argues
 * against, one module over. The note IS created; only the binding is
 * pending a follow-up bead with `key-store.ts` in its `owns`.
 */
export function createObsidianAcceptNoteOfferPort(vault: VaultSource): AcceptNoteOfferPort {
  return {
    async accept(entry: RegistryConceptEntry) {
      const path = await uniqueNotePath(vault, sanitizeNoteFileName(entry.displayName));
      await vault.write(path, `# ${entry.displayName}\n`);
    },
  };
}
