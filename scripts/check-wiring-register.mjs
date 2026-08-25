#!/usr/bin/env node

// check-wiring-register.mjs — the wiring register must describe the real tree, completely, and
// no port whose owning task has already closed may sit with no production caller and no
// documented, cited deferral.
//
// ==============================================================================================
// WHY THIS EXISTS (ol-1ek8, olea-service beads database)
// ==============================================================================================
// Three capabilities were built, tested, and connected to nothing — invisible because every
// component test mocks the port that has no adapter. A survey counted 22 injected ports across
// both repos: 14 wired, 1 wired only to its own connection test, 7 defined with production-
// quality implementations and never instantiated outside a test. Nothing had the job of noticing
// this, because ports-and-adapters defines seams beautifully and says nothing about which get
// plugged in — a component test passes either way.
//
// `docs/dev/wiring-register.md` is the human-authored table. This script is what stops that table
// from rotting into a flattering subset of the truth, the way any hand-maintained inventory does.
// It asserts three separate things, and each can fail independently:
//
//   1. COMPLETENESS. Every port the scan below finds in the source tree is a row in the register,
//      and every row in the register is a port the scan finds. A port present in code and absent
//      from the register is exactly the failure mode this file exists to prevent — the register
//      would otherwise report "16 ports" forever, however many actually exist.
//   2. RESOLVABILITY. Every `file:line` a row cites — where the interface is defined, what
//      implements it, what calls it — is a real location in a real file, right now.
//   3. REACHABILITY. A port whose owning task has closed, that still has no production caller,
//      and that the register does not mark as a cited, deliberate deferral, is a FINDING: the
//      task that claimed to build and wire it is done, and the port is not reachable from
//      anything the product runs. This is the whole point (see the "calibration" note below).
//
// ==============================================================================================
// WHAT COUNTS AS A "PORT" — the completeness rule, stated once, checkably
// ==============================================================================================
// An exported `interface` OR a function-typed exported `type` alias, in `packages/core/src/**`
// or `packages/plugin/src/**` (never `dist/`, `*.spec.ts`, `*.test.ts`, or anything under a
// `test/` directory), whose name ends in one of:
//
//   Port | Store | Provider | Sink | Transport | Caller | Embedder
//
// — i.e. a single named seam with a real-vs-fake implementation, the shape D-042's fallout and
// ol-k57j's transport gap both turned on. Interfaces ending in `Deps` are DELIBERATELY EXCLUDED:
// they are composition-root bags (`EngineDeps { store: QueueStore, capability, runner, clock?,
// random? }`) that bundle several leaf ports plus plain config/data for one call site. Nothing
// "implements" a `*Deps` interface the way something implements a port — the ports named inside
// it are already rows in their own right, and counting the bag too would double-count the same
// wiring question under two names. See `docs/dev/wiring-register.md`'s own header for the same
// rule in prose, and keep the two in sync if either changes.
//
// The regex below is intentionally syntactic (source-text matching, not a TypeScript AST) — the
// same trade-off `check-inv1.mjs` makes for `obsidian` imports. It will miss a port re-exported
// under a different name and will not understand re-declaration through `export { X as Y }`;
// neither pattern exists in this repo today (see this file's own test for what happens when one
// is planted).
//
// ==============================================================================================
// WHAT COUNTS AS A "PRODUCTION CALLER" — added 2026-08-16 after a real false negative
// ==============================================================================================
// FIRST VERSION OF THIS SCRIPT HAD NO ANSWER TO THIS QUESTION AT ALL. It read the register's own
// "Production caller" cell as fact and only checked that a cited `file:line` existed and was in
// range — never whether the cited (or any) location actually calls anything. When `ol-odb0.1`
// landed and genuinely wired `EmbeddingProvider`, `EmbeddingCacheStore` and `KeywordIndexStore`
// (`new WorkerEmbeddingProvider(...)` / `new ObsidianEmbeddingCacheStore(...)` at
// `packages/plugin/src/retrieval/wiring.ts:95`/`:96`, `new ObsidianKeywordIndexStore(this)` at
// `packages/plugin/src/main.ts:256` — a DIRECT construction in the composition root itself, not
// even an indirect one), this script kept reporting all three as findings and exited 0, because
// nobody had also rewritten the register's prose and nothing here would ever have noticed either
// way. A register that cannot see a wiring landing cannot see one being removed either — the
// exact property a ratchet most needs. That is the bug this section, and the code below it, fix.
//
// THE RULE NOW: for a row whose "Production implementation" cell contains at least one backticked
// token that is a bare identifier (not a `file:line` span, not a dotted method reference like
// `OleaPlugin.composeReviewSession`), that token is the row's IMPLEMENTATION SYMBOL. This script
// then scans the SAME production corpus the port-completeness scan uses (`packages/core/src` and
// `packages/plugin/src`, no test/spec files, no `dist/`) for the FIRST line, in ANY file, matching
// `new SYMBOL(` or a bare `SYMBOL(` call — excluding the symbol's own `export function`/`export
// class` declaration line (which would otherwise false-positive on a factory function, since
// `export function createFoo(` textually contains `createFoo(` too). Found anywhere = wired,
// full stop. There is deliberately NO notion of "composition root" hard-coded anywhere in this
// rule — every production file is scanned identically, which is exactly what makes a direct `new
// X()` in `main.ts` and an indirect one three call-frames down inside a `*/wiring.ts` module
// equally detectable (see this file's own regression test, built from the `ol-odb0.1` event,
// which asserts both shapes).
//
// This detected result is then CROSS-CHECKED against the register's own claim, not silently
// substituted for it: if the register says "none" but a call site is found, or the register cites
// a caller but no call site to that symbol exists anywhere, this fails CLOSED (exit 2, "the
// register does not match the source tree") rather than either trusting the stale prose or
// silently overriding it. The register stays the human-readable citation; this makes it
// impossible for that citation to drift from reality without the very next run saying so loudly.
//
// WHAT THIS STILL MISSES, so the limit is documented rather than discovered again the hard way:
//   - Reachability through a STORED REFERENCE rather than a textual call. `WorkerTaskTransport`'s
//     row is detected via `new WorkerHttpTransport(...)` inside `createObsidianWorkerTransport`'s
//     own body (`worker/obsidian-transport.ts`) — proving the FACTORY constructs its product, not
//     that the factory itself is ever invoked from the product. `main.ts` passes
//     `createObsidianWorkerTransport` into `OleaSettingTab` BY REFERENCE (never calls it
//     directly); the settings tab calls it later, by a locally renamed parameter
//     (`this.createTransport(...)`), which this script's text scan cannot trace back to the
//     original name at all. This is why that row's register-cited caller
//     (`settings-tab.ts:167`) and the auto-detected one (`obsidian-transport.ts`) point at
//     DIFFERENT lines — both are real, and this script only requires them to AGREE ON WIRED-OR-
//     NOT (a boolean), never on the exact line, for exactly this reason.
//   - A row whose implementation cell has no plain-identifier token at all (a dotted reference
//     like `OleaPlugin.composeReviewSession`) gets NO cross-check on its CALLER cell — there is
//     no symbol to search for a call site of. Its caller status is register-text-only, same as
//     before this section existed. A row whose implementation cell IS `none` gets a DIFFERENT,
//     separate cross-check instead — see "CAN A 'NONE' CLAIM BE TRUSTED?" below; this bullet is
//     about symbol-shaped implementations specifically.
//   - An implementation supplied as an inline object literal (`{ get: () => ... }`) rather than a
//     named class or factory function is invisible to this scan; nothing here understands
//     structural typing.
//   - A line whose trimmed start is `//`, `*` or `/*` is skipped — added the same day this
//     section was written, because `packages/plugin/src/keyword-index/wiring.ts`'s OWN module
//     doc, describing the `ol-tuvx` diagnosis in prose ("nothing called `new
//     ObsidianKeywordIndexStore(...)`"), false-positived as a real call site the first time this
//     scan ran for real — a comment SAYING a construction never happened matched the same pattern
//     a real construction would. Full-line comments are now excluded; an INLINE trailing comment
//     (`doThing(); // new Foo(...)`) or a string literal containing call-shaped text is not, and
//     remains a documented, unaddressed gap.
//
// ==============================================================================================
// CAN A "NONE" CLAIM BE TRUSTED? — added 2026-08-16, the SECOND false negative the same day
// ==============================================================================================
// The caller cross-check above only falsifies a claim about something the register ALREADY
// NAMES — it scans for the symbol the "Production implementation" cell itself gives it. A row
// whose cell reads `none` names nothing, so there was nothing to falsify: `JudgeCaller`'s row
// said "none — no function of this type exists outside tests", `ol-drfy` landed a real one
// (`createWorkerJudgeCaller`, `packages/core/src/grading/workerJudgeCaller.ts:96`), and this
// script kept reporting it as a finding and exiting 0 — the IDENTICAL trust bug as the caller
// false negative, wearing different clothes: the register can only check claims about things it
// already knows about, and "none" is exactly the claim that names nothing to check.
//
// THE FIX: for a row whose implementation cell IS `none`, scan production source for the PORT
// TYPE NAME itself (not an implementation symbol — there isn't one to name), excluding: the
// row's own declaring file ENTIRELY (not just its declaration line — `gradingPipeline.ts`'s own
// `callJudge: JudgeCaller` parameter, a few lines below `JudgeCaller`'s declaration, PREDATES any
// implementation and must never count, or this would have false-positived on `JudgeCaller` even
// before `ol-drfy` landed); `BARREL_REEXPORT_FILES` (see that constant — `core/src/index.ts`
// re-exports every type in the package regardless of implementation status, so without this
// exclusion the barrel line alone falsifies every "none" claim simultaneously); full-line
// comments (same exclusion as the caller check, for the same reason); and test/spec files
// (already excluded from the production corpus). Any surviving hit means the "none" claim needs
// a human to look again — exit 2, never a silent auto-correction.
//
// SCOPED TO `phaseKind === 'phase'` ROWS, DELIBERATELY. A `deferred` row's "none" carries its own
// citation-based accountability (a human decision, backed by a bead) and is never re-checked
// against source at all, by the same design that already exempts deferred rows from the
// reachability/ratchet check. This is not a hypothetical carve-out: `RerankProvider` is
// `deferred` with implementation `none`, and its port name genuinely IS referenced in production
// — `packages/core/src/retrieval/engine.ts:53`'s `readonly rerank?: RerankProvider;`, an OPTIONAL
// dependency slot nothing fills. Running this exact check against `RerankProvider` before scoping
// it confirmed it would cry wolf on a correct, deliberate deferral — the calibration failure this
// whole tool exists to avoid, just relocated into a second checker. Scoping to `phase` rows only
// is what keeps the new signal honest.
//
// WHAT THIS STILL MISSES: a plain word-boundary match on the type name cannot tell a genuine
// implementation reference from any OTHER legitimate reference to the type outside its own file —
// a Deps bag naming it as an optional field, a second consumer accepting it as a parameter, a
// re-export from a file this list has not yet learned about. It is deliberately blunt: ANY
// surviving hit forces a human to look again, rather than trying to be clever about which hits
// "count" and risking a third silent gap. `BARREL_REEXPORT_FILES` is one specific, named exception
// earned by measurement, not a general "ignore plausible non-implementing references" heuristic —
// widen it by adding another specific file when another barrel is found, not by loosening the rule.
//
// N-013's sharper form, worth stating plainly rather than leaving implicit: this script's own
// fixture tests are NECESSARY, not SUFFICIENT. Every fixture passed, TWICE, including the ones
// built specifically to prove the ratchet's "a known finding gets fixed" direction — and BOTH
// times a real event exercised that direction for the first time, on real data, it did not fire.
// The root cause was identical both times: this script trusted the register's own prose about
// something (a caller location, then an implementation's existence) rather than re-deriving it
// from source. Passing invented fixtures proves a mechanism CAN discriminate; it does not prove
// it WILL, against whatever a real change actually looks like, and it does not prove every
// UNFALSIFIABLE CLAIM SHAPE in the register's vocabulary has been found yet, only the ones this
// file's author has thought to fixture so far. Treat every green run of this file's own test
// suite as evidence about the mechanism, never as evidence the register is currently accurate —
// only running the checker against the real tree tells you that.
//
// ==============================================================================================
// REACHABILITY: "intended phase has passed" — where that signal comes from, and the fallback
// ==============================================================================================
// The register's "Intended phase" column is prose (a plan phase P0–P6, or `deferred` with a
// citation). The pass/fail signal this script actually evaluates is finer-grained and more
// honest than a single global "current phase" cursor: for each row, it reads the "Owning task"
// cell's bead id(s) — the specific task whose evidence column claimed this port would be built
// and wired — and asks whether *that task* has closed. A single global phase cursor was
// considered and rejected: this repo's phase GATES do not close in the order work actually
// lands (Gate G0, for P0 scaffolding, is still open in the beads database while P4 tasks are
// long closed — verified 2026-08-16), so a global cursor would either be wrong immediately or
// need constant hand-maintenance against a gate sequence nobody is actually following. Per-task
// closure is the more precise signal the beads database actually offers.
//
// LIVE SOURCE OF TRUTH: `bd show <id> --json` against the beads database, reached via the
// sibling `../olea-service` checkout (this repo does not carry `.beads/` itself — see this
// repo's own CLAUDE.md, "`bd` does not resolve from this repo"). When that sibling checkout and
// a working `bd` are both present (true in this dev workspace; almost certainly FALSE in this
// public repo's own CI, which checks out only this repo), every row's status comes from a live
// query, made once per unique task id.
//
// HARDCODED FALLBACK, loudly declared, for when the live query is unreachable — CI on this repo
// has no sibling checkout and no beads database, so treating that as a hard failure would make
// this check permanently unrunnable exactly where it would otherwise run every time. As of
// 2026-08-16, per `bd show <id> --json` in `../olea-service`, EVERY owning task cited by
// `docs/dev/wiring-register.md` is CLOSED: ol-p2t08, ol-suspendstate, ol-p3t03, ol-df21a,
// ol-p5t05, ol-p2t01, ol-p2t01a, ol-p4t02, ol-p4t04, ol-p3t05, ol-k57j. THE LIVE QUERY IS THE
// REAL SOURCE OF TRUTH — this snapshot is a fallback for an environment that cannot reach it, not
// a cache; it will silently under-report a task that reopens. Re-verify with
// `bd -C ../olea-service show <id> --json` if this snapshot might be stale. `--task-status` (see
// below) exists precisely so this file's own test does not depend on either the live query or
// this snapshot staying in sync with the real database.
//
// ==============================================================================================
// CALIBRATION — an unwired port whose owning task has NOT closed yet is CORRECT, not a finding
// ==============================================================================================
// A guard that cries wolf gets routed around within a day, and then it reports discipline while
// enforcing none. This script only fails a row for having no caller when its owning task has
// closed (claiming the wiring was delivered) AND the register does not cite a deliberate,
// evidenced deferral (`deferred — [D-xxx] (ol-xxxx): ...`). A `deferred` row is never checked
// against task closure at all — it is exempt by the register's own claim, and this script only
// asserts that the claim carries a citation (a bead id), not that the deferral was wise.
//
// ==============================================================================================
// THE RATCHET (David, 2026-08-16) — KNOWN_FINDINGS, modelled on check-threshold-provenance.mjs's
// KNOWN_GAPS in the sibling repo. Read that file first; this is the same shape.
// ==============================================================================================
// A plain exit-1-on-any-finding checker gets bypassed within a week once real findings exist —
// the exact "cries wolf" failure this whole file exists to avoid. A plain advisory (print and
// exit 0) is worse: an advisory nobody must satisfy is how the five findings below accumulated
// in the first place. The ratchet is the third option: every CURRENTLY KNOWN finding is named,
// dated, and bead-tracked in `KNOWN_FINDINGS` below, and the check passes ONLY when the findings
// this run actually computes are EXACTLY that set — no more, no fewer.
//
//   - A port neither in the register's findings nor in `KNOWN_FINDINGS` needs no action (the
//     ordinary, silent, correct case — most rows, always).
//   - A port the run finds but `KNOWN_FINDINGS` does not name is a NEW finding — fails. Either a
//     fresh regression or a real one nobody has triaged yet; either way it needs a decision, not
//     a silent pass.
//   - A port `KNOWN_FINDINGS` names but the run no longer finds has been FIXED — fails too, with
//     a message naming which entry to delete. This is the property that makes it a ratchet
//     rather than a floor: the list can only ever get harder to satisfy by staying stale, never
//     easier by silently forgiving a fix nobody removed the exemption for.
//
// Every `KNOWN_FINDINGS` entry MUST carry a `followUp` bead id that resolves in the beads
// database — validated at load, unconditionally, before anything else runs. An entry with no
// (or an unresolvable) follow-up is a silent carve-out wearing the shape of a decision, which is
// the exact failure `check-threshold-provenance.mjs`'s identical validation exists to catch. This
// script does NOT verify the id resolves over the network/`bd` at load time (that would make
// every invocation depend on the sibling checkout even when nothing changed) — it validates
// FORMAT only, the same boundary `check-beads-alias-collision.mjs` draws. The three ids below
// were independently verified with `bd show <id>` against `../olea-service` before being added
// here (2026-08-16); re-verify the same way before trusting one that looks unfamiliar.
//
// `--known-findings <json-file>` overrides `KNOWN_FINDINGS` for this file's own test — same
// pattern as `--task-status`, so the ratchet's pass/new/fixed branches are all exercisable
// against invented fixture ports rather than this repo's real ones.
//
// ==============================================================================================
// EXIT CODES
//   0  register complete, every reference resolves, and this run's findings are EXACTLY the
//      `KNOWN_FINDINGS` set — no new finding, no known finding that has quietly disappeared
//   1  the finding set differs from `KNOWN_FINDINGS` in either direction (see above) — a real
//      wiring gap or a stale exemption, not an environment problem
//   2  could not run the check honestly at all: register missing/empty, zero ports found by the
//      scan, an unparseable row, an unresolvable file:line, a bad CLI argument, or a row whose
//      reachability cannot be determined at all (no owning task cited, or task status unknown)
// ==============================================================================================
//
// Usage:
//   node scripts/check-wiring-register.mjs
//   node scripts/check-wiring-register.mjs --repo-root <dir> --register <path>   # test seam
//   node scripts/check-wiring-register.mjs --task-status <json-file>             # test seam:
//       {"ol-xxxx": "closed"} overrides both the live query and the hardcoded fallback, so
//       this script's own test never depends on a real beads database.
//   node scripts/check-wiring-register.mjs --known-findings <json-file>          # test seam:
//       [{"port": "...", "tasks": ["ol-..."], "followUp": "ol-...", "reason": "..."}]
//
// SKIP_WIRING_REGISTER=1  the one bypass. Emergency use only (a broken harness blocking an
//   unrelated change) — never to silence a real finding. Prints a banner naming itself so a
//   bypassed run is never mistaken for a clean one.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const defaultRepoRoot = dirname(scriptsDir); // scripts/check-wiring-register.mjs -> repo root

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    repoRoot: defaultRepoRoot,
    registerPath: null,
    taskStatusPath: null,
    knownFindingsPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo-root') {
      opts.repoRoot = resolve(argv[++i] ?? '');
    } else if (a === '--register') {
      opts.registerPath = resolve(argv[++i] ?? '');
    } else if (a === '--task-status') {
      opts.taskStatusPath = resolve(argv[++i] ?? '');
    } else if (a === '--known-findings') {
      opts.knownFindingsPath = resolve(argv[++i] ?? '');
    } else {
      console.error(`check-wiring-register: unknown argument '${a}'`);
      process.exit(2);
    }
  }
  // The register lives in the PRIVATE repo: it is an architecture map of every injected port,
  // which is design detail this public repo may not carry. The CHECKER stays here because what it
  // scans -- packages/core and packages/plugin -- is here. Private description, public subject.
  if (!opts.registerPath) {
    opts.registerPath = join(opts.repoRoot, '..', 'olea-service', 'docs', 'dev', 'wiring-register.md');
  }
  return opts;
}

