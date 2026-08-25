# Review-log fixtures (C5.2, D7.1, P2-T03, D-020)

Golden JSONL fixtures for the review-log format (`packages/contracts/src/review-log.ts`).
All ids and content are invented (INV-3) — `imbrication`, `bioturbation`,
`cementation` and `appoggiatura` echo concept names used in `packages/core/fixtures/vault/`
so a reader can see this as "the same invented student's" data, but nothing here is real.

**Four schema versions live here on purpose.** D-020 bumped the log to v2 (adding the `kind`
discriminator and the suspend/unsuspend record type); `ol-t3sd` bumped it to v3 (replacing
`conceptId` with `conceptIds`, because one instrument may be evidence for every concept its note
names); `ol-g6zg` bumped it to v4 (moving `masteryAtTime` out of `selectionContext` onto the
record as a per-concept map, because each concept an instrument names has its own mastery). The
v1, v2 and v3 files below are *not* stale and must **never** be regenerated or migrated: they are
the only evidence in the suite that the old read paths and the `upgradeV1` / `upgradeV2` /
`upgradeV3` migrations still work, and deleting or "fixing" one would delete the test of the
migration along with the data. `golden.spec.ts` asserts against the raw bytes of each that it
really is still at its own version, precisely so that a well-meaning migration fails loudly
instead of silently removing the coverage.

**The rule, restated because it is the one that gets broken:** this suite is *extended, never
pruned*. A schema bump adds files at the new version alongside the old ones. It never rewrites a
file that is already on disk — a fixture at an old version is the evidence that history at that
version still reads correctly, and there is nowhere else that evidence can come from.

## Frozen v1 history — never regenerate

- `2026-08-10.device-desktop.v1-legacy.jsonl` — **FROZEN. Do not edit, migrate or regenerate.**
  One desktop device's full, well-formed log for the day, exactly as a pre-D-020 build wrote it:
  `"schemaVersion":1` and no `kind` field anywhere. Three records covering `qa`, `cloze`, and
  `explain-back` (the non-FSRS-scheduled instrument type D7.1 still requires logged, F2.14/F2.16).
  The `explain-back` record's `rating` and `durationMs` are `null` (F2.16: it produces no rating),
  and every record's `selectionContext.examProximity`, `.yieldRank`, and `.planVersion` are
  explicit `null` — the Phase A shape (queue is plain FSRS order, no plan published yet, C7.6) —
  never an omitted key. `golden.spec.ts` reads it to assert that a semester of v1 history parses
  and is upgraded to v2 review events, never discarded and never guessed at.

## Frozen v2 history — never regenerate

Everything in this section was current before `ol-t3sd`. It is now what a semester of
already-written v2 history looks like in her vault, and it is read through `upgradeV2`. Each file
still carries `"schemaVersion":2` and a singular `"conceptId"`, and must keep doing so.

- `2026-08-10.device-mobile.jsonl` — a second device's log for the *same* calendar day: one new
  record, plus a duplicate of the desktop file's second record (same `eventId`, `22222222-...`)
  simulating a retried sync appending the same event twice. Note the duplicate is a *v2* copy of a
  *v1* record: the merge tests therefore also prove that an upgraded v1 record and a natively-read
  v2 record of the same event collapse to one, rather than looking like an id collision.
- `2026-08-10.device-crash.jsonl` — what a device's log file looks like immediately after a
  crash mid-append: one complete, newline-terminated record, followed by a truncated JSON
  fragment with **no trailing newline** (`{"schemaVersion":2,"kind":"review","eventId":"55555555-...","timestamp":"2026-08-10T20:1`,
  cut off mid-value). `parse.spec.ts` asserts `parseReviewLog` recovers the first record and
  reports the fragment in `invalidLines` rather than losing or throwing on either.
