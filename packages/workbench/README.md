# olea-workbench — dev tooling

**This is dev tooling. It is not a product surface and it is not a demo.**

A static page that mounts the *real* view components from `packages/plugin` against
`olea-core` and an in-memory `VaultSource` loaded with the **synthetic fixture vault**
(`packages/core/fixtures/vault`), with no Obsidian runtime anywhere. It exists so every
view state can be seen without driving a plugin through a real vault, and so
[WB-2] has a surface to point a browser at.

Bead: **[WB-1] `ol-with`**. The decision that scopes it: **[D-021] `ol-akja`**.

## The demo surface is DEFERRED, and this is not built toward it

Running the views in a browser is, unavoidably, a working demonstration that the core is
portable. That demonstration is real. It is **not an argument**, and `ol-akja` exists so it
is never later cited as one — read it rather than re-litigating the question here. The
plugin-vs-app deferral stands unchanged, and if this workbench is ever proposed as a
product surface, that is a new Class C decision for which `ol-akja` is explicitly not a
precedent.

Practically: nothing here is designed toward becoming a demo. No marketing copy, no
onboarding, no persistence, no accounts, no analytics. A workbench quietly designed to
become a demo acquires demo constraints it was never scoped for.

## Running it

```bash
pnpm --filter olea-workbench dev      # watch + http://localhost:4321
pnpm --filter olea-workbench build    # static output in dist/
pnpm --filter olea-workbench verify   # read-only: is dist/ a complete production artifact?
```

