/**
 * check-wiring-register.mjs must actually be able to go red — N-013's rule applied to this guard:
 * a check that cannot be shown to fail is anti-evidence. So this drives the REAL script, via
 * `spawnSync`, against planted fixture trees under the OS temp dir. Nothing here touches this
 * repository's real source tree or the real register — every fixture is invented, and the one
 * case that reads the real repo (`the real register parses and is internally consistent`) is
 * read-only.
 *
 * Every fixture interface, path, task id, and bead reference below is invented for this test —
 * none of it names anything real in either repo (INV-3 applies to fixtures too, even synthetic
 * ones with plausible-looking `ol-` ids).
 *
 *   node --test scripts/check-wiring-register.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const GUARD = join(SCRIPTS, 'check-wiring-register.mjs');

const built = [];
after(() => {
  for (const dir of built) rmSync(dir, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** An empty `--known-findings` override. Most tests below are not exercising the ratchet itself
 * and must not be polluted by this repo's real KNOWN_FINDINGS (5 real port names that never
 * appear in an invented fixture tree, which would otherwise report every one of them as
 * "FIXED — no longer reproduces" and fail a test that has nothing to do with the ratchet). */
function emptyKnownFindings(root) {
  const p = join(root, 'known-findings-empty.json');
  writeFileSync(p, '[]');
  return p;
}

function knownFindingsFile(root, entries) {
  const p = join(root, 'known-findings.json');
  writeFileSync(p, JSON.stringify(entries));
  return p;
}

/** A throwaway repo tree: `packages/core/src` + `packages/plugin/src` exist (possibly empty). */
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'olea-wiring-register-'));
  built.push(root);
  mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(join(root, 'packages', 'plugin', 'src'), { recursive: true });
  return root;
}

const REGISTER_HEADER =
  '# fixture register\n\n' +
  '| Interface | Defined at | Production implementation | Production caller | Owning task | Intended phase |\n' +
  '| --- | --- | --- | --- | --- | --- |\n';

function runGuard(args, options = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', ...options });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A baseline fixture: one wired port (`FooPort`) and one deliberately deferred port
 * (`BarPort`, citing an invented decision bead) — the shape a clean register/tree pair has. */
function baselineFixture() {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "import type { FooPort } from 'olea-core';\nexport class RealFoo implements FooPort {\n  get() { return 'x'; }\n}\n",
  );
  write(
    root,
    'packages/plugin/src/main.ts',
    "import { RealFoo } from './foo/impl.js';\nexport function wire() {\n  return new RealFoo();\n}\n",
  );
  write(
    root,
    'packages/core/src/bar/types.ts',
    'export interface BarPort {\n  get(): string;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:2` | `packages/plugin/src/main.ts:3` | `ol-fixture-foo` | P2 — wired |\n' +
    '| `BarPort` | `packages/core/src/bar/types.ts:1` | none | none | `ol-fixture-bar` | deferred — [D-9] (`ol-fixture-bar-decision`): invented for this test |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  return root;
}

test('a clean register against a clean tree exits 0', () => {
  const root = baselineFixture();
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    (() => {
      const p = join(root, 'status.json');
      writeFileSync(p, JSON.stringify({ 'ol-fixture-foo': 'open', 'ol-fixture-bar': 'open' }));
      return p;
    })(),
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
  assert.match(out, /2 port\(s\) registered/);
});

test('BAD ORACLE 1 — a port with no caller, whose owning task is closed, is a genuine finding', () => {
  // Same tree as baseline, but FooPort's row is rewritten to claim no caller, with its owning
  // task forced closed via --task-status. This is the exact shape ol-1ek8 was filed about: a
  // task on record as done, and the port it was for reaching nothing. With an empty
  // --known-findings override this surfaces as a RATCHET MISMATCH (NEW, unrecorded finding) —
  // the ratchet test below covers the case where it IS recorded and passes.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'closed' }));

  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /RATCHET MISMATCH/);
  assert.match(out, /NEW/);
  assert.match(out, /FooPort/);
});

