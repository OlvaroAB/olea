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
  readonly callback: () => void;
  /** Default hotkey, only set where a contract ref names one explicitly — see `register-commands.ts`. Mutable array — see `OleaHotkey`'s doc. */
  hotkeys?: OleaHotkey[];
}

/** The `{ addCommand }` slice of Obsidian's `Plugin` that command registration needs. */
export interface CommandRegistrar {
  addCommand(command: OleaCommandSpec): unknown;
}
