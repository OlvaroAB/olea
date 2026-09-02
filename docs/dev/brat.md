# Installing Olea via BRAT

Olea is not in the Obsidian community plugin directory and will not be during the alpha
(A2.6). It reaches a vault through **BRAT** — the Beta Reviewers Auto-update Tool — which
installs plugins straight from a GitHub repository and keeps them updated.

Shipping a new version is therefore just **cutting a tag** — `release.yml` builds the bundle
and publishes the release from there.

> **Status:** these steps are checked against BRAT's source, the built artifacts and
> `release.yml`. `release.yml` has fired for real tags (`0.9.0-alpha.2` on 2026-08-15, see
> "For maintainers" below), but the install has not been walked through in a real vault.
> Bead `ol-bratverify` is that verification, assigned to David; corrections land here.

---

## One-time setup

1. In Obsidian, open **Settings → Community plugins**. If restricted mode is on, turn it off.
2. **Browse**, search for **BRAT**, install it, and enable it.
3. Open **Settings → BRAT**.
4. Click **Add beta plugin**.
5. In the **Repository** field, enter:
   ```
   OlvaroAB/olea
   ```
   The full `https://github.com/OlvaroAB/olea` URL works too — BRAT strips the prefix, a
   trailing slash and a trailing `.git` before storing it.
6. Set the version dropdown to **Latest version**. That is what keeps Olea auto-updating;
   picking a specific tag instead *freezes* it, and a frozen plugin is skipped by every later
   update run. Olea's releases are prereleases (`0.9.0-alpha.1`), which is fine and needs no
   "allow prereleases" option: BRAT ranks a repository's releases by semver with prereleases
   included rather than asking GitHub for the "latest" release, so a prerelease is found
   normally.
7. Leave **Enable after installing the plugin** ticked, and click **Add plugin**. BRAT
   downloads the release, installs it, and enables it.

That is the whole install. The repository is public, so no GitHub token is needed — public
but unlisted (no topics, no directory entry, no promotion), so the repository name above is
the only way in.

## Did it work?

Open the command palette and type `Olea`. Commands prefixed `Olea:` appearing there is the
proof the bundle loaded and `onload` ran — that is the whole install path, end to end.

**Check which release you are on first, because the three published so far are not
comparable.**

At `0.9.0-alpha.1` there is exactly one command: **Olea: say hello**, raising a notice reading
"Olea is loaded." That release is scaffolding — its `main.js` is 799 bytes and it registers
nothing else. If that is all you see, you are on alpha.1 and should install alpha.3 instead;
nothing else in this document will work.

At `0.9.0-alpha.2` the review loop is real, and the success criterion is the command list, not
a notice. You should see **Olea: Open Olea** (bound to `Ctrl/Cmd+Shift+O`), which opens the
**Today panel** — that panel is the front door, and every other surface is reached through it.
Alongside it: **Olea: Open Today panel** (⌥1), **Olea: Start today's review**, and **Olea:
Create card**. **However, alpha.2's `styles.css` was cut before the Today panel's CSS was
merged into it, so the panel opens unstyled** — install alpha.3 instead; do not use alpha.2 to
judge what the front door looks like.

At `0.9.0-alpha.3` the command set is identical to alpha.2 — same four commands, same names,
same hotkeys — but `styles.css` carries the Today panel's rules, so the panel opens styled.
This is the release to install. Opening Today and starting a review from it is the end-to-end
proof.

You should *not* see a command named "explain something back". It is named in the spec but
deliberately unregistered until the AI half exists — a palette entry that opens something
which explains nothing back would be worse than an absent one. Its absence is correct, not a
missing feature.

To read the version you actually have: **Settings → Community plugins → Olea** shows the
installed version, because BRAT writes the release's own `manifest.json` into
`.obsidian/plugins/olea/`. **Settings → BRAT** lists Olea under the beta plugin list with the
version BRAT is *tracking* — the word `latest`, or a tag marked `(frozen)` if a specific one
was chosen.

## Updating

BRAT updates beta plugins on Obsidian startup by default ("Auto-update plugins at startup",
on unless turned off). It runs about a minute after the workspace finishes loading, and it
installs rather than only checking. Plugins pinned to a specific version are skipped.

To pull an update immediately, run **BRAT: Plugins: Check for updates to all beta plugins and
UPDATE** from the command palette, or use the **Check and update plugin** button on Olea's row
in **Settings → BRAT**.

If Olea updates but the running copy looks stale, run **BRAT: Plugins: Restart a plugin that
is already installed** — reloading the plugin is what picks up the new `main.js`.

## What a release contains

Every Olea release attaches exactly three files, and BRAT reads them directly from the
release's assets:

| File | What it is |
| --- | --- |
| `manifest.json` | plugin id, version, and minimum Obsidian version — **required** |
| `main.js` | the bundle — **required** |
| `styles.css` | styles — optional as far as BRAT is concerned; Olea always ships it |

BRAT looks each asset up by exact filename in the release, so a zip or a versioned filename
would not be found. It reads `manifest.json` out of the release assets and never fetches one
from the repository tree, so the version a vault installs is decided entirely by what the
release carries.