test('BAD ORACLE 2 — the SAME tree with the owning task still open is NOT a finding (exit 0)', () => {
  // Proves the checker discriminates rather than always screaming: this is the calibration
  // requirement (an unwired port whose phase has not arrived is correct, not a finding) — a
  // guard that failed both cases identically would be exhibiting exactly the "cries wolf"
  // failure mode the register exists to avoid, just relocated into the checker itself.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'open' }));

  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

// ------------------------------------------------------------------------------------------
// THE RATCHET — requirement 5: new finding fails, disappeared finding fails, exact set passes.
// ------------------------------------------------------------------------------------------

/** A tree with exactly one genuine finding: `FooPort`, real implementation, no caller, owning
 * task closed. Shared by all three ratchet tests below so only `--known-findings` varies. */
function oneFindingFixture() {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'closed' }));
  return { root, statusPath };
}

test('ratchet: the exact known set passes (exit 0)', () => {
  const { root, statusPath } = oneFindingFixture();
  const known = knownFindingsFile(root, [
    {
      port: 'FooPort',
      tasks: ['ol-fixture-foo'],
      followUp: 'ol-fixture-followup',
      reason: 'invented for this test',
    },
  ]);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    known,
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK — findings this run exactly match KNOWN_FINDINGS/);
  // Green must not mean silent — the known finding is still printed.
  assert.match(out, /KNOWN finding\(s\), every run/);
  assert.match(out, /FooPort/);
  assert.match(out, /ol-fixture-followup/);
});

test('ratchet: a finding not in KNOWN_FINDINGS fails as NEW (exit 1)', () => {
  const { root, statusPath } = oneFindingFixture();
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /RATCHET MISMATCH/);
  assert.match(out, /NEW — found this run, not in KNOWN_FINDINGS/);
  assert.match(out, /FooPort/);
});

test('ratchet: a KNOWN_FINDINGS entry that no longer reproduces fails as FIXED (exit 1)', () => {
  // Same tree, but the owning task is now OPEN — so this run finds nothing — while
  // KNOWN_FINDINGS still lists FooPort. A fix nobody removed the exemption for must fail, not
  // silently pass: that is what makes this a ratchet rather than a floor.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'open' })); // reopened -> no longer a finding
  const known = knownFindingsFile(root, [
    {
      port: 'FooPort',
      tasks: ['ol-fixture-foo'],
      followUp: 'ol-fixture-followup',
      reason: 'invented for this test',
    },
  ]);

  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    known,
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /RATCHET MISMATCH/);
  assert.match(out, /FIXED — in KNOWN_FINDINGS, no longer reproduces/);
  assert.match(out, /FooPort \(follow-up ol-fixture-followup\) — delete this entry/);
});

test('a KNOWN_FINDINGS entry with no valid follow-up bead id is rejected at load (exit 1)', () => {
  const root = fixtureRepo();
  const known = knownFindingsFile(root, [
    { port: 'FooPort', tasks: ['ol-fixture-foo'], reason: 'no followUp field at all' },
  ]);
  // Deliberately points --register at a nonexistent path too: validation must happen BEFORE the
  // register is even read, so this proves the ordering rather than piggy-backing on some other
  // failure that would exit 2 first and mask a validator that never actually ran.
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'does-not-exist.md'),
    '--known-findings',
    known,
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /no valid follow-up bead id/);
});

// ------------------------------------------------------------------------------------------
// REGRESSION (ol-odb0.1, 2026-08-16) — the false negative this event exposed. The FIRST version
// of the caller cross-check did not exist at all: this script trusted whatever the register's
// "Production caller" cell said and never scanned source for a real call site, so when
// `ol-odb0.1`/`ol-tuvx` genuinely wired three ports — one via a DIRECT `new X()` in main.ts, two
// via an INDIRECT one inside a separate `retrieval/wiring.ts` module main.ts calls into — this
// checker kept reporting all three as findings and exited 0. This is the test that would have
// caught it: both shapes, asserted as detected.
// ------------------------------------------------------------------------------------------

/** Two ports, matching the two real shapes `ol-odb0.1` exercised: `DirectPort` constructed
 * directly in a composition-root-style `main.ts`, `IndirectStore` constructed inside a separate
 * `.../wiring.ts` module (never directly in `main.ts`). Neither file is CALLED from the other in
 * this fixture — deliberately: this script's detection scans every production file uniformly and
 * has no notion of "composition root" to hard-code, so a call chain is not needed to prove it. */