// ------------------------------------------------------------------------------------------
// THE RATCHET — KNOWN_FINDINGS. See the module doc's "THE RATCHET" section for the shape and
// why. Every entry's `followUp` was verified with `bd show <id>` against `../olea-service`
// before being added — see each entry's dated comment.
//
// CORRECTED 2026-08-16, TWICE, same root cause both times: this checker trusted the document it
// exists to verify. First correction: this list held five entries; `EmbeddingProvider`,
// `EmbeddingCacheStore` and `KeywordIndexStore` are DELETED here because `ol-odb0.1`/`ol-tuvx`
// (commit `acbaf92`) genuinely wired all three and the caller cross-check (see the module doc's
// "WHAT COUNTS AS A 'PRODUCTION CALLER'" section) now confirms it against source. Second
// correction, same day: `JudgeCaller` is DELETED here too — `ol-drfy` genuinely wired it
// (`createWorkerJudgeCaller`, `packages/core/src/grading/workerJudgeCaller.ts:96`), and the FIRST
// fix did not catch it, because that fix only falsifies a claim about a symbol the register
// already names, and `JudgeCaller`'s row named none. The "CAN A 'NONE' CLAIM BE TRUSTED?" section
// is the fix for that. `MisconceptionEmbedder` was re-verified against it, not assumed still
// correct, and stayed a finding. Third correction, 2026-08-25: `ConceptReaderPort` is DELETED
// here too — `ol-5nle` (EXT-7) genuinely wired it (`WorkerConceptReader`,
// `packages/plugin/src/concept/workerConceptReader.ts:82`, constructed at
// `packages/plugin/src/concept/wiring.ts:102`), closing the D-072 escape hatch this entry named.
// ------------------------------------------------------------------------------------------

