/**
 * `readAssessments` — the Bases assignments reader (F1.1, P1-T06).
 *
 * Reads a `.base` file to find which folder(s) to scan (./base-file.ts),
 * then reads every note in those folder(s) and resolves each of `course`,
 * `type`, `weight`, `due`, `status` to whichever frontmatter key her notes
 * actually use — **tolerantly**: case-insensitive, and matched against a
 * small alias table (`Weight`/`Weighting`, `Due`/`Due Date`, ...), because
 * she renames columns between semesters (a mapping wizard is v1 scope; this
 * tolerance plus an honest report is the v0.9 floor).
 *
 * The failure mode this whole module is built around: a column-matching
 * failure must never come back as a quiet empty list that reads the same as
 * "no assignments". See `AssessmentReadReport` in ./types.ts — every
 * `readAssessments` call returns a full report, not a bare array, and an
 * empty `records` is always explained by `configErrors` or
 * `unresolvedFields` elsewhere in that report.
 */

import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import type { EntryNode, Frontmatter } from '../frontmatter/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import {
  extractDeclaredProperties,
  extractExtFilters,
  extractInFolderFilters,
} from './base-file.js';
import {
  type AssessmentField,
  type AssessmentReadReport,
  type AssessmentRecord,
  type ColumnMapping,
  REQUIRED_ASSESSMENT_FIELDS,
} from './types.js';

/** Known aliases for each semantic field, already lowercased/normalised — see `normalizeKey`. */
const FIELD_ALIASES: Record<AssessmentField, readonly string[]> = {
  course: ['class', 'course'],
  type: ['type'],
  weight: ['weight', 'weighting'],
  due: ['due', 'due date'],
  status: ['status'],
};

/** Case-insensitive, whitespace/`-`/`_`-tolerant normalisation for column-name matching. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function matchField(key: string): AssessmentField | undefined {
  const normalized = normalizeKey(key);
  for (const field of REQUIRED_ASSESSMENT_FIELDS) {
    if (FIELD_ALIASES[field].includes(normalized)) return field;
  }
  return undefined;
}

/** Top-level entry keys in a note's frontmatter, in file order (duplicates included, first occurrence wins downstream — same leniency `setEntryValue` uses). */
function entryKeys(fm: Frontmatter): readonly string[] {
  return fm.nodes.filter((n): n is EntryNode => n.kind === 'entry').map((n) => n.key);
}

export async function readAssessments(
  vault: VaultSource,
  basePath: VaultPath,
): Promise<AssessmentReadReport> {
  const baseSource = await vault.read(basePath);

  const sourceFolders = extractInFolderFilters(baseSource);
  const extensions = extractExtFilters(baseSource);
  const declaredProperties = extractDeclaredProperties(baseSource);
  // `formula.*` columns are computed, not read from any note's frontmatter —
  // out of scope for "column matching", not an "unrecognized" column.
  const declaredNoteColumns = declaredProperties.filter((key) => !key.startsWith('formula.'));

  if (sourceFolders.length === 0) {
    return {
      records: [],
      sourceFolders: [],
      notesScanned: [],
      notesWithoutFrontmatter: [],
      columns: [],
      unresolvedFields: [...REQUIRED_ASSESSMENT_FIELDS],
      unrecognizedColumns: declaredNoteColumns,
      configErrors: [
        `readAssessments: found no file.inFolder(...) filter in ${JSON.stringify(basePath)} — ` +
          "can't determine which folder(s) to scan, so no notes were read. This is a config " +
          'problem with the .base file, not "no assignments".',
      ],
    };
  }

  const extensionList = extensions.length > 0 ? extensions : ['md'];
  const notePathLists = await Promise.all(
    sourceFolders.map((folder) => vault.list({ under: folder, extensions: extensionList })),
  );
  const notesScanned = [...new Set(notePathLists.flat())].sort();

  const notesWithoutFrontmatter: VaultPath[] = [];
  const parsedByPath = new Map<VaultPath, Frontmatter>();
  const allKeys = new Set<string>();

  for (const path of notesScanned) {
    const content = await vault.read(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') {
      notesWithoutFrontmatter.push(path);
      continue;
    }
    const fm = parseFrontmatter(first.inner);
    parsedByPath.set(path, fm);
    for (const key of entryKeys(fm)) allKeys.add(key);
  }

  // One global mapping per field, resolved from the union of keys actually
  // seen across the scanned notes — her whole Base's schema changes
  // together between semesters, not note-by-note.
  const matchedKeyByField = new Map<AssessmentField, string>();
  for (const key of [...allKeys].sort()) {
    const field = matchField(key);
    if (field !== undefined && !matchedKeyByField.has(field)) {
      matchedKeyByField.set(field, key);
    }
  }

  const columns: ColumnMapping[] = REQUIRED_ASSESSMENT_FIELDS.filter((field) =>
    matchedKeyByField.has(field),
  ).map((field) => {
    const matchedKey = matchedKeyByField.get(field);
    if (matchedKey === undefined) throw new Error('readAssessments: internal mapping error');
    return { field, matchedKey };
  });
  const unresolvedFields = REQUIRED_ASSESSMENT_FIELDS.filter(
    (field) => !matchedKeyByField.has(field),
  );
  const unrecognizedColumns = declaredNoteColumns.filter((key) => matchField(key) === undefined);

  const records: AssessmentRecord[] =
    columns.length === 0
      ? []
      : notesScanned
          .filter((path) => parsedByPath.has(path))
          .map((path) => {
            const fm = parsedByPath.get(path);
            if (fm === undefined) throw new Error('readAssessments: internal lookup error');

            const readField = (field: AssessmentField): string | undefined => {
              const key = matchedKeyByField.get(field);
              if (key === undefined) return undefined;
              const scalar = readScalar(fm, key).scalar;
              return scalar === '' ? undefined : scalar;
            };

            const weightRaw = readField('weight');
            const weight = weightRaw === undefined ? undefined : Number(weightRaw);

            return {
              path,
              course: readField('course'),
              type: readField('type'),
              weight: weight !== undefined && Number.isFinite(weight) ? weight : undefined,
              weightRaw,
              due: readField('due'),
              status: readField('status'),
            };
          });

  return {
    records,
    sourceFolders,
    notesScanned,
    notesWithoutFrontmatter,
    columns,
    unresolvedFields,
    unrecognizedColumns,
    configErrors: [],
  };
}
