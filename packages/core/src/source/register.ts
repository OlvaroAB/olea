/**
 * `registerSources` — the non-embed route from a vault file to a `Source`
 * (F1.5, F7.9, P5-T01; F3.1 / `ol-ep3.2`).
 *
 * Scans the configured sources folder (default `03 Research`, F7.9) for
 * markdown notes and classifies each by a `role` frontmatter property,
 * tolerant of a small alias table the same way `../assessment/read.js`
 * tolerates renamed Bases columns — she is one person, not a schema
 * committee, and "no `role` property recognised" must be reported, never
 * silently read as "not a source." See ./types.js for the full report shape
 * and why it exists.
 *
 * **F3.1 extended this module rather than adding a second one.** R6's ruling
 * ("sources = embeds is not acceptable for v0.9") needed a way for a vault
 * file to become a `Source` with no note embedding it. This module was already
 * that: it scans a folder directly rather than following `![[...]]` links. What
 * it could not do was classify a file with no frontmatter to read — a PDF
 * landed in `skippedNonMarkdown`, honestly reported and never extracted.
 *
 * So the gap was never the *route*, it was the *classification*, and the fix is
 * `options.registeredFiles`: the caller names the file and says what it is,
 * because a binary cannot say so itself. That keeps ONE mechanism emitting
 * `Source` records — two competing ways for a file to become a `Source` is the
 * outcome `ol-ep3.2`'s seam assessment specifically warned against — and it
 * fits the one-off "drop a file" gesture, which is about a particular file and
 * not about where that file happens to be filed.
 *
 * What this module still does NOT do is extract anything. It emits `Source`
 * records; `../concept/evidence.js` is what runs them through
 * `../extract/registry.js`, and it runs registered and embedded material
 * through the same collector so there is no second-class path.
 */

import { parseDocument } from '../block/parse.js';
import { formatFromExtension } from '../extract/registry.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type {
  RegisterSourcesOptions,
  Source,
  SourceRegistrationReport,
  SourceRole,
  UnregisterableFile,
} from './types.js';

/** F7.9's default location for past papers and course objectives. */
export const DEFAULT_SOURCES_FOLDER: VaultPath = '03 Research';

/** Recognised `role` values, already normalised — see `normalizeRole`. */
const ROLE_ALIASES: Record<SourceRole, readonly string[]> = {
  'past-paper': [
    'past paper',
    'past-paper',
    'pastpaper',
    'exam paper',
    'exam-paper',
    'past exam',
    'past exam paper',
  ],
  objectives: [
    'objectives',
    'learning objectives',
    'course objectives',
    'learning-objectives',
    'course-objectives',
  ],
  // F3.1. Recognised so a markdown note can declare itself general course
  // material explicitly, the same way it can declare itself a past paper —
  // the folder scan should not be able to classify a role that the manual
  // path can, or the two routes would disagree about the same note.
  'course-material': [
    'course material',
    'course-material',
    'coursematerial',
    'course notes',
    'coursebook',
    'textbook',
    'lecture notes',
  ],
};

/** Case-insensitive, whitespace/`-`/`_`-tolerant normalisation, matching `../assessment/read.js`'s `normalizeKey`. */
function normalizeRole(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function matchRole(value: string): SourceRole | undefined {
  const normalized = normalizeRole(value);
  for (const role of Object.keys(ROLE_ALIASES) as SourceRole[]) {
    if (ROLE_ALIASES[role].includes(normalized)) return role;
  }
  return undefined;
}

function isMarkdown(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

export async function registerSources(
  vault: VaultSource,
  options: RegisterSourcesOptions = {},
): Promise<SourceRegistrationReport> {
  const sourcesFolder = options.sourcesFolder ?? DEFAULT_SOURCES_FOLDER;
  const allPaths = await vault.list({ under: sourcesFolder });

  const notesScanned = allPaths.filter(isMarkdown).sort();
  const skippedNonMarkdown = allPaths.filter((path) => !isMarkdown(path)).sort();

  const sources: Source[] = [];
  const notesWithoutFrontmatter: VaultPath[] = [];
  const unclassified: VaultPath[] = [];

  for (const path of notesScanned) {
    const content = await vault.read(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') {
      notesWithoutFrontmatter.push(path);
      continue;
    }

    const fm = parseFrontmatter(first.inner);
    const roleRaw = readScalar(fm, 'role').scalar;
    const role = roleRaw === '' ? undefined : matchRole(roleRaw);
    if (role === undefined) {
      unclassified.push(path);
      continue;
    }

    const courseRaw = readScalar(fm, 'course').scalar;
    sources.push({
      path,
      role,
      course: courseRaw === '' ? undefined : courseRaw,
      kind: 'registered-file',
      format: null,
    });
  }

  // F3.1: files named explicitly by the caller, wherever they sit, with no
  // embedding note and no frontmatter required. Order matters only in that
  // these are appended after the folder scan, so a report reads scan-then-drops.
  const unregisterable: UnregisterableFile[] = [];
  const seen = new Set<VaultPath>(sources.map((s) => s.path));
  for (const spec of options.registeredFiles ?? []) {
    const path = spec.path;
    // Registered twice, or registered *and* picked up by the folder scan: the
    // first registration stands. Emitting it twice would double every page it
    // contributes, which the content-hash dedup downstream would then have to
    // undo — better not to create the duplicate at all.
    if (seen.has(path)) continue;
    if (!(await vault.exists(path))) {
      unregisterable.push({ path, reason: 'not-found' });
      continue;
    }
    const format = formatFromExtension(path);
    if (format === null && !isMarkdown(path)) {
      // No extractor claims this extension and it is not markdown, so nothing
      // downstream could read it. Named here rather than registered into a
      // `Source` that would silently yield nothing forever.
      unregisterable.push({ path, reason: 'unsupported-format' });
      continue;
    }
    seen.add(path);
    sources.push({
      path,
      // A binary carries no frontmatter, so the caller's word is the only
      // classification available. `'course-material'` is the default because
      // it is what the manual path mostly carries and because it is the value
      // that claims the least.
      role: spec.role ?? 'course-material',
      course: spec.course,
      kind: 'registered-file',
      format,
    });
  }

  const configErrors: string[] = [];
  if (allPaths.length === 0 && (options.registeredFiles ?? []).length === 0) {
    configErrors.push(
      `registerSources: found no files under ${JSON.stringify(sourcesFolder)} — check F7.9's ` +
        'configured sources folder setting, not "no past papers or objectives".',
    );
  }

  return {
    sources,
    sourcesFolder,
    notesScanned,
    notesWithoutFrontmatter,
    unclassified,
    skippedNonMarkdown,
    unregisterable,
    configErrors,
  };
}
