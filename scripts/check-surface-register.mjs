#!/usr/bin/env node

// check-surface-register.mjs — every user-visible affordance this plugin registers with
// Obsidian must be a row in the surface register, citing the contract clause(s) that permit it.
//
// ==============================================================================================
// WHY THIS EXISTS (the `ol-odb0` incident, olea-service beads database)
// ==============================================================================================
// Wave-2 round-2 shipped a command-palette entry, "Olea: Draft cards for a concept", opening a
// modal that let the student ask Olea to draft cards on request. The functional scope's F4.5
// rules out exactly this by name: "The draft verb is withdrawn — there is no 'Draft 6?' —
// because Olea is already drafting" (unbounded automatic generation, `[D-063]`). David caught it
// the same day it shipped; the command and its modal were deleted. `check-wiring-register.mjs`
// (this script's sibling) already checks that a declared surface is REACHABLE; nothing checked
// that a reachable surface is PERMITTED. This script is that second, independent question, made
// mechanical rather than left to someone remembering to re-read the functional scope before
// adding a command.
//
// Modelled on `check-wiring-register.mjs` — same cross-repo register pattern, same
// completeness/resolvability shape — but DELIBERATELY WITHOUT a KNOWN_FINDINGS ratchet. This
// surface is small (six commands, four views, zero modals as of this writing) and additions are
// rare; a carve-out list here would only ever hide the next mistake, never track a real backlog
// of accepted debt the way the wiring register's does. A new, unregistered surface simply fails.
//
// ==============================================================================================
// WHAT COUNTS AS A SURFACE
// ==============================================================================================
//   1. COMMANDS — every `export const OLEA_COMMAND_<NAME> = '<id>';` line in
//      `packages/plugin/src/commands/ids.ts`.
//   2. VIEWS — every `export const VIEW_TYPE_OLEA_<NAME> = '<id>';` line anywhere under
//      `packages/plugin/src` (never `dist/`, `*.spec.ts`, `*.test.ts`, `test/**`) THAT IS ALSO
//      passed to a `this.registerView(` call in `packages/plugin/src/main.ts` — a view type
//      declared but never registered is not a live surface, and requiring actual registration
//      means a future declared-but-unregistered constant does not force a register row it does
//      not yet need.
//   3. MODALS — every `class <Name> extends Modal` declaration anywhere under
//      `packages/plugin/src` (same exclusions). None exist today; the scan stays live so a
//      reintroduced modal cannot ship without a row.
//
// The regex below is syntactic (source-text matching), the same trade-off
// `check-wiring-register.mjs` and `check-inv1.mjs` both make.
//
// ==============================================================================================
// THE REGISTER — docs/dev/surface-register.md, PRIVATE repo (olea-service)
// ==============================================================================================
// Same reasoning as `check-wiring-register.mjs`: the register cites the functional scope's
// clause numbers and section titles, which is private design detail; the checker stays here
// because what it scans (`packages/plugin/src`) is here.
//
// SAME CROSS-REPO LIMITATION AS `check-wiring-register.mjs`, HANDLED DIFFERENTLY ON PURPOSE. The
// register is read via a relative `../olea-service/docs/dev/surface-register.md` path off the
// repo root — the identical pattern `check-wiring-register.mjs` uses for its own register. That
// resolves in any workspace where both repos are cloned as siblings (this dev workspace
// included) and NEVER resolves in this repo's own hosted CI, verified against
// `.github/workflows/ci.yml`: no step anywhere checks out `olea-service` alongside `olea`, in
// this job or any other. `check-wiring-register.mjs` hard-fails (exit 2) when its register is
// missing, full stop, regardless of why. Copying that here would make this BRAND NEW gate
// permanently red in the one CI environment it actually runs in, for a reason unrelated to
// anything it checks — so this script's `main()` treats a missing register at the DEFAULT path
// (never an explicitly-passed `--register`) as a loud, logged SKIP (exit 0), the same posture
// `check-inv3.mjs` takes for its own missing-input case (an unset `INV3_MARKERS` secret). See
// `main()`'s own comment at that branch for the full reasoning, and
// `docs/dev/surface-register.md`'s "Scope note" in the private repo, which authorises exactly
// this handling rather than vendoring a duplicate copy of the register into this repo.
// `--register <path>` lets any workspace point this script at a copy directly, in which case a
// missing file is a real, hard error (a typo, not an environment gap) and is treated as one.
//
// ==============================================================================================
// WHAT ELSE IS CHECKED, BESIDES COMPLETENESS
// ==============================================================================================
//   - STALENESS (the other direction): a register row naming an id/class the scan no longer
//     finds in source is reported too — a renamed or removed surface whose row nobody deleted.
//   - "Registered at" file:line RESOLVABILITY: the cited file exists, the line is in range, and
//     the line mentions the row's id/class name — same content-match discipline
//     `check-wiring-register.mjs` applies to its "Defined at" column.
//   - CONTRACT CLAUSE RESOLVABILITY: every `F<n>.<m>` token in the "Contract clause(s)" column
//     must appear somewhere in `docs/Olea_alpha_functional_scope.md` — citing a clause that does
//     not exist (a typo, or a clause renumbered out from under the row) fails exactly the way an
//     unresolvable `[D-076]` citation fails `check:foundationcitations` one repo over.
//
// ==============================================================================================
// EXIT CODES
//   0  every scanned surface has a register row, every register row's surface still exists, and
//      every citation (file:line and contract clause) resolves — OR the register is missing at
//      its DEFAULT (unspecified) path, logged as a loud warning (this repo's own hosted CI)
//   1  a real mismatch: a new surface with no row, a stale row, or an unresolvable citation
//   2  could not run honestly: an EXPLICITLY-PASSED `--register` missing/empty/unparseable,
//      functional scope doc missing, zero surfaces scanned, or a bad CLI argument
//
// Usage:
//   node scripts/check-surface-register.mjs
//   node scripts/check-surface-register.mjs --repo-root <dir> --register <path> --scope-doc <path>
//
// SKIP_SURFACE_REGISTER=1  emergency bypass only. Prints a banner naming itself so a bypassed
//   run is never mistaken for a clean one.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const defaultRepoRoot = dirname(scriptsDir);

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    repoRoot: defaultRepoRoot,
    registerPath: null,
    scopeDocPath: null,
    registerPathIsDefault: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo-root') {
      opts.repoRoot = resolve(argv[++i] ?? '');
    } else if (a === '--register') {
      opts.registerPath = resolve(argv[++i] ?? '');
      opts.registerPathIsDefault = false;
    } else if (a === '--scope-doc') {
      opts.scopeDocPath = resolve(argv[++i] ?? '');
    } else {
      console.error(`check-surface-register: unknown argument '${a}'`);
      process.exit(2);
    }
  }
  if (!opts.registerPath) {
    opts.registerPath = join(
      opts.repoRoot,
      '..',
      'olea-service',
      'docs',
      'dev',
      'surface-register.md',
    );
  }
  if (!opts.scopeDocPath) {
    opts.scopeDocPath = join(
      opts.repoRoot,
      '..',
      'olea-service',
      'docs',
      'Olea_alpha_functional_scope.md',
    );
  }
  return opts;
}

