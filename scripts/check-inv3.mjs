#!/usr/bin/env node
// INV-3 — no real student content anywhere in this (public) repo. Ever.
// (plan §0.5 gives the public repo a CI tripwire that scans for markers of
// content already known to be real; this script is that tripwire.)
//
// The marker list is deliberately NOT committed — committing it would mean
// shipping the real course codes/names it exists to catch straight into the
// public repo, defeating the entire point. Instead it comes from the
// INV3_MARKERS repo secret at CI time: a newline- or comma-separated list of
// known real-content strings (course codes, her real note titles, etc.),
// populated by David.
//
// Behaviour (decided by David, see P0-T05 and the session-6 amendment below):
//   - INV3_MARKERS unset or empty: the tripwire has nothing to check for, so
//     it CANNOT be doing its job. Warn loudly (::warning:: + a
//     $GITHUB_STEP_SUMMARY entry) that it is NOT ACTIVE, so an empty
//     tripwire can never be silently mistaken for a passing one. Exit 0 —
//     this is expected until David populates the secret, not a failure.
//     UNLESS --require-markers is passed; see below.
//   - INV3_MARKERS set: scan every file in the repo (excluding .git and
//     node_modules) for a literal substring match on any marker. On any hit,
//     fail the build (exit 1) and print WHICH FILE matched — never the
//     matched marker text itself, so the CI log never becomes a second place
//     the real content leaks.
//   - No hits: exit 0.
//
// --require-markers — FAIL CLOSED (David, 2026-08-10, recorded on
// ol-inv3markers). Warn-and-continue is the right default for CI and the
// wrong one for an upload. The asymmetry is not about how much we trust the
// check; it is about whether the action is reversible:
//
//   - CI scans a repo that is ALREADY PUBLIC. The tripwire there is a
//     regression detector on content that has already been reviewed by a
//     human. A run that cannot check is worse than one that can, but it
//     changes nothing about the world, and blocking every build until a
//     secret exists would just get the check disabled.
//   - An upload/publish path is a ONE-WAY DOOR. Once content crosses into a
//     third-party system it is out of our control, may be cached or indexed,
//     and cannot be recalled by deleting it. "We could not verify, so we
//     proceeded" is not a defensible posture in front of a door that does
//     not open backwards.
//
// So any script or step that pushes repo content OUTWARDS must pass
// --require-markers, and gets exit 1 when the secret is missing. There is
// deliberately no environment-variable equivalent: an env var is inherited
// silently by child processes, which is exactly how a fail-closed path
// quietly becomes a fail-open one.
//
// Usage:
//   INV3_MARKERS="MARKER_ONE,MARKER_TWO" node scripts/check-inv3.mjs
//   ^ deliberately fake. Never write a real marker here: this file lives in the
//     public repo, so a realistic example would leak exactly what the secret
//     exists to keep out of it — and would make this script fail against itself.
//   node scripts/check-inv3.mjs                    # unset -> warns, exits 0
//   node scripts/check-inv3.mjs --require-markers  # unset -> errors, exits 1
//   node scripts/check-inv3.mjs <dir>              # scan only <dir> (testing)
//
// ================================================================================================
// MATCHING (ol-thuc) — mirrors the private repo's scripts/check-bead-text.mjs, with one
// deliberate, explained deviation
// ================================================================================================
// Before ol-thuc this matched with `lineText.includes(marker)`: plain, case-sensitive substring,
// no word boundary. Measured against the real marker set (course codes + note titles + concept
// names) that produced 62 false-positive files in this repo alone — short ordinary-word titles
// landing inside unrelated identifiers (`parseMarkers`, `outline.spec.ts`, a CSS comment, ...).
// A tripwire that fires on the majority of an already-clean repo is a tripwire people learn to
// stop reading, which is a worse outcome than a narrower one that stays credible.
//
// `check-bead-text.mjs` solves the identical problem two ways and both are mirrored here:
//
//   1. WORD-BOUNDARY, CASE-INSENSITIVE, SLUG-FLEXIBLE MATCHING (`markerPattern()` below, copied
//      in shape from check-bead-text.mjs's function of the same name). Bounded on the LEFT only
//      (`(?<![\p{L}\p{N}])`), free on the right, on purpose — check-bead-text.mjs and
//      check-fixture-vocabulary.mjs both document this as deliberate: it catches an inflected
//      form of a marker (a trailing section letter, a possessive, a plural) while still refusing
//      to fire on a marker that is merely a SUFFIX of an unrelated word. Multi-word markers match
//      with `[-_ ]` between words, so a title enters as a slug (`some-title`) as readily as it
//      enters as prose (`some title`).
//
//   2. AN ADVISORY CARVE-OUT for markers that are themselves ordinary English — printed, never
//      failed. THE DEVIATION: check-bead-text.mjs's `ORDINARY_ENGLISH_TITLES` is a hand-curated
//      set of SPECIFIC KNOWN REAL TITLES that a human judged, one at a time, to be ordinary words.
//      That requires knowing the real titles — which is exactly the private information this
//      PUBLIC script must never contain, so that list cannot be copied here, or reconstructed here
//      by any other route (an equivalent-sized curated list assembled by trial and error against
//      this repo would amount to the same leak by a slower path). Instead this script asks a
//      GENERIC version of the same question: is every word making up this marker drawn from
//      ordinary English vocabulary, full stop — never "is this specific string of hers ordinary,"
//      only "is this word, in general, ordinary." `scripts/lib/common-english-words.mjs` is a
//      ~8800-word frequency list built from public English text, containing zero information
//      about any real vault. See that file's header for exactly what it is and isn't.
//
//      This is deliberately looser than a curated list in one direction (it will wave through
//      ordinary phrases nobody specifically vetted) and stricter in the other (an actual course
//      code, a proper noun coined for her material, or anything containing a digit is never in a
//      generic word list — COMMON_ENGLISH_WORDS holds only alphabetic dictionary words, so a
//      digit anywhere in a marker disqualifies it from the carve-out automatically, with no
//      separate digit check needed). The asymmetry is intentional: getting the LEAK boundary right
//      matters more than getting the ADVISORY carve-out's precision right, and every advisory hit
//      is still surfaced in the run's output (file + line, never marker text) rather than silently
//      dropped, so a human reviewing CI output always sees it happened.
//
// Preserved unchanged from before ol-thuc, and load-bearing:
//   * INV3_MARKERS unset/empty still warns "NOT ACTIVE" and exits 0 (unless --require-markers).
//   * The matched marker TEXT is never printed anywhere, for a violation or for an advisory hit —
//     only file + line. A guard that prints the secret it exists to protect defeats itself.
// ================================================================================================

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_ENGLISH_WORDS } from './lib/common-english-words.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename)); // scripts/check-inv3.mjs -> repo root

