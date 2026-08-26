#!/usr/bin/env node
/**
 * Static build for the workbench. Output is `dist/`, deployable as-is.
 *
 *   node build.mjs             one-shot development build (sourcemaps)
 *   node build.mjs production  minified, no sourcemap
 *   node build.mjs serve       watch + local server
 *   node build.mjs verify      read-only: is dist/ a complete production artifact?
 *
 * `WB_DIST` overrides the output directory (default `./dist`). It exists so a
 * test can build a throwaway artifact without overwriting the real one — see
 * `test/build-stamp.spec.ts`, and note that the alternative would have been a
 * test that clobbers the deployable directory to prove the deployable directory
 * is protected.
 *
 * Two esbuild settings carry the design:
 *
 * 1. `alias: { obsidian: src/obsidian-shim/index.ts }` — the bundler half of the
 *    same redirect `tsconfig.json`'s `paths` does for the typechecker. The real
 *    view sources compile unchanged; nothing under packages/workbench imports
 *    `obsidian`, so INV-1 holds (scripts/check-inv1.mjs scans this package).
 *
 * 2. A resolver that hard-fails on Node built-ins. `olea-core`'s barrel exports
 *    `FolderSource`, which imports `node:fs`. Stubbing it out silently would let
 *    a browser bundle carry a broken filesystem shim; failing the build makes any
 *    NEW node-only reach from core into the workbench visible at once. The one
 *    known case (`FolderSource`) is dropped by name instead.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dist =
  process.env.WB_DIST === undefined || process.env.WB_DIST === ''
    ? join(here, 'dist')
    : resolve(process.env.WB_DIST);
const mode = process.argv[2] ?? 'development';
// An UNRECOGNISED mode used to fall through to `development` — so a typo in the
// read-only mode (`verfiy`) would silently wipe and rebuild the artifact instead
// of inspecting it. With four modes, one of which exists precisely to be safe to
// run against a directory you care about, that is not a theoretical slip.
const MODES = new Set(['development', 'production', 'serve', 'verify']);
if (!MODES.has(mode)) {
  console.error(
    `workbench: '${mode}' is not a build mode. Expected one of ${[...MODES].join(', ')}. ` +
      'Nothing has been touched.',
  );
  process.exit(1);
}
const production = mode === 'production';
const serve = mode === 'serve';
const verify = mode === 'verify';

const PLUGIN_STYLES = resolve(here, '..', 'plugin', 'styles.css');
const THINGS_THEME = resolve(here, 'vendor', 'things', 'theme.css');
const FIXTURE_VAULT = resolve(here, '..', 'core', 'fixtures', 'vault');
/** Written by `scripts/precompute-embeddings.mjs` (`ol-opmb.2` [TB-2]) — gitignored, optional. */
const EMBEDDING_CASSETTE = resolve(here, '.embedding-cassette', 'cassette.json');
/** Written by `scripts/precompute-generation.mjs` (`ol-opmb.3` [TB-3]) — gitignored, optional. */
const GENERATION_CASSETTE = resolve(here, '.generation-cassette', 'cassette.json');

/**
 * `FolderSource` is core's node:fs implementation of `VaultSource`. The workbench
 * uses `MemoryVaultSource` instead and never constructs it, but esbuild will not
 * drop a re-export from a package without a `sideEffects` field, so it is cut at
 * the resolver. Anything else reaching for a Node built-in is a real problem and
 * fails the build.
 */
const nodeBuiltinGuard = {
  name: 'node-builtin-guard',
  setup(build) {
    build.onResolve({ filter: /^(node:)?(fs|fs\/promises|path|os|crypto|url|module)$/ }, (args) => {
      if (/vault[\\/]folder-source/.test(args.importer)) {
        return { path: args.path, namespace: 'wb-unreachable' };
      }
      return {
        errors: [
          {
            text: `workbench: '${args.path}' is a Node built-in and cannot be bundled for the browser (imported by ${args.importer}). If core grew a new node-only path, that is the finding — do not stub it here.`,
          },
        ],
      };
    });
    build.onLoad({ filter: /.*/, namespace: 'wb-unreachable' }, () => ({
      contents:
        // `stat` added alongside the rest of this list — `ol-4pue` [ARRIVE-1]
        // (`firstSeen`) gave `folder-source.ts` a `node:fs/promises` `stat`
        // import this stub had not been told about, and esbuild's "no
        // matching export" for it blocked every workbench build regardless
        // of host. Discovered while verifying `ol-ppxj.11`; filed as
        // `ol-ppxj.12` since it is a real, host-independent defect distinct
        // from the virtiofs races this bead is scoped to. `unlink` added
        // the same way when `ol-ppxj.15` promoted delete onto VaultSource
        // and gave `folder-source.ts` the identical new import shape.
        'const unreachable = new Proxy({}, { get() { throw new Error("workbench: Node built-ins are unreachable in the browser bundle"); } });\nexport default unreachable;\nexport const watch = unreachable, mkdir = unreachable, readdir = unreachable, readFile = unreachable, stat = unreachable, unlink = unreachable, writeFile = unreachable;\nexport const dirname = unreachable, join = unreachable, posix = unreachable, relative = unreachable, resolve = unreachable, sep = "/";',
      loader: 'js',
    }));
  },
};

