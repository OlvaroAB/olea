/**
 * The F7.4 coverage guard (`ol-egov.141.8.7`): every folder Olea writes under `.olea/` is
 * registered in `src/privacy/log-discovery.ts`'s `OLEA_LAYER_FOLDERS`, so the export and the full
 * delete are told what it is, and a new writer cannot be added without this suite going red.
 *
 * **How writers are found.** Every non-spec `.ts` file under `packages/core/src` and
 * `packages/plugin/src` is parsed with the TypeScript compiler, and every string literal or
 * template-literal part whose text is `.olea` or starts with `.olea/` is collected. Parsing, not a
 * grep: a folder named in a comment is not a writer, and a literal is found wherever it sits.
 * Every writer in the tree names its folder as one such literal today (one `*_FOLDER` constant per
 * store), which is what makes this enumeration complete; the third test below keeps it so by
 * refusing a `.olea` path built at runtime, since a folder name the scan cannot read cannot be
 * checked either.
 *
 * **What "covered" means.** A registered folder is walked by `discoverOleaLayerPaths`, exported
 * by `buildPrivacyExportBundle` and removed by `runFullDelete`; `olea-layer-fixture.spec.ts` proves
 * that for every registered folder, on three host shapes, before and after.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  isOleaLayerPath,
  OLEA_LAYER_FOLDERS,
  OLEA_LAYER_ROOT,
} from '../../src/privacy/log-discovery.js';

const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCANNED_ROOTS = ['core/src', 'plugin/src'] as const;
/** The registry itself names the root and every folder; it reads the layer, it writes none of it. */
const REGISTRY_FILE = 'plugin/src/privacy/log-discovery.ts';

interface OleaLiteral {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

function oleaLiterals(absolutePath: string): OleaLiteral[] {
  const file = relative(PACKAGES_DIR, absolutePath).split('\\').join('/');
  const source = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: OleaLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.text;
      if (text === OLEA_LAYER_ROOT || text.startsWith(`${OLEA_LAYER_ROOT}/`)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push({ file, line, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const ALL_LITERALS: readonly OleaLiteral[] = SCANNED_ROOTS.flatMap((root) =>
  sourceFiles(join(PACKAGES_DIR, root)).flatMap(oleaLiterals),
);
const WRITER_LITERALS = ALL_LITERALS.filter((literal) => literal.file !== REGISTRY_FILE);

/** `.olea/<first segment>`, or `null` when the literal names no folder (the root, or `.olea/` followed by a substitution). */
function folderOf(text: string): string | null {
  const segment = text.slice(OLEA_LAYER_ROOT.length + 1).split('/')[0] ?? '';
  return segment === '' ? null : `${OLEA_LAYER_ROOT}/${segment}`;
}

const REGISTERED = new Set(OLEA_LAYER_FOLDERS.map((entry) => entry.folder));

describe('F7.4 coverage guard: every .olea/ writer is registered (ol-egov.141.8.7)', () => {
  it('the scan reads real writers, not nothing (a blind scanner would pass the next test vacuously)', () => {
    const files = new Set(WRITER_LITERALS.map((literal) => literal.file));
    expect(files).toContain('core/src/review-log/path.ts');
    expect(files).toContain('core/src/concept/key-store.ts');
    expect(files).toContain('plugin/src/review/duplication-confirmation-store.ts');
  });

  it('every .olea/ folder a source file names is registered for export and full delete', () => {
    const unregistered = WRITER_LITERALS.filter((literal) => {
      const folder = folderOf(literal.text);
      return folder !== null && !REGISTERED.has(folder);
    }).map((literal) => `${literal.file}:${literal.line} names ${literal.text}`);
    // A failure here means a store writes a folder F7.4 does not know about. Register it in
    // OLEA_LAYER_FOLDERS (log-discovery.ts) with its role; olea-layer-fixture.spec.ts then proves
    // the export carries it and the full delete removes it.
    expect(unregistered).toEqual([]);
  });

  it('no writer builds a .olea path at runtime, which this scan could not read', () => {
    const unreadable = WRITER_LITERALS.filter((literal) => folderOf(literal.text) === null).map(
      (literal) => `${literal.file}:${literal.line} has ${JSON.stringify(literal.text)}`,
    );
    // Name the folder as one '.olea/<name>' string constant, as every store does today.
    expect(unreadable).toEqual([]);
  });

  it('every registered folder is still named by a writer (the registry holds no stale entry)', () => {
    const written = new Set(
      WRITER_LITERALS.map((literal) => folderOf(literal.text)).filter(
        (folder): folder is string => folder !== null,
      ),
    );
    const stale = [...REGISTERED].filter((folder) => !written.has(folder));
    expect(stale).toEqual([]);
  });

  it('every registered folder sits directly under the root, once', () => {
    for (const { folder } of OLEA_LAYER_FOLDERS) {
      expect(isOleaLayerPath(folder)).toBe(true);
      expect(folder.split('/')).toHaveLength(2);
    }
    expect(REGISTERED.size).toBe(OLEA_LAYER_FOLDERS.length);
  });

  it('the roles are the ones F7.4 rests on: two event logs, one draft cache, every other folder a record store', () => {
    const byRole = (role: string) =>
      OLEA_LAYER_FOLDERS.filter((entry) => entry.role === role)
        .map((entry) => entry.folder)
        .sort();
    expect(byRole('log')).toEqual(['.olea/misconceptions', '.olea/reviews']);
    expect(byRole('cache')).toEqual(['.olea/drafts']);
    expect(byRole('record').length).toBe(OLEA_LAYER_FOLDERS.length - 3);
  });
});