// Directories never walked, anywhere.
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', 'dist']);

// Extensions that are binary or otherwise not worth (or not safe) reading as
// UTF-8 text. The fixture vault deliberately includes a PDF (F1.6 coverage);
// skip it rather than risk a decode error or a nonsense match.
const SKIP_EXT_RE = /\.(pdf|png|jpe?g|gif|ico|webp|woff2?|ttf|eot|mp3|mp4|zip|map)$/i;

function warnInactive() {
  const message =
    'INV-3 tripwire is NOT ACTIVE — INV3_MARKERS secret is unset or empty. ' +
    'This run did not check for real-content markers. This is expected until ' +
    'David populates the INV3_MARKERS repo secret; it is not a passing check.';
  console.log(`::warning::${message}`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(
        summaryPath,
        `\n> [!WARNING]\n> **INV-3 tripwire NOT ACTIVE** — \`INV3_MARKERS\` secret is unset or empty. This run performed no real-content scan. Populate the secret to activate INV-3 enforcement.\n`,
      );
    } catch (err) {
      console.log(`(could not write GITHUB_STEP_SUMMARY: ${err.message})`);
    }
  }
}

function parseMarkers(raw) {
  return [
    ...new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Left-word-boundary, case-insensitive, `[-_ ]`-flexible between words — the same shape as
 * check-bead-text.mjs's `markerPattern()`. Free on the right edge, deliberately (see the header
 * block above): it catches an inflected/possessive/suffixed form of a marker while refusing to
 * fire when the marker is merely the tail end of an unrelated word.
 */
function markerPattern(term) {
  const parts = term
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(escapeRe);
  if (parts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[-_ ]')}`, 'giu');
}

/**
 * Advisory (never a violation) when every word making up the marker is, taken on its own,
 * ordinary English vocabulary — see the header block above and
 * scripts/lib/common-english-words.mjs for what that list is and is not. A marker containing a
 * digit, or any word not in that generic list (a real course code, a coined proper noun, ...),
 * is never advisory.
 */
function isOrdinaryEnglish(term) {
  const words = term
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => COMMON_ENGLISH_WORDS.has(w.toLowerCase()));
}

function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectFiles(full, acc);
    } else if (entry.isFile()) {
      if (SKIP_EXT_RE.test(entry.name)) continue;
      acc.push(full);
    }
  }
  return acc;
}

