# Olea synthetic fixture vault

Bead: **[P0-T07] Synthetic fixture vault**, rebuilt under **`ol-snpq`/`ol-vs57`**. This vault
replicates the *structures* observed in the alpha user's real Obsidian vault (functional scope
§8.1) with **entirely invented content** — invented course codes, invented lecture titles,
invented concepts, invented authors. **INV-3** holds here by construction rather than by review:
every identifier in this vault was invented for it, so none of hers is available to leak. The
screening that established that is recorded in
`olea-service/findings/INV3-fixture-vocabulary.md`. Two invented courses stand in for hers: **GEOL204**
(Sedimentary Successions, WEEK-organised) and **MUSTH104** (Tonal Harmony and Counterpoint,
text-organised by studied work — F1.3).

## The rule is literal, and that is a ruling — not a phrasing

The sentence above was ambiguous for three runs and the repo and the rule disagreed the whole
time. **David ruled on 2026-08-10 that it is to be read literally** (`ol-vs57`, `ol-yj9`): a
term that occurs *anywhere* in her vault — including in ordinary body prose, and including
generic textbook vocabulary that identifies nobody — may not be used here as a course code, a
note title or a concept name. The narrower reading that was on the table ("no real
*identifying* string") was **rejected**. Do not re-narrow it in a comment, a commit message or
a stopword list.

Two things follow for anyone adding a fixture:

1. **The oracle is not a marker list.** `INV3_MARKERS` is a list of strings someone already
   knew to write down; every real collision found so far was an ordinary academic word that
   nobody would have listed. The oracle is the read-only real-vault snapshot in the private
   repo, and the test is *zero hits*.
2. **The test is mechanical and you can run it.** From `olea-service`:

   ```
   node scripts/check-fixture-vocabulary.mjs --term 'Your candidate term'
   ```

   A candidate is usable only if the whole term **and every constituent word of it** returns
   zero, word-bounded and case-insensitive, in snapshot file content *and* in snapshot
   filenames. That is a much harsher bar than it looks — established by measuring an earlier
   lane's candidate list against the real-world vault snapshot, including one candidate whose
   full phrase was clean while its second word was not. The screening yield is private; see
   `olea-service/findings/INV3-fixture-vocabulary.md`. Running the script with no arguments
   gates the whole vault.

   It is a **local** gate. Its oracle is private and gitignored, so it is absent from CI in
   both repos and cannot run there. Never read a green CI run as evidence this rule held.

## Why the courses are in these two subjects, and why that is the fix

**Renaming terms one at a time does not converge, and three passes proved it.** The vault's two
original invented courses were built — unknowingly — in the same subject domains as two of her
real courses. (Which domains those are stays in the private repo; that is the point of INV-3,
and this file is public.) Plausible vocabulary in a shared subject collides term for term:
`ol-snpq` re-derived the collision set with a consistent constituent-word method, established by
measuring against the real-world vault snapshot, and found it far larger than the first pass had
reported — including two terms that recur across a large share of her documents. The collision
counts are private; see `olea-service/findings/INV3-fixture-vocabulary.md`. Three renaming
passes (7 terms, then 4, then 1 family) each replaced a term inside a course whose *whole
vocabulary* was the problem.

**David ruled (run 4) that the courses be rebuilt in disjoint DOMAINS, not renamed ones.** The
replacements are deliberately chosen for structural richness in subjects that appear nowhere in
her vault:

- **GEOL204 — sedimentary processes.** Mechanism- and sequence-heavy: ordered stages, a
  transport-to-burial chain, and "describe the sequence" questions that give the flashcard-front
  heading shape (F2/F3) something real to bite on.
- **MUSTH104 — harmony and voice-leading.** Contrast-pair- and rule-heavy: prepared versus
  unprepared dissonance, one cadence against another, and a prohibition (consecutive fifths)
  that behaves like a rule with exceptions.

Every distinctive term in both courses was screened against the snapshot before use, whole and
word by word, and cleared. `KNOWN_OUTSTANDING` in `check-fixture-vocabulary.mjs` is now
**empty**, and the gate passes under `--all`, which ignores the baseline entirely — so this
vault satisfies the rule outright rather than merely improving on what preceded it. The
measurements behind that are private; see `olea-service/findings/INV3-fixture-vocabulary.md`.

**One consequence worth stating, because a later run will otherwise re-derive it the hard way:**
now that no fixture course shares a subject with any of hers, her subject vocabulary can enter
the `INV3_MARKERS` list **wholesale** without generating fixture false positives. That was
impossible while the fixture courses lived in her domains — every marker would have fired on
this directory. See `ol-inv3markers`.

This file is the index P1-T02's golden test suite is built from: one line per regression case,
naming what it is a fixture for and exactly where it lives.

## Structural fixtures (F1.x / C1.x baseline shapes)

- Folder layout `00`–`05` incl. Zettelkasten — vault root.
- Daily note with a Schedule block carrying class times — `00 Daily notes/2026-08-10.md`.
- WEEK-organised course folder — `01 Courses/GEOL204/WEEK 1|2|3/`.
- Text-organised course folder, one subfolder per studied work (F1.3) —
  `01 Courses/MUSTH104/Chorale No. 12/`, `01 Courses/MUSTH104/Sonatina in D/`,
  `01 Courses/MUSTH104/Minuet and Trio/`.
- Question-headed hierarchical outline notes (flashcard-front headings, F2/F3 premise) —
  most lecture notes under `01 Courses/**`, e.g.
  `01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md`
  ("Describe the stages of clast alignment in a rolling bedload") and
  `01 Courses/MUSTH104/Sonatina in D/Exposition Summary.md`
  ("How does the unaccompanied first subject carry meaning before the harmony moves?").
- Curated `topic` frontmatter property, consistent vocabulary within each course so course↔
  concept M:N is testable (F1.4 / P1-T05) — GEOL204 notes share `Sediment provenance`,
  `Clastic deposition`, `Diagenetic burial`, `Stratigraphic succession` across
  `01 Courses/GEOL204/WEEK 1/*.md`, `WEEK 2/*.md`, `WEEK 3/Lecture - Cementation...md`; MUSTH104
  notes share `Harmonic progression`, `Chromatic harmony`, `Cadential preparation`,
  `Contrapuntal doubling` across `01 Courses/MUSTH104/**/*.md`.
- Embedded-PDF note (F1.6) — `01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform
  Stratification.md` embeds `Geol204-Week2-Slides.pdf` via Obsidian's embed syntax (two
  square brackets around the filename, prefixed with `!` — written without the brackets here
  so this line itself doesn't read as a literal embed to a naive `![[...]]` scanner, e.g.
  P5-T02's `packages/core/src/concept/evidence.ts`, which reads every note's raw text for real
  embed references); the PDF itself is a real,
  minimal one-page valid PDF at
  `01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf` (615 bytes, hand-built objects/xref).
  **Its page text is `GEOL204 Week 2 - Stratigraphic succession`, and the fact that this names a
  `topic` value verbatim is load-bearing, not decorative** — it is the only generated-content
  citation the tier-3 evidence leg can find once the vocabulary includes topic names
  (`concept/evidence.spec.ts`). Verified byte-exact against `pdftotext -raw` (poppler 22.12.0):
  the string round-trips with no clipping, which the previous fixture's 39-character line did
  not — it overran the 300pt MediaBox and `pdftotext` truncated it, so the old "verified to
  extract with pdftotext" claim was weaker than it read. Font size is 12pt for that reason.
