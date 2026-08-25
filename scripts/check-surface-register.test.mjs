/**
 * check-surface-register.mjs must actually be able to go red — N-013's rule applied to this
 * guard, same as its sibling `check-wiring-register.test.mjs` (read that file first for the
 * shape). Drives the REAL script via `spawnSync` against planted fixture trees under the OS
 * temp dir; nothing here touches this repository's real source tree or the real register.
 *
 * Every fixture command id, class name, file path, and clause token below is invented for this
 * test — none of it names anything real in either repo.
 *
 *   node --test scripts/check-surface-register.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const GUARD = join(SCRIPTS, 'check-surface-register.mjs');

const built = [];
after(() => {
  for (const dir of built) rmSync(dir, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** A throwaway repo tree: `packages/plugin/src/commands` exists, ready for an `ids.ts`. */
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'olea-surface-register-'));
  built.push(root);
  mkdirSync(join(root, 'packages', 'plugin', 'src', 'commands'), { recursive: true });
  return root;
}

const REGISTER_HEADER =
  '# fixture register\n\n' +
  '## Commands\n\n' +
  '| Id | Palette name | Registered at | Contract clause(s) | Notes |\n' +
  '| --- | --- | --- | --- | --- |\n';

const SCOPE_DOC = 'fixture functional scope\n\n- F1.1 invented for this test\n';

function runGuard(args, options = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', ...options });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function writeScopeDoc(root) {
  const p = join(root, 'scope.md');
  writeFileSync(p, SCOPE_DOC);
  return p;
}

/** One command (`fixture-foo-open`, declared at ids.ts:1), one matching register row. */
function baselineFixture() {
  const root = fixtureRepo();
  write(
    root,
    'packages/plugin/src/commands/ids.ts',
    "export const OLEA_COMMAND_FOO = 'fixture-foo-open';\n",
  );
  const register =
    REGISTER_HEADER +
    '| `fixture-foo-open` | "Fixture: Open Foo" | `packages/plugin/src/commands/ids.ts:1` | F1.1 | invented for this test |\n';
  write(root, 'docs/dev/surface-register.md', register);
  return root;
}

test('a clean register against a clean tree exits 0', () => {
  const root = baselineFixture();
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/surface-register.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 0, out);
  assert.match(out, /OK/);
  assert.match(out, /1 command\(s\)/);
});

test('a new command with no register row fails (exit 1), naming the surface — the ol-odb0 shape', () => {
  const root = baselineFixture();
  // A second command lands with no register row — exactly the shape the real incident this
  // checker exists for: a new command shipping with nobody having checked it against the
  // register (there, the functional scope directly).
  write(
    root,
    'packages/plugin/src/commands/ids.ts',
    "export const OLEA_COMMAND_FOO = 'fixture-foo-open';\n" +
      "export const OLEA_COMMAND_BAR = 'fixture-bar-open';\n",
  );
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/surface-register.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /MISSING from the register/);
  assert.match(out, /fixture-bar-open/);
});

test('a register row naming a command the scan no longer finds fails as stale (exit 1)', () => {
  const root = fixtureRepo();
  // `fixture-foo-open` is gone (renamed, or withdrawn like OLEA_COMMAND_DRAFT_CARDS) but nobody
  // deleted its row; `fixture-baz-open` is a second, unrelated command that still exists and is
  // still correctly registered — so the scan is not vacuous, and staleness is the only problem.
  write(
    root,
    'packages/plugin/src/commands/ids.ts',
    "export const OLEA_COMMAND_BAZ = 'fixture-baz-open';\n",
  );
  const register =
    REGISTER_HEADER +
    '| `fixture-foo-open` | "Fixture: Open Foo" | `packages/plugin/src/commands/ids.ts:1` | F1.1 | invented for this test |\n' +
    '| `fixture-baz-open` | "Fixture: Open Baz" | `packages/plugin/src/commands/ids.ts:1` | F1.1 | invented for this test |\n';
  write(root, 'docs/dev/surface-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/surface-register.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /register does not match the source tree/);
  assert.match(out, /fixture-foo-open/);
});

test('a register row citing a stale file:line fails resolvability (exit 1)', () => {
  const root = fixtureRepo();
  write(
    root,
    'packages/plugin/src/commands/ids.ts',
    "export const OLEA_COMMAND_FOO = 'fixture-foo-open';\n",
  );
  const register =
    REGISTER_HEADER +
    // Cites line 99, which does not exist in a 1-line file, let alone match the real declaration.
    '| `fixture-foo-open` | "Fixture: Open Foo" | `packages/plugin/src/commands/ids.ts:99` | F1.1 | invented for this test |\n';
  write(root, 'docs/dev/surface-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/surface-register.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /the citation is stale/);
});

test('a register row citing a contract clause absent from the scope doc fails (exit 1)', () => {
  const root = baselineFixture();
  const register =
    REGISTER_HEADER +
    // F9.9 does not appear anywhere in SCOPE_DOC.
    '| `fixture-foo-open` | "Fixture: Open Foo" | `packages/plugin/src/commands/ids.ts:1` | F9.9 | invented for this test |\n';
  write(root, 'docs/dev/surface-register.md', register);
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/surface-register.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /F9\.9/);
  assert.match(out, /does not appear anywhere/);
});

test('a missing register file is a structural failure (exit 2), not a silent pass', () => {
  const root = baselineFixture();
  const { code, out } = runGuard([
    '--repo-root',
    root,
    '--register',
    join(root, 'docs/dev/does-not-exist.md'),
    '--scope-doc',
    writeScopeDoc(root),
  ]);
  assert.equal(code, 2, out);
  assert.match(out, /register not found/);
});

test('SKIP_SURFACE_REGISTER=1 bypasses with a loud banner, exit 0', () => {
  const root = baselineFixture();
  const { code, out } = runGuard(
    [
      '--repo-root',
      root,
      '--register',
      join(root, 'docs/dev/surface-register.md'),
      '--scope-doc',
      writeScopeDoc(root),
    ],
    { env: { ...process.env, SKIP_SURFACE_REGISTER: '1' } },
  );
  assert.equal(code, 0, out);
  assert.match(out, /SKIPPED via SKIP_SURFACE_REGISTER=1/);
});

test('the real register parses and is internally consistent against the real tree', () => {
  // Read-only against this repository's actual source and the real register (sibling checkout).
  // Not a fixture: this is the one case that must hold against reality, same as
  // check-wiring-register.test.mjs's identically-named test.
  const repoRoot = dirname(SCRIPTS);
  const { code, out } = runGuard(['--repo-root', repoRoot]);
  assert.equal(code, 0, out);
});
