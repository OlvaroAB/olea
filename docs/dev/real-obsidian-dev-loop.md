# A dev loop into real Obsidian

BRAT (`docs/dev/brat.md`) installs a *released* build — it needs a cut tag and a GitHub Actions
run, which is too slow for iterating on a change that has not shipped yet. This document is the
faster loop: getting the plugin you just built on this machine into a real Obsidian window, with
no release involved.

> **Status:** `scripts/dev-install.mjs` has been run end-to-end against a throwaway vault
> (copy mode, symlink mode, `--build`, idempotent re-run, conflicting-flag and missing-argument
> handling) and its output verified by inspecting the resulting file tree and JSON directly. It
> has **not** been exercised inside a running Obsidian instance — that half (does the vault
> actually open, does the command palette show Olea's commands, does reload pick up a new build)
> needs a real desktop Obsidian install, which this checking environment does not have. That
> remaining verification is `ol-ppxj.10`'s close evidence.

## Why a *throwaway* vault

This loop is for exercising real Obsidian behaviour the workbench cannot fake — actual file
watching, actual editor/CodeMirror behaviour, actual INV-2 vault round-trips. None of that
requires your real vault, and using it would risk exactly the kind of accidental write this
project treats as a stop condition (`INV-6`, C6). Point every route below at a disposable
directory you can delete afterwards — an empty folder Obsidian is told to open as a new vault is
enough. `scripts/dev-install.mjs` refuses to run against a directory inside either the `olea` or
`olea-service` repositories (which includes the real-vault snapshot the private repo tracks) as
a guard against pointing it at the wrong place by accident — it is not a substitute for picking
a genuinely disposable directory yourself.

## Three routes in

| Route | Needs a release? | Update mechanism | Best for |
| --- | --- | --- | --- |
| **BRAT** (`docs/dev/brat.md`) | Yes — a pushed tag | BRAT checks GitHub releases | Verifying what a real install/update looks like for the eventual alpha user |
| **Direct copy** (`scripts/dev-install.mjs`, default) | No | Re-run the script after each build | Everyday local iteration; matches how the built artifacts actually ship |
| **Symlink** (`scripts/dev-install.mjs --symlink`) | No | Automatic — the vault always reads the current build | Rebuilding often and reloading in Obsidian without re-copying each time |

### Direct copy or symlink: `scripts/dev-install.mjs`

```bash
# from the olea repo root
node scripts/dev-install.mjs <path-to-throwaway-vault>              # copy (default)
node scripts/dev-install.mjs <path-to-throwaway-vault> --symlink    # symlink instead
node scripts/dev-install.mjs <path-to-throwaway-vault> --build      # build first, then install
```

Or via the root package script:

```bash
pnpm run dev:install -- <path-to-throwaway-vault> [--symlink|--copy] [--build]
```

What it does:

1. Reads `packages/plugin/manifest.json` for the plugin id (currently `olea`).
2. Optionally builds the plugin first (`--build` runs `pnpm --filter olea-plugin build`, which
   both type-checks and runs the production esbuild pass — see `packages/plugin/package.json`).
3. Creates `<vault>/.obsidian/plugins/<id>/` if it does not exist.
4. Copies (or symlinks) `main.js`, `manifest.json` and `styles.css` from `packages/plugin/` into
   that directory.
5. Writes or updates `<vault>/.obsidian/community-plugins.json` so the plugin id is enabled —
   creating the file if absent, appending the id if the file exists and does not already list
   it, and leaving every other entry untouched. Re-running is a no-op on this step if the id is
   already present.
6. Prints exactly what it did (which files, copy vs. symlink, whether it changed
   `community-plugins.json`), so a re-run's output tells you whether anything changed.

It uses Node built-ins only (no dependency install needed to run it) and refuses to target a
vault directory inside `olea`, inside the sibling private `olea-service` repo, or under that
repo's tracked real-vault snapshot (`docs/Obsidian-vault-copy`) — see the script's own header
comment for the full reasoning.

## Copy vs. symlink

**Copy (default).** The vault gets its own physical files. This is what an installed plugin
normally looks like, so it is the safer default when you are not sure which behaviour you are
testing. The cost: after every rebuild you must re-run the script (or pass `--build` to fold the
rebuild in) before Obsidian sees the change. Copying is also the only option that behaves
predictably across every platform and every sync setup — see the caveats below.

**Symlink.** The vault's plugin directory points at the files still living under
`packages/plugin/` in your `olea` checkout. Rebuild the plugin and the vault picks up the new
`main.js` the moment Obsidian reloads it — no re-copy step. This is the faster loop for repeated
iteration, with three caveats:

- **Obsidian's file watcher.** Obsidian watches for changes inside the vault; whether it notices
  a rebuilt file reached through a symlink depends on the platform's filesystem-event behaviour
  for symlinked targets, not just on the file having changed. Do not assume automatic detection —
  reload the plugin manually (below) after every rebuild until you have confirmed otherwise on
  your platform.
- **Windows.** Creating a symlink on Windows normally requires Developer Mode enabled or an
  elevated (Administrator) process; without one, `--symlink` will fail to create the links even
  though the copy path works fine. Prefer `--copy` on Windows unless you have already set that
  up.
- **Synced vaults (Obsidian Sync, iCloud, Dropbox, etc.).** Sync engines generally do not
  understand symlinks the way a plain filesystem does — a synced vault may upload the symlink
  itself (a small text-like pointer) rather than the file it targets, or refuse to sync it at
  all. Never symlink into a vault that is also under a sync service; use `--copy` there. This is
  a non-issue for a throwaway vault kept off any sync service, which is what this whole document
  assumes.

## Reloading the plugin

Obsidian does not always notice a plugin's files changed on disk. After copying or rebuilding:

- **Command palette → "Reload app without saving"** — the reliable option; reloads the whole
  window, including every plugin.
- If you installed via BRAT, its **"Restart a plugin that is already installed"** command
  reloads a single plugin without a full window reload — see `docs/dev/brat.md`. That BRAT
  command operates on plugins BRAT itself installed and is not expected to apply to a
  direct-copy or symlink install.
- If you have just enabled Olea for the first time (a fresh `community-plugins.json`), it may
  need to be enabled once by hand under **Settings → Community plugins** even though
  `dev-install.mjs` already wrote the entry — Obsidian typically only reads that file at startup.

Proof the reload worked: open the command palette and look for `Olea:`-prefixed commands, same
check as `docs/dev/brat.md`'s "Did it work?" section.

## Where the manual smoke checklist fits

The 108-plus-scenario `@manual` checklist is assembled from `features/*.md` by
`pnpm run checklist:manual` (run in `olea-service`, since that is where the scenario files and
the script live — see that repo's `docs/dev/wiring-register.md` and `CLAUDE.md` for the
mechanism). Every scenario in it needs *some* real Obsidian window to walk through, because it
exists precisely for the behaviour the workbench cannot exercise. This dev loop is that window:
build the plugin, install it into a throwaway vault with `scripts/dev-install.mjs`, open the
vault in Obsidian, and work the checklist against it. Use BRAT instead only when the thing under
test is the release/update mechanism itself, not the plugin's behaviour.
