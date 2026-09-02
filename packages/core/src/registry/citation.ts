/**
 * A student-facing citation string for one `RegistrySourceLocation`
 * (`ol-2zfj.25`, F8.4 amended Sep 2026 — `[D-171]`).
 *
 * This is the formatter `ol-2zfj.25` was filed to pre-register: turning
 * `RegistrySourceLocation.page`/`.section` into a short, honest string
 * rather than leaving the field silently unrendered. `[D-171]` moved the
 * display surface itself to the F8.4 registry's Sources list (not F3.10/
 * F3.11, which name no display surface — see this bead's notes), so this
 * module formats exactly what `RegistrySourceLocation` carries and nothing
 * `../extract/types.js`'s `SourceLocation` documents as a second scheme
 * (`[D-085]`).
 *
 * **Display rule:** `location.section ?? page/slide-appropriate fallback`.
 * `page` IS the slide number for a PPTX-sourced passage (there is no
 * separate slide field — `RegistrySourceLocation`'s own doc comment), so a
 * `.pptx` source path renders `slide N` while every other page-bearing
 * source renders `p. N`. `heading` is the last resort, used only when
 * neither a section nor a page/slide is known. **Never fabricated**: a
 * location with none of `section`/`page`/`heading` renders the bare note
 * name, exactly like `sourceLocationLabel` did before this bead — see
 * `./citation.spec.ts` for the full case table.
 *
 * Pure, no `obsidian` import (INV-1) — unit-tested under Vitest.
 */

import type { RegistrySourceLocation } from './types.js';

/** The note's filename, without folders or extension. */
function noteNameFromPath(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function isPptxPath(sourcePath: string): boolean {
  return sourcePath.toLowerCase().endsWith('.pptx');
}

/** The passage-grain fragment alone (`p. 3`, `slide 5`, a section title, a heading) — `undefined` when nothing is known, never a fabricated default. Exported for callers that want the grain separately from the note name. */
export function passageGrainLabel(location: RegistrySourceLocation): string | undefined {
  if (location.section) return location.section;
  if (location.page !== undefined) {
    return isPptxPath(location.sourcePath) ? `slide ${location.page}` : `p. ${location.page}`;
  }
  if (location.heading) return location.heading;
  return undefined;
}

export interface FormatSourceCitationOptions {
  /** Render the passage grain alone, without the note name prefix — for a caller (e.g. an instrument row) that already shows the note title elsewhere and would otherwise repeat it. Defaults to `false`. */
  readonly grainOnly?: boolean;
}

/**
 * The full student-facing citation: note name, then the passage grain in
 * parentheses when one is known. With `{ grainOnly: true }`, returns just
 * the grain fragment (or `undefined` when none is known) for a caller that
 * shows the note name separately.
 */
export function formatSourceCitation(
  location: RegistrySourceLocation,
  opts?: FormatSourceCitationOptions,
): string {
  const grain = passageGrainLabel(location);
  if (opts?.grainOnly) return grain ?? '';
  const name = noteNameFromPath(location.sourcePath);
  return grain ? `${name} (${grain})` : name;
}