/**
 * ol-m34c: **`dist/` records which build wrote it, so a MIXED one is detectable.**
 *
 * ol-ie7t made a *failed* serve non-destructive. This is the other half, and it
 * is the half that was observed doing damage: a **successful** serve wipes
 * `dist/` and rebuilds it as a dev build, in the same directory the deployable
 * artifact lives in. On 2026-08-15 a forgotten watcher wrote a 3,352,881-byte
 * dev bundle over a 447 KB production `app.js` seven minutes after the
 * production build finished, leaving `index.html`, `_headers` and
 * `plugin-styles.css` from one build beside an `app.js` from another — and
 * **nothing in the directory said so**. Anything deploying `dist/` in that
 * window would have shipped a dev build with no signal at all.
 *
 * Ordering alone cannot fix that: the watcher's write is a *successful* build
 * doing exactly what it was asked to. What was missing was not a guard but a
 * RECORD. So every completed build now writes `build-stamp.json` naming the
 * mode it ran in and the size and SHA-256 of every other file it left behind,
 * and the watcher rewrites that stamp on every rebuild — so the stamp cannot go
 * stale while the thing it describes changes underneath it, which is the exact
 * shape of the failure it exists to catch.
 *
 * `node build.mjs verify` then answers "is this a complete production artifact?"
 * in one command, with three distinct exit codes (0 / 1 mixed-or-tampered /
 * 2 intact-but-not-production) so a pre-deploy gate can tell those apart without
 * parsing prose.
 *
 * WHAT THE STAMP DELIBERATELY DOES NOT CONTAIN. No pid, no user, no absolute
 * path, no `process.env` — nothing environment-derived, for the same reason the
 * bundle has no `define`: `dist/` is a public surface and the surest way to keep
 * a credential-shaped string out of it is to have no channel for one. Mode,
 * timestamp, rebuild count, relative paths and hashes are enough to answer every
 * question the incident raised.
 */
const STAMP_NAME = 'build-stamp.json';
const STAMP_FORMAT = 'olea-workbench/build-stamp@1';

/** Every file currently in `dist/`, as sorted relative posix paths, stamp excluded. */
function distFiles() {
  const paths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) paths.push(relative(dist, absolute).split(sep).join(posix.sep));
    }
  };
  walk(dist);
  return paths.filter((path) => path !== STAMP_NAME).sort();
}

async function fileFacts(path) {
  const bytes = await readFile(join(dist, ...path.split(posix.sep)));
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

let rebuilds = 0;

async function writeStamp() {
  const files = {};
  for (const path of distFiles()) files[path] = await fileFacts(path);
  const stamp = {
    format: STAMP_FORMAT,
    // `serve` is its own mode rather than being folded into `development`:
    // "a live watcher owns this directory" is the fact that mattered.
    mode,
    builtAt: new Date().toISOString(),
    rebuilds,
    fileCount: Object.keys(files).length,
    files,
  };
  await writeFile(join(dist, STAMP_NAME), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/**
 * Rewrites the stamp at the end of every esbuild build, including every watcher
 * rebuild. `onEnd` runs after esbuild has written its outputs, so `app.js` on
 * disk is the one being hashed.
 */
const buildStamp = {
  name: 'build-stamp',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const stamp = await writeStamp();
      if (rebuilds > 0) {
        console.log(
          `workbench: dist/ rewritten by the dev server (rebuild ${rebuilds}) — ` +
            `${STAMP_NAME} now says mode=${stamp.mode}. This is NOT a deployable artifact.`,
        );
      }
      rebuilds += 1;
    });
  },
};