const KNOWN_FINDINGS = [
  {
    port: 'MisconceptionEmbedder',
    tasks: ['ol-p4t04'],
    followUp: 'ol-nagi',
    reason:
      'declared seam, no implementation — re-verified 2026-08-16 against findTypeReference: ' +
      'every non-declaration, non-barrel, non-comment occurrence of the port type name is a ' +
      'doc comment; zero real code references',
  },
];

/** Validates `followUp` format on whichever findings list is active (the hardcoded default, or
 * a `--known-findings` test override) — unconditionally, before any register/scan work happens.
 * Format only (see the module doc): this never calls `bd`, so validity here is necessary, not
 * sufficient — an id that is well-formed but does not actually resolve would still pass this and
 * must be caught by a human reading `bd show <id>`, same boundary as check-beads-alias-collision.
 */
function loadKnownFindings(overridePath) {
  const list = overridePath ? JSON.parse(readFileSync(overridePath, 'utf8')) : KNOWN_FINDINGS;
  for (const entry of list) {
    if (!entry || typeof entry.port !== 'string' || entry.port.length === 0) {
      console.error(
        'check-wiring-register: a KNOWN_FINDINGS entry has no valid `port` — refusing to run ' +
          '(cannot ratchet against a list that does not name what it exempts).',
      );
      process.exit(1);
    }
    if (typeof entry.followUp !== 'string' || !/^ol-[A-Za-z0-9.-]+$/.test(entry.followUp)) {
      console.error(
        `check-wiring-register: KNOWN_FINDINGS entry for '${entry.port}' carries no valid ` +
          'follow-up bead id. An exemption with no tracked follow-up is a silent carve-out, ' +
          'not a decision.',
      );
      process.exit(1);
    }
  }
  return list;
}

