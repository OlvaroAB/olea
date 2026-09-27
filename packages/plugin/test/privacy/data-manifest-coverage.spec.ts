/**
 * The settings-key coverage guard (`ol-egov.141.8.11`, ruled by `[D-393]`): every key the plugin
 * reads or writes in its settings file (`data.json`) has one classification in
 * `src/privacy/data-manifest.ts`, so the full delete and the export are told what it is, and a new
 * store cannot be added without this suite going red. The sibling of `olea-layer-coverage.spec.ts`,
 * which does the same for folders under `.olea/`.
 *
 * **How stores are found.** Every non-spec `.ts` file under `packages/plugin/src` is parsed with
 * the TypeScript compiler. A file that calls `loadData`, `saveData` or `readModifyWrite` is a
 * settings accessor. Every store in the tree names its key as one `const <NAME>_KEY = '<key>'`
 * string constant in its own file, so the key constants of accessor files are the full set of
 * keys. The third and fourth tests keep that true: an accessor file with no key constant, or one
 * that names a key as a bare string literal (`blob['x']`, `'x' in blob`, `{ ['x']: v }`), fails,
 * because a key the scan cannot read cannot be checked either.
 *
 * **Known gaps, stated.** (1) A store that writes a key as a plain identifier property of an
 * object literal (`saveData({ ...blob, someKey: v })`) with no `_KEY` constant anywhere is caught
 * only by the "declares a key constant" test, and only if it is that file's sole key. (2) A bare
 * literal key is looked for only inside functions that reach a settings accessor (so a validator
 * reading a field of a stored value is not mistaken for a top-level key); a merge closure declared
 * at module level, outside any such function, would escape it. No store in the tree does either
 * today; every one names its key through a computed `[CONSTANT]`.
 *
 * **What "covered" means.** A listed key is cleared or kept by `runFullDelete` and carried or not
 * by `buildPrivacyExportBundle` according to its classification; `data-manifest.spec.ts` proves
 * that for every listed key.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY_MANIFEST, settingsKeyEntry } from '../../src/privacy/data-manifest.js';

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = join(PLUGIN_DIR, 'src');

/**
 * Files that call the settings accessors but own no key: the host plumbing itself, and the
 * privacy code that acts on other stores' keys by importing their constants.
 */
const PASS_THROUGH_FILES = new Set([
  'src/main.ts',
  'src/retrieval/serializing-data-host.ts',
  'src/privacy/cache-purge.ts',
  // `src/privacy/data-manifest.ts` is scanned like any store since `[D-406]`: it declares and
  // writes the full-delete pause marker, so that key is held to the same checks.
  // `ol-egov.141.8.12`: the full delete's write seal on the plugin's one settings host.
  'src/privacy/settings-section.ts',
]);

const ACCESSOR_METHODS = new Set(['loadData', 'saveData', 'readModifyWrite']);

interface KeyConstant {
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

interface FileScan {
  readonly file: string;
  readonly isAccessor: boolean;
  readonly keyConstants: readonly KeyConstant[];
  /** Places a string literal is used directly as a property key: unreadable to this guard. */
  readonly literalKeyUses: readonly string[];
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

function isStringish(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** True for any node that opens a function body: declarations, expressions, arrows, methods. */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isAccessorCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ACCESSOR_METHODS.has(node.expression.name.text)
  );
}

/** Scans one file's text; used on the real tree and by the synthetic proofs below. */
function scanSource(file: string, text: string): FileScan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  // Pass 1: every function that (directly or through a nested closure) calls a settings accessor.
  // A literal key is only suspect inside one of those: a validator reading a field of a stored
  // value (`candidate['knownConceptNames']`) sits outside them and names no top-level key.
  const accessorScopes = new Set<ts.Node>();
  let isAccessor = false;
  const findAccessors = (node: ts.Node): void => {
    if (isAccessorCall(node)) {
      isAccessor = true;
      for (let up: ts.Node | undefined = node.parent; up !== undefined; up = up.parent) {
        if (isFunctionLike(up)) accessorScopes.add(up);
      }
    }
    ts.forEachChild(node, findAccessors);
  };
  findAccessors(source);
  const inAccessorScope = (node: ts.Node): boolean => {
    for (let up: ts.Node | undefined = node.parent; up !== undefined; up = up.parent) {
      if (accessorScopes.has(up)) return true;
    }
    return false;
  };