/**
 * Read-only. Compares `dist/` against its own stamp and says what it found.
 *
 *   0 — a complete, internally consistent production artifact
 *   1 — no stamp, or the files no longer match it (the MIXED case)
 *   2 — intact, but not a production build (the dev-server case)
 */
async function verifyDist() {
  const stampPath = join(dist, STAMP_NAME);
  if (!existsSync(stampPath)) {
    console.error(
      `workbench: ${dist} has no ${STAMP_NAME}. Either nothing built it, or something ` +
        'wrote it that was not this script. Treat its contents as unknown.',
    );
    process.exit(1);
  }
  let stamp;
  try {
    stamp = JSON.parse(await readFile(stampPath, 'utf8'));
  } catch (error) {
    console.error(`workbench: ${STAMP_NAME} is not readable JSON (${error.message}).`);
    process.exit(1);
  }
  if (stamp.format !== STAMP_FORMAT) {
    console.error(
      `workbench: ${STAMP_NAME} is format '${stamp.format}', expected ${STAMP_FORMAT}.`,
    );
    process.exit(1);
  }

  const recorded = new Set(Object.keys(stamp.files ?? {}));
  const present = new Set(distFiles());
  const problems = [];
  for (const path of [...recorded].sort()) {
    if (!present.has(path)) {
      problems.push(`missing: ${path}`);
      continue;
    }
    const facts = await fileFacts(path);
    const expected = stamp.files[path];
    if (facts.sha256 !== expected.sha256) {
      problems.push(
        `changed since the build: ${path} (${expected.bytes} bytes at build time, ${facts.bytes} now)`,
      );
    }
  }
  for (const path of [...present].sort()) {
    if (!recorded.has(path)) problems.push(`not written by this build: ${path}`);
  }

  if (problems.length > 0) {
    console.error(
      `workbench: ${dist} does NOT match its own build stamp (mode=${stamp.mode}, built ${stamp.builtAt}). ` +
        'Its files came from more than one build — this is the ol-m34c failure. Rebuild before doing anything with it.',
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  if (stamp.mode !== 'production') {
    console.error(
      `workbench: ${dist} is internally consistent but was built in '${stamp.mode}' mode ` +
        `(${stamp.builtAt}, ${stamp.rebuilds} watcher rebuild(s)). It is not a deployable artifact. ` +
        'Run `pnpm --filter olea-workbench build`.',
    );
    process.exit(2);
  }

  console.log(
    `workbench: ${dist} is a complete production artifact — ${stamp.fileCount} files, ` +
      `all matching the stamp written at ${stamp.builtAt}.`,
  );
  process.exit(0);
}

const options = {
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(dist, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  splitting: false,
  treeShaking: true,
  logLevel: 'info',
  minify: production,
  sourcemap: production ? false : 'inline',
  alias: {
    obsidian: join(here, 'src', 'obsidian-shim', 'index.ts'),
  },
  plugins: [nodeBuiltinGuard, buildStamp],
  // No `define` of anything environment-derived. Nothing from process.env may
  // reach this bundle: INV-3 forbids a credential-shaped string in the output,
  // and the surest way to keep one out is to have no channel for it.
};

/**
 * Copies `packages/core/fixtures/vault` into `dist/vault/` **verbatim**, plus a
 * manifest that is nothing but the sorted list of paths.
 *
 * VERBATIM AND UNENCODED IS THE REQUIREMENT, not a convenience. Every INV-3
 * control this project has — `INV3_MARKERS`, the real-title backstop, the
 * tree-wide sweeps that caught both real leaks — is a plaintext search. Encoding
 * the corpus (this build used to base64 it into a generated module) leaks nothing
 * by itself, but it takes the corpus out of reach of every one of those controls
 * while they keep reporting green. A check that cannot fail is worse than one
 * that does.
 *
 * With a straight copy, the build artifact holds exactly the same greppable
 * markdown the source tree does: sweeping either is equivalent to sweeping the
 * other, and that equivalence is a property of `cp`, not of anyone's discipline.
 *
 * This is a READ of packages/core/fixtures. WB-1 must never write there.
 */
async function copyFixtureVault() {
  const target = join(dist, 'vault');
  await cp(FIXTURE_VAULT, target, { recursive: true });

  const paths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        paths.push(relative(FIXTURE_VAULT, absolute).split(sep).join(posix.sep));
      }
    }
  };
  walk(FIXTURE_VAULT);
  paths.sort();
  if (paths.length === 0) {
    throw new Error(`workbench: no fixture files found under ${FIXTURE_VAULT}`);
  }
  await writeFile(join(target, 'manifest.json'), `${JSON.stringify(paths, null, 2)}\n`, 'utf8');
  console.log(`workbench: copied ${paths.length} fixture files to dist/vault/`);
}