// ------------------------------------------------------------------------------------------
// THE PORT SCAN
// ------------------------------------------------------------------------------------------

const PORT_NAME_RE = /^[A-Za-z0-9]+(?:Port|Store|Provider|Sink|Transport|Caller|Embedder)$/;
const PORT_DECL_RE = /^export (interface|type) ([A-Za-z0-9]+)\b/;
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

/** Every `export interface X` / `export type X = ...` whose name matches the port-suffix rule,
 * under `packages/core/src` and `packages/plugin/src`. Returns a Map<name, {file, line}> keyed
 * on interface name (relative posix-ish path kept as given by `relative()`). */
function productionScanRoots(repoRoot) {
  return [
    join(repoRoot, 'packages', 'core', 'src'),
    join(repoRoot, 'packages', 'plugin', 'src'),
  ].filter((r) => existsSync(r));
}

function scanPorts(repoRoot) {
  const found = new Map();
  for (const root of productionScanRoots(repoRoot)) {
    for (const file of collectTsFiles(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((lineText, idx) => {
        const m = PORT_DECL_RE.exec(lineText);
        if (!m) return;
        const name = m[2];
        if (!PORT_NAME_RE.test(name)) return;
        if (name.endsWith('Deps')) return; // belt-and-suspenders; PORT_NAME_RE never matches *Deps anyway
        if (!found.has(name)) {
          found.set(name, { file: relative(repoRoot, file), line: idx + 1 });
        }
      });
    }
  }
  return found;
}

/** Every production `.ts`/`.tsx` file across both scan roots — the exact corpus `scanPorts`
 * walks, reused so caller-detection sees precisely the same tree the port scan does. Collected
 * once per run and passed into `findCallSite` per row, rather than re-walking per port. */
function collectAllProductionFiles(repoRoot) {
  const acc = [];
  for (const root of productionScanRoots(repoRoot)) collectTsFiles(root, acc);
  return acc;
}

/** Scans `files` for the first line that CONSTRUCTS or CALLS `symbol` — `new SYMBOL(` or a bare
 * `SYMBOL(` — excluding `symbol`'s own `export function`/`export class` declaration line (which
 * would otherwise false-positive on a factory function: `export function createFoo(` textually
 * contains `createFoo(` too). Returns `{file, line}` (repo-root-relative) or null. See the module
 * doc's "WHAT COUNTS AS A 'PRODUCTION CALLER'" section for the full rule and its known limits —
 * this is a call-SITE detector, not a reachability prover. */
function findCallSite(repoRoot, symbol, files) {
  const declRe = new RegExp(
    `^export\\s+(?:default\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function|class)\\s+${symbol}\\b`,
  );
  const callRe = new RegExp(`(?:\\bnew\\s+${symbol}\\s*\\(|(?<![.\\w])${symbol}\\s*\\()`);
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const lineText = lines[idx];
      const trimmed = lineText.trimStart();
      if (declRe.test(trimmed)) continue;
      if (/^(\/\/|\*|\/\*)/.test(trimmed)) continue; // full-line comment — see the module doc
      if (callRe.test(lineText)) {
        return { file: relative(repoRoot, file), line: idx + 1 };
      }
    }
  }
  return null;
}