// ------------------------------------------------------------------------------------------
// THE SOURCE SCAN
// ------------------------------------------------------------------------------------------

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'test']);

function collectTsFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectTsFiles(join(dir, entry.name), acc);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue;
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function pluginSrcRoot(repoRoot) {
  return join(repoRoot, 'packages', 'plugin', 'src');
}

/** `{name -> {id, file, line}}` for every `export const OLEA_COMMAND_* = '...'` under `commands/ids.ts`. */
function scanCommands(repoRoot) {
  const idsFile = join(pluginSrcRoot(repoRoot), 'commands', 'ids.ts');
  const found = new Map();
  if (!existsSync(idsFile)) return found;
  const lines = readFileSync(idsFile, 'utf8').split('\n');
  const re = /^export const (OLEA_COMMAND_[A-Z0-9_]+)\s*=\s*'([^']+)';/;
  lines.forEach((lineText, idx) => {
    const m = re.exec(lineText);
    if (!m) return;
    found.set(m[2], { constName: m[1], file: relative(repoRoot, idsFile), line: idx + 1 });
  });
  return found;
}

/** Every `export const VIEW_TYPE_OLEA_* = '...'` anywhere under `packages/plugin/src`. */
function scanDeclaredViewTypes(repoRoot) {
  const found = new Map();
  const re = /^export const (VIEW_TYPE_OLEA_[A-Z0-9_]+)\s*=\s*'([^']+)';/;
  for (const file of collectTsFiles(pluginSrcRoot(repoRoot))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((lineText, idx) => {
      const m = re.exec(lineText);
      if (!m) return;
      found.set(m[2], { constName: m[1], file: relative(repoRoot, file), line: idx + 1 });
    });
  }
  return found;
}

