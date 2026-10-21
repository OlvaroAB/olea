/**
 * The shared-passage lookup (`[D-562]`, ruled 2026-10-21; F4.11; `olea-service/docs/dev/
 * intelligence-build/scp.md` section 2.6, "Shared stimuli"). For one paper group whose template
 * shares a scenario, extract, table or data set, it picks ONE chunk of that form from her held,
 * non-sealed material for the group's concepts, or says it looked and found none, or says it did
 * not (or could not) look. Pure: no I/O, no clock, no model call, nothing logged (D-005).
 *
 * **Why three answers, not two.** Only `'none-held'` may lead to the `no-held-stimulus` empty
 * reason, which she reads as "none of your material supplies one". A rule that says that when her
 * material does hold one tells her something false, and no later check catches it. So
 * `'none-held'` is returned only when the lookup read material in which the needed form can exist
 * as text, found none, and left nothing unread that might hold one. Every other case is
 * `'not-looked'`, with its reason: the group is written without shared material, and it is never
 * refused. That is the honest default, and each `'not-looked'` reason below is a Class B default.
 *
 * **The passage is hers, as written.** A `'held'` result points at a chunk by source id and index
 * (`PaperHeldStimulus`) and never copies, trims or rewrites it; {@link heldStimulusText} resolves
 * the pointer to the chunk's exact string for the request. Nothing here generates text, so a
 * stimulus with values in it never comes from the model-extended margin (F4.11, `[D-262]`).
 *
 * ## The declared rules (declared, never fitted; plain English)
 *
 * 1. **What is searched.** The sources the caller hands, in the order handed, each chunk in its
 *    own order. A source id handed twice is read once, at its first occurrence. A blank chunk is
 *    not material. **A registered assessment paper is never searched or chosen**: a source of kind
 *    `'past-paper'`, or one the caller marks `isAssessmentPaper: true`. No production fact records
 *    which papers are sealed, so no past paper can safely be a stimulus source. A source whose
 *    status the caller could not tell (`isAssessmentPaper: null`) is not searched either.
 * 2. **Which needs are looked for.** A need that is `'not-needed'` or `'not-identified'`, or
 *    `'needed'` with no named form, is not looked for. A figure is never looked for: its content is
 *    not text, the question writer reads text only, and a figure in her notes is not "none of your
 *    material supplies one".
 * 3. **What counts as a table or a data set** (one rule for both). The chunk holds either
 *    - a Markdown table: a line with a pipe, then a delimiter line of the same number of cells, each
 *      cell only dashes with an optional colon at either end, then at least one row with a pipe and
 *      a cell that is not empty. A header and delimiter with no row under them is not a table; or
 *    - a delimited block: at least `PAPER_STIMULUS_DELIMITED_MIN_ROWS` (3) consecutive lines that
 *      are not headings, each splitting on the same delimiter (a tab, a pipe, a comma, a semicolon,
 *      or a run of two or more spaces) into the same number of fields, at least 2, with a field
 *      that is not empty. A list marker is read past, so a list of values counts. For a comma,
 *      semicolon or space run, which ordinary prose also uses, every line after the first must
 *      also hold a field that is a number on its own. A delimiter line of dashes is markup, never
 *      a row.
 *
 *    Pipes inside a wikilink (`[[note|alias]]`), and escaped pipes, never split a line. Quote and
 *    callout markers (`>`) are read past, so a table inside a callout counts.
 * 4. **What counts as a scenario or an extract** (one rule for both: text alone cannot tell a case
 *    from a quoted passage). The chunk holds at least `PAPER_STIMULUS_PROSE_MIN_WORDS` (30) words of
 *    running text, outside headings, horizontal rules, tables, code blocks, embeds and front
 *    matter. About two sentences: enough for several parts to share, and low on purpose, because a
 *    floor set high turns a short passage she holds into a claim that none is held.
 * 5. **The length band and the size cap.** A chosen chunk is at most `PAPER_STIMULUS_MAX_CHARS`
 *    (6000) characters as written, counted as JavaScript string length, which is how the request
 *    field counts: the constant IS the request field's (`AUTHORING_SHARED_PASSAGE_MAX_CHARS` in
 *    `olea-contracts`' `authoring-paper-context.ts`, `ol-egov.141.89.7.97`). A prose chunk's
 *    band is therefore 30 words to 6000 characters. **A chunk over the cap is never chosen**, and
 *    one that holds the form over the cap means her material does supply one: `'not-looked'`,
 *    `'qualifying-over-cap'`, never `'none-held'`.
 * 6. **How one chunk is chosen.** The first qualifying chunk at or under the cap, in source order
 *    and then chunk order. The caller's order therefore decides, and the same input always gives
 *    the same pick.
 * 7. **What blocks a claim of none.** If no chunk is chosen, the result is `'not-looked'` rather than
 *    `'none-held'` when any of these holds:
 *    - a qualifying chunk was over the cap (`'qualifying-over-cap'`);
 *    - a searched chunk holds content whose text is not in the chunk: an embed (`![[...]]`, which
 *      covers images, PDFs and embedded notes alike), a Markdown image, an HTML image, table,
 *      media or frame element, or a code block a plugin renders (`dataview`, `dataviewjs`, `base`,
 *      `query`, `mermaid`, `chart`). Any of these could be the case or table she holds
 *      (`'non-text-content'`). The list is declared, not exhaustive;
 *    - a source's assessment status was not told (`'assessment-status-unknown'`);
 *    - for a table or data set, a searched source is not her own notes (a kind other than
 *      `'notes'`): text extracted from a document may have lost a table's rows and columns
 *      (`'extracted-text-unverified'`);
 *    - nothing was searched at all: no sources, only blank chunks, or only assessment papers
 *      (`'no-searchable-material'`). With only past papers held, the paper itself holds the
 *      stimulus, so "none of your material supplies one" would be false on its face.
 *
 * **What this does not do.** It never judges whether a passage suits the group's questions (the
 * writer builds on it), never ranks by concept relevance beyond the caller's order, and never reads
 * text a chunk does not carry. The package index exports it, and the plugin's paper path asks it
 * once per group (`packages/plugin/src/paper/stimulus-lookup.ts`, `ol-egov.141.89.7.93`).
 */

