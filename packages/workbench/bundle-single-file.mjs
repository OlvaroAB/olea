#!/usr/bin/env node
/**
 * Assembles `dist-single/olea-workbench.html` — the whole workbench as ONE
 * self-contained HTML file — out of an already-built `dist/` (`ol-with`'s
 * "single-file" lane, run 15).
 *
 * WHY THIS EXISTS AS A SEPARATE SCRIPT. The Cloudflare Pages deploy that
 * would normally publish `dist/` is blocked on David's credential, so this
 * gives him a private review link some other static host (or a direct file)
 * can serve with zero server-side logic and zero sibling requests. It is
 * deliberately NOT part of `build.mjs`: `dist/` is the deployable Pages
 * artifact, its build-stamp guard is a promise about what wrote it, and noth-
 * ing here may touch that promise. This script only READS `dist/` and writes
 * a new directory next to it.
 *
 *   node build.mjs production      # unchanged — writes dist/
 *   node bundle-single-file.mjs    # reads dist/, writes dist-single/
 *
 * ## What "single file" costs, and how each cost is paid
 *
 * A strict CSP at the eventual hosting location blocks every request to any
 * other origin, and a single file has no sibling to request from even under a
 * relaxed one. Four things `dist/` normally serves separately have to move
 * inside the one HTML document instead:
 *
 * 1. `workbench.css` (the chrome) — was a `<link>` in `<head>`, becomes a
 *    `<style>` with the same text.
 * 2. `app.js` — was `<script type="module" src="./app.js">`, becomes the same
 *    script with its content inline. Nothing in it reads `import.meta`, so an
 *    inline module behaves identically to an external one here.
 * 3. The theme/plugin stylesheets `host-frame.ts` loads INSIDE the review
 *    iframe's own document via `<link href="...">` — `createHostFrame` and
 *    `setThemeSheets` now check a global, `window.__OLEA_WB_INLINE_CSS__`,
 *    and build an inline `<style>` instead of a `<link>` when it is
 *    populated. That is the one `src/` change this task needed (see
 *    `src/host-frame.ts`): the global is absent in the ordinary build,
 *    so `build.mjs`'s output is untouched — every `<link>` there still
 *    fetches from `dist/` exactly as before. This script is what populates
 *    the global, as a small object literal assigned before `app.js` runs.
 * 4. The 52-file synthetic fixture vault, loaded by `src/vault/fixture-vault.ts`
 *    via `fetch('./vault/manifest.json')` then one `fetch()` per file — genuine
 *    `fetch()` calls, unlike the `<link>`-based stylesheets above, so THESE are
 *    solved by intercepting `fetch` itself rather than by touching that file.
 *    A shim prepended to the inlined `app.js` overrides `window.fetch`: any
 *    request whose URL contains `/vault/` is answered from a pre-populated
 *    base64 map built from `dist/vault/` (byte-exact — the map is built from
 *    the same verbatim copy `build.mjs` made, PDFs included), and everything
 *    else falls through to the real `fetch`. `fixture-vault.ts` itself is
 *    unmodified: the inlining concern lives entirely in this bundler, as the
 *    task asked for.
 *
 * `_headers` and `build-stamp.json` are Pages/build-process artifacts with no
 * meaning inside a single HTML file and are not carried over.
 *
 * ## Fragment mode (`--fragment`)
 *
 * `node bundle-single-file.mjs --fragment` additionally writes
 * `dist-single/olea-workbench.fragment.html` — the same page with no
 * `<!doctype>`, `<html>`, `<head>` or `<body>` of its own, for a hosting
 * surface that wraps supplied content in ITS OWN document skeleton (dropping
 * a full document in there would nest `<html>`/`<body>` illegally). Order,
 * fixed because the host is said to scan only the first 8 KB for a `<title>`:
 *
 *   1. `<title>` — a short, name-like one, not the full-document's longer text.
 *   2. The inlined `workbench.css`, unchanged, plus one small addendum block
 *      (see below).
 *   3. The body content: a tiny inline attribute-setting script, then the
 *      same `<div class="wb">…</div>` markup the full document has.
 *   4. The inlined `app.js` (identical bytes to the full-document version).
 *
 * Two things the full document gets for free from its own `<html>`/`<body>`
 * tags that the fragment cannot:
 *
 * - **`data-wb-ready`'s initial value.** `public/index.html` opens
 *   `<html lang="en" data-wb-ready="false">`; `src/main.ts` only ever WRITES
 *   that attribute at runtime, via `document.documentElement.setAttribute`
 *   (never reads it, and nothing in `workbench.css` selects on it either —
 *   checked before relying on that). So nothing breaks either way, but the
 *   documented contract ("`[data-wb-ready="true"]` on `<html>`, set only
 *   after…") implies a `"false"` (or absent) state beforehand, observable by
 *   an external watcher. Since there is no `<html>` tag here to carry it
 *   statically, step 3 opens with a one-line inline script that sets it on
 *   `document.documentElement` (the HOST's real `<html>`, whatever it is)
 *   before any other body content — cheap, and it keeps the contract true
 *   for anyone polling from outside rather than relying on a tag that will
 *   not exist in this mode.
 * - **Filling the viewport and owning the background**, instead of showing
 *   through to whatever the host's own reset painted. `workbench.css`'s
 *   `.wb` rule already uses `min-height: 100vh` — a viewport unit, not a
 *   percentage, so it does not depend on any `html { height: 100% }` chain
 *   existing above it (there isn't one in this stylesheet; checked). Per the
 *   CSS canvas-background rule, an unstyled `<html>` already propagates
 *   `<body>`'s `background` to paint the whole viewport, and `body{margin:0;
 *   background:…}` sets exactly that — so this was already covered by the
 *   existing rules. The addendum block in step 2 makes it explicit rather
 *   than relying on that propagation alone, since it costs nothing and this
 *   is exactly the kind of behaviour worth not leaving implicit: it sets
 *   `html, body { height: 100%; margin: 0 }` (defensive; harmless given no
 *   existing rule reads a `%` height from an ancestor) and a `background`
 *   directly on `.wb` itself, so the painted colour does not depend on which
 *   element the host's own reset happens to win the cascade on.
 *
 * The full-document output is untouched by any of this — same bytes, same
 * command (`node bundle-single-file.mjs`), same file.
 *
 * ## Privacy
 *
 * The fixture vault copied into `dist/vault/` is the same synthetic corpus
 * `build.mjs` copies verbatim from `packages/core/fixtures/vault` — sanctioned,
 * non-real content (see the package README / `check:fixturevocab` in
 * olea-service). This script embeds exactly those bytes, base64-encoded, and
 * nothing else: no environment variable, no absolute path, no build-machine
 * detail ever reaches the output (mirrors `build.mjs`'s own "no `define`"
 * discipline).
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const outDir = join(here, 'dist-single');
const outFile = join(outDir, 'olea-workbench.html');
const fragmentOutFile = join(outDir, 'olea-workbench.fragment.html');
const buildFragment = process.argv.includes('--fragment');

/** Short and name-like, deliberately shorter than the full document's <title>. */
const FRAGMENT_TITLE = 'Olea component workbench';

