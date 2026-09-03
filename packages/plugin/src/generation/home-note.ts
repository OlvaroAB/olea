/**
 * `ensureHomeNoteForConcept` — the bare-document home note F3.1/F3.3 promise
 * (`[D-179]` / `[SRC-2]`, `ol-ho93`, INV-6).
 *
 * **What this closes.** Before `[D-179]`, a PDF/PPTX/DOCX/image dropped
 * directly into the vault with no embedding note produced `ExtractedUnit`s
 * `pipeline.ts` silently skipped: `materializeAcceptedDraft` needs a real
 * markdown note to insert an accepted MCQ into, and a bare drop has none.
 * `[D-179]` ruled the fix is not "wait until she embeds it somewhere" but
 * "Olea creates that home note itself, beside the source, in Olea's own
 * layer — never prompting first." This module is that creation, plus the
 * reuse and concept-binding upkeep a note that outlives a single sweep needs.
 *
 * **Why this is safe without consent.** INV-6's Part One (absolute: never
 * write into her authored notes without consent) does not apply — this note
 * is never one of hers. Part Two (Olea's own layer, D-097) covers it: the
 * note is "repairable, renameable and prunable like anything else Olea
 * writes without asking." `HOME_NOTE_MARKER_KEY` is the durable way later
 * code tells "a note I may freely rewrite the bookkeeping of" from "a note
 * she wrote" — the one fact INV-6 needs answered before any of this module's
 * functions touch an existing file at the target path.
 *
 * **Naming and location.** `homeNotePathForSource` names the note from the
 * source file's own stem, beside it — `01 Courses/GEOL204/Lecture 4.pdf`
 * gets `01 Courses/GEOL204/Lecture 4.md`. The course is never read from this
 * note's own content (F3.1/F3.3, amended `[D-179]`): it comes from the
 * shared folder both files sit in, via `courseFromPath` — the same
 * derivation `pipeline.ts` already applies to the source path itself, so
 * this module carries no course logic of its own.
 *
 * **Collision, not a guess.** A file may already sit at the derived path —
 * most plausibly one of her own notes that happens to share the source's
 * stem. `ensureHomeNoteForConcept` checks `HOME_NOTE_MARKER_KEY` before
 * treating an existing file as reusable and returns `null` rather than
 * writing into it or inventing a disambiguated name on her behalf; the
 * caller's job is deciding what "no usable note this sweep" means for it
 * (`pipeline.ts` skips the candidate, same shape as the pre-`[D-179]`
 * "no embedding note" skip it replaces).
 *
 * **Concept binding, grown rather than fixed at creation.** A home note can
 * end up drafted for more than one concept over its lifetime — the same
 * course-wide, coarse-grained sweep `pipeline.ts`'s own module doc already
 * accepts for the embedded-note case. `session/enumerate.ts` binds every
 * instrument in a note to whatever that note's own `topic:` frontmatter
 * names (its own module doc: "an instrument in a note with no `topic:`" is
 * unbound, invisible to the queue), so a home note materializing its first
 * draft with an empty `topic:` would produce exactly that silent-loss shape.
 * `ensureHomeNoteForConcept` therefore takes the concept name being drafted
 * for and grows `topic:` to include it — idempotently, a name already
 * present is left untouched — every time it is called, not only at creation.
 *
 * **Idempotent across sweeps by construction, not by a separate check.**
 * `pipeline.ts` calls this once per successful draft; `vault.exists` decides
 * creation, and the topic-growth step is naturally a no-op past the first
 * time a given concept reaches this note. A second sweep over the same
 * source therefore reuses the same note and, at most, appends a `topic:`
 * entry it did not already have — it never recreates or duplicates it.
 *
 * **`[D-214]`'s second caller: a source that is ALREADY a `.md` file.**
 * `ol-0r92.45` reuses this exact module for an authored note she wrote
 * herself, via `pipeline.ts`'s pre-existing bare-drop branch
 * (`unit.provenance.embeddedIn` absent, `sourcePath` her note's own path —
 * see `ingestion/process-now.ts`'s `buildAuthoredNoteUnit`, outside this
 * bead's own `owns` but the caller this fix exists for). The naming rule
 * above (`${dir}${stem}.md`) is a no-op collision for any source that is
 * itself already `.md`: stripping and re-adding the same extension returns
 * the SAME path, which would make `ensureHomeNoteForConcept` read HER note
 * back, find no marker, and return `null` — silently drafting nothing,
 * forever, for every authored note. `homeNotePathForSource` below special-
 * cases exactly that one collision (never reachable by a PDF/PPTX/DOCX/image
 * source, none of which end in `.md`) so an authored note gets a genuinely
 * separate sibling note — never itself. INV-6 is unaffected: the sibling is
 * still Olea's own layer, still collision-checked the same way, and her
 * note is never the one this module opens for writing.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import {
  parseDocument,
  parseFrontmatter,
  readList,
  readScalar,
  serializeFrontmatter,
  setEntryValue,
} from 'olea-core';

/**
 * Frontmatter key marking a note as one of Olea's own home-note artifacts —
 * the fact that makes it safe for this module (and nothing else) to freely
 * rewrite the note's `topic:` bookkeeping without her consent (INV-6, D-097
 * Part Two). Never set on, or read from, anything she authored.
 */
export const HOME_NOTE_MARKER_KEY = 'olea-home-note';
const HOME_NOTE_MARKER_VALUE = 'true';