/**
 * Files whose SOLE job is re-exporting every type a package declares, whether or not anything
 * implements it — a reference inside one of these proves nothing. Found empirically, the same
 * day as everything else in this section: `packages/core/src/index.ts` is a 670-line barrel with
 * 71 `export type { ... } from '...'` blocks, mechanically re-exporting `JudgeCaller` and
 * `MisconceptionEmbedder` alike, implemented or not — without this exclusion the barrel line
 * alone would falsify EVERY "no implementation" claim simultaneously, on every row, forever.
 * `packages/plugin/src` has no equivalent file today; add one here the day it does.
 */
const BARREL_REEXPORT_FILES = new Set(['packages/core/src/index.ts']);

/** Scans `files` for the first NON-comment line, outside `excludeFiles` (repo-relative paths),
 * that references `portName` as a whole word. `excludeFiles` is always the row's own declaring
 * file(s) plus `BARREL_REEXPORT_FILES` — see the module doc's "CAN A 'NONE' CLAIM BE TRUSTED?"
 * section for why the WHOLE declaring file is excluded, not just its declaration line (a
 * same-file parameter-type reference, e.g. `gradingPipeline.ts`'s own `callJudge: JudgeCaller`
 * a few lines below the type's declaration, predates any implementation and must not count). */
function findTypeReference(repoRoot, portName, excludeFiles, files) {
  const wordRe = new RegExp(`(?<![\\w$])${portName}(?![\\w$])`);
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (excludeFiles.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const trimmed = lines[idx].trimStart();
      if (/^(\/\/|\*|\/\*)/.test(trimmed)) continue; // full-line comment
      if (wordRe.test(lines[idx])) {
        return { file: rel, line: idx + 1 };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------
// THE REGISTER PARSER
// ------------------------------------------------------------------------------------------

const FILE_LINE_RE = /`([^`\s]+\.tsx?):(\d+)`/g;
const BACKTICK_RE = /`([^`]+)`/;
const TASK_ID_RE = /`(ol-[A-Za-z0-9.-]+)`/g;
const IDENTIFIER_TOKEN_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function stripEmphasis(cell) {
  return cell.replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

/** Extracts the row's IMPLEMENTATION SYMBOL from a "Production implementation" cell — the first
 * backticked token that is a bare identifier, i.e. neither a `file:line` span nor a dotted
 * reference (`OleaPlugin.composeReviewSession`). Returns null when the cell has none (a plain
 * "none", or a cell whose only backticked content is a file:line/dotted reference) — see the
 * module doc's "WHAT COUNTS AS A PRODUCTION CALLER" section for what that means downstream. */
function extractImplSymbol(cell) {
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    if (IDENTIFIER_TOKEN_RE.test(m[1])) return m[1];
  }
  return null;
}

/** Splits a markdown table row into cells. Assumes the row starts and ends with `|`, which every
 * row in this register's format does. */
function splitRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  // Cells never contain a literal unescaped pipe in this register (paths and prose don't need
  // one); a plain split is sufficient and keeps this parser simple rather than clever.
  return inner.split('|').map((c) => c.trim());
}

/** Parses `docs/dev/wiring-register.md`'s table into row objects. Throws (with a message
 * pinpointing the problem) on anything that does not look like a well-formed row once the table
 * has started — an unparseable row is a fail-closed condition, not a skip. */
function parseRegister(text) {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /^\|\s*Interface\s*\|/.test(l));
  if (headerIdx === -1) {
    throw new Error('no table header row found (expected a line starting "| Interface |")');
  }
  // headerIdx + 1 is the `| --- | --- | ... |` separator; data starts after it.
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break; // table ended
    const cells = splitRow(line);
    if (cells.length < 6) {
      throw new Error(
        `table row ${i + 1} has ${cells.length} cell(s), expected at least 6: ${line}`,
      );
    }
    const [interfaceCell, definedCell, implCell, callerCell, taskCell, phaseCell] = cells;

    const interfaceMatch = BACKTICK_RE.exec(interfaceCell);
    if (!interfaceMatch) {
      throw new Error(
        `table row ${i + 1}: could not read an interface name from '${interfaceCell}'`,
      );
    }

    const definedRefs = [...definedCell.matchAll(FILE_LINE_RE)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
    }));
    if (definedRefs.length === 0) {
      throw new Error(`table row ${i + 1} ('${interfaceMatch[1]}'): "Defined at" has no file:line`);
    }

    const implRefs = [...implCell.matchAll(FILE_LINE_RE)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
    }));
    const implIsNone = implRefs.length === 0 && /^none\b/i.test(stripEmphasis(implCell));
    if (implRefs.length === 0 && !implIsNone) {
      throw new Error(
        `table row ${i + 1} ('${interfaceMatch[1]}'): "Production implementation" is neither 'none' nor a file:line`,
      );
    }
    const implSymbol = extractImplSymbol(implCell);

    const callerRefs = [...callerCell.matchAll(FILE_LINE_RE)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
    }));
    const callerIsNone = callerRefs.length === 0 && /^none\b/i.test(stripEmphasis(callerCell));
    if (callerRefs.length === 0 && !callerIsNone) {
      throw new Error(
        `table row ${i + 1} ('${interfaceMatch[1]}'): "Production caller" is neither 'none' nor a file:line`,
      );
    }

    const taskIds = [...taskCell.matchAll(TASK_ID_RE)].map((m) => m[1]);

    const phaseStripped = stripEmphasis(phaseCell);
    let phaseKind;
    let phaseLabel;
    if (/^deferred\b/i.test(phaseStripped)) {
      phaseKind = 'deferred';
      const cited = [...phaseCell.matchAll(TASK_ID_RE)].length > 0 || /\[D-\d+\]/.test(phaseCell);
      if (!cited) {
        throw new Error(
          `table row ${i + 1} ('${interfaceMatch[1]}'): marked 'deferred' with no cited decision/bead — a deferral must be defensible, not asserted`,
        );
      }
      phaseLabel = phaseStripped;
    } else if (/^unknown\b/i.test(phaseStripped)) {
      phaseKind = 'unknown';
      phaseLabel = phaseStripped;
    } else {
      const pm = /^P([0-6])\b/.exec(phaseStripped);
      if (!pm) {
        throw new Error(
          `table row ${i + 1} ('${interfaceMatch[1]}'): "Intended phase" ('${phaseStripped}') is not 'P0'..'P6', 'deferred', or 'unknown'`,
        );
      }
      phaseKind = 'phase';
      phaseLabel = `P${pm[1]}`;
    }

    rows.push({
      lineNo: i + 1,
      name: interfaceMatch[1],
      definedRefs,
      implRefs,
      implIsNone,
      implSymbol,
      callerRefs,
      callerIsNone,
      taskIds,
      phaseKind,
      phaseLabel,
      phaseCellRaw: phaseCell,
    });
  }
  if (rows.length === 0) {
    throw new Error('table header found but zero data rows parsed');
  }
  return rows;
}