function ol0db01ShapedFixture() {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/direct/types.ts',
    'export interface DirectPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/direct/impl.ts',
    "export class RealDirect implements DirectPort {\n  get() { return 'x'; }\n}\n",
  );
  write(
    root,
    'packages/plugin/src/main.ts',
    "import { RealDirect } from './direct/impl.js';\nexport class Plugin {\n  onload() {\n    this.direct = new RealDirect();\n  }\n}\n",
  );
  write(
    root,
    'packages/core/src/indirect/types.ts',
    'export interface IndirectStore {\n  save(): void;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/indirect/impl.ts',
    'export class RealIndirect implements IndirectStore {\n  save() {}\n}\n',
  );
  write(
    root,
    'packages/plugin/src/indirect/wiring.ts',
    "import { RealIndirect } from './impl.js';\nexport function buildIndirectWiring() {\n  return new RealIndirect();\n}\n",
  );
  return root;
}

test("regression (ol-odb0.1): a direct construction in a composition-root-style file is DETECTED as wired even though the register still says 'none' (exit 2, stale)", () => {
  const root = ol0db01ShapedFixture();
  const register =
    REGISTER_HEADER +
    '| `DirectPort` | `packages/core/src/direct/types.ts:1` | `RealDirect` — `packages/plugin/src/direct/impl.ts:1` | none | `ol-fixture-direct` | P2 |\n' +
    '| `IndirectStore` | `packages/core/src/indirect/types.ts:1` | `RealIndirect` — `packages/plugin/src/indirect/impl.ts:1` | none | `ol-fixture-indirect` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(
    out,
    /'DirectPort' register says Production caller 'none', but 'RealDirect' is actually constructed at packages\/plugin\/src\/main\.ts:4/,
  );
});

test("regression (ol-odb0.1): a construction inside a SEPARATE wiring module is ALSO detected as wired even though the register still says 'none' (exit 2, stale)", () => {
  const root = ol0db01ShapedFixture();
  const register =
    REGISTER_HEADER +
    '| `DirectPort` | `packages/core/src/direct/types.ts:1` | `RealDirect` — `packages/plugin/src/direct/impl.ts:1` | `packages/plugin/src/main.ts:4` | `ol-fixture-direct` | P2 |\n' +
    '| `IndirectStore` | `packages/core/src/indirect/types.ts:1` | `RealIndirect` — `packages/plugin/src/indirect/impl.ts:1` | none | `ol-fixture-indirect` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(
    out,
    /'IndirectStore' register says Production caller 'none', but 'RealIndirect' is actually constructed at packages\/plugin\/src\/indirect\/wiring\.ts:3/,
  );
});

test('regression (ol-odb0.1): the SAME two ports, register ACCURATELY citing the real caller, are confirmed wired with no stale-register problem (exit 0)', () => {
  const root = ol0db01ShapedFixture();
  const register =
    REGISTER_HEADER +
    '| `DirectPort` | `packages/core/src/direct/types.ts:1` | `RealDirect` — `packages/plugin/src/direct/impl.ts:1` | `packages/plugin/src/main.ts:4` | `ol-fixture-direct` | P2 |\n' +
    '| `IndirectStore` | `packages/core/src/indirect/types.ts:1` | `RealIndirect` — `packages/plugin/src/indirect/impl.ts:1` | `packages/plugin/src/indirect/wiring.ts:3` | `ol-fixture-indirect` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

test('regression: a comment merely NAMING a construction is not mistaken for a real call site', () => {
  // The exact shape packages/plugin/src/keyword-index/wiring.ts's own module doc hit live while
  // this fix was being built: a docstring saying "nothing called `new X(...)`" is not a call.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  write(
    root,
    'packages/plugin/src/foo/wiring.ts',
    '/**\n * Nothing here calls `new RealFoo(...)` yet — see the register.\n */\nexport function buildFoo() {\n  return null;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out); // NOT stale — the comment must not be mistaken for a real call
  assert.match(out, /OK/);
});

test('a caller citation with no matching call site anywhere is flagged as a wrong/stale citation (exit 2)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class RealFoo {\n  get() { return 'x'; }\n}\n",
  );
  write(root, 'packages/plugin/src/main.ts', '// RealFoo is never actually constructed here.\n');
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | `packages/plugin/src/main.ts:1` | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /no call site to 'RealFoo' was found anywhere/);
});

