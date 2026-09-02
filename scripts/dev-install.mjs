#!/usr/bin/env node

// dev-install.mjs — install the built plugin (main.js, manifest.json, styles.css) into a
// throwaway local Obsidian vault, for real-Obsidian dev/QA that the workbench cannot exercise.
//
// ==============================================================================================
// WHY THIS EXISTS (ol-ppxj.10, olea-service beads database)
// ==============================================================================================
// The workbench is a browser substitute; it cannot exercise INV-2 (byte-identical vault
// round-trips) or real editor behaviour, and the 108-scenario @manual pre-ship checklist
// (`pnpm run checklist:manual`, olea-service) needs somewhere to actually run. Before this
// script there was no path from a local build into a real Obsidian instance short of BRAT,
// which requires a cut release (see docs/dev/brat.md) — too slow for iterating on an unreleased
// change. This script is the direct-copy / symlink route for that loop.
//
// ==============================================================================================
// USAGE
// ==============================================================================================
//   node scripts/dev-install.mjs <vault-dir> [--symlink|--copy] [--build]
//
//   <vault-dir>   Path to a THROWAWAY local Obsidian vault (any directory Obsidian can open as
//                 a vault). Never a vault that matters — see the refusal checks below.
//   --copy        Copy the three build artifacts into the vault (default).
//   --symlink     Symlink them instead — see docs/dev/real-obsidian-dev-loop.md for the
//                 copy-vs-symlink trade-offs (hot reload, Windows, Sync).
//   --build       Run `pnpm --filter olea-plugin build` first, so the artifacts are current.
//
// Idempotent: re-running updates the three artifacts and never duplicates or clobbers other
// entries in community-plugins.json.
//
// ==============================================================================================
// SAFETY: THIS NEVER TOUCHES A VAULT THAT MATTERS
// ==============================================================================================
// The target must be a throwaway vault. The script refuses to run if the resolved vault
// directory is:
//   1. inside this repo (olea), or
//   2. inside the sibling private repo (olea-service, resolved as ../olea-service relative to
//      this repo's root), which includes but is not limited to
//   3. docs/Obsidian-vault-copy under that sibling repo — checked explicitly, in addition to
//      (2), because that real-vault snapshot is exactly the kind of directory an autocomplete
//      or a stale shell history could hand this script by accident, and INV-3/INV-2 both depend
//      on it never being treated as scratch space.
//
// Node built-ins only — no dependency on anything outside the standard library.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename)); // scripts/dev-install.mjs -> repo root
const pluginDir = join(repoRoot, 'packages', 'plugin');

const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

function usage() {
  return [
    'Usage: node scripts/dev-install.mjs <vault-dir> [--symlink|--copy] [--build]',
    '',
    '  <vault-dir>   path to a THROWAWAY local Obsidian vault',
    '  --copy        copy the built artifacts into the vault (default)',
    '  --symlink     symlink them instead',
    '  --build       run `pnpm --filter olea-plugin build` first',
    '',
    'See docs/dev/real-obsidian-dev-loop.md.',
  ].join('\n');
}