/**
 * Copies the pre-computed embedding cassette (`ol-opmb.2` [TB-2]) into
 * `dist/embedding-cassette.json` verbatim, the same "fetched as a plain
 * static asset at runtime" discipline `copyFixtureVault` already uses (same
 * INV-3 reasoning does not apply here — every text embedded is coined
 * nonsense, never real content — but the pattern is right regardless:
 * `loadEmbeddingCassette.ts` fetches this the same way
 * `fixture-vault.ts` fetches `vault/manifest.json`).
 *
 * Tolerates absence: a fresh checkout that has never run
 * `scripts/precompute-embeddings.mjs` still builds, and every OTHER surface
 * (review, today, oracle) is unaffected — only the Retrieval states 404
 * until the pass has been run once.
 */
async function copyEmbeddingCassette() {
  if (!existsSync(EMBEDDING_CASSETTE)) {
    console.log(
      'workbench: no .embedding-cassette/cassette.json found — the Retrieval states will 404 ' +
        'until `node scripts/precompute-embeddings.mjs --spend` has been run once. Every other ' +
        'surface is unaffected.',
    );
    return;
  }
  await cp(EMBEDDING_CASSETTE, join(dist, 'embedding-cassette.json'));
  console.log(
    'workbench: copied .embedding-cassette/cassette.json to dist/embedding-cassette.json',
  );
}

/**
 * Copies the pre-computed generation cassette (`ol-opmb.3` [TB-3]) into
 * `dist/generation-cassette.json` verbatim — the same "fetched as a plain
 * static asset at runtime" discipline `copyEmbeddingCassette` above already
 * uses, and the same "no INV-3 concern, but the pattern is right regardless"
 * reasoning: the model's output is over a fabricated synthetic corpus, never
 * real content.
 *
 * Tolerates absence: a fresh checkout that has never run
 * `scripts/precompute-generation.mjs` still builds, and every OTHER surface
 * is unaffected — only the Generation states 404 until the pass has been run
 * once.
 */
async function copyGenerationCassette() {
  if (!existsSync(GENERATION_CASSETTE)) {
    console.log(
      'workbench: no .generation-cassette/cassette.json found — the Generation states will 404 ' +
        'until `node scripts/precompute-generation.mjs --spend` has been run once. Every other ' +
        'surface is unaffected.',
    );
    return;
  }
  await cp(GENERATION_CASSETTE, join(dist, 'generation-cassette.json'));
  console.log(
    'workbench: copied .generation-cassette/cassette.json to dist/generation-cassette.json',
  );
}

/**
 * `ol-ppxj.11` [HOST-1]: `cp(src, dest, { recursive: true })` into an ALREADY-
 * EXISTING `dest` throws EEXIST on this host — the same measured defect as
 * `ol-63et` (wrangler's mkdtemp/lstat), one level up the stack. Node's `fs.cp`
 * lstats `dest` to decide whether it needs to `mkdir` it fresh; on this
 * virtiofs mount that lstat can spuriously report ENOENT for a directory that
 * was in fact created moments earlier (here, `dist` itself, by the
 * `mkdir(dist, { recursive: true })` a few lines above `copyStatic()`'s
 * caller). Believing `dest` absent, `fs.cp` takes the "create fresh" path and
 * calls a plain, non-recursive `mkdir(dest)`, which then collides with the
 * genuinely-existing directory and throws a REAL EEXIST.
 *
 * A short retry is order-independent and correct on both hosts: on a healthy
 * host the lstat never lies, so `cp` never throws and this never loops; on
 * this host, letting the racing stat settle before retrying makes the second
 * attempt see `dest` as existing and take `fs.cp`'s ordinary "merge into an
 * existing directory" path — the same result `cp` produces everywhere else.
 * Verified: `node build.mjs production` — that plain `cp(public -> dist)`
 * call — reproduced EEXIST on first run every time here before this wrapper,
 * and 0 failures in 10 repeated runs after (5 into an empty dist, 5 more over
 * the already-built one, which is the "second run over existing dist" case).
 */