/** The subset of `declaredViewTypes` actually passed to `this.registerView(` in `main.ts`,
 * annotated with the file:line of the CONSTANT NAME as it appears inside that call (not the
 * `registerView(` token itself, and not the declaration) — that is the line the register's
 * "Registered at" column cites. Matched against the WHOLE FILE TEXT rather than line-by-line,
 * because `registerView(` and its `VIEW_TYPE_OLEA_*` argument sit on separate source lines
 * (`this.registerView(\n  VIEW_TYPE_OLEA_REVIEW,\n  ...)`) — `\s` in the regex below spans that
 * newline, which a per-line test cannot see at all. */
function scanRegisteredViews(repoRoot, declaredViewTypes) {
  const mainFile = join(pluginSrcRoot(repoRoot), 'main.ts');
  const found = new Map();
  if (!existsSync(mainFile)) return found;
  const text = readFileSync(mainFile, 'utf8');
  for (const [id, decl] of declaredViewTypes) {
    const re = new RegExp(`registerView\\(\\s*(${decl.constName})\\b`);
    const m = re.exec(text);
    if (!m) continue; // declared, never registered — not a live surface
    const constNameOffset = m.index + m[0].lastIndexOf(decl.constName);
    const line = text.slice(0, constNameOffset).split('\n').length;
    found.set(id, { constName: decl.constName, file: relative(repoRoot, mainFile), line });
  }
  return found;
}

/** `{className -> {file, line}}` for every `class X extends Modal` under `packages/plugin/src`. */
function scanModals(repoRoot) {
  const found = new Map();
  const re = /^export class ([A-Za-z0-9_]+) extends Modal\b/;
  for (const file of collectTsFiles(pluginSrcRoot(repoRoot))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((lineText, idx) => {
      const m = re.exec(lineText);
      if (!m) return;
      found.set(m[1], { file: relative(repoRoot, file), line: idx + 1 });
    });
  }
  return found;
}

// ------------------------------------------------------------------------------------------
// THE REGISTER PARSER
// ------------------------------------------------------------------------------------------