function parseArgs(argv) {
  let vaultArg;
  let mode; // 'copy' | 'symlink'
  let build = false;
  for (const arg of argv) {
    // `pnpm run dev:install -- <args>` forwards the `--` separator itself rather than
    // stripping it (verified against pnpm 10.33.0) — ignore it rather than reject it, so both
    // `node scripts/dev-install.mjs <args>` and the pnpm passthrough work identically.
    if (arg === '--') {
      continue;
    }
    if (arg === '--copy' || arg === '--symlink') {
      if (mode && mode !== arg.slice(2)) {
        throw new Error('--copy and --symlink are mutually exclusive.');
      }
      mode = arg.slice(2);
    } else if (arg === '--build') {
      build = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (vaultArg === undefined) {
      vaultArg = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  if (!vaultArg) {
    throw new Error(`Missing <vault-dir>.\n\n${usage()}`);
  }
  return { vaultArg, mode: mode ?? 'copy', build };
}

// True if `child` is `parent` itself or nested under it. Both must already be resolved
// (absolute, no trailing separator) paths.
function isInside(child, parent) {
  return child === parent || child.startsWith(parent + sep);
}

function assertSafeVaultDir(vaultDir) {
  const forbidden = [];
  forbidden.push({ path: repoRoot, label: 'this repo (olea)' });

  const siblingPrivateRepo = resolve(repoRoot, '..', 'olea-service');
  if (existsSync(siblingPrivateRepo)) {
    forbidden.push({ path: siblingPrivateRepo, label: 'the sibling private repo (olea-service)' });
  }
  // Named explicitly, in addition to the whole-repo check above: the real-vault snapshot is the
  // one directory in this project a mistaken path is most likely to point at.
  const realVaultSnapshot = join(siblingPrivateRepo, 'docs', 'Obsidian-vault-copy');
  if (existsSync(realVaultSnapshot)) {
    forbidden.push({
      path: realVaultSnapshot,
      label: 'docs/Obsidian-vault-copy (the real-vault snapshot)',
    });
  }

  for (const { path: forbiddenPath, label } of forbidden) {
    if (isInside(vaultDir, forbiddenPath)) {
      throw new Error(
        `Refusing to install into ${vaultDir}\n` +
          `It is inside ${label} (${forbiddenPath}).\n` +
          'This script only ever installs into a throwaway local Obsidian vault — pick a ' +
          'directory outside both repos.',
      );
    }
  }
}

function readPluginId() {
  const manifestPath = join(pluginDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.id) {
    throw new Error(`${manifestPath} has no "id" field.`);
  }
  return manifest.id;
}

function runBuild() {
  console.log('> pnpm --filter olea-plugin build');
  execFileSync('pnpm', ['--filter', 'olea-plugin', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

function assertArtifactsPresent() {
  const missing = ARTIFACTS.filter((name) => !existsSync(join(pluginDir, name)));
  if (missing.length > 0) {
    throw new Error(
      `Missing build artifact(s) in ${pluginDir}: ${missing.join(', ')}.\n` +
        'Run with --build, or build the plugin first (`pnpm --filter olea-plugin build`).',
    );
  }
}

// Removes whatever is at `dest` (file or symlink — including a *dangling* symlink, which
// `existsSync` would report as absent because it follows the link), so both copy and symlink
// modes can write a fresh destination unconditionally.
function clearDest(dest) {
  if (pathExistsOrIsLink(dest)) {
    rmSync(dest, { force: true });
  }
}

function pathExistsOrIsLink(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function installArtifacts(destDir, mode) {
  mkdirSync(destDir, { recursive: true });
  const actions = [];
  for (const name of ARTIFACTS) {
    const src = join(pluginDir, name);
    const dest = join(destDir, name);
    clearDest(dest);
    if (mode === 'symlink') {
      symlinkSync(src, dest);
      actions.push(`symlinked ${dest} -> ${src}`);
    } else {
      copyFileSync(src, dest);
      actions.push(`copied ${src} -> ${dest}`);
    }
  }
  return actions;
}

// Writes/updates <vault>/.obsidian/community-plugins.json to enable `pluginId`, without
// clobbering any other entry. Idempotent: a second run is a no-op if the id is already present.
function enablePlugin(obsidianDir, pluginId) {
  mkdirSync(obsidianDir, { recursive: true });
  const listPath = join(obsidianDir, 'community-plugins.json');
  let list = [];
  if (existsSync(listPath)) {
    const raw = readFileSync(listPath, 'utf8').trim();
    if (raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
        throw new Error(
          `${listPath} is not a JSON array of plugin ids — refusing to overwrite it.`,
        );
      }
      list = parsed;
    }
  }
  if (list.includes(pluginId)) {
    return { path: listPath, changed: false, list };
  }
  const updated = [...list, pluginId];
  writeFileSync(listPath, `${JSON.stringify(updated, null, 2)}\n`);
  return { path: listPath, changed: true, list: updated };
}

function main() {
  const { vaultArg, mode, build } = parseArgs(process.argv.slice(2));
  const vaultDir = resolve(process.cwd(), vaultArg);

  assertSafeVaultDir(vaultDir);

  if (build) {
    runBuild();
  }
  assertArtifactsPresent();

  const pluginId = readPluginId();
  const destDir = join(vaultDir, '.obsidian', 'plugins', pluginId);
  const wasNewVault = !existsSync(vaultDir);
  mkdirSync(vaultDir, { recursive: true });

  const actions = installArtifacts(destDir, mode);
  const { path: listPath, changed, list } = enablePlugin(join(vaultDir, '.obsidian'), pluginId);

  console.log(`Plugin id: ${pluginId}`);
  console.log(`Mode: ${mode}`);
  if (wasNewVault) {
    console.log(`Created vault directory: ${vaultDir} (did not previously exist)`);
  }
  console.log(`Plugin directory: ${destDir}`);
  for (const action of actions) {
    console.log(`  ${action}`);
  }
  if (changed) {
    console.log(`Enabled "${pluginId}" in ${listPath}`);
  } else {
    console.log(`"${pluginId}" already enabled in ${listPath}`);
  }
  console.log(`community-plugins.json now: ${JSON.stringify(list)}`);
  console.log('');
  console.log('Open this vault in Obsidian and reload the plugin (see');
  console.log('docs/dev/real-obsidian-dev-loop.md) to pick up the installed build.');
}

try {
  main();
} catch (err) {
  console.error(`dev-install: ${err.message}`);
  process.exit(1);
}
