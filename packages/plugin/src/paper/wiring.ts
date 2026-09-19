/**
 * `buildPracticePaperProvider` / `courseForActiveFile` — the practice-paper command/view's
 * `main.ts`-facing composition (F4.11, `[PAPER-8]` / `ol-egov.141.6.1`).
 *
 * Mirrors `grading/wiring.ts`/`retrieval/wiring.ts`'s own shape: everything that decides WHAT to
 * show lives in `./provider.ts`/`./copy.ts`/`./assemble.ts`, all obsidian-free and unit-tested;
 * this file is the one composition seam that needs the real `VaultSource`, `ObsidianDataHost` and
 * `WorkerConfig` transport factory only `main.ts` has ready. `main.ts` itself only needs to:
 *
 *   const practicePaper = buildPracticePaperProvider({ vault, dataHost: this, createTransport:
 *   createObsidianWorkerTransport, settingsStore: new ObsidianStudyPlanSettingsStore(this) });
 *   this.registerView(VIEW_TYPE_OLEA_PAPER, (leaf) => new PaperView(leaf, practicePaper));
 *
 * plus a command (`OLEA_COMMAND_PRACTICE_PAPER_OPEN`, `./ids.js`) whose `checkCallback` uses
 * `courseForActiveFile` to gate on the active file naming a course, and a `revealPracticePaperView`
 * method following the exact `revealGapView`/`revealSessionBuilderView` reuse-don't-stack shape
 * `main.ts` already uses for every other course/concept-scoped view — see `docs/dev/wiring-
 * register.md` (private repo) for this bead's reachability note on the one-line `main.ts` call.
 *
 * **Course resolution is folder-based, the same as every other course join in this repo**
 * (`courseFromPath`, F1.3) — there is no active-file-frontmatter course resolver anywhere in this
 * plugin to reuse instead (confirmed by search before writing this file), and inventing a second,
 * different "which course is this" rule alongside `courseFromPath`'s folder rule is exactly the
 * `ol-5y40`-shaped mistake `oracle/compose.ts`'s own module doc warns against ("one rule, two
 * repos... is how two answers to 'which course is this?' get shipped at once" — the same argument
 * applies within one repo). A note that sits outside the courses folder (or loose inside it)
 * resolves to `undefined`, and the command is hidden — the same "no supported target, hide the
 * palette entry" rule `OLEA_COMMAND_PROCESS_NOTE_NOW`'s own `checkCallback` already follows.
 */

import type { App, TFile } from 'obsidian';
import { courseFromPath, type VaultSource, type WorkerTaskTransport } from 'olea-core';
import type { PersistedStudyPlanConfig } from '../plan/settings-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { buildPracticePaperGenerationPort, type ObsidianDataHost } from './generation-port.js';
import { createLocalPracticePaperProvider, type PracticePaperViewDeps } from './provider.js';

/** The course `file` sits under, by `courseFromPath`'s folder rule (F1.3) — `undefined` outside the courses folder, matching every other consumer of that function in this repo. */
export function courseForActiveFile(file: TFile, coursesFolder?: string): string | undefined {
  return coursesFolder === undefined
    ? courseFromPath(file.path)
    : courseFromPath(file.path, coursesFolder);
}

/** Convenience wrapper reading the active file straight off `App` — `undefined` with no active file, same as no active file resolving to a course. */
export function courseForActiveFileInApp(app: App, coursesFolder?: string): string | undefined {
  const file = app.workspace.getActiveFile();
  return file === null ? undefined : courseForActiveFile(file, coursesFolder);
}

export interface BuildPracticePaperProviderDeps {
  readonly vault: VaultSource;
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
  readonly settingsStore: { load(): Promise<PersistedStudyPlanConfig> };
  readonly now?: () => Date;
}

/** The production `PracticePaperViewDeps` — see the module doc for exactly what `main.ts` supplies and why each piece is injected rather than built here. */
export function buildPracticePaperProvider(
  deps: BuildPracticePaperProviderDeps,
): PracticePaperViewDeps {
  return createLocalPracticePaperProvider({
    vault: deps.vault,
    settingsStore: deps.settingsStore,
    now: deps.now ?? (() => new Date()),
    generationPort: () =>
      buildPracticePaperGenerationPort({
        dataHost: deps.dataHost,
        createTransport: deps.createTransport,
      }),
  });
}
