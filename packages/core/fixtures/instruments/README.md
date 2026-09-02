# Instrument-format golden fixtures

Beads: **[P2-T04] Q&A + cloze card formats** and **[P2-T05] MCQ instrument format**. These are the
golden files `packages/core/test/instrument/golden.spec.ts` and the two format suites in
`packages/core/src/instrument/` are built from — one line per regression case below, naming what
it is a fixture for and exactly where it lives.

They live here rather than in `fixtures/vault/` for the same reason `fixtures/review-log/` does:
the vault fixture set is the *note-shape* corpus that `concept/extract`, `keyword-index`,
`assessment/read` and the frontmatter golden suite all scan and count, and adding card syntax to
it would change those counts for reasons that have nothing to do with what they test. The
INV-2 golden suite walks **both** trees, so nothing is lost by the separation.

## INV-3

Entirely invented, and invented **fresh for these files** rather than borrowed. Every distinctive
term below was checked whole-word and case-insensitively against the read-only real-vault snapshot
before it was written down, with zero hits required for each: `olivine`, `feldspar`, `quartz`,
`calcite`, `garnet`, `amphibole`, `basalt`, `granite`, `gneiss`, `schist`, `marble`, `pumice`,
`breccia`, `magma`, `silicate`, `groundmass`, `phenocryst`, `foliation`, `cleavage`, `banding`,
`banded`, `aphanitic`, `phaneritic`, `porphyritic`, `igneous`, `metamorphic`, `sedimentary`,
`volcanic`, `crystallises`, `specimen`, `outcrop`, `coarse`, `grain`, `LITHO204`, and the invented
ids `mcq-crystallisation-1`, `mcq-grain-size-1`, `basaltline`. The remaining words in these files
are ordinary English.

The invented course code is `LITHO204` and the subject matter is deliberately outside every
subject either the real vault or `fixtures/vault/` covers — a third domain, so that a term
appearing in two places is a signal rather than a coincidence.

## Q&A and cloze (F2.1, C5.3) — `qa-and-cloze.md`

The target format is the default syntax of the Obsidian spaced-repetition plugin; where that was
established from is documented at the top of `packages/core/src/instrument/card-format.ts`, which
is the file to read before changing anything here.

- **Single-line card** (`::`) — "Grain size and cooling", first card.
- **Single-line reversed card** (`:::`) — second card. Exercises the separator-ordering rule:
  `:::` contains `::`, so a parser that checks the short one first silently produces the wrong
  back text rather than no card at all.
- **Multi-line card** (`?` on its own line) — third card. The card ends at a blank line, which is
  exactly where `block/parse.ts` ends a paragraph, so a multi-line card is one paragraph block.
- **Multi-line reversed card** (`??` on its own line) — fourth card.
- **Two cloze deletions on one list item** (`==…==`) — "Terms worth blanking out", first item.
  Two instruments from one line, each showing the other deletion as ordinary text.
- **Curly-brace cloze** (`{{…}}`) — second item. Off by default in the plugin, recognised here
  because it is unambiguous; `**bold**` deliberately is not.
- **Bold that is not a cloze** — third item. `convertBoldTextToClozes` ships false, and her notes
  use bold for emphasis, so reading it as a cloze would mint instruments she never wrote.
- **A card another plugin has already scheduled** — "Already scheduled somewhere else", first
  card, carrying a `<!--SR:…-->` comment on the same line. Read and reported, never written,
  never included in the answer text (C5.3: Olea owns scheduling).
- **A cloze line carrying a `^blockid`** (C1.4) — the line after it. The id is read and kept out
  of the card text.
- **Prose that is not a card** — the closing section, so a parser that treats every line as a
  candidate has something to be wrong about.

## The same, in CRLF — `qa-and-cloze-crlf.md`

Whole file is `\r\n`, frontmatter included (verified with `file(1)`). Guards two things at once:
carriage returns must not leak into parsed card text, and a card *created* in this file must be
written with CRLF terminators without anything being inferred from the platform.

## MCQ (F2.15) — `mcq-valid.md`

Both blocks are in **canonical** form, so `serializeMcq(parse(block)) === block` byte-for-byte.

- **A pool of five**, with `feedback:` and `id:` — the shape with room to rotate, and the two
  optional fields exercised.
- **A pool of exactly two** (`[D-195]` lowered the floor from four to two), with neither optional
  field — the documented floor, and the shuffle-only fallback the amendment names for a
  genuinely short grounded pool: present the two there are and shuffle them, rather than
  manufacture a third or withdraw the feature. The suite asserts the fixture covers both the
  boundary and above it, so "≥ `MIN_DISTRACTOR_POOL`" is never tested only from the safe side.

## MCQ — what must fail to parse — `mcq-invalid.md`

Eight blocks, seven distinct reasons, one reason each, every one reported with its span rather
than dropped:

1. **One distractor** — `insufficient-distractors`. Below the `[D-195]` floor of two: a single
   grounded distractor is a true/false item, not an MCQ, and F2.15 exists to stop it presenting
   as one.
2. **No stem** — `missing-stem`.
3. **No answer** — `missing-answer`.
4. **Two answers** — `repeated-field`.
5. **A distractor repeated** — `duplicate-option`. The count says five and the pool is four; the
   check runs *before* the count so this cannot pass as a legal pool.
6. **`distractors:` instead of `distractor:`** — `unknown-field`. A near-miss typo costs her a
   distractor she thought she had written, and silence here is how she never finds out.
7. **A field with no value** — `empty-value`.
8. **A pasted line that is not a field at all** — `unknown-field`.

## MCQ — hand-typed, valid, deliberately not canonical — `mcq-hand-typed.md`

Irregular spacing, non-canonical field order, mixed-case labels, a blank line inside the block,
and a `~~~~` fence instead of a backtick one. It parses; its bytes are kept exactly as typed; and
the golden suite asserts that re-serializing it produces something **different** from its source.
That inequality is the point: reading a note is not a reason to reformat it, and a parser that
tidied on read would put a byte-churning diff in every commit she makes.