- Hub-and-spoke linking — lecture notes across both courses link out to atomic concept notes in
  `05 Zettelkasten/` (e.g. `[[Bioturbation]]`, `[[Imbrication]]`, `[[Appoggiatura]]`,
  `[[Suspension]]`), and the zettels cross-link each other, matching the graph shape observed in
  her real vault.
- **Instruments, in every format the two format modules implement** (F2.1, F2.15, C5.3) — the
  vault carried *no* card syntax of any kind until this addition, which is why
  `card-format.ts`'s header says the fixture vault "could not settle" the dialect question.
  Everything downstream of parsing (queue composition, the review view, the workbench, the
  end-to-end session proof) needs a corpus that actually contains instruments, and a
  round-trip suite that loops over a vault with none in it passes vacuously. Placed only in
  notes that already carry a `topic` property, so every instrument binds to a concept:
  - Q&A, **all four** default-syntax styles — single-line `::` and single-line-reversed `:::`
    in `01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md`,
    multi-line `?` in `WEEK 1/Lecture - Introduction to Clastic Sediment.md` and in
    `01 Courses/MUSTH104/Sonatina in D/Exposition Summary.md`, multi-line-reversed `??` in
    `WEEK 3/Lecture - Cementation and Burial Diagenesis.md`, plus single-line `::` in
    `01 Courses/MUSTH104/Chorale No. 12/Phrase One - Close Listening.md` and
    `Minuet and Trio/Cadences and Suspensions.md`.
  - Cloze, **both** delimiters — two `==…==` deletions on one line in
    `WEEK 1/Lecture - Introduction to Clastic Sediment.md` (so the multi-deletion path, where
    the other deletions render as ordinary text, has a fixture), one more in
    `Minuet and Trio/Cadences and Suspensions.md`, and `{{…}}` in
    `WEEK 3/Lecture - Cementation and Burial Diagenesis.md`.
  - MCQ — a pool of **five** with `feedback` and `id` in
    `01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md`, and the
    **floor** case of exactly four with neither in
    `01 Courses/MUSTH104/Sonatina in D/Exposition Summary.md`. Both are written in
    `serializeMcq`'s canonical form, because `test/instrument/golden.spec.ts` requires every
    non-`hand-typed` fixture block to re-serialize byte-identically.
  - **No scheduling data and no `#flashcards` deck tag anywhere** — `card-format.ts` is
    explicit that Olea writes neither, so a fixture carrying either would make a
    regression indistinguishable from a fixture that always had it. The foreign-`<!--SR:…-->`
    and block-id cases stay in `fixtures/instruments/qa-and-cloze.md`, where they belong.
  - Distribution is itself the fixture: both courses carry cards *and* an MCQ, and several
    concepts carry two or more instruments (`Sediment provenance`, `Clastic deposition`,
    `Diagenetic burial`, `Stratigraphic succession`, `Contrapuntal doubling`, `Chromatic
    harmony`) so per-concept dedupe downstream has a corpus that gives it a real decision to
    make. Asserted in `packages/core/test/instrument/vault-instruments.spec.ts`.
