/**
 * Narrow local mirror of the slice of Obsidian's `Command`/`Plugin.addCommand`
 * surface this plugin actually uses — deliberately not `import type { Command }
 * from 'obsidian'`.
 *
 * Same reasoning as `ingestion/queue-store.ts`'s `ObsidianDataHost`: it lets
 * `register-commands.ts` (the logic worth unit-testing — which ids, names and
 * hotkeys get registered) run and be tested in plain Vitest with a fake
 * registrar, with zero dependency on the `obsidian` package, which has no
 * runtime to execute against outside a real Obsidian host. `main.ts` is the
 * only place that hands a real `Plugin` in; structurally a `Plugin` satisfies
 * `CommandRegistrar` below without any adapter, since Obsidian's `addCommand`
 * accepts every field this file defines (plus more we don't use).
 */

/** Mirrors Obsidian's `Modifier` union exactly, so `OleaHotkey` is structurally assignable to Obsidian's `Hotkey`. */
export type OleaHotkeyModifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';

export interface OleaHotkey {
  /**
   * Mutable array, matching Obsidian's own `Hotkey.modifiers: Modifier[]`
   * exactly — a `readonly` array here would make `OleaCommandSpec`
   * structurally *not* assignable to Obsidian's `Command` (a `Plugin` is
   * handed straight to `registerOleaCommands` as a `CommandRegistrar` in
   * `main.ts`, so this has to line up).
   */
  modifiers: OleaHotkeyModifier[];
  key: string;
}

export interface OleaCommandSpec {
  readonly id: string;
  readonly name: string;
  /**
   * Optional because a command may supply `checkCallback` instead, below.
   * Every Olea command but one still uses this form.
   */
  readonly callback?: () => void;
  /**
   * `ol-s46v`: the slice of Obsidian's real `Command` surface this port
   * didn't need until `OLEA_COMMAND_PROCESS_NOTE_NOW` folded in here — this
   * file's own module doc already frames the port as "the slice of
   * Obsidian's `Command`/`Plugin.addCommand` surface this plugin actually
   * uses," and this is that slice widening by exactly one field, not a new
   * pattern. Mutually exclusive with `callback` in practice, matching
   * Obsidian's own contract. **This is the one field here that changes what
   * is rendered in the palette, not just what runs**: Obsidian calls it with
   * `checking: true` to ask "would this command do anything right now,"
   * without executing it — returning `false` hides the palette entry
   * entirely, same as an absent command. It calls again with
   * `checking: false` only once the student actually invokes it, and that
   * call is where the real action runs and `true` is returned.
   */
  readonly checkCallback?: (checking: boolean) => boolean;
  /** Default hotkey, only set where a contract ref names one explicitly — see `register-commands.ts`. Mutable array — see `OleaHotkey`'s doc. */
  hotkeys?: OleaHotkey[];
}

/** The `{ addCommand }` slice of Obsidian's `Plugin` that command registration needs. */
export interface CommandRegistrar {
  addCommand(command: OleaCommandSpec): unknown;
}