// ------------------------------------------------------------------------------------------
// REGRESSION (ol-drfy, 2026-08-16, SAME DAY as ol-odb0.1) — the SECOND false negative, and the
// generalisation the coordinator asked for rather than a fix pinned to this one instance. The
// caller cross-check above only falsifies a claim about a symbol the register ALREADY NAMES.
// `JudgeCaller`'s row named none, so there was nothing to falsify, so it stayed a finding after
// `ol-drfy` genuinely wired it. This is the case that exposed it: a row claiming `none`, where
// the port TYPE NAME is now referenced in production. Plus every OTHER unfalsifiable-claim shape
// found while building the fix (`BARREL_REEXPORT_FILES`, the declaring-file exclusion, and the
// `deferred` scope boundary) — each earned by a real near-miss while this was being built, not
// invented in the abstract.
// ------------------------------------------------------------------------------------------

test("regression (ol-drfy): a row claiming 'none' implementation, where the port type is NOW referenced in production, is DETECTED (exit 2)", () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  // A second, unrelated production file references the PORT TYPE (not an implementation symbol
  // — there is none) as a dependency slot, the same shape `WorkerJudgeCallerDeps`/`GradingWiring`
  // actually used for `JudgeCaller`.
  write(
    root,
    'packages/plugin/src/consumer.ts',
    'export interface ConsumerDeps {\n  readonly foo: FooPort;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(
    out,
    /'FooPort' register claims Production implementation 'none', but the port type is referenced in production at packages\/plugin\/src\/consumer\.ts:2/,
  );
});

test("a 'none' claim with no reference anywhere outside its own declaration is left alone (exit 0) — the discrimination half of the same fix", () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'open' })); // task still open too — belt and suspenders
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