- Lecture-note template — `04 Templates/Lecture Note Template.md`.
- Citation-workflow research notes with `citekey`/`authors`/`year` frontmatter —
  `03 Research/*.md` (all five files; author surnames Norling, Petrov, Adeyemi, Vance, Halloran
  and Reyes are unchanged across the rebuild — they were verified clean and are not
  subject-bearing).
- Obsidian Bases assignments table — `02 Assignments/Assignments.base`, querying 14 individual
  assessment notes in the same folder (7 per course, weights sum to 100 each), due dates spread
  Aug–Nov 2026, `type` values `Quiz` / `Assignment` / `Lab` / `Test`. The `.base` file itself is
  unchanged by the rebuild: it names folders and property keys, never a course.
- Obsidian callouts (P1-T01 gap-closing addition — the block model names callouts but no fixture
  file had any) — a plain `> [!note]`, a titled `> [!tip]`, a foldable `> [!warning]- Title`, and
  one containing a nested list, all invented GEOL204 exam-prep content —
  `01 Courses/GEOL204/WEEK 3/whirlwind-recap-callouts.md`.

## Nasty cases — regression fixtures for P1-T02's golden/property tests

- **Wikilink in a bare frontmatter value, space-separated multi-link form** (C1.3 — the shape
  the functional scope names as the frontmatter a YAML library cannot round-trip: an unquoted
  value holding two space-separated wikilinks. **Cited by reference, not reproduced.** The
  scope's own example is lifted verbatim from her vault, so pasting it here would carry real
  content across the INV-3 boundary while feeling like sourcing — that is exactly how DP-1's
  leak happened. Cite the source, do not paste it. An invented value of the same shape is
  `tags: [[Schist]] [[foliation]]`) —
  `03 Research/Norling 2019 - Turbidite Bedform Successions.md`, field
  `related: [[Imbrication]] [[Hummocky stratification]]`. **Verified with PyYAML `safe_load`:
  this raises a hard parse error** (`expected <block end>, but found '['`) — a failure worse
  than silent mangling, because a YAML-library frontmatter parser cannot get the file open at
  all. Treat this as the highest-value case in the set; the analysis that ranks it there is in
  `olea-service/findings/P1-real-vault.md`.