function scan(root, markers) {
  // Precompute {marker, pattern, advisory} once — not per line, per file.
  const compiled = markers
    .map((marker) => ({
      marker,
      pattern: markerPattern(marker),
      advisory: isOrdinaryEnglish(marker),
    }))
    .filter((m) => m.pattern !== null);

  const hits = []; // { file, line, advisory } — never marker text
  for (const file of collectFiles(root)) {
    // Skip anything implausibly large to read as text (defensive; the repo
    // has no such files today).
    try {
      if (statSync(file).size > 10 * 1024 * 1024) continue;
    } catch {
      continue;
    }
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable/binary — not a text-content leak vector
    }
    const lines = content.split('\n');
    lines.forEach((lineText, idx) => {
      for (const { pattern, advisory } of compiled) {
        pattern.lastIndex = 0;
        if (pattern.test(lineText)) {
          hits.push({ file: relative(repoRoot, file), line: idx + 1, advisory });
        }
      }
    });
  }
  return hits;
}

const argv = process.argv.slice(2);
const requireMarkers = argv.includes('--require-markers');
const unknownFlags = argv.filter((a) => a.startsWith('--') && a !== '--require-markers');
if (unknownFlags.length > 0) {
  // Refuse rather than ignore. A typo'd `--require-marker` that silently
  // parsed as "no flag" would turn a fail-closed call site into a fail-open
  // one, which is the single worst outcome this script can produce.
  console.error(`check-inv3: unknown flag(s): ${unknownFlags.join(', ')}`);
  process.exit(2);
}
const argRoot = argv.find((a) => !a.startsWith('--'));
const scanRoot = argRoot ? resolve(repoRoot, argRoot) : repoRoot;

const rawMarkers = process.env.INV3_MARKERS ?? '';
const markers = parseMarkers(rawMarkers);

if (markers.length === 0) {
  if (requireMarkers) {
    console.error(
      'INV-3 FAIL-CLOSED: INV3_MARKERS is unset or empty, and --require-markers was passed.\n\n' +
        'This call site pushes repo content outwards (an upload, a publish, a sync into a\n' +
        'third-party system). That is a one-way door: content that crosses it may be cached\n' +
        'or indexed and cannot be recalled by deleting it afterwards. An unverifiable scan\n' +
        'therefore blocks rather than warns.\n\n' +
        'Set INV3_MARKERS (see ol-inv3markers) or, if you have read every file being sent\n' +
        'and are accepting the risk deliberately, do not route it through this script —\n' +
        'record the decision instead. Do not remove --require-markers to get past this.',
    );
    process.exit(1);
  }
  warnInactive();
  process.exit(0);
}

const hits = scan(scanRoot, markers);
const advisoryHits = hits.filter((h) => h.advisory);
const violations = hits.filter((h) => !h.advisory);

if (advisoryHits.length > 0) {
  const byFile = new Map();
  for (const h of advisoryHits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h.line);
  }
  console.log('');
  console.log(
    `INV-3 ADVISORY: ${advisoryHits.length} hit(s) across ${byFile.size} file(s) matched a ` +
      'marker that is also ordinary English (see scripts/lib/common-english-words.mjs). ' +
      'Printed, not failed.',
  );
  for (const [file, lines] of byFile) {
    console.log(`  ${file}  (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})`);
  }
}

if (violations.length > 0) {
  console.error('\nINV-3 VIOLATION: possible real student content found in the public repo.\n');
  console.error('(Matched marker text is intentionally not printed here — see INV3_MARKERS.)\n');
  const byFile = new Map();
  for (const o of violations) {
    if (!byFile.has(o.file)) byFile.set(o.file, []);
    byFile.get(o.file).push(o.line);
  }
  for (const [file, lines] of byFile) {
    console.error(`  ${file}  (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})`);
  }
  console.error(
    `\n${byFile.size} file(s) matched a known real-content marker. Remove or replace with ` +
      'synthetic fixture content before this can merge. If this is a false positive, ' +
      'narrow INV3_MARKERS rather than weakening this check.',
  );
  process.exit(1);
} else {
  console.log(
    `\nINV-3 OK — no known real-content markers found (${markers.length} marker(s) checked).`,
  );
  process.exit(0);
}