- `2026-08-10.device-tablet.v2-suspend.jsonl` — suspension events (F2.6's durable half)
  interleaved with reviews in the same daily file, which is how they really appear. Six lines,
  deliberately covering the two cases a naive projection gets wrong:
  - **out of order** — `mcq:appoggiatura:1` is unsuspended at 11:15 on the line *before* the
    line that suspends it at 09:40. A projection that folded by array position would call it
    suspended; the correct answer, by timestamp, is that it is not.
  - **unsuspend with no preceding suspend** — `explain-back:cementation:1` has only an
    `unsuspend` at 12:00. That is an ordinary sync state (the suspend may be in a file that has
    not arrived), so it is a no-op, not an error.
  - `cloze:bioturbation:1` is suspended at 09:20 and never unsuspended in this file, so it
    is the one instrument the projection over this file alone reports as suspended.
- `2026-08-10.device-phone.v2-suspend.jsonl` — the second device of the suspension merge pair.
  Two lines: a byte-for-byte duplicate of the tablet's suspend of `cloze:bioturbation:1`
  (same `eventId`, `bbbbbbbb-...`), which must collapse to one event, and an `unsuspend` of the
  same instrument at 13:00 from a *different* event, which must survive alongside it. Merging the
  two files and projecting shows the split of responsibility D-020 settled on: the merger
  deduplicates and orders, and the projection — not the merger — decides that the later unsuspend
  won and nothing is suspended at the end of the day.

## Frozen v3 history — never regenerate

- `2026-08-10.device-laptop.v3.jsonl` — a fourth device on the same calendar day, writing what
  the writer produced between `ol-t3sd` and `ol-g6zg`. Four lines, each covering something the
  earlier versions structurally could not say:
  - **a v3 copy of an event that also exists as v1** (`11111111-...`, the desktop file's first
    record). Merging the two files must collapse it to one, which is the v3 restatement of the
    property the v1/v2 pair already proves: a record reaching one device through the migration
    chain and another natively is the *same* record, byte for byte, not an id collision.
  - **a review naming two concepts** (`77777777-...`, `conceptIds` of length 2) — the case the
    version exists for, and the case no v1 or v2 line can express.
  - **a suspend naming two concepts** (`88888888-...`) for the same instrument. The suspend
    record moved in step with the review record deliberately: the instrument→concept binding is
    not reconstructible later, so "what did she stop studying?" and "what did she practise?" must
    not answer with different numbers of concepts for the same instrument on the same day.
  - **an explain-back naming two concepts** (`66666666-...`) with `rating` and `durationMs` both
    `null` (F2.16), proving the multi-concept case and the no-rating case compose.

  Note what is *not* here and cannot be: a v3 fixture with two concepts that was migrated from
  v2. `upgradeV2` maps `conceptId` to a **one**-element `conceptIds` and nothing cleverer,
  because the second concept was never captured and cannot be invented — a guess persisted into
  an append-only log is indistinguishable from a fact, forever. Every migrated record in this
  suite therefore has exactly one concept, and that is the correct, checked outcome.

  **This file is also the whole reason review-log v4 has a `not-attributable` case.** Its
  `77777777-...` line names two concepts and carries a single `masteryAtTime`, migrated in place
  to `"sprout"` under the ratified vocabulary (`D-049`/`VOC-1`; on disk before that migration it
  read `"coming"`, the retired word this file's prose used to quote here). Which of the two
  concepts that state described was never captured, so a per-concept map cannot be
  built from it honestly: splitting it across both asserts something the log never said, and
  picking one invents a primary concept. The migration therefore keeps the value and declines
  the attribution. The alternative was to edit or drop this line, and INV-2 forbids both — the
  suite is extended, never pruned, which is exactly why the v4 shape had to accommodate the
  fixture rather than the fixture accommodate the shape.

## Current v4 fixtures

- `2026-08-10.device-workstation.v4.jsonl` — a fifth device on the same calendar day, writing
  what the writer produces today (`ol-g6zg`). Six lines:
  - **a v4 copy of the event that also exists as v1 and as v3** (`11111111-...`). Merging all
    three files must collapse it to one, which is the v4 restatement of the property the v1/v2
    and v1/v3 pairs already prove: a record reaching one device through the full migration chain
    and another natively is the *same* record, byte for byte, not an id collision. Its
    `masteryAtTime` is the one-entry map `upgradeV3` produces from a single-concept v3 record,
    which is what makes the byte comparison meaningful rather than trivially true.
  - **two concepts, each with its own `masteryAtTime` entry** (`12121212-...`) — the case the
    version exists for, and the case no earlier version can express at all: a v3 record could
    say only one state for a two-concept review, never which concept it described; a v4 record
    keys the state per concept instead. Before the ratified vocabulary landed (`D-049`/`VOC-1`)
    the two concepts here held two different retired-vocabulary states (`"coming"` and
    `"shaky"`); D-049's collapse merges both onto the single word `sprout`, so on disk today
    both entries read `"sprout"` — identical values, still two independent map entries. That
    coincidence is a known side effect of the migration, not a re-authored fixture (INV-2): the
    line is left exactly as it was written and still demonstrates the *structural* case (an
    independently-attributed map entry per concept), just no longer two *differing* values. The
    differing-values case now lives on a new line, `16161616-...`, appended below (`ol-gwuo`).
  - **`masteryAtTime` absent entirely** (`13131313-...`) — what every vault writer produces
    today, and will until C5.4's rollup (`ol-p4t06`) exists. Absent means "not recorded", which
    is exactly what `null` meant in v1–v3. Note the contrast with `yieldRank`, `examProximity`
    and `planVersion` on the same line, which are still explicit nulls: those are scalars in a
    fixed-shape object, and omitting one would make "we had no value" and "we never recorded
    this field" indistinguishable a semester later.
  - **an explain-back naming two concepts** (`14141414-...`) with `rating` and `durationMs` both
    `null` (F2.16) and no `masteryAtTime`, proving the multi-concept, no-rating and
    not-recorded cases compose.
  - **a v4 suspend** (`15151515-...`). The suspend record carries no `selectionContext` and so
    has no mastery to attribute; it moves to v4 anyway, because `schemaVersion` is read per line
    and one daily file must never hold two current versions.
  - **two concepts, two genuinely different post-migration `masteryAtTime` values**
    (`16161616-...`, appended by `ol-gwuo`) — the case `12121212-...` demonstrated before the
    vocabulary collapse and can no longer, restored as a *new* line rather than an edit to that
    one (INV-2/append-only discipline; the bullet above states why editing it was never an
    option). `imbrication` holds `"sprout"` and `cementation` holds `"sapling"` — two adjacent
    values from the ratified four-stage enum (`masteryState` in `contracts/src/review-log.ts`:
    `seed` → `sprout` → `sapling` → `tree`), chosen as fixture data, not a schema change. Together
    with `12121212-...` it also shows the two-record contrast: same map shape (two concepts, two
    map entries), one line's values happen to coincide post-migration and the other's do not —
    `golden.spec.ts`'s whole-vault merge test checks both, distinctness included.

  Note what is *not* here, and cannot be written by anything: a line carrying the
  `not-attributable` form of `masteryAtTime`. That form exists only as the output of
  `upgradeV3` reading the v3 laptop fixture — no writer produces it, nothing rewrites a log
  file, so it can never reach disk. Its on-disk evidence is the v3 line it is produced from,
  one section up.