`release.yml` stamps `manifest.json` from the tag name and then re-reads it and fails the job
if the two disagree, so a released manifest and its tag agree by construction. If they ever
did disagree, BRAT takes the release tag as the version and says so rather than installing
silently — but the disagreement would still have shipped, which is why the workflow refuses
first.

## Requirements

- **Obsidian 1.9.10 or newer.** That is the `minAppVersion` in `manifest.json`, and Obsidian
  refuses to load a plugin below it. The floor is set for Bases: Olea's assignments reader
  parses a `.base` file (F1.1), so the vault needs a version of Obsidian in which Bases is
  available to everyone.
- Desktop and mobile are both supported (`isDesktopOnly: false`), though some capabilities are
  desktop-only by design — ingestion drains on desktop only, because mobile operating systems
  suspend backgrounded apps and a long mobile drain would be a promise the platform breaks
  (D-002).

## If something goes wrong

- **"Repository not found"** — check the spelling is exactly `OlvaroAB/olea`. Owner and name
  only, or the plain repository URL; anything with extra path segments (`/tree/main`, an
  issues link) will not parse. BRAT shows this same message for a private repository it has no
  token for, but `OlvaroAB/olea` is public, so spelling is the thing to check.
- **"Add plugin" stays greyed out** — the version dropdown is still on "Select a version".
  Choose **Latest version**.
- **"There are no releases available"** — BRAT installs plugins only from GitHub *releases*,
  never from branch contents. If this appears, no release exists to install and the problem is
  on the release side, not in the vault.
- **"Plugin requires a newer version of Obsidian"** — update Obsidian to 1.9.10 or newer.
- **Installed, but no Olea commands in the palette** — BRAT ticks "Enable after installing" by
  default, but if that box was cleared, the plugin is on disk and switched off. Enable Olea
  under Settings → Community plugins.
- **Enabled, and still nothing beyond "Olea: say hello"** — you are on `0.9.0-alpha.1`, which
  is a scaffolding proof with one command and no features. It exists to prove this install path
  works, and nothing more. This is the single most likely way to conclude "the plugin is
  broken" when it is not: check the installed version under Settings → Community plugins →
  Olea, and if it reads `0.9.0-alpha.1`, install `0.9.0-alpha.3` and start again.
- **Today panel opens but has no styling** — you are on `0.9.0-alpha.2`, whose `styles.css`
  predates the Today panel's CSS being merged into it. Update to `0.9.0-alpha.3`, which carries
  the same commands with the panel's styling restored.
- **Sanity check on the artifact itself.** On the release page, `main.js` should be a few
  hundred KB. If it reads **799 bytes**, that is the alpha.1 scaffolding bundle — a release
  that installs perfectly and does nothing. Byte size is the fastest way to tell a real build
  from a hollow one, and it is worth a glance before every install.

## For maintainers

```bash
# from the repo root
cd packages/plugin
npm_package_version=0.9.x-alpha.N node version-bump.mjs   # stamp manifest + versions.json
cd ../.. && pnpm -r build                                  # emit main.js
git commit -am "chore(plugin): stamp 0.9.x-alpha.N"
git tag -a 0.9.x-alpha.N -m "..." && git push origin main --tags
```

Pushing the tag triggers `release.yml`. It runs `pnpm install --frozen-lockfile` and
`pnpm run build`, re-stamps `manifest.json` from the tag name, re-reads it and fails the job
if it disagrees with the tag, and then creates the release with exactly the three assets
attached. Any tag containing a hyphen gets `--prerelease`; a plain `0.9.0` would ship as a
full release. The trigger is `on: push: tags: "0.9.*"`, which matches `0.9.0`,
`0.9.1`, `0.9.0-alpha.1` and so on — but **not** a `v`-prefixed tag, so do not write `v0.9.0`.

**That workflow ran for the first time on `0.9.0-alpha.2`** (2026-08-15) and succeeded in 27
seconds. `0.9.0-alpha.1` had been published by hand with `gh release create`, never by a tag
push, and `release.yml` only triggers on a tag *push* — so alpha.2 was also its first live
test. Verified afterwards rather than assumed: the published `main.js` is byte-identical to
the local build, and the attached manifest's version equals the tag.

Actions are enabled on this repository (`gh api repos/OlvaroAB/olea/actions/permissions` →
`"enabled": true`) and stay on even while the account is out of Actions credits, because this
repo is **public** and public repos are not billed on standard runners. Only the private repos
draw from the monthly minutes.

The `pnpm -r build` line above is there so the local `main.js` matches what is about to ship —
the workflow builds its own copy from scratch, and `main.js` is gitignored, so nothing built
locally is what gets attached. Build before you run the tests, too: `bundle-install.spec.ts`
loads the built bundle and skips silently when it is absent, so a test run that has not built
first will report green without ever checking the artifact.

One ordering trap worth knowing before the alpha ends: BRAT picks the release with the highest
**semver**, not the most recent one, and `0.9.0-alpha.N` sorts *below* `0.9.0`. Cutting a plain
`0.9.0` therefore ends the alpha series — a later `0.9.0-alpha.4` would be published, marked
prerelease, and never offered to anyone tracking latest.