/**
 * Defense-in-depth for the height/background concerns in the file header's
 * "Fragment mode" section — appended, never replacing, the real
 * `workbench.css` text. `.wb`'s own `min-height: 100vh` already does not
 * need this to fill the viewport; this exists so the painted background does
 * not depend on which element wins the cascade against a host's own reset.
 */
const FRAGMENT_STYLE_ADDENDUM = `
/* bundle-single-file.mjs --fragment: explicit fill + background, belt and
   braces alongside .wb's own min-height: 100vh and body's own background
   (see this file's header, "Fragment mode"). */
html, body {
  height: 100%;
  margin: 0;
}
.wb {
  background: var(--wb-bg);
}
`;

/** Escapes the one sequence that could prematurely close an embedding tag. */
function escapeForScript(text) {
  return text.replace(/<\/script/gi, '<\\/script');
}
function escapeForStyle(text) {
  return text.replace(/<\/style/gi, '<\\/style');
}

async function readText(path) {
  return readFile(path, 'utf8');
}

async function assertProductionBuild() {
  const stampPath = join(dist, 'build-stamp.json');
  let stamp;
  try {
    stamp = JSON.parse(await readText(stampPath));
  } catch (error) {
    throw new Error(
      `bundle-single-file: could not read ${stampPath} (${error.message}). Run ` +
        '`node build.mjs production` first — this script only reads an already-built dist/.',
    );
  }
  if (stamp.mode !== 'production') {
    throw new Error(
      `bundle-single-file: dist/ was built in '${stamp.mode}' mode, not 'production' ` +
        `(build-stamp.json, built ${stamp.builtAt}). Run \`node build.mjs production\` first.`,
    );
  }
}

