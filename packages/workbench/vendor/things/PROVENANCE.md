# Vendored: the Things Obsidian community theme

Third-party CSS, redistributed verbatim under the MIT licence in `LICENSE`.
**Nothing in this directory is Olea's work and nothing in it may be edited.**

| | |
| --- | --- |
| Theme | Things, version 2.2.4 (`manifest.json` at the pinned commit) |
| Author | @colineckert — https://github.com/colineckert/obsidian-things |
| Licence | MIT. `LICENSE` is the file's own copyright notice, reproduced verbatim. |
| Pinned commit | `9b8bef93d3919f7693ac78597beaa35bbbd4cfff` (default branch `main`) |
| Retrieved from | `https://raw.githubusercontent.com/colineckert/obsidian-things/main/theme.css` |
| Retrieved on | 2026-08-10 |
| `theme.css` sha256 | `b98c8b9ba0c3cc67ec42cbe34d5a1aea27a903bc7256351162e6584fb0b686d8` |
| Contains remote references | No. Checked for `@import` and `url(http…)`: none. The file is self-contained, so the workbench build makes no network request and the deployed page loads no third-party asset. |

## Why the whole file, verbatim, rather than an extracted subset

The workbench needs *what a real community theme actually sets Obsidian's CSS
variables to*. Extracting a subset would mean resolving this theme's own
`--base-h/--base-s/--base-d` HSL arithmetic by hand and writing the results down
as if they were the theme's values — which is how a plausible-looking invention
gets committed. Redistributing the file unmodified means the values are the
theme's, provably, and the provenance row above is checkable with `sha256sum`.

Only the `.theme-dark` / `.theme-light` variable declarations have any effect
here: every other rule in the file targets Obsidian application classes that do
not exist in the workbench.

## Refreshing it

Re-download from the URL above, update the commit, date and sha256 rows in the
same change, and do not reformat. `biome.json` excludes `packages/workbench/vendor`
for exactly the reason `docs/design/` is excluded in the service repo: a formatter
run over retrieved-verbatim material destroys the property that makes it evidence.