- **Wikilink in a quoted frontmatter value** (C1.3) —
  `03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md`, field
  `related: "[[Deceptive cadence]]"`. PyYAML parses this "successfully" but yields the plain
  string `"[[Deceptive cadence]]"`, losing the wikilink's semantic identity — the
  silent-mangling failure mode, distinct from Norling's hard failure.
- **Wikilinks inside a flow-style (`[a, b]`) list frontmatter value** (C1.3) —
  `03 Research/Vance 2020 - Grainsize Fining Models.md`, field
  `related: [[[Imbrication]], [[Bioturbation]]]`. **Verified with PyYAML:** parses
  without error but silently reinterprets each `[[X]]` as a nested one-element list
  (`[['Imbrication'], ['Bioturbation']]`) rather than two wikilinks — semantically
  wrong output with no error raised, the most dangerous failure mode of the four.
- **Wikilinks inside a block-style (`- item`) list frontmatter value** (C1.3) —
  `03 Research/Halloran 2018 - Chorale Doubling in Keyboard Realisation.md`, field:
  ```
  related:
    - [[Appoggiatura]]
    - [[Consecutive fifths]]
  ```
  Same silent-string failure mode as the flow-list case, in block form.
- **Wikilink-shaped `topic:` values** (C1.3 × F1.4, `ol-aq2p`) — her live convention writes
  `topic` as a wikilink pointing at the concept note, and until this addition **no fixture note
  did**, so the dereference path in `concept/extract.ts` (`wikilinkTarget(item) ?? item`) was
  exercised only by temp vaults built inside `src/concept/extract.spec.ts` and never by the
  committed corpus. Two shapes now exist:
  - a **flow list mixing a wikilink with a plain string** —
    `01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md`, field
    `topic: [[[Sediment provenance]], Diagenetic burial]`. Note this is the same byte shape as
    Vance's `related` nasty case (PyYAML silently reads each `[[X]]` as a nested one-element
    list), now on the property whose *meaning* the concept layer depends on rather than on a
    property nothing reads.
  - a **block list whose items are wikilinks, one quoted and one bare** —
    `01 Courses/MUSTH104/Sonatina in D/Exposition Summary.md`, field
    `topic:` / `  - "[[Cadential preparation]]"` / `  - [[Contrapuntal doubling]]`.

  **Both dereference to names that other notes write as bare strings**, which is the actual
  invariant: `Sediment provenance` is a wikilink here and a plain string in
  `WEEK 1/Lecture - Introduction to Clastic Sediment.md`; `Contrapuntal doubling` is a wikilink
  here and a plain string in `Minuet and Trio/Cadences and Suspensions.md`. So the two spellings
  must land in **one** `ConceptRecord`, and the regression this guards is the silent *split*
  into a `[[Sediment provenance]]`-named concept beside a `Sediment provenance`-named one —
  which nothing downstream would error on. Asserted in
  `packages/core/test/concept/fixture-topic-binding.spec.ts`.

  **Deliberately still tier 2, and this is a ruling not an oversight.** Neither target is a
  Zettelkasten title, so neither binds at tier 1 — the fixture's `topic` vocabulary and its
  zettel titles are different grains on purpose (see the `topic` bullet above), and
  `src/concept/extract.spec.ts` asserts *every* fixture concept is tier 2. Pointing one of these
  at a zettel title to force a tier-1 binding would also, as a side effect, delete that title
  from the tier-3 mint's negative case — the same "fix one fixture, silently rewrite another
  suite's premise" trap the `Suspension`/"settling fallout" note at the end of this file
  records.
- **Non-alphabetical / meaningful frontmatter key order** — `00 Daily notes/2026-08-10.md`
  (`date`, `courses-today`, `status` — not alphabetical; a YAML library round-trip would
  re-sort to `courses-today, date, status`).
- **Mixed quoting styles within one file** (bare + single + double) —
  `03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md`: `citekey` is
  bare, `authors` is a single-quoted flow list (`['A. Petrov', 'K. Adeyemi']`), `year` is
  double-quoted (`"2021"`), `related` is a double-quoted wikilink.
- **Mixed quoting styles across files** — emerges from the Research set collectively: Norling
  is entirely bare, Petrov mixes all three styles, Vance and Halloran use unquoted flow/block
  wikilink lists. No two Research notes share one quoting convention.
- **A note with no frontmatter at all** —
  `01 Courses/GEOL204/WEEK 3/scratch-thoughts.md`.
