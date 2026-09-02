# Olea — plugin monorepo (public, unlisted)

An AI study companion that lives in an Obsidian vault. This repo is the **client half**: core
logic, the plugin, and the shared contracts. The Worker lives in the private `olea-service`
repo alongside the beads database.

## Authority order — the docs are the contract

The contract documents live in **`../olea-service/docs/`**, not here. They are private and stay
in the private repo under INV-3; both repos share this workspace, so every agent can still reach
them. This repo's `docs/` holds only developer-facing material with no real content in it.

1. `../olea-service/docs/Olea_alpha_functional_scope.md` + `Olea_knowledge_model.md` — **the
   contract.** They define the F/C/R/D/Q identifiers, and nothing here — task, commit or test
   — is named without one. An amended clause names the decision that changed it inline; find the
   underlying bead id and `bd show` it for the argument.
1a. `../olea-service/docs/Olea_architecture_boundary.md` — **normative for where things run**,
   and it governs this repo directly: `[D-069]` is what makes this repo public and the service
   private. Read §1 before writing any code that touches state. Its line is **storage, not
   processing**, and an artifact delivered to the client is not protected — merely absent from
   the source tree.
1b. `../olea-service/docs/Olea_component_register.md` — **normative for where each component
   runs**, and the per-item owner map for `[D-069]`. Check it before assuming a module belongs in
   this repo because that is where the file happens to sit today.
1c. `../olea-service/docs/Olea_vocabulary_registry.md` — **normative for the words the student
   sees.** Reaching for a forbidden word, or using a listed word in another sense, is a conflict
   to flag rather than a judgement call.
2. `../olea-service/docs/Olea_ai_workload_and_cost_model.md` — where the slots, the criteria
   for picking a model, and the five empirical eval questions are set out. It guides rather
   than binds: model picks are config (C4.6).
3. `../olea-service/docs/Olea_v09_implementation_plan.md` — the quality approach, the invariants,
   and **§2.7's five-clause Definition of Done** — clause 5 being the reachability rule
   (`[D-072]`): a task delivering a capability names its production caller by `file:line`, or
   records why there deliberately is not one yet and which bead adds it. Its **§3 "Phases" is
   retired** — see the task protocol below.
3a. `../olea-service/docs/archive/foundation/` — **the foundation rounds, archived 2026-08-28 (`ol-egov.6`); the target state they ratified lives in the contract documents via `[D-076]`.** Where a
   contract document still describes the pre-foundation world, that gap is tracked work: file it,
   do not report it as a defect, and never treat it as a constraint on what may now be designed.
4. **Decision beads** (`bd list --type decision`) — the durable record of every call and its
   argument. An **open** decision bead is a `proposed` decision and **blocks** its consumers;
   closing it is what releases their work. There is no markdown decisions ledger — see
   `[D-012]`, which records that deviation from plan §0.2.

**If an implementation suggests a feature the contract doesn't name, it goes in as a proposed
decision bead — never silently into the code.** Plausible capabilities invented mid-build are
adopted deliberately or not at all.

## The six invariants — enforced, not remembered

The normative wording is the implementation plan's invariants section
(`../olea-service/docs/Olea_v09_implementation_plan.md`); what follows is this repo's own
restatement of what each one obliges an agent working here to do.

- **INV-1** — no `obsidian` import outside `packages/plugin`. Biome rule + `scripts/check-inv1.mjs`
  in CI; `packages/core/test/inv1.probe.spec.ts` proves the enforcement fires.
- **INV-2** — a file this project writes back must differ from the one it read only in the edit
  that was asked for; every other byte survives. The golden suite proving that is permanent CI
  furniture — it may **grow, and nothing ever leaves it**.
- **INV-3** — **this repo carries synthetic fixtures exclusively.** No real-world vault content,
  review logs, or eval data reaches it in any form; CI greps for real-content markers as a
  tripwire. INV-3 **applies to bead text as well** — the beads database spans both repos, so
  anything written into a bead from here is a public surface.
  **Rescoped 2026-08-14 by D-029 (`ol-sxul`) — read that bead before acting on INV-3.**
- **INV-4** — the three recording disciplines go in **ahead of** whatever generates their data:
  review logging with the instrument type on the record (D7.1); prompt and model stamping
  (D7.3); eval-set hygiene (D7.2). Wire them late and the history is simply gone.
- **INV-5** — a generative pipeline does not ship until a test starves it of context and holds
  it to refusing. One such test per pipeline; a new pipeline means a new one, always.
- **INV-6** — no AI output lands in the deck or the vault until she has accepted it.

## Commands

