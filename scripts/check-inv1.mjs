#!/usr/bin/env node
// INV-1 — no `obsidian` import outside packages/plugin. Ever. (plan §0.5, A2.1/A2.2)
//
// This is CI's enforcement layer for INV-1 (the other layer is Biome's
// `noRestrictedImports` override in biome.json for packages/core and
// packages/contracts — belt and suspenders, per plan §1.2: "if Biome's rule
// proves insufficient, a 10-line grep is an acceptable enforcement").
//
// Usage:
//   node scripts/check-inv1.mjs            scan the default set: every
//                                           package under packages/ except
//                                           packages/plugin (this is what CI
//                                           calls; must exit 0 on a clean tree)
//   node scripts/check-inv1.mjs <dir>       scan only <dir> (relative to the
//                                           repo root, or absolute) — used by
//                                           packages/core/test/inv1.probe.spec.ts
//                                           to point the checker at the
//                                           deliberately-poisoned probe fixture
//
// Exit code 0  = no `obsidian` imports found (clean).
// Exit code 1  = one or more `obsidian` imports found outside packages/plugin.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename)); // scripts/check-inv1.mjs -> repo root

// Directories never walked, anywhere: build output, vcs, deps, and the
// deliberately-poisoned INV-1 probe fixture (see the fixture file itself for
// why it's safe to always skip by name here).
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'inv1-probe']);

const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts)$/;

// Matches `from 'obsidian'`, `from "obsidian"`, `require('obsidian')`,
// `require("obsidian")`, and dynamic `import('obsidian')`.
const OBSIDIAN_IMPORT_RE = /(?:from\s+|require\(\s*|import\(\s*)['"]obsidian['"]/;

function collectSourceFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // dir doesn't exist — nothing to scan
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectSourceFiles(join(dir, entry.name), acc);
    } else if (entry.isFile() && SOURCE_EXT_RE.test(entry.name)) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function defaultScanRoots() {
  const packagesDir = join(repoRoot, 'packages');
  let entries;
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'plugin')
    .map((e) => join(packagesDir, e.name));
}

function findOffenders(roots) {
  const offenders = [];
  for (const root of roots) {
    for (const file of collectSourceFiles(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (OBSIDIAN_IMPORT_RE.test(line)) {
          offenders.push({
            file: relative(repoRoot, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }
  }
  return offenders;
}

const argRoot = process.argv[2];
const roots = argRoot ? [resolve(repoRoot, argRoot)] : defaultScanRoots();

const offenders = findOffenders(roots);
const scannedLabel =
  roots.map((r) => relative(repoRoot, r) || '.').join(', ') || '(no packages found)';

if (offenders.length > 0) {
  console.error('INV-1 VIOLATION: `obsidian` may only be imported from packages/plugin.\n');
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  console.error(
    `\n${offenders.length} offending import(s) in ${new Set(offenders.map((o) => o.file)).size} file(s). ` +
      'Move this code into packages/plugin, or remove the import.',
  );
  process.exit(1);
} else {
  console.log(
    `INV-1 OK — no \`obsidian\` imports found outside packages/plugin. (scanned: ${scannedLabel})`,
  );
  process.exit(0);
}