import { AUTHORING_SHARED_PASSAGE_MAX_CHARS } from 'olea-contracts';

import type {
  PaperGroupStimulusNeed,
  PaperHeldSource,
  PaperHeldStimulus,
  PaperStimulusForm,
} from './paper-types.js';

/**
 * The longest chunk that may be chosen, in characters (JavaScript string length): the request
 * field's own limit, `AUTHORING_SHARED_PASSAGE_MAX_CHARS` (`olea-contracts`,
 * `authoring-paper-context.ts`, `ol-egov.141.89.7.97`), imported rather than restated, so a chosen
 * passage is never refused or cut on the wire and the two can never drift.
 */
export const PAPER_STIMULUS_MAX_CHARS: number = AUTHORING_SHARED_PASSAGE_MAX_CHARS;

/** Declared: the fewest words of running text that make a chunk a scenario or an extract (rule 4). */
export const PAPER_STIMULUS_PROSE_MIN_WORDS = 30;

/** Declared: the fewest consecutive lines that make a delimited block of rows (rule 3). */
export const PAPER_STIMULUS_DELIMITED_MIN_ROWS = 3;

/**
 * One held source of the group's concepts, as the lookup reads it. A `PaperHeldSource` with its
 * assessment-paper status added, so a composition can hand `{ ...held, isAssessmentPaper }`.
 */
export interface PaperStimulusSource {
  readonly sourceId: string;
  readonly kind: PaperHeldSource['kind'];
  /** Her chunks, in order, exactly as held. */
  readonly chunks: readonly string[];
  /**
   * `true` for a registered assessment paper (a registered past paper of any course, or an
   * assessment document), `false` for anything else, `null` when the caller cannot tell. A source
   * of kind `'past-paper'` is excluded whatever this says.
   */
  readonly isAssessmentPaper: boolean | null;
}

export interface PaperStimulusLookupInput {
  readonly need: PaperGroupStimulusNeed;
  /** The held material of the group's concepts, in the order the pick should prefer. */
  readonly sources: readonly PaperStimulusSource[];
}