  // Pass 2: key constants anywhere in the file; literal key uses inside accessor scopes.
  const keyConstants: KeyConstant[] = [];
  const literalKeyUses: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /_KEY$/.test(node.name.text) &&
      node.initializer !== undefined &&
      isStringish(node.initializer)
    ) {
      keyConstants.push({ name: node.name.text, value: node.initializer.text, line: lineOf(node) });
    }
    if (inAccessorScope(node)) {
      if (ts.isElementAccessExpression(node) && isStringish(node.argumentExpression)) {
        literalKeyUses.push(
          `${file}:${lineOf(node)} [${JSON.stringify(node.argumentExpression.text)}]`,
        );
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
        isStringish(node.left)
      ) {
        literalKeyUses.push(`${file}:${lineOf(node)} ${JSON.stringify(node.left.text)} in ...`);
      }
      if (ts.isComputedPropertyName(node) && isStringish(node.expression)) {
        literalKeyUses.push(`${file}:${lineOf(node)} {[${JSON.stringify(node.expression.text)}]}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { file, isAccessor, keyConstants, literalKeyUses };
}

/** Keys an accessor file declares that the manifest does not classify. */
function unclassifiedKeys(scan: FileScan): string[] {
  return scan.keyConstants
    .filter((constant) => settingsKeyEntry(constant.value) === undefined)
    .map((constant) => `${scan.file}:${constant.line} ${constant.name} = '${constant.value}'`);
}

const ACCESSORS: readonly FileScan[] = sourceFiles(SRC_DIR)
  .map((absolute) =>
    scanSource(
      relative(PLUGIN_DIR, absolute).split('\\').join('/'),
      readFileSync(absolute, 'utf8'),
    ),
  )
  .filter((scan) => scan.isAccessor && !PASS_THROUGH_FILES.has(scan.file));

describe('F7.4 settings coverage guard: every settings key is classified (ol-egov.141.8.11, D-393)', () => {
  it('the scan reads real stores, not nothing (a blind scanner would pass the next test vacuously)', () => {
    const files = new Set(ACCESSORS.map((scan) => scan.file));
    expect(files).toContain('src/worker/config-store.ts');
    expect(files).toContain('src/usage/log-store.ts');
    expect(files).toContain('src/grove/ground-streak-store.ts');
    expect(ACCESSORS.flatMap((scan) => scan.keyConstants).length).toBeGreaterThanOrEqual(
      SETTINGS_KEY_MANIFEST.length,
    );
  });

  it('every key a store declares has a classification in the manifest', () => {
    // A failure here means a store reads or writes a settings key F7.4 does not know about: the
    // full delete would leave it and the export would miss it. Classify it in
    // SETTINGS_KEY_MANIFEST (src/privacy/data-manifest.ts); data-manifest.spec.ts then proves the
    // delete and the export treat it by its classification.
    expect(ACCESSORS.flatMap(unclassifiedKeys)).toEqual([]);
  });

  it('every settings accessor declares its key as a named _KEY constant', () => {
    const keyless = ACCESSORS.filter((scan) => scan.keyConstants.length === 0).map(
      (scan) => scan.file,
    );
    // Name the key as `export const <STORE>_STORAGE_KEY = '<key>'`, as every store does today, or
    // add the file to PASS_THROUGH_FILES above if it truly owns no key.
    expect(keyless).toEqual([]);
  });

  it('no settings accessor names a key as a bare string literal the scan cannot classify', () => {
    expect(ACCESSORS.flatMap((scan) => scan.literalKeyUses)).toEqual([]);
  });

  it('every manifest entry is still a key some store declares (no stale entry)', () => {
    const declared = new Set(ACCESSORS.flatMap((scan) => scan.keyConstants.map((c) => c.value)));
    const stale = SETTINGS_KEY_MANIFEST.map((entry) => entry.key).filter(
      (key) => !declared.has(key),
    );
    expect(stale).toEqual([]);
  });

  it('every manifest key is listed once', () => {
    const keys = SETTINGS_KEY_MANIFEST.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The acceptance's "proved by adding one", kept as a standing test: a store with a new key and
  // no classification is reported by exactly the check above that guards the real tree.
  it('a new store with an unclassified key is reported (synthetic proof)', () => {
    const scan = scanSource(
      'src/synthetic/new-store.ts',
      [
        "export const SYNTHETIC_NEW_STORE_STORAGE_KEY = 'syntheticNewStore';",
        'export class SyntheticStore {',
        '  constructor(private readonly host: { loadData(): Promise<unknown> }) {}',
        '  async load() {',
        '    const blob = await this.host.loadData();',
        '    return (blob as Record<string, unknown>)[SYNTHETIC_NEW_STORE_STORAGE_KEY];',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(scan.isAccessor).toBe(true);
    expect(unclassifiedKeys(scan)).toEqual([
      "src/synthetic/new-store.ts:1 SYNTHETIC_NEW_STORE_STORAGE_KEY = 'syntheticNewStore'",
    ]);
  });

  it('a store naming its key as a bare literal is reported (synthetic proof)', () => {
    const scan = scanSource(
      'src/synthetic/literal-store.ts',
      [
        'export async function save(host: { loadData(): Promise<unknown>; saveData(d: unknown): Promise<void> }) {',
        '  const blob = (await host.loadData()) as Record<string, unknown>;',
        "  blob['syntheticLiteral'] = 1;",
        '  await host.saveData(blob);',
        '}',
      ].join('\n'),
    );
    expect(scan.keyConstants).toEqual([]);
    expect(scan.literalKeyUses).toEqual(['src/synthetic/literal-store.ts:3 ["syntheticLiteral"]']);
  });
});