**`dev` never touches `dist/`.** It builds and serves from `dist-dev/`, a sibling directory it
owns and rebuilds on every source edit — see [the build stamp](#the-build-stamp-ol-m34c) for
why that directory still carries its own stamp, and `ol-m34c` for why `dev` no longer writes
to the deployable directory at all.

`dist/` is a plain static directory. One URL per surface × state × variable set × persona:

```
#/<surface>/<state-id>?set=<variable-set-id>&persona=<persona-id>
```

`surface` is one of the sixteen route surfaces named in "What mounts, and what does not" below
(`review` is the default if the segment is anything else). Each surface's own file
(`*-scenarios.ts`) is the source of truth for its addressable states; the two lists below are
the two original surfaces, kept here because nothing since has needed a second worked example.

Review states: `loading`, `empty`, `qa-front`, `qa-reveal`, `cloze-front`, `cloze-reveal`,
`mcq-open`, `mcq-answered-correct`, `mcq-answered-wrong`, `mcq-answered-guessed`,
`note-missing`, `session-complete`.

Today states: `today-nothing-due`, `today-due`, `today-after-writing`, `today-stale`,
`today-unavailable`, `today-scope-not-declared`, `today-rhythm-quiet`, `today-rhythm-fresh`,
`today-after-reentry`, `today-encouragement-off`, `today-term-dates-pointer`.

Variable sets: `obsidian-dark`, `obsidian-light`, `things-dark`, `things-light`,
`things-dark-no-baseline`, `things-light-no-baseline`. The last two deliberately do **not**
model Obsidian — see [Theming](#theming).

Personas: `none` (default), `steady-reviewer`, `crammer`, `instrument-skipper`,
`lapsed-returner`, `struggler`, `empty-history`, `single-session`.

## What mounts, and what does not

Seventeen route surfaces today (`main.ts`'s `RouteSurface`): `review`, `today`, `oracle`,
`retrieve`, `generate`, `timeline`, `explain`, `explain-back`, `session`, `trends`, `rhythm`,
`bulk-review`, `registry`, `plugin-surface`, `grove`, `walk` (a linear mode over the other
six original surfaces' scenario builders — see `walkthrough.ts`'s module doc), and `simulator`
(`ol-3ux7.64`, [E-SIM] — a live, persisted vault and clock over the WHOLE real plugin, not a
scripted state; see "The simulator" below). Every flat/scripted surface mounts either a real
`packages/plugin` view/modal against real `deps`, or — where no product view exists yet for the
underlying mechanism — reports through the inspector and says so on screen, never a hand-built
view model standing in for one.

**Mounts:** `ReviewView` — all seven screens it can render, plus the three MCQ answer
variants, twelve addressable states in total. Every one is reached by sending **real
keystrokes** to the mounted view, resolved by the real `keymap.ts`. Nothing pokes
`ReviewSession`'s internals and no view model is hand-built, so a state that cannot be
reached by a binding the resolver accepts cannot be reached here either.

**Also mounts, since run 11:** `TodayView` (F6.1, `[P2-T09]`, DONE) — eleven addressable
states, built by `src/today-scenarios.ts`. Three of them (`ol-z6x2` [WB-2] F1/C3 tranche)
wire `buildTodayPanel`'s `courseScopeModels`/`courseMaterialArrivals` fields for the first
time — `today-scope-not-declared` (F6.2/F8.1's cross-course scope section, stating the same
"no source registered" fact `grove/copy.ts` states at its own screen), `today-rhythm-quiet`
and `today-rhythm-fresh` (F6.9's rhythm reading: an honest quiet-course line, and its honest
silence when nothing crosses the threshold). No earlier state wired either field, so both
sections rendered nothing until these three existed. `today-due` calls the product's own
`loadTodayPanel` over the same in-memory vault the review states use — a real walk of the
vault's instruments and a real replay of `.olea/reviews/`, not a hand-built view model.
`today-nothing-due` and `today-unavailable` call core's `buildTodayPanel` directly at a
deliberately chosen edge input (an empty instrument list; a `null` one) — still the real,
pure function, just exercised at the input that produces the state, because the fixture
vault has no natural path to "everything already reviewed today."

**`today-after-writing` and `today-stale` reproduce `ol-h3wy`, rather than describing it.**
`TodayView.refresh()` has to be called by something — that was always true, and remains true
after the fix; what changed is *where* `main.ts` calls it (`ReviewView.onClose`, and every
`revealTodayView`). This workbench mounts `TodayView` directly and never runs `main.ts`, so
nothing calls `refresh()` unless a scenario does. Both states write an identical real
review-log record to the vault after the pane has opened, the same way a finished session
does; `today-after-writing` then calls `view.refresh()` and `today-stale` deliberately does
not. The inspector's "vault, recomputed now" row calls `loadTodayPanel` fresh at render time
regardless of which branch ran, so `today-stale`'s screen and its inspector visibly disagree
— that disagreement **is** the bug, not an illustration of it.

**Persona history does not reach this pane.** `readReviewHistory` (`today/data-source.ts`)
reads `.olea/reviews/` only; a loaded persona's stream lives under
`.olea-synthetic/reviews/`, a disjoint namespace by construction (see "The synthetic/real log
boundary" below). So switching `?persona=` changes nothing about any `today-*` state — the
counts are always the real fixture vault's baseline, plus whatever a scenario itself wrote to
`.olea/reviews/`. Stated on the state itself (`today-due`'s note) so it does not read as a
missed wiring.

**`today-*` renders unstyled, and this is a known gap, not a regression.**
`packages/plugin/src/today/today.css` is staged but not yet merged into
`packages/plugin/styles.css` (`today/view.ts`'s own header explains why — it names a
concurrent lane over `styles.css` that this run's build/theme lane also owns). `build.mjs`
copies only `packages/plugin/styles.css` into `dist/plugin-styles.css`, so until that merge
lands, every `today-*` state's DOM is real and correct but carries no `.olea-today-*` rule —
browser-default box styling. Not worked around here: duplicating `today.css` into this
package would be exactly the "second copy of the role layer" this README already argues
against for the theme tokens, and `build.mjs`/`packages/plugin/styles.css` are outside this
lane's ownership this run.

**Also mounts, since the explain/session/trends surfaces landed:**

- **`explain`** (F2.7's grounding half, "why did I get that wrong") is **inspector-only** — no
  product view exists for a bare grounding result, because the prose half that would consume it
  is blocked on `ol-rem6`. `explain-scenarios.ts`'s two states run the real `groundExplanation`
  driver (real keyword search, no embedding provider) over the **real fixture vault**, never
  `packages/synthetic`'s coined corpus, and report through the inspector — the same "no product
  view exists" shape `retrieve` already has, for the same reason.
- **`session`** mounts the real `SessionBuilderView` (F4.6-F4.9, `ol-p5t06b`) over the fixture
  vault, via `session-scenarios.ts`. Four of its six states re-bind real fixture instruments
  onto the ranked concepts the oracle actually returns — the fixture vault as it stands has no
  concept that is both ranked and carries a card, a finding that file's module doc explains in
  full — and carry the `.wb-illustrative-label` inside the host pane because of it. The other
  two states (`session-no-cards-yet`, `session-nothing-to-build`) are left **unborrowed** on
  purpose, so the honest emptiness stays visible and gets no illustrative label: labelling an
  honest screen as illustrative would teach a reader to ignore the label where it matters.
- **`trends`** mounts the real `TodayView` (F6.2's mastery overview, F6.5's spacing/effort
  insights) over a synthetic persona stream, via `trends-scenarios.ts` — a **separate surface
  from `today` on purpose**, so nothing here touches the `today-*` visual-regression goldens.
  Every one of its six states carries the illustrative label: the whole surface runs on
  fabricated history, and two states are negative controls (`planted.neutralise` applied to an
  otherwise-identical seed) so the two detectors' claims are checkable on screen rather than
  only asserted in a test.

**Also mounts — the oracle/retrieve/generate/timeline tranche (`ol-opmb`'s TB-1..TB-4):**

- **`oracle`** mounts the real `GapView` (`../../plugin/src/gap/view.js`) against a
  `SyntheticWorld`'s `mastery → rank → plan → gap` chain, via `oracle-scenarios.ts` — never a
  hand-built `GapViewModel`. Ten states, including three genuinely different `refreshStudyPlan`
  code paths (fresh, stale-but-governing, expired-and-discarded) and one struggling-course
  control. Carries `FIXTURE_ORACLE_ILLUSTRATIVE_LABEL` (D-041) on screen.
- **`retrieve`** and **`generate`** are **inspector-only**, the same "no product view exists"
  shape `explain` uses, for the same reason: there is no screen for a bare grounding or
  generation result yet. Both run the real `oracle/retrieve.ts` / `oracle/generate.ts` drivers
  against the same real, once-embedded `EmbeddingCassette` (and, for `generate`, a real
  `GenerationCassette`) — `retrieve-scenarios.ts` and `generate-scenarios.ts`'s module docs name
  which labelled query demonstrates which state and why that is empirical, not tuning.
  `generation-pending-accept` and `generation-accepted` run the identical chain and differ only
  in whether `acceptCandidates` was called, mirroring the live "Accept" button exactly.
- **`timeline`** mounts the same real `GapView` as `oracle`, but pinned to a whole simulated
  semester with the viewed day as a second URL parameter (`day=<n>`) rather than a state per
  day — `timeline-scenarios.ts`, over `oracle/timeline.ts`'s `deriveOracleTimeline`.

**Also mounts — the F5/F7/F8/F1 tranches (`ol-z6x2` [WB-2]):**

- **`explain-back`** mounts the real `ExplainBackModal` (`packages/plugin`) — a `Modal`, not an
  `ItemView`, the one surface in this package that is not a workspace tab. `main.ts`'s
  `mountExplainBack` opens it as an overlay above the host pane and settles it the same way
  every other surface settles. It never runs the real grading pipeline
  (`gradeExplainBackAttempt`/`acceptExplainBackGradingWithObservation`) — that pipeline's own
  behaviour is covered by `packages/core`'s and `olea-service`'s spec files; every state instead
  injects a canned grade/observation result to exercise the modal's own phase-rendering state
  machine (topic → answering → grading → graded/refused → accepted) and its `[D-171]` "See in
  registry" hand-off, recorded live in the inspector. See "Two additions predate this ledger
  row" below for the `Modal`/`App`/`Workspace` shim this needed.
- **`bulk-review`** mounts the real `BulkReviewController`/`BulkReviewView` (F3.3's triage path
  after generation) over a `MemoryVaultSource` seeded with synthetic pending drafts, via
  `bulk-review-scenarios.ts` — the real `createVaultDraftCacheStore` and `createDraftAcceptPort`
  from `packages/plugin/src/generation/`, the identical recipe `bulk-review.spec.ts` already
  uses. Only the edit port is workbench-local.
- **`registry`** mounts the real `RegistryView` (F8.4) driven by the real
  `buildRegistryModel` (`olea-core`), via `registry-scenarios.ts`. Fed hand-built
  `ConceptRecord`/`VaultInstrumentRecord`/log-entry arrays rather than a walked vault (the same
  posture `trends-scenarios.ts` takes for its own synthetic history), because
  `buildRegistryModel` takes those directly. Rename/withdraw/restore run through the real pure
  `overrides.ts` transforms, held in an in-memory `RegistryOverrides` per scenario instance.
- **`plugin-surface`** mounts the real `OleaSettingTab` (F7) over an in-memory
  `ObsidianDataHost` and a canned `WorkerTaskTransport`, via `plugin-surface-scenarios.ts`.
  Scope is deliberately narrow — only the F7 risk that does not live in the Obsidian runtime
  (rendered copy, a settings section's conditional presence, the "Test connection" status
  line's live text); F7.7's commands/hotkeys/palette entries stay `@manual`. Because the real
  component mounts whole, its other sections (study plan, term dates, base URL/token fields,
  Support) render too, without a scenario asserting them individually.
- **`grove`** mounts the real `GroveView` (F1.5/F8.1) over a hand-built `GroveCourseModel`
  (never a vault walk), via `grove-scenarios.ts` — the three-way source-registration status,
  F8.3's count-and-denominator summary, and F4.10's material gap named in plain language.
- **`rhythm`** is the one surface with **no product view to mount**, and says so on screen
  (`RHYTHM_NO_PRODUCT_VIEW_NOTICE`): it draws RHY-3's multicourse composition rule directly
  against `olea-core`'s real, unmodified `discoverScheduleEvents` → `associateScheduleEvents` →
  `computeScheduleFreshness` chain, over the fixture vault plus one synthetic calendar note.
  Presentational-only workbench code, not a product renderer — `[D-072]`'s reachability clause
  is explicitly not discharged by this pane.
- **`walk`** is not a seventh product surface but a linear re-presentation of the other six
  original surfaces' own scenario builders, plus two pseudo-surfaces of its own (`'note'`,
  rendering her fixture note's own markdown with no plugin code involved, and
  `'oracle-fixture'`, the same real `GapView` `oracle` mounts, over the real fixture vault
  instead of the synthetic corpus, per D-041). `walkthrough.ts` is data and derivation only —
  `main.ts` is still the one place that mounts a screen.

### The simulator (`ol-3ux7.64`, [E-SIM])

`#/simulator` is not a scripted state — it is a live, persisted vault (an IndexedDB overlay over
the fixture snapshot) and a page-level clock, over the **whole real plugin**, mounted through
`obsidian-shim/mount-plugin.ts`'s `mountPlugin(OleaPlugin, { vault, pluginData })`
(`simulator/controller.ts`, `ol-3ux7.64.10` [WBX-1b]). The plugin's own `onload()` registers every
command, view and the settings tab; the controller opens the Today panel once, right after mount,
through the real `OLEA_COMMAND_TODAY_OPEN` command, so the pane never starts blank. Day-advance,
jump-to-date and reset all do a full unmount/re-mount — the plugin's own `onunload`/`onload`, the
same as a real Obsidian reload.

**Degraded fallback.** `OleaPlugin.onload()` reads `navigator.onLine` and calls
`window.setInterval` directly, bypassing the shim (`test/obsidian-shim-whole-plugin.spec.ts`'s own
module doc names this as an "environment gap between plain Node and a real browser, not a gap in
this shim"). Every real browser has both; this package's own Vitest suite (plain Node, no
jsdom/happy-dom dependency) does not. `SimulatorController` checks for both before every mount
attempt and, if either is missing, degrades to a single-view `TodayView` mount with a notice
naming exactly which global is absent — never a silent blank pane or an uncaught throw partway
through `onload()`.

**Nothing is left in a "does not exist yet" or "deliberately not shimmed" state today.** Two
things this README used to say don't mount — a triage view, and `OleaSettingTab` — both now do:
`bulk-review` (F3.3) is that triage path, and `plugin-surface` (F7) is the settings tab, once
the ledger's row 7 (below) worked out what shim it actually needed. Left here as a Class A
correction (a live document must be current, never backwards-looking) rather than silently
dropped, since both statements were cited as design constraints while they held.

## Persona history (SYN-1, `ol-6vyi`)

**The problem it solves.** WB-1 rendered every history-bearing surface against nothing:
`priorState` was a hand-made "reviewed once, rated Good" stub, every `selectionContext`
field was an explicit `null`, and the empty screen's next-due line was a written-down word.
SYN-1 named this workbench as its first consumer for exactly that reason.

**What loads.** `?persona=<id>` generates that persona's ninety-day D7.1 stream with
`olea-synthetic`, replays it through the product's own FSRS scheduler using **only the
emitted records**, and hands the result to the queue seam. The window is anchored so the
stream ends the day before the workbench's fixed today, with an assessment three days after
it, so `examProximity` counts down instead of being null.

| Surface | What the persona changes |
| --- | --- |
| `qa-reveal`, `cloze-reveal` | The four FSRS interval previews. They are a pure function of `priorState`, so this is where a persona is most visible: `struggler` reads `tomorrow / in 3 days / in 4 days / in 5 days` where `lapsed-returner` reads `in 4 days / in 213 days / in 292 days / in 464 days`. |
| `mcq-answered-*` | The single interval label under the answered MCQ, from the same `priorState`. |
| `empty` | `nextDueLabel`, derived from the soonest due date across her whole replayed deck — including the `null` that `empty-history` correctly produces, which reaches F2.2's "Nothing is due right now" branch. Nothing else in the workbench reaches that branch. |
| `session-complete` | `dueSoonCount`, because the summary counts items whose *actual resulting* interval is due today or tomorrow. |
| The review-log record in the inspector | `selectionContext.dueState` (derived from the scheduler's own output, never assigned), `examProximity`, and the record's `masteryAtTime`. |
| The inspector's log-namespace line | The persona's own day-files, read back out of the vault. |

**`masteryAtTime` is `synthetic-provisional`, inherited rather than created.** The workbench
does not compute it: it echoes the value from the persona's own last record for that
instrument, whose provenance is SYN-1's `MASTERY_STABILITY_BANDS`, a placeholder until
C5.4's rollup exists. Since review-log v4 (`ol-g6zg`) it lives on the record as a per-concept
map rather than as one number inside `selectionContext`; the provenance is unchanged by the
move, and the composer still writes none of its own. The inspector says so on screen whenever
a persona is loaded.
**No threshold anywhere in this package is fitted to a persona**, and none may be (N-015).

### The synthetic/real log boundary

Two log namespaces, disjoint by construction:

- `.olea-synthetic/reviews/` — the persona's history, written through
  `writeSyntheticStream`, which **refuses the whole `.olea/` namespace and throws**. That
  guard is not disabled, softened or given a resolver override anywhere in this package. The
  workbench writes to an in-memory vault, so honouring it costs nothing — and a test points
  the writer at core's own `reviewLogPath` and requires the throw, with the vault unchanged.
- `.olea/reviews/` — what the mounted session writes, through core's real
  `appendReviewLogRecord`.

Every synthetic event carries the `syn:evt:` stamp, and the inspector re-reads **both**
namespaces after every render and states the result. That check is possible only because
`MemoryVaultSource.list()` does not skip dot-directories the way `FolderSource` does — worth
knowing before anyone tries the same check against a folder on disk.

### The real queue is in (`ol-mtpn`, DONE)

The composer landed, and the four-step swap this section used to describe as future work has
been carried out exactly as written:

1. **`src/queue/derive.ts` shrank to "call the composer".** It no longer synthesises anything:
   `olea-core`'s `buildReviewSession` walks the fixture vault for its *real* instruments — the
   actual `::` cards, `==…==` clozes and `olea-mcq` blocks — replays the review log into
   per-instrument scheduling state, and composes a session. `packages/plugin`'s
   `adaptReviewQueue` turns that into `ReviewQueueItem[]`.
2. **`scenarios.ts`'s `queueItem()` is deleted**, along with `priorStateFor` and the
   `workbenchSelectionContext` stub. Nothing in this package decides `priorState` or
   `selectionContext` any more; whole `ReviewQueueItem`s arrive from the composer.
3. **`PersonaHistory.queueItemFor` is gone.** The persona layer keeps writing her history
   into `.olea-synthetic/reviews/`, and gains one small replacement, `entriesFor`, which maps
   her stream onto the vault's real instrument ids. The positional join survives as a relabel
   of *log entries* rather than a copy into a queue field, so the depth a surface shows is now
   a consequence of replaying a history.
4. **The open decision was resolved the second way: the workbench feeds the composer parsed
   records.** `deriveWorkbenchQueue` takes entries, not a folder, so `olea-core` never learns
   `.olea-synthetic/` exists and the generator's guard against `.olea/` is untouched — nothing
   in this path writes at all. The forbidden third option, pointing the generator at
   `.olea/reviews/`, was not taken, and the test that requires the throw still passes.

Two consequences of composing for real, both visible on the counts strip rather than hidden:

- **F2.17's dedupe offers one instrument per concept**, so a single composition over the
  fixture corpus cannot reach every card type. Three compositions are run over one
  enumeration and one replay, differing only in `formatPreference` — F2.17's own injected
  seam, whose whole point is that the *caller* decides which format to prefer.
  `dedupeByConcept: false` is deliberately **not** used: that flag is F2.17's named
  exam-proximity relaxation, and a harness switching it on to make its screenshots easier
  would be the workbench asserting a product behaviour to suit itself.
- **The queue never draws early (F2.8, Phase A)**, so with a persona loaded most of her deck
  is scheduled past `WORKBENCH_NOW` and several personas compose to an empty session on 15
  January. Correct product behaviour, useless harness. The workbench therefore composes at
  `WORKBENCH_NOW` *or the day her latest-scheduled instrument comes due, whichever is later* —
  an instant **derived from her replayed state**, deterministic, and printed on the counts
  strip. All twelve states render for all eight personas; nothing about any item's
  `dueState`, `priorState` or ordering is fabricated to get there.

## The shim, and the ledger of everything that pushed on it

`src/obsidian-shim/` is the entire Obsidian API this needs: `ItemView`,
`WorkspaceLeaf.detach()`, `Component.registerDomEvent`, `Notice`, and Obsidian's
`createDiv`/`createEl`/`createSpan`/`empty`/`addClass`/`toggleClass`/`setAttr` DOM helpers.
That is the chrome layer: facts about the window, never about review.

INV-1 is not weakened to make this work. Nothing under `packages/workbench` imports
`obsidian`; `tsconfig.json`'s `paths` and `build.mjs`'s esbuild alias redirect that
specifier — for this package's compilation and bundle only — at the shim. This package sits
under `packages/`, so `scripts/check-inv1.mjs` scans it like any other.

**The ledger.** Every place a view or its ports wanted more than a shallow shim, and which
way it went. This is the deliverable, not a footnote: it is INV-1 pressure found by running
rather than by inspection.

| # | What wanted more shim | Verdict | Bead |
| - | --- | --- | --- |
| 1 | `createObsidianNoteExistsPort(app)` asks `app.vault.getAbstractFileByPath(path) !== null` — which would need `App` in the shim. | **Move core-ward.** `VaultSource.exists(path)` already answers exactly that question, with no Obsidian in it. The port can take a `VaultSource`. Shim not grown; `App` is deliberately absent. | `ol-t5lj` |
| 2 | `SuspendPort.suspend(instrumentId)` cannot write a durable suspend record: core has `appendSuspendRecord` and the frozen schema has a suspend event (D-020), but the port's signature carries no `conceptId`, which that record requires. | **Interface change, escalated.** Not worked around; the workbench's suspend stops at a `Notice`, same as the plugin's own port. | `ol-97u2` |
| 3 | Queue composition. `[P2-T07]` was unbuilt, so the workbench had to synthesise `ReviewQueueItem[]` itself (`src/queue/derive.ts`). | **DELETED, on its deletion date.** The composer landed (`olea-core`'s `session/` + `buildReviewSession`), `derive.ts` shrank to calling it, and `scenarios.ts`'s `queueItem()` and `PersonaHistory.queueItemFor` went with it. See "The real queue is in" above. Nothing workbench-side decides `priorState` or `selectionContext` any more. | `ol-mtpn` |
| 4 | `EditPort.edit()` opens the source note in a split (`app.workspace.openLinkText`). | **Genuinely chrome, no core-ward move.** Opening an editor beside the session is host window management. The workbench reports it with a `Notice` rather than faking an editor. No bead. |  |
| 5 | Presentation logic living in `view.ts` — `formatCourseList`, the session-complete paragraph's pluralisation and conditional clauses, the MCQ feedback sentence, the `again/hard/good/easy` label map and the `1..4` keycap digits (already in `keymap.ts`'s `RATING_KEYS`). | **Move core-ward.** None of it forced the shim to grow, but all of it is untested-by-design copy assembly in the DOM layer — including sentences that assert a schedule. | `ol-09kf` |

| 6 | Isolating the host pane in an iframe (`ol-mioe`) needed the Obsidian DOM helpers in the frame's realm, since prototypes are per-realm. | **Chrome, and the shim doing its job.** `installObsidianDomHelpers` takes a window and `createEl` creates through `this.ownerDocument` instead of the ambient global. No new *member* was added — the surface is the same list of Obsidian APIs. Obsidian's own helpers work this way for the same reason: it pops tabs into separate windows. |  |
| 7 | `OleaSettingTab` (F7's real settings pane, `ol-z6x2` F7 tranche) needs `Setting`/`PluginSettingTab`/`Plugin`/`TextComponent`/`ButtonComponent`/`requestUrl` to render whole — form-row layout, a name/description/control API, and the type shape of the one adapter (`privacy/obsidian-adapters.ts`) F7.4's privacy section pulls in transitively. `ol-0r92.29`'s F2.10 toggle later added `addToggle`/`ToggleComponent` to the same surface — the first boolean control any F7 section needed. | **Chrome, grown per the WB-1 rule.** Verified by grep first (only `setName`/`setDesc`/`setHeading`/`setDisabled`/`addText`/`addButton`/`addToggle` on `Setting`; no `addDropdown`/`setTooltip`/`setCta`). `requestUrl` is a real `fetch()`, never a throw, since a later tranche's fixture may exercise the delete path this one's states never click. | `ol-z6x2`, `ol-0r92.29` |

**Two additions predate this ledger row and are recorded here rather than left silent:**
`Modal`/`App`/`Workspace` (`ol-z6x2`'s F5 tranche, for `ExplainBackModal`'s `[D-171]`
"See in registry" hand-off) landed with their own module doc in `obsidian-shim/index.ts`
but no ledger row — see that file's doc for the argument. **The sentence this replaces —
"nothing was added to the shim to make a view render, the shim's surface today is exactly
what it was when the first view mounted" — stopped being true at that tranche and is
corrected here (Class A) rather than left standing as stale-but-present authority** (the
project's own rule on that: a live document that is not archive must be current, never
backwards-looking). The shim has grown three times since WB-1 landed, every time logged
either here or in the module doc it grew, and every time chrome by the same test.

## Findings the workbench produced by running

- **F2.4's dark-by-default strategy mixes light and dark tokens under a real community
  theme.** `view.ts` puts `theme-dark` on the view's own root while the host body carries
  `theme-light`. Any theme that declares a variable in only *one* of its two branches then
  leaks the wrong half into the "dark" view. Reproduced with Things: it sets
  `--background-modifier-hover` only in its `.theme-light` block, so under
  `?set=things-light` every `.olea-review-keycap` became a light-grey glyph on a
  light-grey chip — unreadable. Bead `ol-ro57`. Reproduce at
  `#/review/qa-reveal?set=things-light`.

  **Fixed, and re-measured in run 9 rather than assumed: this no longer reproduces.** Driven
  headless across all four variable sets, the keycap's computed background stays
  `rgba(255,255,255,0.055)` under `things-light` even though the frame body resolves
  `--background-modifier-hover` to Things' light `#e2e5e9` — the `olea-host-fallback` cascade
  layer in `styles.css` is holding the dark floor, which is exactly what `view.ts`'s header
  claims it does. The finding is left standing because the *shape* is still the live hazard
  (`styles-host-vars.spec.ts` is the permanent guard); only the specific unreadable rendering
  is gone.

  **Re-read after `ol-itiu`: that measurement was taken with the baseline stripped**, since
  the switcher then loaded one sheet at a time. Its set id is now
  `things-light-no-baseline`. It still says what it said — with no baseline, the
  `olea-host-fallback` layer holds the dark floor — but it was never a statement about a real
  install. Under all three load models the keycap chip resolves **dark**, and for three
  different reasons, which is why `ol-ro57`'s fix does not depend on the unresolved scoping
  question:

  | Load model | Where `--background-modifier-hover` comes from on the review root | Result |
  | --- | --- | --- |
  | Things alone (`*-no-baseline`) | Nothing matches the root; `@layer olea-host-fallback` supplies `rgba(255,255,255,0.055)` | dark |
  | Baseline + Things, bare-class scoping | The baseline's `.theme-dark` matches the root directly: `rgba(255,255,255,0.075)` | dark |
  | Baseline + Things, `body`-alias scoping | Again nothing matches the root; the layer floor is reached | dark |

  Things declares that variable only in its `.theme-light` block, which reaches the root by
  *inheritance* — and an inherited value loses to any declaration on the element itself,
  including one inside a cascade layer. That is the whole mechanism, and it is why the layer
  was the right fix.

  One correction to the record while re-reading it: **Things declares 3 of the 8
  branch-varying variables `styles.css` reads, not 2** — `--text-muted` and `--text-faint` in
  both branches, plus `--background-modifier-hover` in the light branch only. The one-branch
  case is the entire subject of this finding, so leaving it out of the count erases the
  interesting member. `--interactive-accent` is not one of the 8: it is one of the four
  branch-invariant reads, which `styles.css` deliberately keeps out of the fallback layer.

- **`view.ts` reads the ambient global `document`, so it misbehaves in any document but the
  first one.** Found by putting the view in an iframe (`ol-mioe`): `render()` decides whether
  to restore focus with `root.contains(document.activeElement)`, and with the view in another
  document that read is answered by the *top* document and always says no. This is not an
  artefact of the harness — **Obsidian pops tabs out into separate windows**, which is why it
  exposes `activeDocument` / `el.win` at all, and the same code has the same bug there. The
  fix is `el.ownerDocument`, in `packages/plugin`. Bead `ol-rq23` (`[WB-1f]`).

## Theming

The switcher supplies **Obsidian's own CSS variables** and nothing else. The
`--olea-host-*` role layer already exists, once, in `packages/plugin/styles.css` (ported
from the approved `docs/design/pass1/tokens/theme-host.css`), and the workbench loads that
file **unmodified** at build time. A second copy of the role layer here would be a second
thing to keep in sync.

- `src/themes/obsidian-default.css` — Obsidian's default theme, dark and light. Base
  colours are copied from the official CSS-variables reference; the semantic mapping is
  *not published* and is this workbench's reconstruction. The stylesheet header says so.
- `vendor/things/theme.css` — the Things community theme, 2.2.4, redistributed verbatim
  under MIT. See `vendor/things/PROVENANCE.md` for the pinned commit and sha256. Nothing in
  that directory is Olea's work or may be edited.

Scoping is Obsidian's own: values live under `.theme-dark` / `.theme-light`. Selecting a
light set leaves the review surface dark — that is F2.4 working, not the switcher failing.

### Which sets model Obsidian, and which strip the baseline on purpose (`ol-itiu`)

Obsidian's `app.css` is **always loaded and cannot be disabled**. A community theme is
layered on top of it and overrides selectively; it is written expecting a baseline
underneath, and Things proves it — Things *reads* `--background-primary`, `--text-normal`
and `--background-modifier-border` while declaring none of them.

| Set | Sheets, in cascade order | Models Obsidian? |
| --- | --- | --- |
| `obsidian-dark` / `obsidian-light` | `obsidian-default.css` | Yes — the baseline, no theme over it |
| `things-dark` / `things-light` | `obsidian-default.css`, then `things.css` | **Yes** |
| `things-dark-no-baseline` / `things-light-no-baseline` | `things.css` alone | **No, deliberately** |

`data-wb-baseline` is `"present"` or `"stripped"` on both the `<iframe>` and the frame's
`<body>`. **Any Q6.1 evidence from this workbench must say which**, because the two answer
different questions:

- **baseline present** — what her Obsidian would show.
- **baseline stripped** — which of Olea's own fallbacks are load-bearing when the host is
  silent. Useful, and not a claim about Obsidian.

**Every workbench finding recorded before `ol-itiu` was measured under the stripped model,
whatever set id it names**, because the switcher loaded one sheet at a time. Re-read them
that way; the two below have been.

#### What the reconstruction cannot tell you, and why it does not block the fix

`obsidian-default.css` declares its semantic roles under **bare `.theme-dark` /
`.theme-light`** selectors. Real `app.css` may instead alias them in a `body` block from
per-branch `--color-base-*`. **That mapping is not published and has not been checked
against an installed copy of Obsidian.** It matters because F2.4 nests a `theme-dark`
review root inside a `theme-light` body: under bare-class scoping the root matches the
baseline's dark block directly; under `body`-alias scoping nothing in the baseline matches
the root at all, and those reads fall to `styles.css`'s `@layer olea-host-fallback` floor.

**Both are dark**, which is why `ol-ro57`'s fix is correct under either model — see the
finding below. The exact *colours* differ, so a `things-light` screenshot is faithful only
under the first model. A second stylesheet modelling the other scoping is deliberately not
shipped: it would be a second unverified guess offered as if it were a choice. The question
is answerable — by reading `app.css` out of an installed Obsidian — and nobody here has done
it.

## INV-3

### The fixture vault is copied verbatim and never encoded — read this before adding a build step over her content

`build.mjs` copies `packages/core/fixtures/vault` into `dist/vault/` **unmodified**, writes
a manifest that is nothing but the sorted list of paths, and the page `fetch`es those files
at runtime. Nothing is embedded in the bundle and nothing is encoded.

The first version of this package did embed it, base64'd into a generated TypeScript module.
It worked. It was wrong, and the reason generalises:

> **Every INV-3 control this project has is a plaintext search.** `INV3_MARKERS`, the
> real-title backstop, and the tree-wide sweeps that caught *both* real leaks so far are all
> string searches over text. A build step that base64s the corpus leaks nothing by itself —
> it takes the corpus out of reach of every one of those controls, silently, while they keep
> reporting green. That is a check that cannot fail, which is strictly worse than a check
> that fails: it is `ol-inv2vacuity`'s failure shape in a new costume.

With a straight copy, the source tree and the build artifact hold **the same greppable
markdown**, so sweeping either is equivalent to sweeping the other — and that equivalence is
a property of `cp`, not of anyone's discipline.

**Corrected by run 9's pre-deploy gate: do not read that as "a sweep can skip `dist/`", which
is what this paragraph used to say.** The vault copy is byte-identical (`diff -r` against
`packages/core/fixtures/vault` shows no content difference), but the build also *writes* a
generated `manifest.json` into `dist/vault/`, and the artifact around it — `app.js`,
`plugin-styles.css`, the vendored themes — is not in the source tree at all. Run the sweep
against `dist/` itself: it is one command, and the equivalence argument covers 52 of the 53
files in there. There is also a second reason a repo-root sweep does not reach it —
`scripts/check-inv3.mjs` has `dist` in its `SKIP_DIR_NAMES`, so it walks past the artifact
even when pointed at the repo root. It has to be given the path.

The cost is 50-odd small requests on load and a dependency on being served over HTTP. Both
are free: this has always been an ES-module page and has never worked from `file://`.

**If you add a step that transforms, packs, minifies or encodes anything derived from her
content, you are removing it from the controls. Say so out loud and get it decided, rather
than discovering later that a green sweep meant nothing.**

### The rest

- **Fixture content only.** The real-vault snapshot and `eval/data` are never read, never
  referenced, and are in a different repo. `packages/core/fixtures` is read and never
  written.
- **No fixture string is hardcoded anywhere in this package.** Not a title, not a course
  code, not a concept name. Since the composer landed, the workbench does not even key on
  *structure* any more: it asks `olea-core` what instruments the vault holds and renders
  whatever comes back, so a fixture rename (`ol-yj9`) changes what the workbench shows and
  breaks nothing.
- **Persona history is fabricated too, and stays that way.** `olea-synthetic`'s vocabulary is
  coined nonsense tokens verified zero-hit against the real-vault snapshot, and the workbench
  joins it to fixture instruments *positionally* — never by name, so no fixture string enters
  this path either. Every fabricated event is identifiable forever by its `syn:evt:` id.
- **No baked tokens, and no channel for one.** The build has no `define` and reads no
  `process.env`, so there is no path by which an environment value could reach the bundle.
  At runtime the page fetches only its own fixture vault from its own origin; it makes no
  third-party request and calls no model. If AI flows are ever exercised from this surface,
  the staging token is entered at runtime by the operator and never persisted.
- The one sentence on screen that is not fixture-derived is the MCQ feedback line, which
  says so in its own text: in the product that line is model-generated (F2.15).

## The host pane is its own document (`ol-mioe`)

`[data-wb-surface]` is an `<iframe>`, and the theme stylesheet, `packages/plugin/styles.css`
and the Obsidian-shell layout rules all live inside it. The chrome document loads
`workbench.css` and nothing else.

**This is about evidence, not tidiness.** WB-2 takes per-state × per-variable-set screenshots
as Q6.1 evidence, and evidence contaminated by the harness's own chrome is weak evidence.
`[data-wb-surface]` was already the intended screenshot target; a separate document makes
that boundary **real rather than conventional**. The previous defence was a zero-specificity
`:where(*)` reset in `workbench.css`, and a theme rule at higher specificity beat it —
Things' `body:not(.default-font-color) strong` is (0,2,1), which is why WB-1 had to stop
using `<strong>` in the chrome at all. That reset is gone and `<strong>` is back.

Verified in headless Chromium: with the chrome's `<strong>`, the inspector and the active nav
item measured **byte-identical computed colour, font, letter-spacing and text-transform under
all four variable sets**, and the chrome document reports exactly one stylesheet.

**Keystroke dispatch is unchanged, and was checked rather than assumed.** States are still
reached by dispatching a real `KeyboardEvent` at `view.contentEl`, resolved by the real
`keymap.ts`; the event is now constructed with the *frame's* `KeyboardEvent` so the whole
dispatch happens in one realm. `#/review/qa-reveal` still reveals on Space and renders four
real FSRS previews inside the frame; `session-complete` still rates three items through and
writes three review-log records. Nothing is poked into existence and no view model is
hand-built.

Two costs, both stated rather than discovered later:

- The DOM helpers must be installed into the frame's realm (ledger row 6).
- `view.ts`'s focus restoration stops working inside the frame, because it reads the global
  `document.activeElement`. The workbench never depended on it — keys go straight to
  `contentEl` — but it is a real product bug for Obsidian's popped-out windows. Filed as
  `ol-rq23` (`[WB-1f]`); the fix is in `packages/plugin`, which this lane does not own.

WB-2 reaches inside the frame with Playwright's `frameLocator`. `data-wb-variable-set` is set
on both the `<iframe>` element and the frame's `<body>`, so the state × set matrix is still
readable from the top document without entering the frame.

## Known limits

- Writes go to the in-memory vault and vanish on reload. That is deliberate: nothing here
  should be able to modify the fixture vault on disk. Switching persona blanks the previous
  persona's day-files rather than deleting them (`MemoryVaultSource` has no delete), which is
  why the inspector counts log files by content rather than by listing.

## For WB-2 (`ol-z6x2`), which is not this bead

No Playwright, no visual-regression harness and no `@auto-web` tags live here. What WB-1
left in place so that pass is cheap:

- **One URL per surface × state × variable set × persona**, reloadable and order-independent.
- **`[data-wb-surface]`** — the screenshot target, and since `ol-mioe` a separate document,
  so its pixels are the product's and nothing else's. Reach inside it with `frameLocator`.
  **Not the same thing as the route's `surface` segment** — that one is
  **`[data-wb-route-surface]`** (`"review"` or `"today"`), on `<html>`, kept as a separate
  attribute name specifically so the two never collide.
- **`[data-wb-state]`**, **`[data-wb-variable-set]`** and **`[data-wb-persona]`** — the
  state × set × persona matrix, readable from the top document.
- **`[data-wb-baseline]`** — `"present"` or `"stripped"`, on the `<iframe>` and the frame's
  `<body>`. `ol-itiu`'s acceptance criterion is that evidence says which load model produced
  it; reading this attribute into the screenshot's own metadata is how that stops depending
  on anyone remembering.
- **`[data-wb-log-boundary]`** on the inspector — `"held"` or `"broken"`. A screenshot pass
  gets the synthetic/real log-boundary check for free by asserting on it.
- **`[data-wb-ready="true"]`** on `<html>`, set only after the scripted keystrokes have
  settled. The wait condition, so no test needs a sleep. (`loading` never sets it — that is
  the state's definition.)
- **`[data-wb-notice]`** — one element per `Notice` the host would have shown.
- **Determinism**: a fixed clock, fixed prior scheduling states, deterministic event ids and
  index-based instrument picks. A screenshot taken twice is the same screenshot.

## The build stamp (`ol-m34c`)

**What happened, so this reads as a record rather than a precaution.** On 2026-08-15 a
`node build.mjs serve` from three days earlier was still holding port 4321 with a watcher on
the real `dist/`. Seven minutes after a production build finished, an unrelated source edit
made that watcher write a **3,352,881-byte dev bundle over the 447 KB production `app.js`**.
`index.html`, `_headers` and `plugin-styles.css` were still the production build's. Nothing
in the directory recorded that its files came from two builds, so nothing could have
noticed — and `dist/` is what the pre-deploy privacy gate is run against. It was caught by a
human comparing a reported file size against the file on disk.

`ol-ie7t` fixed the case where a serve *fails*: it binds its port before touching anything, so
a clash is a clean non-destructive exit. Ordering could not help with the case above, because
that overwrite was a *successful* build doing what it was asked — so `ol-m34c` closed it a
different way: `serve` now builds and serves from `dist-dev/`, a sibling of the deployable
`dist/`, and never writes to `dist/` at all. A live watcher simply has no path to the
deployable artifact any more, successful or not.

The stamp below predates that fix and remains useful independently of it: a one-shot
`node build.mjs` (no args) still legitimately leaves a dev build sitting in the deployable
`dist/` until the next `production` build, and the stamp is what lets `verify` catch that,
plus any other tampering or partial write.

So every completed build writes `dist/build-stamp.json`: the mode it ran in, when, how many
watcher rebuilds have happened since, and the size and SHA-256 of every other file in the
directory. The watcher rewrites it on every rebuild, so the stamp cannot go stale while the
thing it describes changes underneath it — which is the exact shape of the failure.

`node build.mjs verify` reads it back and answers in one command, with three exit codes a
gate can act on without parsing prose:

| Exit | Meaning |
| --- | --- |
| `0` | A complete production artifact: every file matches the stamp, and the stamp says `production`. |
| `1` | **Mixed or tampered** — a file changed since the build, went missing, arrived from somewhere else, or there is no stamp at all. This is the incident above. |
| `2` | Internally consistent, but not a production build (`development` or `serve`). Never deploy it. |

**The stamp carries nothing environment-derived** — no pid, no user, no absolute path, no
`process.env` — for the same reason the bundle has no `define`: `dist/` is a public surface,
and the surest way to keep a credential-shaped string out of it is to have no channel for
one. `test/build-stamp.spec.ts` asserts that, alongside the three exit codes and a
reconstruction of the mixed directory using a real dev bundle.

`WB_DIST` overrides the deployable output directory, which is how the tests build throwaway
artifacts instead of clobbering the deployable one. `serve` derives its own `dist-dev`-shaped
directory from whatever `WB_DIST` resolves to, so a test pointing `WB_DIST` at a scratch
directory gets an equally-scratch serve directory beside it.

## Deploying

Run `pnpm --filter olea-workbench verify` first — a `dist/` that exits 1 or 2 is not the
thing any gate was run against.

See `wrangler.toml`. The workbench deploys to Cloudflare Pages from `main`; the exact
project settings are in the WB-1 report. Nobody deploys from a lane.
