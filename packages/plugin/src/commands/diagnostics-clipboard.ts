/**
 * `copyDiagnosticsToClipboard` — the Obsidian-touching half of the F7.5/Q6.3
 * diagnostics command (`ol-p6t02`). `diagnostics.ts` carries every piece of
 * logic worth unit-testing (the report text, the queue counting) as pure
 * functions; this file is only the glue that reads the real
 * plugin/Obsidian/platform versions, loads the two persisted stores, and
 * puts the result on the clipboard.
 *
 * **No test file**, same reasoning as `commands/placeholders.ts`: this
 * module imports `Notice`, `Platform` and `apiVersion` from `obsidian`,
 * which has no runtime outside a real Obsidian host (`obsidian`'s own
 * `package.json` declares `main: ""`), so it cannot execute under Vitest.
 * Covered by the `@manual` scenarios in `features/F7-plugin-surface.md`
 * instead.
 *
 * **Failures surface actionably, never silently** (the bead's own acceptance
 * criterion): if either store fails to load or the clipboard write throws,
 * she gets a `Notice` telling her the attempt failed and what she can still
 * do — never a swallowed error and never an uncaught exception in the
 * console.
 */

import { apiVersion, Notice, Platform } from 'obsidian';
import type { PersistedKeywordIndex, PersistedQueue } from 'olea-core';
import { buildDiagnosticsReport } from './diagnostics.js';

export interface DiagnosticsSources {
  readonly pluginVersion: string;
  loadQueue(): Promise<PersistedQueue | null>;
  loadIndex(): Promise<PersistedKeywordIndex | null>;
}

/** The `{ writeText }` slice of the Clipboard API this needs — injectable so production's real `navigator.clipboard` is a call-site concern, not a hard-wired global. */
export interface ClipboardPort {
  writeText(text: string): Promise<void>;
}

const defaultClipboard: ClipboardPort = {
  writeText: (text: string) => navigator.clipboard.writeText(text),
};

export async function copyDiagnosticsToClipboard(
  sources: DiagnosticsSources,
  clipboard: ClipboardPort = defaultClipboard,
): Promise<void> {
  try {
    const [queue, index] = await Promise.all([sources.loadQueue(), sources.loadIndex()]);
    const report = buildDiagnosticsReport({
      generatedAt: new Date().toISOString(),
      pluginVersion: sources.pluginVersion,
      obsidianApiVersion: apiVersion,
      platform: Platform.isMobile ? 'mobile' : 'desktop',
      queue,
      index,
    });
    await clipboard.writeText(report);
    new Notice('Olea: diagnostics copied to clipboard — paste them into your bug report.');
  } catch {
    // Actionable, not silent: she is told the attempt failed and what she
    // can still do, never left guessing whether the command did anything.
    new Notice(
      "Olea: couldn't gather diagnostics this time. Try the command again in a moment; if it keeps failing, just note when it happened in your report.",
    );
  }
}
