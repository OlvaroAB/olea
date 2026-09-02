/**
 * The seams the registry provider depends on instead of talking to a real
 * vault or Obsidian directly — same narrow-port split `review/ports.ts` and
 * `commands/types.ts` already draw, so a plain fake object can satisfy these
 * in tests.
 *
 * **`PruneInstrumentPort` is a second production caller of
 * `appendSuspendRecord`, symmetric where `review/ports.ts`'s `SuspendPort`
 * is not.** `SuspendPort.suspend` (F2.6's durable half) only ever writes
 * `kind: 'suspend'` — nothing in review offers unsuspending yet, per that
 * port's own doc. F8.5's withdrawal is explicitly reversible ("can return"),
 * so this port writes both directions through the same frozen writer,
 * exactly as that module's doc anticipates: *"the day an unsuspend command
 * exists it is a caller of the same writer, not a new one."* Nothing here
 * duplicates `SuspendPort` or reaches into `review/`; it calls
 * `olea-core`'s `appendSuspendRecord` directly, carrying the `conceptIds`
 * `RegistryInstrumentSummary` already has on hand (no reconstruction problem
 * — see that record's own doc for why the id alone was never enough).
 *
 * **The withdrawn set this reads back is `../review-log/suspension.ts`'s
 * existing projection** (`suspendedInstrumentIds`), read by the provider,
 * not by this port — a prune here and an in-session suspend (F2.6) are
 * therefore the SAME state, viewed from two surfaces, never two competing
 * withdrawal mechanisms for one instrument.
 *
 * **`createObsidianAcceptNoteOfferPort` (`ol-r1by`/`[D-176]`, moved here
 * `ol-2zfj.55`) lives in this file, not `obsidian-ports.ts`, despite the
 * name.** It never touches `App` — only `VaultSource` — so it belongs on
 * this side of the split for the same reason `createVaultPruneInstrumentPort`
 * above does: `obsidian-ports.ts`'s own module doc is explicit that its
 * `App`-shaped dependency (concretely, its `import { RegistryView } from
 * './view.js'`, which itself imports the real `obsidian` package as a VALUE,
 * not a type) "cannot be loaded under Vitest" — confirmed directly:
 * importing anything at all from `obsidian-ports.ts` under this package's
 * Vitest config throws `Failed to resolve entry for package "obsidian"`,
 * because that npm package ships only `.d.ts` ambient declarations (`"main":
 * ""`, no runtime file at all) — Obsidian itself supplies the real
 * implementation at runtime. A port with no `App` member has no reason to
 * pay that cost, and `obsidian-ports.ts` re-exports the name unchanged (see
 * its own doc) so `main.ts`'s existing `from './registry/obsidian-ports.js'`
 * import keeps working with no edit there.
 */

import {
  appendSuspendRecord,
  bindConceptKeyToNote,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type VaultSource,
} from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';
import type { AcceptNoteOfferPort } from './provider.js';

export interface PruneInstrumentPort {
  prune(instrument: RegistryInstrumentSummary): Promise<void>;
  restore(instrument: RegistryInstrumentSummary): Promise<void>;
}

/**
 * The real `PruneInstrumentPort`: `olea-core`'s `appendSuspendRecord` over a
 * `VaultSource` — needs no Obsidian, so it runs under Vitest, matching
 * `review/ports.ts`'s `createVaultSuspendPort`.
 */
export function createVaultPruneInstrumentPort(
  vault: VaultSource,
  deviceId: string,
): PruneInstrumentPort {
  async function write(kind: 'suspend' | 'unsuspend', instrument: RegistryInstrumentSummary) {
    await appendSuspendRecord(
      vault,
      {
        kind,
        timestamp: isoWithLocalOffset(new Date()),
        instrumentId: instrument.instrumentId,
        conceptIds: [...instrument.conceptIds],
      },
      { deviceId },
    );
  }

  return {
    prune: (instrument) => write('suspend', instrument),
    restore: (instrument) => write('unsuspend', instrument),
  };
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
 * — see this module's doc and `createObsidianAcceptNoteOfferPort`'s own doc
 * on why.
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
 * "a new authored note." The write itself goes through `VaultSource`
 * (`vault.exists`/`vault.write`), never `app.vault` — a vault existence/write
 * question is core-ward per this package's own `README.md` shim-ledger row 1
 * (`ol-t5lj`, `createObsidianNoteExistsPort`'s identical call), and keeping
 * this port on `VaultSource` alone is exactly what makes it directly
 * unit-testable under Vitest against a plain `VaultSource` fixture — see
 * this module's own doc for why that is also why it lives here rather than
 * in `obsidian-ports.ts`.
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
 * **Binds the concept's existing key (`[D-088]`) onto the new note
 * (`ol-2zfj.55`).** `[D-176]`'s clause requires it, and the earlier gap here
 * — `resolveConceptKey` resolves by ANCHOR MATCH, so a topic-anchored
 * (tier-2/3) concept's `TopicAnchor` never matches the new note's
 * `NoteAnchor` (`kind` differs), and calling it would have MINTED A SECOND
 * KEY for the same concept rather than rebinding the existing one — is
 * closed by `key-store.ts`'s second, key-driven seam, `bindConceptKeyToNote`:
 * it looks the record up by `entry.key` (never by anchor match) and
 * rewrites its `anchor` in place, folding the old topic wording into
 * `aliases` per `[D-183]`'s alias rule rather than discarding it. Called
 * AFTER the note write succeeds — a rebind onto a note that was never
 * actually created would be worse than the gap it closes. `noteUid` is
 * `null` here: this writer emits a bare `# heading` note with no
 * frontmatter, so there is no `olea-uid` yet to prefer over the path (see
 * `uid/stamp.ts`); the anchor still resolves correctly by path, and gains a
 * stable uid the moment something stamps one, the same drift
 * `resolveConceptKey`'s own anchor-refresh already tolerates.
 */
export function createObsidianAcceptNoteOfferPort(vault: VaultSource): AcceptNoteOfferPort {
  return {
    async accept(entry: RegistryConceptEntry) {
      const path = await uniqueNotePath(vault, sanitizeNoteFileName(entry.displayName));
      await vault.write(path, `# ${entry.displayName}\n`);
      await bindConceptKeyToNote(vault, entry.key, {
        kind: 'note',
        noteUid: null,
        notePath: path,
      });
    },
  };
}