/** Every file under `dir`, as sorted vault-relative posix paths. */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(absolute, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, absolute).split(sep).join(posix.sep));
    }
  }
  return out.sort();
}

async function buildFixtureMap() {
  const vaultDir = join(dist, 'vault');
  const paths = await walk(vaultDir);
  if (paths.length === 0) {
    throw new Error(`bundle-single-file: no files found under ${vaultDir}`);
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const path of paths) {
    const bytes = await readFile(join(vaultDir, ...path.split(posix.sep)));
    map[path] = bytes.toString('base64');
  }
  return map;
}

/**
 * The shim that runs before `app.js`'s own module code: it overrides
 * `window.fetch` to answer the fixture vault's `fetch()` calls from an
 * embedded base64 map (see file header, point 4) and sets the CSS-inlining
 * global `src/host-frame.ts` checks (point 3). Plain ES2022, since it lands
 * inside the same `type="module"` script as the esbuild output it precedes.
 */
function buildShim({ fixtureMap, cssMap }) {
  return `
/* --- bundle-single-file.mjs: inline-asset shim, generated, see this file's header --- */
(function () {
  var FIXTURES = ${JSON.stringify(fixtureMap)};
  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var urlStr = typeof input === 'string' ? input : (input && input.url) || String(input);
      var marker = '/vault/';
      var idx = urlStr.indexOf(marker);
      if (idx !== -1) {
        var rest = decodeURIComponent(urlStr.slice(idx + marker.length).split(/[?#]/)[0]);
        if (Object.prototype.hasOwnProperty.call(FIXTURES, rest)) {
          var bytes = base64ToBytes(FIXTURES[rest]);
          return Promise.resolve(new Response(bytes, { status: 200, statusText: 'OK' }));
        }
      }
    } catch (_e) {
      // Fall through to the real fetch — an unreachable fixture must surface
      // as the app's own "could not load" error, not a swallowed exception.
    }
    return realFetch(input, init);
  };
})();
window.__OLEA_WB_INLINE_CSS__ = ${JSON.stringify(cssMap)};
/* --- end shim --- */
`;
}