- **CRLF line endings** — `01 Courses/MUSTH104/Chorale No. 12/Listening notes.md` (whole file
  converted to `\r\n`; verified with `file(1)`: "with CRLF line terminators").
- **CRLF line endings intersecting a frontmatter block, with wikilinks inside that
  frontmatter** (C1.3 × the CRLF case — the intersection P1-T02's acceptance criteria names but
  the two cases above never actually share a file) —
  `03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md`. The whole file —
  frontmatter and body — is `\r\n` throughout (verified with `file(1)`: "with CRLF line
  terminators"; byte-counted: every `\n` in the file is part of a `\r\n` pair, zero bare LF).
  Its `related` field is a block-style list mixing a bare wikilink item
  (`- [[Paraconformity]]`) with a double-quoted one (`- "[[Hummocky stratification]]"`) — a
  shape not covered elsewhere in the vault (Halloran's block list is bare/bare, Petrov's quoted
  wikilink is a single inline value, not a list item), so this file also closes that gap.
  Replaces the synthetic `CRLF_FRONTMATTER_INNER` constant that used to stand in for this case
  in `packages/core/test/frontmatter/test-helpers.ts`.
- **Filename containing spaces and an ampersand** —
  `01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md` (this
  file doubles as the embedded-PDF note above).
- **Non-ASCII content** (accented characters, an em dash, curly quotes) —
  `01 Courses/GEOL204/WEEK 3/Lecture - Cementation and Burial Diagenesis.md` — "Dr. Élise
  Béranger", em dashes (—), and curly quotes (' ') in a quoted aside.
- **A `---` line inside a fenced code block** (frontmatter-delimiter false positive) —
  `01 Courses/GEOL204/WEEK 3/lab-protocol-notes.md` — the fenced example data block contains
  two `---` lines *after* the note's real frontmatter has already closed. Regression target:
  a parser must not extend "frontmatter" to the last `---` in the document, and must not treat
  fenced `---` lines as Markdown thematic breaks either.
- **Frontmatter value that is an empty string, and one that is an empty list** —
  `01 Courses/MUSTH104/Chorale No. 12/Phrase One - Close Listening.md` — `subtitle: ""` and
  `related: []`.
- **A PDF 1.5+ file whose entire page tree is inside a compressed object stream** (ol-voen /
  [P3-T04b]) — `01 Courses/GEOL204/WEEK 3/xref-stream-only.pdf`, 3 pages, 1,056 bytes.
  **Invariant guarded: page-tree discovery must not depend on objects being uncompressed.**
  There is no literal `trailer` keyword anywhere in the file; the only cross-reference is a
  PDF 1.5 cross-reference *stream* (`/Type /XRef`), and the Catalog, the `/Pages` node **and
  all three leaf `/Type /Page` dicts** are `/FlateDecode`-compressed inside an `/ObjStm` object
  stream. The three content streams are FlateDecode'd and sit *outside* the object stream, so
  once page discovery works, text extraction succeeds with no further change — which is exactly
  what makes this fixture a test of *discovery* and nothing else. The shipped extractor returned
  `pages: []` for this shape and reported success; seven real lecture decks were in this state.
  Verified independently with `pdftotext` (poppler 22.12.0): 3 pages, all three page texts read
  exactly. Entirely invented, self-describing content — see the note at the end of this file.
  **Unchanged by the course rebuild, deliberately:** its content is prose about PDF object
  streams, carries no subject vocabulary at all, and was already cleared word by word.
- **A PDF whose leaf pages are in plain sight but whose branch `/Pages` node is not**
  (ol-voen / [P3-T04b]) — `01 Courses/GEOL204/WEEK 3/hybrid-pages-node.pdf`, 3 pages,
  1,422 bytes. **Invariant guarded: a page-tree walk that yields nothing must fall back.**
  Same three pages, no literal `trailer`, same xref stream — but here the Catalog and all three
  leaf `/Type /Page` objects are plain uncompressed objects the raw object scan finds, and
  *only* the branch `/Pages` node between them is inside the `/ObjStm`. The root therefore resolves,
  the walk starting from it returns nothing because the node it starts at is unreachable, and a
  fallback guarded on "was the root found?" rather than "did the walk find anything?" never runs
  — with every page object sitting in the map. Two real lecture decks were in this state, and
  this fixture is recovered in full by the one-line guard change alone, with no `/ObjStm`
  support at all. That is deliberate: it keeps the cheap regression separable from the
  expensive one. Verified independently with `pdftotext`: 3 pages, all three texts exact.
  Unchanged by the course rebuild, for the same reason as the fixture above.
- **Tabs used for indentation in a list** —
  `01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md` — the sub-list
  under "What keeps an imbricated fabric from being re-set by the next flood?" is indented with
  a literal tab character (verified with `grep -P '^\t'`: 3 lines).

## Past papers + objectives (F1.5, F7.9, P5-T01)

- **Past paper, role-tagged** — `03 Research/GEOL204 Past Paper 2024.md`, `role: past-paper`
  frontmatter, `course: GEOL204`. Registers as a `Source` (`packages/core/src/source/register.ts`)
  distinctly from the citation-workflow research notes above, which carry `source-type`
  (bibliographic type: `journal-article`, `book-chapter`) rather than `role` — the two
  properties answer different questions and are deliberately not conflated under one key.
- **Course objectives, role-tagged** — `03 Research/GEOL204 Course Objectives.md`,
  `role: objectives` frontmatter, `course: GEOL204`. A plain bulleted list of learning
  objectives; no per-question segmentation applies (that's specific to `role: past-paper`).
- Both live in `03 Research` because F7.9 names that as the *default* configurable location for
  past papers and objectives, and the registration reader is exercised against the real folder
  the citation notes already occupy — proving role classification, not folder-name coincidence,
  is what separates a past paper from a reading-list note living in the same place.

### Nasty cases in the past paper — regression fixtures for `segmentPastPaper` (P5-T01)

- **Multi-part questions** — Question 3 has top-level content, a lettered part `(a)`, a second
  lettered part `(b)` with its own roman-numbered sub-parts `(i)` and `(ii)` — i.e. `3(a)`,
  `3(b)`, `3(b)(i)`, `3(b)(ii)` must all survive as distinct, correctly-parented addressable
  blocks.
- **A question spanning a page break** — between `3(b)(i)` and `3(b)(ii)` sits an HTML comment
  documenting the transcription and a `***` thematic-break line standing in for the original
  PDF's page boundary. Neither is a paragraph, so neither is inspected for a part marker or
  allowed to close the currently-open part — `3(b)(ii)` must still resolve as a child of `3(b)`,
  not a new top-level question.
- **Mark allocations in varying formats** — `(10 marks)` (Q1, parenthetical on the heading),
  `[5 marks]` (Q2, bracketed on the heading), `(15 marks)` (Q3 heading), `[4 marks]` (part `(a)`,
  bracketed, trailing the part text), a bare `6 marks` with no punctuation at all (part `(b)(ii)`),
  and no marks stated whatsoever for part `(b)`, part `(b)(i)`, or Question 4 — `marks` must be
  `undefined`, never a fabricated `0`, wherever nothing was stated.
- **A section header that is not a question** — `## Section A — Multiple Choice` and
  `## Section B — Short Answer Questions` sit at the same heading level as the question
  headings but do not match the question-numbering pattern; they must contribute no
  `QuestionBlock` and appear in `nonQuestionHeadings` instead of silently vanishing or being
  misread as a zero-content "question."
- **A question containing a list** — Question 1's stem is followed directly by a bulleted list
  of MCQ options. A segmenter that just split on blank lines would fragment the list away from
  its question; this one keys on question/part markers, so the list stays inside Question 1.
- **A question containing a code block** — Question 2 contains a fenced pseudocode block between
  its stem and the question's end, exercising the same "blank lines are not boundaries" case for
  a block kind the block parser treats even more distinctly than a list.

### A second past-paper year — multi-year clustering evidence (P5-T02, F4.1)

- **`03 Research/GEOL204 Past Paper 2023.md`** — `role: past-paper`, `course: GEOL204`,
  `year: 2023`. Three plain top-level questions, no multi-part structure (that's already
  covered by the 2024 paper above). Entirely invented, like every other fixture in this vault.
- **Why it exists:** `packages/core/src/concept/evidence.ts` (P5-T02) clusters past-paper
  questions that name the same concept across every registered past paper — "several questions
  across several years asking the same thing is evidence a concept is high-yield" (F4.2–F4.4).
  With only one past-paper year, no cluster could ever have more than one member question, so
  this file gives the mechanism something real to cluster: all three of its questions name
  `Imbrication` (a Zettelkasten title, `05 Zettelkasten/Imbrication.md`, never used as anyone's
  `topic` value), matching the 2024 paper's own Question 3; Question 2 also names
  `Hummocky stratification`, matching 2024's Question 2; Question 3 names `Bioturbation` and
  `Paraconformity`, both Zettelkasten-only terms with no other mention in either paper. See the
  P5-T02 task report for the resulting cluster sizes and citation counts, captured as real
  numbers rather than an estimate.
- **The objectives document carries a deliberate near-miss.** Bullets 1 and 4 name
  `Imbrication` and `Hummocky stratification` exactly; bullet 3 uses the adjectival form
  *`imbricated fabrics`*, which must **not** be counted as a hit for `Imbrication`. That
  deliberate mismatch is what pins R1/R2's no-fuzzy-matching requirement, and
  `concept/evidence.spec.ts` asserts exactly two objectives citations because of it. If you "tidy" bullet 3 into the noun form, you delete the test.
- **Two GEOL204 zettels are deliberately absent from both papers and the objectives**
  (`Cementation`, `Ripple lamination`), as is every MUSTH104 zettel, so the tier-3 mint has a
  real negative case. `05 Zettelkasten/Suspension.md` is the one to watch: an earlier draft of
  the 2024 paper's Question 1 used a sedimentology idiom built on that zettel's name, and
  extraction read it as a concept mention — minting a tier-3 record across the course boundary
  that nobody had intended. The bullet was reworded to `settling fallout` and the stray record
  went with it. A word that is ordinary in one of these two subjects and a concept name in the
  other is a live hazard in a two-course fixture; check both directions. The worked case is in
  `olea-service/findings/INV3-fixture-vocabulary.md`.

## Obsidian Bases — sourcing and assumptions

`02 Assignments/Assignments.base` was written against the **official Obsidian Bases syntax
documentation**, fetched directly (not from memory or a third-party mirror, after two mirror
sites gave mutually contradictory answers about a "sort" key — see below):

- https://obsidian.md/help/bases/syntax (canonical syntax reference; raw source pulled from
  `https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Bases/Bases%20syntax.md`
  to get the authoritative text rather than a rendered/summarised copy)
- https://obsidian.md/help/bases (overview)

Every key used in `Assignments.base` (`filters`/`and`/`file.inFolder()`/`file.ext`,
`formulas` with `date()`/`today()` date arithmetic, `properties`/`displayName`, and the view's
`type`/`name`/`groupBy`/`order`/`summaries`) is drawn verbatim from the fetched syntax doc's
own example and prose — nothing was invented.

**Ambiguity flagged:** the syntax doc has **no documented `sort` key** for table-view row
ordering (only `groupBy`, which sorts by *group*, and column `order`, which controls which
columns display and in what left-to-right sequence — not row order). Two independent
web-search-derived summaries claimed a `sort: [{property, direction}]` key exists, but neither
could produce a verbatim citation, and the raw official markdown source (fetched directly
above) does not contain one. Rather than invent an undocumented key, `Assignments.base` uses
only `groupBy: { property: note.class, direction: ASC }` to group rows by course and leaves
row order within each group to Obsidian's default/interactive column-header sort. If Bases
does gain or already has an undocumented `sort` key in a shipping version newer than this doc
snapshot, that's worth a `discovered-from` bead when someone opens this fixture in current
Obsidian and checks.

**Design choice, not from the docs:** the Base queries 14 separate assessment notes (one file
per assessment, `class`/`type`/`weight`/`due`/`status` in frontmatter) rather than storing rows
inline in the `.base` file, because Bases has no `from`/`source`/inline-row concept — "by
design a base includes every file in the vault" and views are filtered/computed over existing
notes' properties. This mirrors how her real vault almost certainly works and is the only
structurally valid way to build a Bases table at all.

Row count: 14 assessments (7 GEOL204 + 7 MUSTH104), weights sum to 100 within each course, due
dates spread 2026-08-14 through 2026-11-27.

## Notes for the orchestrator

- All content is invented: course codes GEOL204/MUSTH104, all lecture/assignment/research
  titles, all six GEOL204 zettels (Imbrication, Bioturbation, Paraconformity, Cementation,
  Ripple lamination, Hummocky stratification) and six MUSTH104 zettels (Suspension,
  Appoggiatura, Deceptive cadence, Plagal cadence, Consecutive fifths, Tierce picarde), all
  author names (Norling, Petrov, Adeyemi, Vance, Halloran, Reyes), all studied-work titles
  (Chorale No. 12, Sonatina in D, Minuet and Trio). Her real course codes, lecture titles,
  author names, assignment names and folder names have zero overlap here — and so, now, does
  every subject-bearing word.
- **"Checked against the real marker set at authoring time — no overlap" used to be the last
  line of the bullet above, and it was wrong in a way worth keeping visible.** It was true and
  useless: the marker set is a list of strings someone thought to write down, and none of the
  three vocabulary leaks found since were on it. What was *not* invented at authoring time was
  the concept vocabulary — the terms inside the notes — and the check that would have caught it
  is `scripts/check-fixture-vocabulary.mjs` in `olea-service`, against the snapshot, not against
  a marker list. Cite that check, never the marker set.
- **The gate is stricter than "the titles are clean," and the rebuild had to satisfy it twice.**
  The script's check units include every ATX **heading**, so ordinary English inside a
  question-shaped heading is checked too. The first full draft of these courses was clean on the
  identifiers that obviously matter — codes, titles, concept names — and the gate rejected it
  anyway, over ordinary English words sitting in headings rather than domain vocabulary at all.
  Expect that; the failing set is
  listed in `olea-service/findings/INV3-fixture-vocabulary.md`. Write
  the headings, run the gate, and take the words it names — do not argue with it, and do not add
  a domain word to `STOPWORDS` to make it quiet.
- Every wikilink-in-frontmatter variant was mechanically verified against PyYAML (not just
  eyeballed) — see the nasty-case list above for exact parse results.
- `03 Research/GEOL204 Past Paper 2024.md` and `03 Research/GEOL204 Course Objectives.md`
  (P5-T01): entirely invented — invented exam questions, invented pseudocode, invented mark
  allocations, invented objectives text. No real course's past paper or objectives document is
  represented anywhere in this vault (INV-3).
- `03 Research/GEOL204 Past Paper 2023.md` (P5-T02): entirely invented, same as the 2024 paper
  above — invented exam questions, invented mark allocations. No real course's past paper is
  represented anywhere in this vault (INV-3).
- The two page-discovery PDFs (ol-voen) carry **self-describing content about the parser bug
  they reproduce** — "Compressed page tree fixture, page one…", "Hybrid page tree fixture, page
  two…" — rather than invented lecture material. That is a deliberate INV-3 choice, not
  laziness: a fixture whose text is a sentence about PDF object streams cannot carry a course,
  a title or a turn of phrase across the boundary even by accident. Their vocabulary was
  nonetheless cleared against the snapshot under the ol-vs57 literal rule, word by word: every
  constituent word of both filenames and of all six page sentences is either 0/0 against
  `check-fixture-vocabulary.mjs` (`compressed`, `tree`, `fixture`, `dictionary`, `catalog`,
  `node`, `branch`, `leaf`, `stream`, `streams`, `traversal`, `yields`, `uncompressed`,
  `hybrid`, `xref`, `pages`) or ordinary English on that gate's own STOPWORDS list. Four
  earlier drafts of these sentences used `intermediate`, `walk`, `sit` and `outside`, which are
  neither — they were replaced rather than argued for. And the fixtures' job is to
  exercise *structure*, which their content has no part in. Neither file is embedded by any
  note, mirroring a real structural fact (a vault can hold a PDF nothing links to) without
  carrying any of that vault's content. Both are **generated-then-committed** rather than built
  at test time, because the exact byte structure — no `trailer` keyword, which object sits in
  the `/ObjStm` — *is* the fixture; `pdf.spec.ts` asserts those structural properties directly
  so a regenerated file that lost them fails loudly instead of passing vacuously.
- `packages/core/fixtures/review-log/` uses the slug forms of four of these concept names
  (`imbrication`, `bioturbation`, `cementation`, `appoggiatura`) in its instrument and concept
  ids, so it is renamed in lockstep with this vault and its README says so. A grep for the old
  vocabulary that stops at this directory will miss it.
- `packages/core/fixtures/instruments/` is a **third** invented subject domain (LITHO204,
  mineralogy), chosen the same way and for the same reason. It predates this rebuild and is
  untouched by it. Three fixture domains, none of them hers.