/** Why the lookup did not look, or could not claim that none is held (module doc, rules 2 and 7). */
export const PAPER_STIMULUS_NOT_LOOKED_REASONS = Object.freeze([
  'not-needed',
  'not-identified',
  'form-not-named',
  'figure-not-text',
  'no-searchable-material',
  'qualifying-over-cap',
  'non-text-content',
  'assessment-status-unknown',
  'extracted-text-unverified',
] as const);

/** One word from `PAPER_STIMULUS_NOT_LOOKED_REASONS`. */
export type PaperStimulusNotLookedReason = (typeof PAPER_STIMULUS_NOT_LOOKED_REASONS)[number];

/**
 * The lookup's answer. Only `'none-held'` may lead to `no-held-stimulus`; `'not-looked'` means the
 * group is written without shared material and is never refused.
 */
export type PaperStimulusLookup =
  | { readonly status: 'held'; readonly stimulus: PaperHeldStimulus }
  | { readonly status: 'none-held' }
  | { readonly status: 'not-looked'; readonly reason: PaperStimulusNotLookedReason };

/** One chosen passage, a 'none held' found by looking, or the reason it did not look (module doc). */
export function lookUpPaperGroupStimulus(input: PaperStimulusLookupInput): PaperStimulusLookup {
  const { need, sources } = input;
  if (need.status === 'not-needed') return notLooked('not-needed');
  if (need.status === 'not-identified') return notLooked('not-identified');
  const form = need.form;
  if (form === null) return notLooked('form-not-named');
  if (form === 'figure') return notLooked('figure-not-text');
  const tabular = isTabularForm(form);

  let searched = false;
  let overCap = false;
  let nonText = false;
  let statusUnknown = false;
  let extractedUnverified = false;
  const seen = new Set<string>();

  for (const source of sources) {
    if (seen.has(source.sourceId)) continue;
    seen.add(source.sourceId);
    if (isExcludedAssessmentPaper(source)) continue;
    if (source.isAssessmentPaper === null) {
      statusUnknown = true;
      continue;
    }
    let searchedHere = false;
    for (let chunkIndex = 0; chunkIndex < source.chunks.length; chunkIndex++) {
      const text = source.chunks[chunkIndex];
      if (text === undefined || text.trim() === '') continue;
      searched = true;
      searchedHere = true;
      if (chunkHoldsForm(form, text)) {
        if (text.length <= PAPER_STIMULUS_MAX_CHARS) {
          return { status: 'held', stimulus: { form, sourceId: source.sourceId, chunkIndex } };
        }
        overCap = true;
      } else if (chunkHoldsNonTextContent(text)) {
        nonText = true;
      }
    }
    if (tabular && searchedHere && source.kind !== 'notes') extractedUnverified = true;
  }

  if (overCap) return notLooked('qualifying-over-cap');
  if (nonText) return notLooked('non-text-content');
  if (statusUnknown) return notLooked('assessment-status-unknown');
  if (extractedUnverified) return notLooked('extracted-text-unverified');
  if (!searched) return notLooked('no-searchable-material');
  return { status: 'none-held' };
}

/**
 * The chosen passage's text, exactly as held (never trimmed or rewritten), or `null` when the
 * pointer no longer resolves to a chunk the lookup could choose: the source is missing or an
 * assessment paper, the index is out of range, or the chunk is blank, over the cap, or no longer
 * of the form. A source id handed twice resolves at its first occurrence, as the lookup reads it.
 */
export function heldStimulusText(
  sources: readonly PaperStimulusSource[],
  stimulus: PaperHeldStimulus,
): string | null {
  if (stimulus.form === 'figure') return null;
  const source = sources.find((s) => s.sourceId === stimulus.sourceId);
  if (source === undefined || isExcludedAssessmentPaper(source)) return null;
  if (source.isAssessmentPaper !== false) return null;
  const text = source.chunks[stimulus.chunkIndex];
  if (text === undefined || text.trim() === '' || text.length > PAPER_STIMULUS_MAX_CHARS) {
    return null;
  }
  return chunkHoldsForm(stimulus.form, text) ? text : null;
}

