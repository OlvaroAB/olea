/**
 * S2 — [D-226] ruling 1's "same control reachable from the document itself,"
 * so F1.5(c) holds for the life of a course: she finds a paper in week seven
 * while looking at it, not while looking at the grove.
 *
 * A `file-menu` context-menu item, the same wiring shape `main.ts` already
 * uses for "Olea: Process this note now" (`ol-0r92.21`/`[D-152]`/`ol-s46v`)
 * — `this.registerEvent(this.app.workspace.on('file-menu', ...))`, gated by
 * a predicate, with no precedent in `register-commands.ts` for an event
 * registration. **Deliberately not a command-palette entry** — S3 (F7.7) was
 * considered by the ruling and is NOT adopted: a third entry point onto one
 * act.
 *
 * **Gate.** Fires only for a file `olea-core#isRegisterableDocument` accepts
 * (never markdown — F1.3 already owns declaring a role for those via
 * frontmatter) AND whose course `olea-core#courseFromPath` can resolve from
 * where it sits. **Scope cut, Class B (reversible default, flagged for
 * retroactive review), stated rather than silently applied:** a file sitting
 * loose in the flat F7.9 folder (`03 Research`, no course substructure to
 * read — `register.ts`'s own module doc) has no course this predicate can
 * derive, so this control does not fire for it; she still has S1
 * (`../grove/view.ts`, rendered per-course, where the course is already
 * known) for that case. Building a course picker for the flat-folder case is
 * follow-up work, not a gap in the ruling — S1 already gives every F7.9 file
 * a path to registration.
 *
 * **Write.** Reuses `./register-source-modal.ts`'s role step verbatim — the
 * same two-button choice S1 opens — then calls
 * `olea-core#appendSourceRegisteredRecord` directly. Correction is the same
 * gesture as declaration (F1.5): invoking this on an already-registered path
 * simply appends a second event, and `olea-core#projectRegisteredFiles`
 * folds "latest wins".
 */

import type { Plugin } from 'obsidian';
import { TFile } from 'obsidian';
import {
  appendSourceRegisteredRecord,
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  isRegisterableDocument,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { RegisterSourceRoleModal } from './register-source-modal.js';

export const REGISTER_SOURCE_MENU_TITLE = 'Olea: Register as objectives or past paper';
export const REGISTER_SOURCE_MENU_ICON = 'file-check';

export interface RegisterSourceWiringDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests; defaults to F1.3's `DEFAULT_COURSES_FOLDER`. */
  readonly coursesFolder?: VaultPath;
  /** Called after a successful write — production refreshes an open grove leaf. */
  readonly onRegistered?: () => void;
}

/**
 * Wires the file-menu item into `plugin`. Call once, from `onload` — the
 * same lifetime `main.ts`'s existing `file-menu` registration
 * (`isProcessNowSupported`) has, via `plugin.registerEvent` so Obsidian tears
 * it down on unload without a separate cleanup call.
 */
export function wireDocumentSourceRegistration(
  plugin: Plugin,
  deps: RegisterSourceWiringDeps,
): void {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;

  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;
      const path = file.path as VaultPath;
      if (!isRegisterableDocument(path)) return;
      const course = courseFromPath(path, coursesFolder);
      if (course === undefined) return;

      menu.addItem((item) => {
        item
          .setTitle(REGISTER_SOURCE_MENU_TITLE)
          .setIcon(REGISTER_SOURCE_MENU_ICON)
          .onClick(() => {
            new RegisterSourceRoleModal(plugin.app, path, (role) => {
              void appendSourceRegisteredRecord(
                deps.vault,
                { timestamp: deps.now().toISOString(), path, role, course },
                { deviceId: deps.deviceId },
              ).then(() => deps.onRegistered?.());
            }).open();
          });
      });
    }),
  );
}