const ID_ROW_RE = /^\|\s*`([^`]+)`\s*\|/;
const FILE_LINE_RE = /`([^`\s]+\.tsx?):(\d+)`/;
const CLAUSE_TOKEN_RE = /F\d+\.\d+/g;

/** Splits a markdown table row into trimmed cells. Assumes the row starts and ends with `|`. */
function splitRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/**
 * Parses every table ROW (not header/separator) whose first cell is a backticked id/class name,
 * anywhere in the register — the three tables (Commands, Registered views, Modals) share the
 * same column shape (Id, label, Registered-at, Contract clause(s), Notes), so one pass over the
 * whole document is sufficient; there is nothing that requires knowing which section a row is in.
 */
function parseRegister(text) {
  const lines = text.split('\n');
  const rows = [];
  lines.forEach((lineText, idx) => {
    const idMatch = ID_ROW_RE.exec(lineText);
    if (!idMatch) return;
    const cells = splitRow(lineText);
    if (cells.length < 4) {
      throw new Error(
        `line ${idx + 1}: row for '${idMatch[1]}' has ${cells.length} cell(s), expected at least 4 (Id, label, Registered at, Contract clause(s))`,
      );
    }
    const registeredAtCell = cells[2];
    const clauseCell = cells[3];
    const fileLineMatch = FILE_LINE_RE.exec(registeredAtCell);
    if (!fileLineMatch) {
      throw new Error(
        `line ${idx + 1}: row for '${idMatch[1]}' — "Registered at" has no \`file:line\``,
      );
    }
    const clauseTokens = [...clauseCell.matchAll(CLAUSE_TOKEN_RE)].map((m) => m[0]);
    if (clauseTokens.length === 0) {
      throw new Error(
        `line ${idx + 1}: row for '${idMatch[1]}' cites no F<n>.<m> contract clause`,
      );
    }
    rows.push({
      lineNo: idx + 1,
      id: idMatch[1],
      registeredAt: { file: fileLineMatch[1], line: Number(fileLineMatch[2]) },
      clauseTokens,
    });
  });
  if (rows.length === 0) {
    throw new Error('no table row with a backticked id in its first cell was found');
  }
  return rows;
}

// ------------------------------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------------------------------

function main() {
  if (process.env.SKIP_SURFACE_REGISTER === '1') {
    console.log(
      '::warning::check-surface-register SKIPPED via SKIP_SURFACE_REGISTER=1. ' +
        'Emergency bypass only — this proves nothing about surface completeness this run.',
    );
    process.exit(0);
  }

  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.registerPath)) {
    if (opts.registerPathIsDefault) {
      // UNLIKE check-wiring-register.mjs's hard fail-closed on a missing register, this is a
      // DELIBERATE soft-skip, and only for the DEFAULT (unspecified) path — an explicit
      // `--register` that doesn't resolve (used by every fixture in this script's own test) is
      // still a hard error just below. Verified empirically against this repo's real
      // `.github/workflows/ci.yml`: there is no step anywhere that checks out `olea-service`
      // alongside `olea`, in this job or any other, so the default `../olea-service/...` path
      // NEVER resolves in this repo's own hosted CI — not a rare edge case, the guaranteed case.
      // check-wiring-register.mjs's identical default path has the same property and hard-fails
      // on it regardless (see that script's own module doc, "REACHABILITY" section, which
      // documents the sibling-checkout gap only for its live `bd` task-status query, never for
      // the register file's existence). Copying that shape here would make this brand-new gate
      // permanently red in the one CI environment it will actually run in — the N-013 failure
      // this project's own charter warns against, just inverted: not a check that cannot fail,
      // but one that cannot succeed, for a reason that has nothing to do with what it verifies.
      // So: warn loudly (same posture check-inv3.mjs takes for its own missing-input case, an
      // unset INV3_MARKERS secret) and pass, rather than block every PR in the public repo on an
      // environment gap this bead did not create and was explicitly authorised to work around
      // (see this repo's olea-service counterpart, docs/dev/surface-register.md, "Scope note").
      console.log(
        '::warning::check-surface-register: register not found at the default path ' +
          `(${opts.registerPath}) — this repo's own CI has no sibling ../olea-service checkout, ` +
          'so this is expected here, not a defect. Skipping with a WARNING rather than failing ' +
          'the build on an environment gap this check cannot close. Run this locally in a ' +
          'workspace with both repos cloned as siblings for the real check, or pass ' +
          '--register <path> to point at a copy directly.',
      );
      process.exit(0);
    }
    console.error(`check-surface-register: register not found at ${opts.registerPath}`);
    process.exit(2);
  }
  const registerText = readFileSync(opts.registerPath, 'utf8');
  if (registerText.trim().length === 0) {
    console.error(`check-surface-register: register at ${opts.registerPath} is empty`);
    process.exit(2);
  }

  let rows;
  try {
    rows = parseRegister(registerText);
  } catch (err) {
    console.error(`check-surface-register: UNPARSEABLE register — ${err.message}`);
    process.exit(2);
  }
  const registeredIds = new Set(rows.map((r) => r.id));

  const commands = scanCommands(opts.repoRoot);
  const declaredViews = scanDeclaredViewTypes(opts.repoRoot);
  const registeredViews = scanRegisteredViews(opts.repoRoot, declaredViews);
  const modals = scanModals(opts.repoRoot);

  const totalScanned = commands.size + registeredViews.size + modals.size;
  if (totalScanned === 0) {
    console.error(
      'check-surface-register: the scan found ZERO commands, registered views or modals. ' +
        'A guard that finds nothing is blind, not clean — refusing to report success. ' +
        'Check --repo-root and the scan roots in this script.',
    );
    process.exit(2);
  }

  const problems = [];

  // --- Completeness, both directions ---
  const scannedIds = new Set([...commands.keys(), ...registeredViews.keys(), ...modals.keys()]);
  const missing = [...scannedIds].filter((id) => !registeredIds.has(id));
  const stale = [...registeredIds].filter((id) => !scannedIds.has(id));
  if (missing.length > 0) {
    const describe = (id) => {
      const loc = commands.get(id) ?? registeredViews.get(id) ?? modals.get(id);
      return `${id} (${loc.file}:${loc.line})`;
    };
    problems.push(
      `${missing.length} surface(s) found in source but MISSING from the register: ` +
        missing.map(describe).join(', '),
    );
  }
  if (stale.length > 0) {
    problems.push(
      `${stale.length} register row(s) name a surface the scan no longer finds (renamed, ` +
        `removed, or a view declared but never registered): ${stale.join(', ')}`,
    );
  }

  // --- "Registered at" resolvability: cross-check against what the scan itself found, the same
  // "re-derive, don't trust the cited text" discipline `check-wiring-register.mjs`'s caller
  // cross-check applies. A row whose id the scan does not find at all is already reported as
  // STALE above; this loop only re-checks rows the scan DID find, catching a citation that names
  // a real surface but the wrong location for it (a line-shift after an edit, most likely).
  for (const row of rows) {
    const scanned = commands.get(row.id) ?? registeredViews.get(row.id) ?? modals.get(row.id);
    if (!scanned) continue;
    if (scanned.file !== row.registeredAt.file || scanned.line !== row.registeredAt.line) {
      problems.push(
        `'${row.id}' "Registered at" cites ${row.registeredAt.file}:${row.registeredAt.line}, ` +
          `but the scan finds it at ${scanned.file}:${scanned.line} — the citation is stale`,
      );
    }
  }

  // --- Contract clause resolvability ---
  if (!existsSync(opts.scopeDocPath)) {
    console.error(
      `check-surface-register: functional scope doc not found at ${opts.scopeDocPath} — cannot verify contract clause citations`,
    );
    process.exit(2);
  }
  const scopeDocText = readFileSync(opts.scopeDocPath, 'utf8');
  for (const row of rows) {
    for (const token of row.clauseTokens) {
      if (!scopeDocText.includes(token)) {
        problems.push(
          `'${row.id}' cites contract clause '${token}', which does not appear anywhere in ` +
            `${relative(opts.repoRoot, opts.scopeDocPath)} — the citation is wrong, stale, or the clause was renumbered`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error('check-surface-register: register does not match the source tree.\n');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `check-surface-register: OK — ${rows.length} register row(s), ${commands.size} command(s), ` +
      `${registeredViews.size} registered view(s), ${modals.size} modal(s), all accounted for.`,
  );
  process.exit(0);
}

main();