/** Rule 3: the chunk holds a Markdown table or a delimited block of rows. */
export function chunkHoldsTable(text: string): boolean {
  return tabularLineMask(analysisLines(text)).some(Boolean);
}

/** Rule 4: the chunk holds at least `PAPER_STIMULUS_PROSE_MIN_WORDS` words of running text. */
export function chunkHoldsProsePassage(text: string): boolean {
  return proseWordCount(text) >= PAPER_STIMULUS_PROSE_MIN_WORDS;
}

/** Rule 7: the chunk holds content whose text is not in the chunk (an embed, an image, a rendered block). */
export function chunkHoldsNonTextContent(text: string): boolean {
  if (EMBED_RE.test(text) || HTML_NON_TEXT_RE.test(text)) return true;
  return analysisLines(text).some((line) => RENDERED_FENCE_RE.test(line.trim()));
}

// --------------------------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------------------------

const EMBED_RE = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/;
const EMBED_GLOBAL_RE = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g;
const HTML_NON_TEXT_RE =
  /<(?:img|table|svg|iframe|object|embed|video|audio|picture|canvas)(?=[\s/>])/i;
const RENDERED_FENCE_RE = /^(?:```|~~~)\s*(?:dataview|dataviewjs|base|query|mermaid|chart)\b/i;
const FENCE_RE = /^(?:```|~~~)/;
const HEADING_RE = /^#{1,6}(?:\s|$)/;
const HORIZONTAL_RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const LIST_MARKER_RE = /^(?:[-*+]|\d{1,3}[.)])\s+(?:\[.\]\s+)?/;
const QUOTE_MARKER_RE = /^\s*(?:>\s?)+/;
const CALLOUT_MARKER_RE = /^\[![^\]]*\][+-]?/;
const WIKILINK_RE = /\[\[[^\]]*\]\]/g;
const ESCAPED_PIPE_RE = /\\\|/g;
const DELIMITER_CELL_RE = /^:?-+:?$/;
const NUMBER_FIELD_RE = /^[-+−]?[$£€¥]?\d+(?:[.,]\d+)*%?$/;
const WORD_RE = /[\p{L}\p{N}]/u;
const SPACE_RUN_RE = / {2,}/;

type Delimiter = 'tab' | 'pipe' | 'comma' | 'semicolon' | 'space-run';
const DELIMITERS: readonly Delimiter[] = ['tab', 'pipe', 'comma', 'semicolon', 'space-run'];
/** Delimiters ordinary prose also uses: a row after the first must hold a number (rule 3). */
const PROSE_DELIMITERS: ReadonlySet<Delimiter> = new Set(['comma', 'semicolon', 'space-run']);

function notLooked(reason: PaperStimulusNotLookedReason): PaperStimulusLookup {
  return { status: 'not-looked', reason };
}

function isTabularForm(form: Exclude<PaperStimulusForm, 'figure'>): boolean {
  return form === 'table' || form === 'data-set';
}

function isExcludedAssessmentPaper(source: PaperStimulusSource): boolean {
  return source.kind === 'past-paper' || source.isAssessmentPaper === true;
}

function chunkHoldsForm(form: Exclude<PaperStimulusForm, 'figure'>, text: string): boolean {
  return isTabularForm(form) ? chunkHoldsTable(text) : chunkHoldsProsePassage(text);
}

/** The chunk's lines, front matter dropped and quote or callout markers read past. Analysis only: the chunk itself is never changed. */
function analysisLines(text: string): readonly string[] {
  const raw = text.split(/\r?\n/);
  let start = 0;
  if (raw[0]?.trim() === '---') {
    const close = raw.findIndex(
      (line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'),
    );
    if (close > 0) start = close + 1;
  }
  return raw.slice(start).map((line) => line.replace(QUOTE_MARKER_RE, ''));
}

/** A line's text with wikilinks and escaped pipes masked, so neither splits a cell. */
function maskLinks(line: string): string {
  return line.replace(WIKILINK_RE, 'x').replace(ESCAPED_PIPE_RE, 'x');
}

/** The cells of a pipe line (one leading and one trailing pipe stripped), or `null` without a pipe. */
function pipeCells(line: string): readonly string[] | null {
  const masked = maskLinks(line).trim();
  if (!masked.includes('|')) return null;
  let inner = masked;
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  return inner.split('|').map((cell) => cell.trim());
}

function isDelimiterRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL_RE.test(cell));
}