```bash
corepack enable                 # pnpm 10.33.0 is pinned in packageManager
pnpm install
pnpm -r lint                    # Biome
pnpm -r typecheck
pnpm -r test                    # Vitest
pnpm -r build                   # plugin bundle via esbuild → main.js
node scripts/check-inv1.mjs     # INV-1 tripwire; must exit 0
```

Release = cutting a tag. `0.9.x[-alpha.N]` triggers a GitHub Release carrying exactly
`manifest.json`, `main.js`, `styles.css` — the BRAT artifact set. Shipping the alpha is cutting
a tag; see `docs/dev/brat.md`.

## Task protocol

- **Ordering: streams and readiness gates, not phases.** The `phase:pN` scheme and its
  `E-P0`..`E-P6` epics were **retired 2026-08-21** — those epics are closed and the labels survive
  only as historical provenance. Work sits under eight stream epics and closes through six
  readiness gates, `RG-B` then `RG-0`..`RG-4`. Build work follows the dependency graph and may run
  cross-stream in orchestrator-designated lanes, with contracts frozen before a lane forks.
  **Absent a designated lane, run `pnpm run next` in `../olea-service` and take from the top** —
  it ranks by what closing a bead releases, which is the question "lowest open phase" used to
  answer badly.
- **There is no fixed cap on concurrent lanes.** David retracted the "max 3 concurrent" line on
  2026-08-16 — it had been here since the protocol was written and he had never set it. **The real
  constraint is file ownership, not a count:** before forking a lane, name the paths it owns, and
  never let two live lanes hold the same file. State the ownership map in each brief; that is what
  makes the concurrency safe, and a count never was.
- The beads database is in `../olea-service/.beads/` (D-010) and spans **both** repos. Pull your
  frontier from it rather than loading the plan into context. **`bd` does not resolve from this
  repo** — it finds no workspace here, so use one of:
  ```bash
  bd -C ../olea-service ready          # or: export BEADS_DIR=../olea-service/.beads
  ```
- **Cite by path, never quote.** Real content lives in a small number of sanctioned locations,
  all outside this repo and enumerated in the private repo's `CLAUDE.md`. Reference such a source
  **by path**; never paste a line of its text into this repo, into bead text, or into a findings
  note or run report. Quoting an already-private source is the leak path this project has, and
  bead text, commit messages and next-run prompts travel onward by default. INV-3 governs bead
  text for exactly that reason.
- Every finished bead carries **evidence** in its notes — commit hash, test id, captured output
  — before it closes. Never "done" without evidence. Hand back `blocked` with a reason rather
  than abandoning silently.
- Work uncovered mid-task is filed as a new bead with a `discovered-from` edge, **never absorbed
  into the current task**.
- Commits are conventional, with the bead id, the stable alias, and contract refs:
  `feat(core): MCQ rating mapping caps at Good [ol-p2t06 / P2-T06] (F2.16)`
- **A scenario file is part of starting any F-numbered bead — check it before you write code.**
  **BDD scenarios live in the PRIVATE repo**, at `../olea-service/features/`, and are written
  **when the task starts, before implementation**, tagged `@auto:<testID>` or `@manual`. They
  moved there because they describe in detail how Olea behaves and why, which is not something
  this repo may carry. If a bead's labels carry an `F<n>.<m>` ref and
  `../olea-service/features/F<n>-*.md` has no scenario for it, writing that scenario is the first
  step of the task. **An `@auto:<testID>` tag names a test in THIS repo** — the scenario is
  private, the test it points at is public, and that split is deliberate.
- **Escalate to the orchestrator**: interface, contract-schema, or review-log-schema changes;
  spec conflicts or deviations (→ an open decision bead → David); any task that fails its gate
  twice; any privacy-touching diff.

## The run charter (D-018)

A run does not end at the end of its written scope. It lands the plane at an internal
checkpoint, generates its own next prompt, and continues — until a stop condition fires:
**(a)** a Class C decision blocks the critical path, **(b)** a ship or gate requires David,
**(c)** verification quality is degrading under context pressure, in which case it
checkpoints, re-spawns with fresh context, and continues rather than skims.

**Verification depth is never traded for scope.**

Which decisions you may make alone. Note the ladder is drawn around **reversibility and who
bears the consequence**, not around difficulty — a hard refactor is Class A, a one-word
change to a persisted enum is Class C (D-017 is the worked example).

- **Class A — self-ratify, log on the bead:** naming, internal refactors, test
  infrastructure, p2 discovered-item handling, doc corrections.
- **Class B — proceed with the reversible default, flag for retroactive review:** interface
  adjustments within contract version N, non-persisted enum/vocabulary choices, threshold
  tunings.
- **Class C — always stop:** anything touching C6/privacy or INV-3, persisted schemas, ships
  and gates, spend commitments, contract amendments, **deployed secrets and infrastructure
  state**, anything changing what the alpha user experiences.