test('a reference to the port type ONLY inside its own declaring file does not falsify the "none" claim (exit 0) — the pre-ol-drfy JudgeCaller shape', () => {
  // gradingPipeline.ts declared JudgeCaller at line 210 AND referenced it again at line 312
  // (`callJudge: JudgeCaller,`) for years before any implementation existed. A same-file
  // reference must never count, or this check would have false-positived on JudgeCaller long
  // before ol-drfy landed.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n\n' +
      '// A sibling declaration in the SAME file referencing FooPort again, same shape as\n' +
      "// gradingPipeline.ts's own callJudge: JudgeCaller parameter.\n" +
      'export interface FooConsumer {\n  readonly foo: FooPort;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'open' }));
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

test('a reference to the port type ONLY inside the barrel re-export (packages/core/src/index.ts) does not falsify the "none" claim (exit 0)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  // A barrel file, same shape and same path check-wiring-register.mjs's BARREL_REEXPORT_FILES
  // names — every type in the real package's index.ts is re-exported exactly like this,
  // implemented or not.
  write(root, 'packages/core/src/index.ts', "export type { FooPort } from './foo/types.js';\n");
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | P2 |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const statusPath = join(root, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ 'ol-fixture-foo': 'open' }));
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--task-status',
    statusPath,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

test("a deferred row's 'none' claim is NEVER re-checked against source, even when the port type genuinely is referenced elsewhere (exit 0) — the RerankProvider shape", () => {
  // RerankProvider is deferred with implementation 'none', and its port name genuinely IS
  // referenced elsewhere in production (retrieval/engine.ts's `readonly rerank?: RerankProvider`,
  // an optional dependency slot nothing fills). Running the 'none' check against deferred rows
  // was tried and confirmed to cry wolf on exactly this real case before being scoped away from
  // deferred rows — this test is what keeps that scoping decision from silently regressing.
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/consumer.ts',
    'export interface ConsumerDeps {\n  readonly foo?: FooPort;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--known-findings',
    emptyKnownFindings(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
});

test('a "Production implementation" citing a symbol whose cited file:line does not actually mention it is flagged (exit 2) — the symmetric check to "Defined at"', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  write(
    root,
    'packages/plugin/src/foo/impl.ts',
    "export class SomethingElse {\n  get() { return 'x'; }\n}\n", // NOT RealFoo
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/foo/impl.ts:1` | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(
    out,
    /'FooPort' "Production implementation" names 'RealFoo', but none of its cited file:line ref\(s\) mention that symbol/,
  );
});

test('a port present in source but absent from the register fails closed (exit 2)', () => {
  const root = baselineFixture();
  // Add a third port to source with no matching register row.
  write(
    root,
    'packages/plugin/src/baz/types.ts',
    'export interface BazStore {\n  save(): void;\n}\n',
  );
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /MISSING from the register/);
  assert.match(out, /BazStore/);
});

test('a register row naming a port the scan no longer finds fails closed (exit 2)', () => {
  const root = fixtureRepo();
  // No source file at all — the register still claims FooPort exists.
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n' +
    '| `GhostProvider` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-ghost` | deferred — [D-2] (`ol-fixture-ghost-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /register row\(s\) name a port the scan no longer finds/);
  assert.match(out, /GhostProvider/);
});

test('an unresolvable file:line reference fails closed (exit 2)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | `RealFoo` — `packages/plugin/src/nowhere.ts:5` | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /file does not exist/);
});

test('a "Defined at" line that does not actually mention the interface fails closed (exit 2)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    // Line 2 is `  get(): string;` — real file, real line, wrong content.
    '| `FooPort` | `packages/core/src/foo/types.ts:2` | none | none | `ol-fixture-foo` | deferred — [D-1] (`ol-fixture-foo-decision`) |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /does not mention/);
});

test('zero ports found by the scan fails closed (exit 2) — a blind guard is not a clean one', () => {
  const root = fixtureRepo(); // empty src dirs, nothing to find
  write(
    root,
    'docs/dev/wiring-register.md',
    `${REGISTER_HEADER}| \`FooPort\` | \`x.ts:1\` | none | none | \`ol-x\` | P2 |\n`,
  );
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /ZERO ports/);
});

test('a missing register file fails closed (exit 2)', () => {
  const root = fixtureRepo();
  const { code, out } = runGuard(['--repo-root', root, '--register', join(root, 'nope.md')]);
  assert.equal(code, 2, out);
  assert.match(out, /not found/);
});

test('an empty register file fails closed (exit 2)', () => {
  const root = fixtureRepo();
  write(root, 'docs/dev/wiring-register.md', '   \n');
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /empty/);
});

test('a deferred row with no cited decision/bead is an unparseable row (exit 2)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/core/src/foo/types.ts',
    'export interface FooPort {\n  get(): string;\n}\n',
  );
  const register =
    REGISTER_HEADER +
    '| `FooPort` | `packages/core/src/foo/types.ts:1` | none | none | `ol-fixture-foo` | deferred, just because |\n';
  write(root, 'docs/dev/wiring-register.md', register);
  const { code, out } = runGuard(['--repo-root', root]);
  assert.equal(code, 2, out);
  assert.match(out, /no cited decision\/bead/);
});

test('an unknown CLI argument fails closed (exit 2)', () => {
  const { code, out } = runGuard(['--bogus-flag']);
  assert.equal(code, 2, out);
  assert.match(out, /unknown argument/);
});

test('SKIP_WIRING_REGISTER=1 bypasses the check and says so loudly', () => {
  const { code, out } = runGuard([], { env: { ...process.env, SKIP_WIRING_REGISTER: '1' } });
  assert.equal(code, 0, out);
  assert.match(out, /SKIPPED/);
});

test('the real register in this repo parses without a structural error (read-only, no --task-status)', () => {
  // Not asserting exit 0 here — the real register may legitimately have reachability findings
  // (exit 1) when a real port's owning task has closed with no production caller and no cited
  // deferral, and that is a genuine finding this test must not paper over. What this test
  // guarantees is that the register itself is WELL-FORMED against the real tree: no exit 2.
  const { code, out } = runGuard([]);
  assert.notEqual(
    code,
    2,
    `real register/tree mismatch (this must never be a parse/scan failure):\n${out}`,
  );
});