function splitFields(line: string, delimiter: Delimiter): readonly string[] | null {
  const unlisted = line.trim().replace(LIST_MARKER_RE, '');
  if (delimiter === 'pipe') return pipeCells(unlisted);
  const masked = maskLinks(unlisted).trim();
  switch (delimiter) {
    case 'tab':
      return masked.includes('\t') ? masked.split('\t').map((f) => f.trim()) : null;
    case 'comma':
      return masked.includes(',') ? masked.split(',').map((f) => f.trim()) : null;
    case 'semicolon':
      return masked.includes(';') ? masked.split(';').map((f) => f.trim()) : null;
    case 'space-run':
      return SPACE_RUN_RE.test(masked) ? masked.split(/ {2,}/).map((f) => f.trim()) : null;
  }
}

function hasNumberField(fields: readonly string[]): boolean {
  return fields.some((field) => NUMBER_FIELD_RE.test(field));
}

/** Which lines belong to a table or a delimited block (rule 3). */
function tabularLineMask(lines: readonly string[]): readonly boolean[] {
  const mask = lines.map(() => false);
  markMarkdownTables(lines, mask);
  const eligible = lines.map((line) => {
    const t = line.trim();
    return t !== '' && !HEADING_RE.test(t) && !FENCE_RE.test(t);
  });
  for (const delimiter of DELIMITERS) markDelimitedRuns(lines, eligible, delimiter, mask);
  return mask;
}

function markMarkdownTables(lines: readonly string[], mask: boolean[]): void {
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = pipeCells(lines[i] ?? '');
    if (header === null || isDelimiterRow(header)) continue;
    const delimiter = pipeCells(lines[i + 1] ?? '');
    if (delimiter === null || !isDelimiterRow(delimiter) || delimiter.length !== header.length) {
      continue;
    }
    let end = i + 2;
    let hasValue = false;
    while (end < lines.length) {
      const row = pipeCells(lines[end] ?? '');
      if (row === null || isDelimiterRow(row)) break;
      if (row.some((cell) => cell !== '')) hasValue = true;
      end++;
    }
    if (!hasValue) continue;
    for (let k = i; k < end; k++) mask[k] = true;
    i = end - 1;
  }
}

function markDelimitedRuns(
  lines: readonly string[],
  eligible: readonly boolean[],
  delimiter: Delimiter,
  mask: boolean[],
): void {
  const needsNumber = PROSE_DELIMITERS.has(delimiter);
  let start = -1;
  let width = 0;
  const close = (end: number): void => {
    if (start >= 0 && end - start >= PAPER_STIMULUS_DELIMITED_MIN_ROWS) {
      for (let k = start; k < end; k++) mask[k] = true;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const fields = eligible[i] === true ? splitFields(lines[i] ?? '', delimiter) : null;
    const usable =
      fields !== null &&
      fields.length >= 2 &&
      fields.some((field) => field !== '') &&
      !(delimiter === 'pipe' && isDelimiterRow(fields));
    if (
      usable &&
      start >= 0 &&
      fields.length === width &&
      (!needsNumber || hasNumberField(fields))
    ) {
      continue;
    }
    close(i);
    if (usable) {
      start = i;
      width = fields.length;
    } else {
      start = -1;
    }
  }
  close(lines.length);
}

/** Words of running text outside headings, rules, tables, code blocks, embeds and front matter (rule 4). */
function proseWordCount(text: string): number {
  const lines = analysisLines(text);
  const tabular = tabularLineMask(lines);
  let inFence = false;
  let words = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || tabular[i] === true) continue;
    if (HEADING_RE.test(trimmed) || HORIZONTAL_RULE_RE.test(trimmed)) continue;
    const body = trimmed
      .replace(CALLOUT_MARKER_RE, '')
      .replace(LIST_MARKER_RE, '')
      .replace(EMBED_GLOBAL_RE, ' ');
    for (const token of body.split(/\s+/)) {
      if (WORD_RE.test(token)) words++;
    }
  }
  return words;
}