// ------------------------------------------------------------------------------------------
// TASK STATUS — live bd, JSON override, or the documented fallback
// ------------------------------------------------------------------------------------------

// See the module doc's REACHABILITY section for what this is and its staleness risk.
const HARDCODED_FALLBACK_STATUS = {
  'ol-p2t08': 'closed',
  'ol-suspendstate': 'closed',
  'ol-p3t03': 'closed',
  'ol-df21a': 'closed',
  'ol-p5t05': 'closed',
  'ol-p2t01': 'closed',
  'ol-p2t01a': 'closed',
  'ol-p4t02': 'closed',
  'ol-p4t04': 'closed',
  'ol-p3t05': 'closed',
  'ol-k57j': 'closed',
};

function tryLiveBdStatus(repoRoot, ids) {
  const serviceDir = resolve(repoRoot, '..', 'olea-service');
  if (!existsSync(join(serviceDir, '.beads'))) return null;
  try {
    const out = execFileSync('bd', ['-C', serviceDir, 'show', ...ids, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // stderr carries a benign `beads.role` warning; discard it
    });
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const map = {};
    for (const issue of list) {
      if (issue?.id) map[issue.id] = issue.status;
    }
    return map;
  } catch {
    return null; // bd missing, not on PATH, or the query failed — fall through to the fallback
  }
}

function resolveTaskStatuses(repoRoot, allTaskIds, taskStatusOverridePath) {
  if (taskStatusOverridePath) {
    const raw = JSON.parse(readFileSync(taskStatusOverridePath, 'utf8'));
    return { statuses: raw, source: `--task-status override (${taskStatusOverridePath})` };
  }
  const live = tryLiveBdStatus(repoRoot, allTaskIds);
  if (live && allTaskIds.every((id) => id in live)) {
    return { statuses: live, source: 'live `bd show --json` against ../olea-service' };
  }
  console.log(
    '::warning::check-wiring-register could not reach a live beads database ' +
      '(../olea-service/.beads not found, `bd` not on PATH, or the query failed). ' +
      'Falling back to the hardcoded snapshot documented in this script’s own header ' +
      '(dated 2026-08-16) — re-verify with `bd -C ../olea-service show <id> --json` if it ' +
      'might be stale.',
  );
  return {
    statuses: HARDCODED_FALLBACK_STATUS,
    source: 'hardcoded fallback (2026-08-16 snapshot)',
  };
}

// ------------------------------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------------------------------