async function cpTolerant(src, dest, options) {
  const attempts = 8;
  for (let attempt = 1; ; attempt++) {
    try {
      await cp(src, dest, options);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
    }
  }
}

async function copyStatic() {
  await mkdir(join(dist, 'themes'), { recursive: true });
  await cpTolerant(join(here, 'public'), dist, { recursive: true });
  await cp(
    join(here, 'src', 'themes', 'obsidian-default.css'),
    join(dist, 'themes', 'obsidian-default.css'),
  );
  await cp(THINGS_THEME, join(dist, 'themes', 'things.css'));
  // The product's real stylesheet, unmodified. The workbench never re-declares
  // the --olea-host-* role layer; it loads the one packages/plugin ships.
  await cp(PLUGIN_STYLES, join(dist, 'plugin-styles.css'));
  await copyFixtureVault();
  await copyEmbeddingCassette();
  await copyGenerationCassette();
  await writeFile(
    join(dist, '_headers'),
    '/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n',
    'utf8',
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.base': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

/**
 * Serves one file out of `dist/`, resolved per request. Because nothing is read
 * at startup, this tolerates being bound before `dist/` exists: requests that
 * arrive during the rebuild below simply 404 until `copyStatic()` has run.
 */
async function serveFromDist(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Fixture paths contain spaces and an ampersand (deliberately — the fixture
  // vault's README names both as regression cases), so the request path arrives
  // percent-encoded and has to be decoded before it can be a filename.
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = join(dist, requested.replace(/^\/+/, ''));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

/**
 * Binds `port`, settling only once the listener is actually established and
 * rejecting on failure instead of dying on an unhandled `'error'` event.
 */
function bind(server, port) {
  return new Promise((settle, fail) => {
    const onError = (error) => fail(error);
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      settle();
    });
  });
}

const port = Number(process.env.WB_PORT ?? 4321);

/**
 * ol-ie7t: **THE ORDER BELOW IS THE FIX, and it is the whole fix.**
 *
 * This script's first act used to be `rm(dist)`, with the port bound at the very
 * end. So a `serve` that could not get its port had already deleted the artifact
 * by the time it found out, and then died on an unhandled EADDRINUSE — leaving
 * no `dist/` and nothing saying why. The next command to look for `dist/` simply
 * found it missing or half-built, with no indication that a failed dev server
 * was the cause.
 *
 * WHY A FEW LINES OF ORDERING ARE WORTH THIS MUCH COMMENT. `dist/` is a public
 * surface: the built workbench is a deployable artifact with a pre-deploy privacy
 * gate run against it. A build step that can silently destroy or half-replace
 * that artifact is one step removed from a gate that passed against a different
 * bundle than the one deployed — the same N-013 shape as everything else here,
 * where the reported result stops describing the thing it names.
 *
 * Acquiring the port first makes a clash a clean, early, non-destructive
 * failure: nothing has been removed, the exit code is non-zero, and the message
 * says which port and what to do. `dist/` is only ever touched once this process
 * knows it can finish.
 *
 * It is the whole fix for the CLASH. It is not the whole fix for the directory:
 * a serve that *does* get its port still replaces the artifact with a dev build,
 * which is `ol-m34c` and is why the build stamp above exists.
 */
if (verify) {
  await verifyDist();
}

if (serve) {
  const server = createServer(serveFromDist);
  try {
    await bind(server, port);
  } catch (error) {
    console.error(
      `workbench: could not bind port ${port} (${error.code ?? error.message}). ` +
        'dist/ has NOT been touched. Free that port, or set WB_PORT to another one.',
    );
    process.exit(1);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (!serve) {
  await esbuild.build(options);
  process.exit(0);
}

const context = await esbuild.context(options);
await context.watch();

console.log(`workbench: http://localhost:${port}/#/review/qa-front?set=obsidian-dark`);
// Said once, on the way in, because the incident this guards against was a serve
// nobody remembered starting. `build-stamp.json` says `mode: "serve"` for as long
// as this process owns the directory.
console.log(
  `workbench: this dev server now OWNS ${dist} and will overwrite it on every source ` +
    'edit. `node build.mjs verify` exits 2 while that is true.',
);