function fileNameOf(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * The home note's vault path for a given source: same folder, source's own
 * file-name stem, `.md` extension. Never collides with the source itself for
 * the four formats `[D-179]` built this against (C3.1: PDF/PPTX/DOCX/image),
 * none of which carry a `.md` extension of their own.
 *
 * **The one collision this guards against (`[D-214]`, `ol-0r92.45`):** a
 * source that is itself already `.md` — an authored note — strips and
 * re-adds the identical extension, so the naive rule above would return
 * `sourcePath` unchanged and this module would mistake HER note for its own
 * home note. When the derived candidate would equal the source verbatim,
 * a distinguishing suffix makes the home note a genuinely separate sibling
 * file instead — still beside the source, still named from its stem, never
 * the source itself.
 */
export function homeNotePathForSource(sourcePath: VaultPath): VaultPath {
  const slash = sourcePath.lastIndexOf('/');
  const dir = slash === -1 ? '' : sourcePath.slice(0, slash + 1);
  const fileName = fileNameOf(sourcePath);
  const dot = fileName.lastIndexOf('.');
  const stem = dot <= 0 ? fileName : fileName.slice(0, dot);
  const candidate = `${dir}${stem}.md`;
  return candidate === sourcePath ? `${dir}${stem} (Olea).md` : candidate;
}

/** Whether `content` carries `HOME_NOTE_MARKER_KEY` — see the module doc's "collision, not a guess" note. */
export function isOleaHomeNote(content: string): boolean {
  const first = parseDocument(content).blocks[0];
  if (first?.kind !== 'frontmatter') return false;
  const fm = parseFrontmatter(first.inner);
  return readScalar(fm, HOME_NOTE_MARKER_KEY).scalar === HOME_NOTE_MARKER_VALUE;
}

/**
 * The note's starting content: an empty `topic:` (grown by
 * `ensureTopicIncludes` below, never guessed here — this module never knows
 * which concept a bare drop is "about"), the marker key, and one line of
 * plain-text orientation. No `course:` key — F3.1/F3.3 are explicit that the
 * course comes from the folder, never from this note's content.
 */
function initialHomeNoteContent(sourcePath: VaultPath): string {
  const fileName = fileNameOf(sourcePath);
  return [
    '---',
    'topic:',
    `${HOME_NOTE_MARKER_KEY}: ${HOME_NOTE_MARKER_VALUE}`,
    '---',
    '',
    // Worded to hold for both callers: a bare document with no note of its
    // own (`[D-179]`) and a note she wrote herself, whose own text is never
    // written into (`[D-214]`, INV-6) — "beside" is true either way, and
    // this file never claims the source "had no note of its own."
    `*Olea created this note beside \`${fileName}\`, to keep generated practice out of it directly.`,
    "Generated quiz items land here on acceptance. This note is Olea's own layer (INV-6) —",
    'renameable and prunable like anything else Olea writes without asking.*',
    '',
  ].join('\n');
}

/**
 * Grows the note's `topic:` list to include `conceptName` when it is not
 * already there — a no-op, not a rewrite, on a note that already names it.
 * Block-list form (`- Concept Name`, one per line) rather than a wikilink or
 * a space-separated run, because a concept name may itself contain spaces
 * and this is the one `readList` shape that never ambiguates on that (see
 * `frontmatter/read.ts`'s own doc on the shapes it tries in order).
 *
 * Hardcodes the `---` delimiter lines rather than re-deriving them from the
 * note's own bytes: safe only because this module is the sole writer of this
 * exact note shape (every home note is created by `initialHomeNoteContent`
 * above, verbatim), which is not true of a note she authored — this
 * function must never be reached for one, and `ensureHomeNoteForConcept`'s
 * marker check is what guarantees that.
 */
async function ensureTopicIncludes(
  vault: VaultSource,
  notePath: VaultPath,
  conceptName: string,
): Promise<void> {
  const content = await vault.read(notePath);
  const frontmatterBlock = parseDocument(content).blocks[0];
  if (frontmatterBlock?.kind !== 'frontmatter') return; // defensive — every home note this module writes has one

  const fm = parseFrontmatter(frontmatterBlock.inner);
  const current = readList(fm, 'topic').items;
  if (current.includes(conceptName)) return; // idempotent — already bound, nothing to grow

  const items = [...current, conceptName];
  const newValueRaw = `\n${items.map((name) => `  - ${name}`).join('\n')}\n`;
  const updatedFm = setEntryValue(fm, 'topic', newValueRaw);
  const updatedBlockRaw = `---\n${serializeFrontmatter(updatedFm)}---\n`;

  const newContent =
    content.slice(0, frontmatterBlock.start) +
    updatedBlockRaw +
    content.slice(frontmatterBlock.end);
  await vault.write(notePath, newContent);
}

/**
 * Creates or reuses the home note beside `sourcePath` and ensures its
 * `topic:` names `conceptName`, returning the note's path — the value
 * `pipeline.ts` uses as a `DraftRecord.sourcePath`, exactly as an embedding
 * note's own path already is for F1.6's case.
 *
 * Returns `null` when a file already sits at the derived path and is not one
 * of Olea's own home notes (see the module doc's "collision, not a guess") —
 * the caller must not write into it and must not invent an alternate name.
 */
export async function ensureHomeNoteForConcept(
  vault: VaultSource,
  sourcePath: VaultPath,
  conceptName: string,
): Promise<VaultPath | null> {
  const notePath = homeNotePathForSource(sourcePath);

  if (await vault.exists(notePath)) {
    const content = await vault.read(notePath);
    if (!isOleaHomeNote(content)) return null;
  } else {
    await vault.write(notePath, initialHomeNoteContent(sourcePath));
  }

  await ensureTopicIncludes(vault, notePath, conceptName);
  return notePath;
}