function main() {
  if (process.env.SKIP_WIRING_REGISTER === '1') {
    console.log(
      '::warning::check-wiring-register SKIPPED via SKIP_WIRING_REGISTER=1. ' +
        'Emergency bypass only — this proves nothing about wiring completeness this run.',
    );
    process.exit(0);
  }

  const opts = parseArgs(process.argv.slice(2));

  // Validated unconditionally, before any register/scan work — see the module doc's "THE
  // RATCHET" section for why this must never be gated on how far the rest of the run gets.
  const knownFindings = loadKnownFindings(opts.knownFindingsPath);

  if (!existsSync(opts.registerPath)) {
    console.error(`check-wiring-register: register not found at ${opts.registerPath}`);
    process.exit(2);
  }
  const registerText = readFileSync(opts.registerPath, 'utf8');
  if (registerText.trim().length === 0) {
    console.error(`check-wiring-register: register at ${opts.registerPath} is empty`);
    process.exit(2);
  }

  let rows;
  try {
    rows = parseRegister(registerText);
  } catch (err) {
    console.error(`check-wiring-register: UNPARSEABLE register — ${err.message}`);
    process.exit(2);
  }

  const scanned = scanPorts(opts.repoRoot);
  if (scanned.size === 0) {
    console.error(
      'check-wiring-register: the port scan found ZERO ports in packages/core/src or ' +
        'packages/plugin/src. A guard that finds nothing is blind, not clean — refusing to ' +
        'report success. Check --repo-root and the scan roots in this script.',
    );
    process.exit(2);
  }

  // --- Completeness, both directions ---
  const registeredNames = new Set(rows.map((r) => r.name));
  const scannedNames = new Set(scanned.keys());
  const missingFromRegister = [...scannedNames].filter((n) => !registeredNames.has(n));
  const staleInRegister = [...registeredNames].filter((n) => !scannedNames.has(n));

  const problems = [];
  if (missingFromRegister.length > 0) {
    problems.push(
      `${missingFromRegister.length} port(s) found in source but MISSING from the register: ` +
        missingFromRegister
          .map((n) => `${n} (${scanned.get(n).file}:${scanned.get(n).line})`)
          .join(', '),
    );
  }
  if (staleInRegister.length > 0) {
    problems.push(
      `${staleInRegister.length} register row(s) name a port the scan no longer finds in source ` +
        `(renamed, removed, or moved out of the scanned roots): ${staleInRegister.join(', ')}`,
    );
  }

  // --- Resolvability: every cited file:line is real ---
  function checkRefs(refs, label, rowName) {
    for (const ref of refs) {
      const abs = join(opts.repoRoot, ref.file);
      if (!existsSync(abs)) {
        problems.push(`'${rowName}' ${label} cites ${ref.file}:${ref.line} — file does not exist`);
        continue;
      }
      const lineCount = readFileSync(abs, 'utf8').split('\n').length;
      if (ref.line < 1 || ref.line > lineCount) {
        problems.push(
          `'${rowName}' ${label} cites ${ref.file}:${ref.line} — file only has ${lineCount} line(s)`,
        );
      }
    }
  }
  for (const row of rows) {
    checkRefs(row.definedRefs, 'Defined at', row.name);
    checkRefs(row.implRefs, 'Production implementation', row.name);
    checkRefs(row.callerRefs, 'Production caller', row.name);
    // "Defined at" gets one extra check: the interface name should actually appear on the cited
    // line.
    for (const ref of row.definedRefs) {
      const abs = join(opts.repoRoot, ref.file);
      if (!existsSync(abs)) continue; // already reported above
      const lines = readFileSync(abs, 'utf8').split('\n');
      const text = lines[ref.line - 1] ?? '';
      if (!text.includes(row.name)) {
        problems.push(
          `'${row.name}' "Defined at" cites ${ref.file}:${ref.line}, but that line does not mention '${row.name}'`,
        );
      }
    }
    // Symmetric check for "Production implementation": when the cell names a symbol, at least
    // one of its cited file:line refs should actually mention that symbol — the same class of
    // gap the "Defined at" check above closes, applied to the other citation that names a symbol.
    if (row.implSymbol && row.implRefs.length > 0) {
      const anyMentions = row.implRefs.some((ref) => {
        const abs = join(opts.repoRoot, ref.file);
        if (!existsSync(abs)) return true; // already reported by checkRefs above; don't pile on
        const lines = readFileSync(abs, 'utf8').split('\n');
        return (lines[ref.line - 1] ?? '').includes(row.implSymbol);
      });
      if (!anyMentions) {
        problems.push(
          `'${row.name}' "Production implementation" names '${row.implSymbol}', but none of its ` +
            `cited file:line ref(s) mention that symbol — the citation may be wrong or stale`,
        );
      }
    }
  }

  // --- Caller cross-check: does the register's claim (wired vs. 'none') match what a real
  // call-site scan finds? See the module doc's "WHAT COUNTS AS A 'PRODUCTION CALLER'" section —
  // this is the fix for the ol-odb0.1 false negative. Skipped for rows with no extractable
  // implementation symbol (documented limit, not a silent gap).
  const productionFiles = collectAllProductionFiles(opts.repoRoot);
  for (const row of rows) {
    if (!row.implSymbol) continue;
    const detected = findCallSite(opts.repoRoot, row.implSymbol, productionFiles);
    const sourceSaysWired = detected !== null;
    if (row.callerIsNone && sourceSaysWired) {
      problems.push(
        `'${row.name}' register says Production caller 'none', but '${row.implSymbol}' is ` +
          `actually constructed at ${detected.file}:${detected.line} — the register is STALE ` +
          `(this is the ol-odb0.1 false-negative shape; update the Production caller cell)`,
      );
    } else if (!row.callerIsNone && !sourceSaysWired) {
      problems.push(
        `'${row.name}' register cites a Production caller, but no call site to ` +
          `'${row.implSymbol}' was found anywhere in packages/core/src or packages/plugin/src ` +
          `— the citation may be wrong or stale`,
      );
    }
  }

  // --- "None" claims must be re-derived, not trusted (ol-drfy false negative). See the module
  // doc's "CAN A 'NONE' CLAIM BE TRUSTED?" section: scoped to `phaseKind === 'phase'` rows only
  // — a `deferred` row's "none" carries its own citation-based accountability (a human decision,
  // e.g. RerankProvider/D-040), and RerankProvider's OWN port name is legitimately referenced in
  // production (`retrieval/engine.ts`'s `readonly rerank?: RerankProvider`, an optional
  // dependency slot nothing fills) — proving this exact check would cry wolf on a correct
  // deferral if applied there. Findings-eligible rows only.
  for (const row of rows) {
    if (!row.implIsNone || row.phaseKind !== 'phase') continue;
    const excludeFiles = new Set([...row.definedRefs.map((r) => r.file), ...BARREL_REEXPORT_FILES]);
    const hit = findTypeReference(opts.repoRoot, row.name, excludeFiles, productionFiles);
    if (hit) {
      problems.push(
        `'${row.name}' register claims Production implementation 'none', but the port type is ` +
          `referenced in production at ${hit.file}:${hit.line} (outside its own declaration and ` +
          `outside the barrel re-export) — re-verify whether an implementation now exists; the ` +
          `register may be stale (the ol-drfy false-negative shape: a 'none' claim was never ` +
          `re-derived)`,
      );
    }
  }

  // Structural problems (parse-adjacent) are environment/register-quality failures — exit 2,
  // distinct from a real wiring finding. Report and stop before spending a `bd` round-trip.
  if (problems.length > 0) {
    console.error('check-wiring-register: register does not match the source tree.\n');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }

  // --- Reachability: closed-task ports with no caller and no cited deferral ---
  const rowsNeedingStatus = rows.filter((r) => r.callerIsNone && r.phaseKind === 'phase');
  const allTaskIds = [...new Set(rowsNeedingStatus.flatMap((r) => r.taskIds))];
  let statusResult = { statuses: {}, source: '(not needed — every port is wired or deferred)' };
  if (allTaskIds.length > 0) {
    statusResult = resolveTaskStatuses(opts.repoRoot, allTaskIds, opts.taskStatusPath);
  }

  // "Cannot determine" is a structural problem (exit 2, alongside completeness/resolvability
  // above), NOT part of the ratchet below — the ratchet compares GENUINE findings (a closed task,
  // confirmed no caller) against KNOWN_FINDINGS, and has nothing useful to say about a row this
  // run could not evaluate at all.
  const unknownRows = rows.filter((r) => r.phaseKind === 'unknown');
  const genuineFindings = []; // { port, message }
  for (const row of rowsNeedingStatus) {
    if (row.taskIds.length === 0) {
      problems.push(
        `${row.name}: no production caller, phase ${row.phaseLabel}, and no "Owning task" cited — ` +
          `cannot verify deliberate deferral, so this fails closed`,
      );
      continue;
    }
    const known = row.taskIds.map((id) => statusResult.statuses[id]);
    if (known.some((s) => s === undefined)) {
      problems.push(
        `${row.name}: owning task status unknown for one of [${row.taskIds.join(', ')}] ` +
          `(source: ${statusResult.source}) — cannot verify, fails closed`,
      );
      continue;
    }
    const allClosed = known.every((s) => s === 'closed');
    if (allClosed) {
      genuineFindings.push({
        port: row.name,
        message:
          `${row.name}: owning task(s) [${row.taskIds.join(', ')}] closed, phase ${row.phaseLabel} ` +
          `reached, and there is still no production caller — the task that claimed to wire this ` +
          `is done, and it is not reachable from anything the product runs`,
      });
    }
  }
  if (problems.length > 0) {
    console.error('check-wiring-register: could not determine reachability for every row.\n');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }

  // --- Report (unconditional — green must not mean silent) ---
  const wiredCount = rows.filter((r) => !r.callerIsNone).length;
  const deferredCount = rows.filter((r) => r.phaseKind === 'deferred').length;
  console.log(
    `check-wiring-register: ${rows.length} port(s) registered — ${wiredCount} wired, ` +
      `${deferredCount} deliberately deferred, ${unknownRows.length} unknown phase, ` +
      `${genuineFindings.length} finding(s) this run. Task-status source: ${statusResult.source}.`,
  );
  if (unknownRows.length > 0) {
    console.log(
      `  unknown-phase (reported, not failed): ${unknownRows.map((r) => r.name).join(', ')}`,
    );
  }
  console.log(`\ncheck-wiring-register: ${knownFindings.length} KNOWN finding(s), every run —\n`);
  for (const k of knownFindings) {
    console.log(`  - ${k.port} [${k.tasks.join(', ')}] — ${k.reason} (follow-up: ${k.followUp})`);
  }

  // --- The ratchet: this run's genuine findings must be EXACTLY KNOWN_FINDINGS ---
  const foundPorts = new Set(genuineFindings.map((f) => f.port));
  const knownPorts = new Set(knownFindings.map((f) => f.port));
  const newlyFound = genuineFindings.filter((f) => !knownPorts.has(f.port));
  const noLongerFound = knownFindings.filter((f) => !foundPorts.has(f.port));

  if (newlyFound.length > 0 || noLongerFound.length > 0) {
    console.error('\ncheck-wiring-register: RATCHET MISMATCH —\n');
    if (newlyFound.length > 0) {
      console.error(`  NEW — found this run, not in KNOWN_FINDINGS:`);
      for (const f of newlyFound) console.error(`    - ${f.message}`);
      console.error(
        "    Either wire a production caller, mark the register row 'deferred' with a cited " +
          'decision, or add a KNOWN_FINDINGS entry with a real follow-up bead id.',
      );
    }
    if (noLongerFound.length > 0) {
      console.error(`  FIXED — in KNOWN_FINDINGS, no longer reproduces:`);
      for (const f of noLongerFound) {
        console.error(`    - ${f.port} (follow-up ${f.followUp}) — delete this entry`);
      }
      console.error(
        '    A stale exemption is a lie about the current state. Remove the entry — that is ' +
          'what makes this a ratchet rather than a floor.',
      );
    }
    process.exit(1);
  }

  console.log('\ncheck-wiring-register: OK — findings this run exactly match KNOWN_FINDINGS.');
  process.exit(0);
}

main();