**Standing rule, added 2026-08-10 (`ol-4eq4`):** *Lanes and implementers never rotate,
overwrite, or mutate deployed secrets or infrastructure state. A locked door is a stop, never
a lock change.* Rotating a secret invalidates every credential derived from it, **including
ones whose existence the rotator cannot see**. Being blocked is the correct end state for a
lane that hits a locked door.

**Secrets live in Infisical** (`ol-1w0b`), reached through the `olea-auth` shell function that
both shells already source, and injected only at the moment a command runs
(`infisical run -- <command>`) — never written to a file. **This repo is public, so it holds no
credential path, no project id and no value:** the credential-file location, the machine-identity
procedure and the CLI's traps are all in `../olea-service/docs/runbook-secrets.md`. If you are
about to paste a token anywhere in this tree, you are doing the wrong thing.

Re-read this file at every internal checkpoint. One consolidated report per run: done /
Class B items for retroactive review / Class C stops with options / what waits on David /
next-run prompt.

## Footguns

- **Frontmatter round-trip is sacred.** Run the golden tests before any writer change. Standard
  YAML libraries are a *wrong answer* even when semantically correct — they re-quote and
  re-order. C1.3 requires wikilinks-inside-frontmatter to survive byte-identical.
- **Parse the fixture vault's shapes, not CommonMark completeness.**
  `packages/core/fixtures/vault/` defines the parser's scope, and its README maps every
  deliberately-nasty case to the invariant it guards.
- **The fixture vault is synthetic and must stay that way** (INV-3). Anomalies observed
  elsewhere become *new synthetic fixtures* here, never one-off patches. Mirror the *structure*;
  invent everything else. A fixture that keeps a real title, phrasing or identifier has carried
  content across the boundary, however faithful it feels.
- **The INV-3 CI tripwire has never actually run** — `INV3_MARKERS` is unset, so `check-inv3.mjs`
  exits 0 with a loud warning (that is the designed behaviour, not a pass). **Never cite a green
  CI run as evidence INV-3 held.** Note the ceiling on it even once populated: it greps for
  *recurrence of strings someone already knew to list*, so it structurally cannot catch a string
  nobody thought to list, nor inspect anything that is not text it is pointed at. The judgment at
  the moment you type the string is the control; the tripwire is not.
- **`bd update --notes` REPLACES the notes field; `--append-notes` appends.** A wholesale
  replace has already destroyed another agent's evidence once. Default to `--append-notes`.
  (bd 1.2.1 prints a warning when it happens; the replace still happens.)
- **`bd close` on an ALREADY-CLOSED bead silently does nothing.** It prints the tick, echoes
  your new reason back in full, and exits 0 — while the stored `close_reason` stays whatever the
  first close wrote. Re-verified on bd 1.2.1: unchanged. Workaround: `bd reopen <id>` then
  `bd close <id> --reason "…"`. There is no `--close-reason` flag on `bd update`.
- **"Push complete" from `bd dolt push` is not evidence of anything**, and the LOCAL
  `refs/dolt/data` never advances, in either repo. The only acceptance test for backlog
  replication is a **changed value from `git ls-remote origin 'refs/dolt/data'`**. A check
  written against the local ref reports the same answer forever. Note also that
  `bd hooks run pre-push` does **not** push the Dolt database, and exits 0 having synced nothing.
- **There are two global `bd` installations on this box, and only one is on the PATH.**
  `/root/.npm-global/bin/bd` shadows `/usr/local/bin/bd`, and npm's configured prefix is
  `/usr/local` — so the obvious `npm install -g @beads/bd@<version>` upgrades the copy that is
  *not* the one you run, prints "added 1 package", and leaves `bd --version` unchanged. Upgrade
  with an explicit `npm install -g --prefix /root/.npm-global @beads/bd@<version>`, then confirm
  with `bd --version` and `which -a bd`.
- The three above are one family — **a command that reports success while changing nothing** —
  and apply in either repo. The defence is to read the resulting state back (`bd show --json`,
  `git ls-remote`) rather than trusting an exit code.
- **A design mock is not a spec, and its body copy is where inventions hide.** A
  speculative-element review looks at *components*, and these arrive as *sentences*. Check every
  sentence in a mock that asserts a number, a schedule, or a consequence against the contract;
  that is where "the system does X" gets decided by nobody.
- **Check the stable-alias namespace before assigning one** (`bd list --all`, grep the parent's
  aliases). A duplicated alias makes two beads read as one in every later citation.
- Scheduling state is per **instrument** (R3), not per concept. The `Scheduler` interface takes
  instrument ids and nothing in it may mention concepts.
- No LICENSE file is deliberate — all rights reserved during the unlisted alpha.