async function main() {
  await assertProductionBuild();

  const [indexHtml, workbenchCss, appJs, pluginCss, obsidianCss, thingsCss, fixtureMap] =
    await Promise.all([
      readText(join(dist, 'index.html')),
      readText(join(dist, 'workbench.css')),
      readText(join(dist, 'app.js')),
      readText(join(dist, 'plugin-styles.css')),
      readText(join(dist, 'themes', 'obsidian-default.css')),
      readText(join(dist, 'themes', 'things.css')),
      buildFixtureMap(),
    ]);

  // Same keys `src/main.ts` / `src/themes/index.ts` pass as hrefs — see
  // PLUGIN_STYLES_HREF and THEME_SHEET_HREF. inlineCssFor() in host-frame.ts
  // looks a request up by exactly this string.
  const cssMap = {
    './plugin-styles.css': pluginCss,
    './themes/obsidian-default.css': obsidianCss,
    './themes/things.css': thingsCss,
  };

  const shim = buildShim({ fixtureMap, cssMap });
  const inlineScript = escapeForScript(`${shim}\n${appJs}`);
  const inlineStyle = escapeForStyle(workbenchCss);

  let html = indexHtml;

  // Function replacers, deliberately — NOT `html.replace(pattern, bigString)`.
  // `String.prototype.replace` interprets `$&`, `` $` ``, `$'` and `$$` inside a
  // STRING replacement, and the bundled `app.js` legitimately contains the
  // literal idiom `"\\$&"` (the standard JS regex-escape pattern,
  // `replace(/.../g, '\\$&')`, used somewhere in the real bundled code). With a
  // string replacement, `$&` there was being expanded to "the whole matched
  // substring" — i.e. the ORIGINAL `<script src="./app.js">` tag text — and
  // spliced back into the middle of unrelated minified code. A function
  // replacer's return value is inserted literally, with no pattern
  // interpretation, which is the fix and the reason this comment exists.
  const linkTag = '<link rel="stylesheet" href="./workbench.css" />';
  if (!html.includes(linkTag)) {
    throw new Error(
      `bundle-single-file: expected to find ${JSON.stringify(linkTag)} in dist/index.html`,
    );
  }
  html = html.replace(linkTag, () => `<style>\n${inlineStyle}\n</style>`);

  const scriptTag = '<script type="module" src="./app.js"></script>';
  if (!html.includes(scriptTag)) {
    throw new Error(
      `bundle-single-file: expected to find ${JSON.stringify(scriptTag)} in dist/index.html`,
    );
  }
  html = html.replace(scriptTag, () => `<script type="module">\n${inlineScript}\n</script>`);

  await mkdir(outDir, { recursive: true });
  await writeOne(outFile, html, fixtureMap);

  if (buildFragment) {
    // Body content, straight from the ORIGINAL dist/index.html — same
    // `.wb`-rooted markup the full document has, no other change. Same
    // safe function-replacer as above, same reason (see the comment on the
    // full-document `scriptTag` replacement).
    const bodyMatch = indexHtml.match(/<body>([\s\S]*)<\/body>/);
    if (bodyMatch === null) {
      throw new Error('bundle-single-file: could not find <body>…</body> in dist/index.html');
    }
    if (!bodyMatch[1].includes(scriptTag)) {
      throw new Error(
        `bundle-single-file: expected to find ${JSON.stringify(scriptTag)} inside <body> of dist/index.html`,
      );
    }
    const bodyWithScript = bodyMatch[1].replace(
      scriptTag,
      () => `<script type="module">\n${inlineScript}\n</script>`,
    );

    // Step 3 opens with the tiny attribute-setter described in the file
    // header's "Fragment mode" section — before the `.wb` markup, so it is
    // set on the host's real `<html>` (`document.documentElement`) as early
    // as this fragment can arrange, well before `app.js` itself would first
    // set it (main.ts's own `render()`, not on script parse).
    const readyFlagScript =
      "<script>document.documentElement.setAttribute('data-wb-ready', 'false');</script>";

    const fragment = [
      `<title>${FRAGMENT_TITLE}</title>`,
      `<style>\n${inlineStyle}\n${FRAGMENT_STYLE_ADDENDUM}\n</style>`,
      readyFlagScript,
      bodyWithScript.trim(),
    ].join('\n');

    await writeOne(fragmentOutFile, fragment, fixtureMap);
  }
}

/** Writes `html` to `path`, reporting size and enforcing the 16 MiB ceiling. */
async function writeOne(path, html, fixtureMap) {
  await writeFile(path, html, 'utf8');
  const { size } = await stat(path);
  const MB = 1024 * 1024;
  console.log(
    `bundle-single-file: wrote ${path} (${(size / MB).toFixed(2)} MiB, ` +
      `${Object.keys(fixtureMap).length} fixture files embedded).`,
  );
  if (size > 16 * MB) {
    throw new Error(
      `bundle-single-file: ${path} is ${(size / MB).toFixed(2)} MiB, over the 16 MiB limit.`,
    );
  }
}

await main();
