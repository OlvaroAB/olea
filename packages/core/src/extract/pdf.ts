/**
 * The PDF extractor (C3.1, C3.2, F1.6, P3-T04) — **real, not stubbed.**
 *
 * This is a from-scratch, minimal PDF structural parser and content-stream
 * tokenizer, not a wrapper around a library — there was no mobile-safe,
 * dependency-light PDF *text extraction* library that fit (see the task
 * report for what was surveyed; the honest options were "pull in pdf.js",
 * which is a rendering engine, not a text extractor, and drags a canvas/DOM
 * dependency that has no place in a package that must build for Obsidian
 * mobile, or "write the ~200 lines PDF text actually needs"). What's here
 * handles the common, unencrypted case: a trailer that is either a literal
 * `trailer` keyword or a PDF 1.5+ cross-reference *stream*, a page tree
 * reached through `/Kids` arrays whose nodes may be plain objects or
 * compressed inside an `/ObjStm` object stream, content streams that are
 * either raw or `/FlateDecode`-compressed (via `fflate`'s pure-JS
 * `unzlibSync` — see `../../package.json` for why that dependency was
 * chosen), and `Tj`/`TJ`/`'`/`"` text-showing operators with standard PDF
 * string escaping.
 *
 * **On cross-reference streams, and the two bugs that used to live here**
 * (ol-voen / [P3-T04b]). This file used to say it had "no support for
 * cross-reference streams" and conclude that the `/Type /Catalog` scan
 * covered the case anyway. **It did not**, and the cost was real lecture
 * PDFs — none of them image-only, every one carrying a substantial text
 * layer — silently returning zero pages while the pipeline reported success.
 * That was established by measuring against a real-world vault; the figures
 * stay private, in `olea-service/findings/E4-corpus-and-zero-yield.md`. Two
 * distinct bugs wore that one symptom:
 *
 *  - *The page tree lived inside an object stream.* Producers such as
 *    `pdf-lib` and pdfTeX emit a file that is PDF 1.5+ throughout: nothing
 *    appears as a literal `trailer` keyword, and `/ObjStm` streams hold the
 *    Catalog, the intermediate `/Pages` nodes **and the leaf `/Type /Page`
 *    dicts** alike. The raw `N G obj` scan
 *    found zero Catalogs and zero Pages, so there was nothing even to fall
 *    back to. `expandObjectStreams` below is the fix: inflate every
 *    `/Type /ObjStm`, read its `/N` (objnum, offset) pairs out of the first
 *    `/First` bytes, and register the objects inside it in the same map the
 *    raw scan populates. Everything downstream — the page-tree walk, the
 *    content-stream decode — then works unchanged.
 *  - *The fallback was guarded on the wrong condition.* A hybrid file (the
 *    Acrobat PDFMaker shape) puts the Catalog and every leaf page object in
 *    plain sight but the intermediate `/Pages` node inside an `/ObjStm`. The
 *    root therefore *resolved*, the walk returned nothing because the node
 *    it started from was unreachable, and because the root was defined the
 *    fallback never ran — with every page object sitting in the map. The
 *    fallback now runs whenever the **walk** yields no pages, not only when
 *    the **root** is unresolvable.
 *
 * **On subset composite fonts, and why "no CMap resolution" stopped being an
 * acceptable limitation** (ol-avvt). This file used to name absent CMap
 * resolution as a deliberate limitation and argue it cost only "imperfect
 * glyph decoding downstream" on CJK and symbol fonts. That argument was wrong
 * about who uses composite fonts. `/Subtype /Type0` with `/Encoding
 * /Identity-H` is what **every modern office exporter** emits for ordinary
 * English text, and its string bytes are two-byte glyph indices into a subset
 * font, not character codes. Measured against a real past-paper corpus, three
 * quarters of the papers and five sixths of the pages came back
 * `reached-but-unreadable` while poppler read a full text layer out of every
 * one. `cmap.ts` reads the `/ToUnicode` map those files carry; `resourcesFontsFromText`
 * below resolves which font each `Tf` selects. A second defect rode along with
 * it and only became visible once the characters were right — see
 * `LINE_BREAK_VERTICAL_TOLERANCE` for the newline-per-glyph problem, which
 * shattered the words a character-count check would have called a success.
 *
 * **On Form XObjects, and the trap in fixing them naively** (ol-v460). This
 * file used to name unwalked Form XObjects as a deliberate limitation — see
 * `ol-x1ch`, which bought the *honesty* of that limitation (a page whose only
 * content is a form reported `'unreadable'` rather than a false `'absent'`)
 * without lifting it. Measured against the same past-paper corpus `ol-avvt`
 * used: one converter product puts 100% of seven papers' body text inside a
 * Form XObject that `getPageContent` never opened, so no amount of CMap work
 * could reach it — `ol-avvt`'s fix, correctly, moved these papers not at all.
 * `walkContentTokens` now recurses into a Form XObject when a `Do` names one,
 * folding its shown text into the same walk. **The trap is resource scope**: a
 * form's `/Tf` names are resolved against *its own* `/Resources`, never the
 * page's — the two can reuse the same name for two different fonts, and
 * decoding one form's composite-font glyph indices through another
 * dictionary's `/ToUnicode` CMap (or none) is exactly the plausible-looking
 * garbage `ol-avvt` and `ol-x1ch` exist to refuse, and it would pass a
 * character-count check while failing only a word-level one. See
 * `resolveFormXObject` for exactly how a form's resources are found (its own,
 * falling back to whatever content stream painted it — never unconditionally
 * the page's, so a form nested two deep inherits from its immediate parent,
 * not from a page it never touches) and `walkContentTokens` for the cycle
 * guard (an ancestor-*path* set, not a once-ever-visited one, so the same form
 * legitimately painted twice at sibling positions is not refused as a cycle)
 * and the depth cap that backs it up. Two decode gaps remain and are not
 * form-specific — the `/Encoding /Differences` and builtin-encoding
 * limitations named below apply exactly the same way inside a form as on a
 * page; only the form-walking gap itself is what closed here. The figures
 * stay private, in `olea-service/findings/H-past-papers-inventory-and-text-layer.md`
 * and the bead's own tracing.
 *
 * **On the SAME form painted twice at the SAME position, and why that is the
 * one case ol-v460 deliberately left folded-in rather than folded-out**
 * (ol-hpqn). "Painted twice at sibling positions is not a cycle" (previous
 * paragraph) is true and stays true — but it says nothing about two paints at
 * the *identical* position, which is not a second rendering at all, just the
 * same content re-stamped. Before this fix, `walkContentTokens` had no notion
 * of position, so it walked every non-cyclic `Do` unconditionally and a form
 * painted twice at one spot contributed its text twice — measured, on one
 * page in the same past-paper corpus, as an F1 of 0.50 against poppler (up
 * from 0.155 pre-`ol-v460`, so **not a regression**, but not clean either):
 * precision 0.34, recall 0.98 — nearly everything poppler found, we found
 * too, plus a form's worth of text a second time. `cm`'s translation is now
 * tracked (see `Mat`, `multiplyMat`, `roundedCoord`) and a `Do` naming a form
 * already painted at THIS level's current translation is skipped rather than
 * walked again. The guard is deliberately narrow — same object number, same
 * `(e, f)`, same immediate content stream — because a false positive here
 * *deletes* real text (an MCQ answer key repeating "A B C D" once per
 * question, each at its own position, must never be folded), which is a far
 * worse failure than the inflation being fixed. See `walkContentTokens`'s own
 * doc for why level-relative translation is enough without composing the
 * whole ancestor CTM chain.
 *
 * Objects are still found by scanning for `N G obj` rather than by reading
 * an xref table, which is what makes this parser *more* tolerant of a
 * damaged xref than a spec-correct one would be; the xref stream is consulted
 * only as one more place a `/Root` reference might be written.
 *
 * **Named limitations, deliberately not chased further** (this task's own
 * judgement about where "minimal but real" stops and "reimplementing
 * pdf.js" starts):
 *  - No cross-reference-stream *decoding* (the `/W`-column binary table
 *    itself is never parsed). Nothing needs it: object locations come from
 *    the raw scan plus `/ObjStm` expansion, so the only thing the xref
 *    stream is read for is the `/Root` entry in its own dictionary, which is
 *    plain text in the object header like any other dict.
 *  - No support for `/ObjStm` streams filtered by anything other than
 *    `/FlateDecode` (`/LZWDecode`, `/ASCII85Decode` and friends). An
 *    object stream we cannot inflate is skipped, and the result is the
 *    honest `'no-pages-found'` outcome rather than a silent empty.
 *  - No encryption support (an encrypted PDF's streams are unreadable
 *    garbage to this parser; it will report near-zero char yield and route
 *    the page to vision, which is a safe failure mode, not a crash).
 *  - Font encoding is resolved through the font's **`/ToUnicode` CMap** and
 *    nothing else (see `cmap.ts`). A simple font without one keeps the
 *    Latin-1/WinAnsi reading, which is its correct default. What is *not*
 *    implemented is the other two ways a reader can recover a code: a simple
 *    font's `/Encoding /Differences` glyph names resolved through the Adobe
 *    Glyph List, and a font's builtin encoding read out of the embedded font
 *    program. A composite font with neither a `/ToUnicode` nor a supported
 *    encoding reports `'unreadable'` rather than guessing — see the honesty
 *    rule in `cmap.ts`.
 *  - No inline images (`BI...ID...EI`) special-cased — their binary payload
 *    is tokenized as if it were content-stream syntax. In practice this
 *    contributes noise tokens that are silently ignored (not text-showing
 *    operators), not corrupted output, because the tokenizer never throws
 *    on unrecognised bytes.
 *  - **Form XObjects are walked, resolving fonts from the form's own
 *    `/Resources`** (ol-v460 — see the module doc above; this bullet used to
 *    name the opposite as a limitation). What remains unresolved inside a
 *    form is exactly what remains unresolved on a page: the two font-encoding
 *    gaps named two bullets up.
 */

import { unzlibSync } from 'fflate';
import { decodeWithFont, type FontDecoder, parseToUnicodeCMap } from './cmap.js';
import { applyFurnitureDetection } from './furniture.js';
import { classifyPageText, isReachedButUnreadable } from './plausibility.js';
import { routePage } from './threshold.js';
import type {
  ExtractedUnit,
  ExtractionOutcome,
  ExtractionResult,
  ExtractOptions,
  Extractor,
  ExtractorInput,
  PageExtraction,
  RouteDecision,
} from './types.js';

// ---- byte/string plumbing --------------------------------------------------

/**
 * PDF's own syntax (keywords, delimiters, numbers, dictionary punctuation)
 * is always single-byte ASCII, so decoding the *whole* file as Latin-1 is
 * safe for locating structure: Latin-1 is a bijection over byte values
 * 0-255, meaning every offset computed against the decoded string is also a
 * valid offset into the original `Uint8Array` — which is what lets
 * `parsePdfObjects` hand back byte ranges that `getStreamBytes` slices
 * directly out of `bytes`, rather than re-encoding a JS string back to
 * bytes and hoping nothing was lost in the round-trip.
 */
function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

// ---- object-level structural parsing --------------------------------------

interface PdfObjectRecord {
  /** The dictionary portion of the object body — before `stream`, if any. */
  readonly dictText: string;
  /** Absolute byte offsets of the raw (possibly compressed) stream data, if this object has one. */
  readonly streamStart?: number;
  readonly streamEnd?: number;
}

/**
 * Finds every `N G obj ... endobj` in the file by direct scan rather than
 * via the xref table (see the module doc). After each object, the regex's
 * `lastIndex` is advanced past that object's `endobj` — not left to resume
 * scanning from wherever the match ended — specifically so that binary
 * stream bytes (which can coincidentally contain digit-digit-`obj`-shaped
 * sequences) are never re-entered as a spurious object header.
 */
function parsePdfObjects(text: string): Map<number, PdfObjectRecord> {
  const objects = new Map<number, PdfObjectRecord>();
  const OBJ_RE = /(\d+)[ \t]+\d+[ \t]+obj\b/g;
  let match: RegExpExecArray | null = OBJ_RE.exec(text);
  while (match !== null) {
    const num = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const endobjIdx = text.indexOf('endobj', bodyStart);
    const bodyEnd = endobjIdx === -1 ? text.length : endobjIdx;
    const body = text.slice(bodyStart, bodyEnd);

    const streamKw = /stream\r?\n/.exec(body);
    if (!streamKw) {
      objects.set(num, { dictText: body });
    } else {
      const dictText = body.slice(0, streamKw.index);
      const relStart = streamKw.index + streamKw[0].length;
      const relEndstream = body.indexOf('endstream', relStart);
      const relLimit = relEndstream === -1 ? body.length : relEndstream;

      // `/Length`, when it is a direct integer, is the stream's exact byte
      // count and beats guessing at the delimiter — but only when the two
      // agree to within the one EOL the spec puts between the data and
      // `endstream`. A `/Length` that disagrees by more than that is a
      // producer bug (or an indirect length this parser did not resolve),
      // and the scan is the more tolerant answer.
      //
      // **Why this matters, and it is not theoretical.** Trimming an EOL
      // unconditionally eats a *data* byte whenever the stream's own last
      // byte happens to be `\n` or `\r`, which for compressed data is simply
      // 1-in-128. `unzlibSync` does not throw on a payload one byte short —
      // it returns the successfully-inflated prefix — so the loss is silent.
      // Measured against a real-world vault, it cost the tail of one
      // `/ObjStm` and with it a run of leaf page dictionaries, so a long
      // document reported short with no error anywhere. The figures stay
      // private, in `olea-service/findings/E4-corpus-and-zero-yield.md`
      // (ol-voen).
      const declared = dictInt(dictText, 'Length');
      let relEnd: number;
      if (
        declared !== undefined &&
        relStart + declared <= relLimit &&
        relLimit - relStart - declared <= 2
      ) {
        relEnd = relStart + declared;
      } else {
        relEnd = relLimit;
        // Trim exactly one trailing EOL immediately before `endstream` — it's
        // part of the stream *delimiter*, not the stream's own bytes.
        if (relEnd >= 2 && body[relEnd - 2] === '\r' && body[relEnd - 1] === '\n') relEnd -= 2;
        else if (relEnd >= 1 && (body[relEnd - 1] === '\n' || body[relEnd - 1] === '\r'))
          relEnd -= 1;
      }

      objects.set(num, {
        dictText,
        streamStart: bodyStart + relStart,
        streamEnd: bodyStart + relEnd,
      });
    }

    OBJ_RE.lastIndex = bodyEnd;
    match = OBJ_RE.exec(text);
  }
  return objects;
}

// ---- minimal dictionary field readers -------------------------------------
// Deliberately not a general PDF-dictionary parser (no nested-dict values,
// no arbitrary array element types) — just the handful of shapes page-tree
// walking and stream decoding actually need. See the module doc.

function dictName(dictText: string, key: string): string | undefined {
  const re = new RegExp(`/${key}\\s*/([A-Za-z0-9+_.#-]+)`);
  return re.exec(dictText)?.[1];
}

function dictRef(dictText: string, key: string): number | undefined {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dictText);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

/** A direct (non-indirect) non-negative integer value, e.g. `/N 42`, `/First 218`, `/Count 3`. The mandatory whitespace after the key is what keeps `/N` from matching `/Name`. */
function dictInt(dictText: string, key: string): number | undefined {
  const m = new RegExp(`/${key}\\s+(\\d+)(?!\\d)`).exec(dictText);
  if (m?.[1] === undefined) return undefined;
  // `/Key 12 0 R` is an indirect *reference*, not the integer 12. This
  // parser resolves no indirect integers, so report "absent" rather than
  // silently handing back an object number as if it were the value.
  if (/^\s+\d+\s+R\b/.test(dictText.slice(m.index + m[0].length))) return undefined;
  return Number(m[1]);
}

function dictRefArray(dictText: string, key: string): number[] {
  const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dictText);
  if (!m) return [];
  const inner = m[1] ?? '';
  const refs: number[] = [];
  const refRe = /(\d+)\s+\d+\s+R/g;
  let rm: RegExpExecArray | null = refRe.exec(inner);
  while (rm !== null) {
    refs.push(Number(rm[1]));
    rm = refRe.exec(inner);
  }
  return refs;
}

/** `/Contents` is either a single indirect reference or an array of them — both forms occur in the wild. */
function dictContentsRefs(dictText: string): number[] {
  const arr = dictRefArray(dictText, 'Contents');
  if (arr.length > 0) return arr;
  const single = dictRef(dictText, 'Contents');
  return single === undefined ? [] : [single];
}

/** `/Filter` may be a single name or an array of names (chained filters) — this only ever checks for FlateDecode's presence, not order or chaining. */
function dictHasFlateDecode(dictText: string): boolean {
  const m = /\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/.exec(dictText);
  return m?.[1]?.includes('FlateDecode') ?? false;
}

// ---- page-tree walk ---------------------------------------------------

/**
 * Finds the root Catalog's `/Pages` object number, trying three places for
 * the `/Root` reference in descending order of authority:
 *
 *  1. the last literal `trailer` dict in the file (last = most recent, for an
 *     incrementally-updated PDF);
 *  2. the last cross-reference *stream*'s own dictionary — a PDF 1.5+ file
 *     written without a `trailer` keyword puts the trailer's keys, `/Root`
 *     included, in the `/Type /XRef` object's dict, which is plain text in
 *     the object header and needs none of the `/W`-column table decoded;
 *  3. a `/Type /Catalog` scan, which asks the objects themselves rather than
 *     anything that points at them, and so survives a file whose xref is
 *     damaged or absent entirely.
 */
function findPagesRootNum(
  text: string,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): number | undefined {
  const trailerRe = /trailer\s*<<([\s\S]*?)>>/g;
  let lastTrailer: RegExpExecArray | null = null;
  let m: RegExpExecArray | null = trailerRe.exec(text);
  while (m !== null) {
    lastTrailer = m;
    m = trailerRe.exec(text);
  }

  let rootNum = lastTrailer ? dictRef(lastTrailer[1] ?? '', 'Root') : undefined;
  if (rootNum === undefined) {
    for (const rec of objects.values()) {
      if (dictName(rec.dictText, 'Type') !== 'XRef') continue;
      const fromXref = dictRef(rec.dictText, 'Root');
      if (fromXref !== undefined) rootNum = fromXref; // last one in the file wins.
    }
  }
  if (rootNum === undefined) {
    for (const [num, rec] of objects) {
      if (dictName(rec.dictText, 'Type') === 'Catalog') {
        rootNum = num;
        break;
      }
    }
  }
  if (rootNum === undefined) return undefined;

  const rootObj = objects.get(rootNum);
  return rootObj ? dictRef(rootObj.dictText, 'Pages') : undefined;
}

/**
 * The page tree's own `/Count`, when the root `/Pages` node is reachable and
 * states one. This is the *document's* claim about how many pages it has, as
 * distinct from how many this parser managed to reach — which is exactly the
 * comparison `ExtractionOutcome` needs to tell `'empty-document'` (a page
 * tree that really does declare zero pages) from `'no-pages-found'` (a
 * document that says it has pages we could not enumerate).
 */
function declaredPageCount(
  pagesRootNum: number | undefined,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): number | undefined {
  if (pagesRootNum === undefined) return undefined;
  const rec = objects.get(pagesRootNum);
  return rec ? dictInt(rec.dictText, 'Count') : undefined;
}

/** Walks `/Kids` from the Pages root, depth-first, collecting leaf Page object numbers in document order. Cycle-guarded — a malformed tree cannot loop forever. */
function collectPageNums(
  pagesRootNum: number,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();

  const visit = (num: number): void => {
    if (seen.has(num)) return;
    seen.add(num);
    const rec = objects.get(num);
    if (!rec) return;
    if (dictName(rec.dictText, 'Type') === 'Pages') {
      for (const kid of dictRefArray(rec.dictText, 'Kids')) visit(kid);
    } else {
      out.push(num);
    }
  };
  visit(pagesRootNum);
  return out;
}

/** Fallback page discovery when no trailer/Catalog/Pages chain resolves at all: every `/Type /Page` object, in object-number order. Better than reporting zero pages for a structurally-odd-but-otherwise-fine PDF. */
function fallbackPageNums(objects: ReadonlyMap<number, PdfObjectRecord>): number[] {
  const nums: number[] = [];
  for (const [num, rec] of objects) {
    if (dictName(rec.dictText, 'Type') === 'Page') nums.push(num);
  }
  return nums.sort((a, b) => a - b);
}

// ---- stream decoding --------------------------------------------------

function getStreamBytes(bytes: Uint8Array, rec: PdfObjectRecord): Uint8Array | undefined {
  if (rec.streamStart === undefined || rec.streamEnd === undefined) return undefined;
  const raw = bytes.slice(rec.streamStart, rec.streamEnd);
  if (!dictHasFlateDecode(rec.dictText)) return raw;
  try {
    return unzlibSync(raw);
  } catch {
    // Corrupt or unsupported compressed stream — degrade to "no text found"
    // rather than throwing, so one bad content stream cannot fail an entire
    // extraction batch. The page will report a low/zero char count and
    // correctly route to vision, which is the safe failure mode.
    return undefined;
  }
}

/**
 * Inflates every `/Type /ObjStm` object stream and registers the objects
 * inside it into `objects`, so the rest of this module never has to know
 * whether a dictionary arrived compressed or in plain sight (ol-voen — see
 * the module doc for what this cost).
 *
 * An object stream's payload is `/N` pairs of `objnum offset`, whitespace-
 * separated, in the first `/First` bytes, followed by the concatenated
 * object bodies at those offsets. Objects inside an object stream can never
 * themselves have streams (the spec forbids it), which is also why one pass
 * suffices: an `/ObjStm` can never be nested inside another.
 *
 * **A raw object always wins over a compressed one of the same number.** A
 * plain `N G obj` in the file is directly addressable and, in an
 * incrementally-updated document, is the later write; overwriting it with an
 * object-stream entry would be silently reverting an update. Skipping is
 * also what makes this function safe to run unconditionally.
 *
 * Every failure mode here is a skip, never a throw: a stream that will not
 * inflate (an unsupported filter, corruption), a dictionary missing `/N` or
 * `/First`, a truncated pair table, an offset past the end of the payload.
 * A skipped object stream costs the pages it held, and `extract()` reports
 * that as `'no-pages-found'` rather than as success.
 */
function expandObjectStreams(bytes: Uint8Array, objects: Map<number, PdfObjectRecord>): void {
  const streams: PdfObjectRecord[] = [];
  for (const rec of objects.values()) {
    if (dictName(rec.dictText, 'Type') === 'ObjStm') streams.push(rec);
  }

  for (const rec of streams) {
    const payload = getStreamBytes(bytes, rec);
    if (!payload) continue;
    const count = dictInt(rec.dictText, 'N');
    const first = dictInt(rec.dictText, 'First');
    if (count === undefined || first === undefined || first > payload.length) continue;

    const text = decodeLatin1(payload);
    const header = text.slice(0, first).match(/\d+/g) ?? [];

    const entries: Array<{ num: number; offset: number }> = [];
    for (let i = 0; i + 1 < header.length && entries.length < count; i += 2) {
      entries.push({ num: Number(header[i]), offset: Number(header[i + 1]) });
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry === undefined) continue;
      const next = entries[i + 1];
      const start = first + entry.offset;
      const end = next === undefined ? text.length : first + next.offset;
      if (start >= text.length || end <= start) continue;
      if (objects.has(entry.num)) continue; // see the doc comment: raw objects win.
      objects.set(entry.num, { dictText: text.slice(start, end) });
    }
  }
}

// ---- content-stream tokenizing ----------------------------------------
// A content stream is PDF's own tiny postfix language: operands (numbers,
// strings, names, arrays) followed by an operator. This tokenizer only
// needs to recognise operand *shapes* precisely enough to find `Tj`/`TJ`/
// `'`/`"` and the string(s) immediately preceding them — it does not
// interpret positioning, graphics-state, or any other operator.

type PdfToken =
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'array'; readonly items: readonly PdfToken[] }
  /**
   * A `/Name` operand. Kept rather than dropped **only** so that `Tf`'s font
   * resource name reaches `walkContentTokens` (ol-avvt): without knowing which
   * font is current there is no way to know which `/ToUnicode` CMap a shown
   * string should be read through, and a composite font's bytes are glyph
   * indices rather than characters. It is a separate token *kind* — never
   * folded into `string` — precisely so it can still never be mistaken for the
   * pending operand of a text-showing operator, which is what dropping it used
   * to guarantee.
   */
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'op'; readonly name: string };

const DELIMS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
function isDelim(c: string | undefined): boolean {
  return c !== undefined && DELIMS.has(c);
}
function isWhitespace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0';
}

/** Decodes a PDF literal string's escapes (`\n`, `\(`, octal `\ddd`, line-continuation backslash-newline, and bare-char fallback for anything else, per spec). */
function decodePdfLiteralString(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      i++;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'n') {
      out += '\n';
      i += 2;
    } else if (next === 'r') {
      out += '\r';
      i += 2;
    } else if (next === 't') {
      out += '\t';
      i += 2;
    } else if (next === 'b') {
      out += '\b';
      i += 2;
    } else if (next === 'f') {
      out += '\f';
      i += 2;
    } else if (next === '(' || next === ')' || next === '\\') {
      out += next;
      i += 2;
    } else if (next === '\n') {
      i += 2; // line continuation — no character emitted
    } else if (next === '\r') {
      i += raw[i + 2] === '\n' ? 3 : 2;
    } else if (next >= '0' && next <= '7') {
      let oct = next;
      let k = i + 2;
      for (let d = 0; d < 2; d++, k++) {
        const digit = raw[k];
        if (digit === undefined || digit < '0' || digit > '7') break;
        oct += digit;
      }
      out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff);
      i = k;
    } else {
      out += next; // unknown escape: the backslash is dropped, the char stands for itself (spec-defined fallback)
      i += 2;
    }
  }
  return out;
}

/** Reads a balanced, escape-aware `(...)` literal string starting at `src[start] === '('`. */
function readLiteralString(src: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let depth = 1;
  let raw = '';
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '\\') {
      raw += c + (src[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (c === '(') {
      depth++;
      raw += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      i++;
      if (depth === 0) break;
      raw += c;
      continue;
    }
    raw += c;
    i++;
  }
  return { text: decodePdfLiteralString(raw), next: i };
}

/** Reads a `<hex>` string starting at `src[start] === '<'` (already checked not to be `<<`). Odd-length hex is padded per spec (trailing nibble treated as 0). */
function readHexString(src: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let hex = '';
  while (i < src.length && src[i] !== '>') {
    const c = src[i];
    if (c !== undefined && /[0-9a-fA-F]/.test(c)) hex += c;
    i++;
  }
  i++; // skip '>'
  if (hex.length % 2 === 1) hex += '0';
  let out = '';
  for (let k = 0; k < hex.length; k += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(k, k + 2), 16));
  }
  return { text: out, next: i };
}

function isNumberChar(c: string | undefined): boolean {
  return c !== undefined && ((c >= '0' && c <= '9') || c === '.');
}

function readNumber(src: string, start: number): { value: number; next: number } {
  let i = start;
  if (src[i] === '+' || src[i] === '-') i++;
  while (isNumberChar(src[i])) i++;
  const value = Number.parseFloat(src.slice(start, i));
  return { value: Number.isNaN(value) ? 0 : value, next: i === start ? start + 1 : i };
}

/** Skips a `<< ... >>` dictionary appearing mid-content-stream (e.g. `BDC` marked-content properties), depth-counted so a nested dict inside it doesn't close early. */
function skipDict(src: string, start: number): number {
  let i = start + 2;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '<' && src[i + 1] === '<') {
      depth++;
      i += 2;
    } else if (src[i] === '>' && src[i + 1] === '>') {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }
  return i;
}

/** Reads a `[ ... ]` array (the shape `TJ` operands take: strings interleaved with kerning numbers). Elements are only ever strings or numbers in a `TJ` array — anything else encountered is skipped defensively rather than aborting the whole array. */
function readArray(src: string, start: number): { items: PdfToken[]; next: number } {
  let i = start + 1;
  const items: PdfToken[] = [];
  while (i < src.length && src[i] !== ']') {
    const c = src[i];
    if (c === undefined || isWhitespace(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      const r = readLiteralString(src, i);
      items.push({ kind: 'string', text: r.text });
      i = r.next;
      continue;
    }
    if (c === '<') {
      const r = readHexString(src, i);
      items.push({ kind: 'string', text: r.text });
      i = r.next;
      continue;
    }
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) {
      const r = readNumber(src, i);
      items.push({ kind: 'number', value: r.value });
      i = r.next;
      continue;
    }
    i++; // unrecognised element shape — skip one char and keep scanning
  }
  return { items, next: i + 1 };
}

function tokenizeContentStream(src: string): PdfToken[] {
  const tokens: PdfToken[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === undefined) break;
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      const r = readLiteralString(src, i);
      tokens.push({ kind: 'string', text: r.text });
      i = r.next;
      continue;
    }
    if (c === '<') {
      if (src[i + 1] === '<') {
        i = skipDict(src, i);
        continue;
      }
      const r = readHexString(src, i);
      tokens.push({ kind: 'string', text: r.text });
      i = r.next;
      continue;
    }
    if (c === '[') {
      const r = readArray(src, i);
      tokens.push({ kind: 'array', items: r.items });
      i = r.next;
      continue;
    }
    if (c === ']' || c === '>' || c === ')') {
      i++; // stray closer — ignore rather than treat as an error
      continue;
    }
    if (c === '/') {
      // Name operand (font/resource/property names). Emitted as its own token
      // kind so `Tf` can name the current font — see `PdfToken`.
      const nameStart = ++i;
      while (i < n && !isDelim(src[i]) && !isWhitespace(src[i])) i++;
      tokens.push({ kind: 'name', name: src.slice(nameStart, i) });
      continue;
    }
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) {
      const r = readNumber(src, i);
      tokens.push({ kind: 'number', value: r.value });
      i = r.next;
      continue;
    }
    if (c === '{' || c === '}') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !isDelim(src[j]) && !isWhitespace(src[j])) j++;
    if (j === i) {
      i++; // defensive: never loop forever on an unexpected byte
      continue;
    }
    tokens.push({ kind: 'op', name: src.slice(i, j) });
    i = j;
  }
  return tokens;
}

/**
 * The magnitude, in thousandths of a text-space unit, at or beyond which a
 * `TJ` numeric adjustment is read as a **word gap** rather than as intra-word
 * kerning (ol-frk9).
 *
 * **Why this constant has to exist at all.** A `TJ` array's numbers move the
 * text cursor; they are not decoration. PowerPoint, Keynote and pdf-lib emit
 * an actual `space` glyph between words and use the numbers only for pair
 * kerning, so dropping them costs nothing. **pdfTeX does not**: it sets each
 * word as its own string and encodes the inter-word gap *as* the number, so a
 * reader that drops the numbers concatenates the whole line into one token.
 * That is the entire mechanism behind ol-frk9: the characters this extractor
 * was missing on LaTeX-produced files were overwhelmingly inter-word spaces,
 * and word recall on that material was materially worse than elsewhere. Both
 * claims were established by measuring against a real-world vault, and the
 * measurements themselves stay private — see
 * `olea-service/findings/E4-corpus-and-zero-yield.md` §8.2, §8.4.
 *
 * **Units, and why no font size is needed.** A `TJ` number is expressed in
 * thousandths of the *current font size*, so a value is already an em-relative
 * quantity: -250 means a quarter of an em of extra advance whether the type is
 * set at 9pt or 30pt. This tokenizer tracks no graphics state and needs none
 * to apply this rule, which is exactly why the rule is stated in these units.
 *
 * **Sign.** Only a *negative* adjustment opens a gap (it advances the cursor
 * forward past where the glyphs ended); a positive one pulls the next glyph
 * back over the previous, which is tightening, never a word break. Testing
 * `magnitude` in both directions would insert spaces into ligature and accent
 * composition, which is the opposite of the defect being fixed.
 *
 * **How the value was decided.** It was calibrated against a real-world vault
 * rather than a synthetic one: the threshold was swept against poppler
 * `pdftotext` as ground truth over every reachable PDF in that corpus. Word
 * recall came out *flat at its maximum across a wide band* and fell off on
 * both sides of it — above the band real gaps start being missed, below it
 * pair kerning starts being read as a gap and words shatter. The distribution
 * is that bimodal: there is nothing in between to get wrong. The value chosen
 * here sits well inside the band rather than at either edge, and above every
 * adjustment the non-LaTeX producers in that corpus emit, which is why the fix
 * has to leave those files byte-identical (`pdf.spec.ts` asserts exactly
 * that). The band, the sweep and the before/after figures are private and live
 * in `olea-service/findings/E4-word-gap-calibration.md`; none of them is
 * restated here.
 *
 * **This is a threshold tuned on real data, not on a synthetic corpus** — the
 * distinction the service repo's CLAUDE.md draws, and the reason the fixtures
 * in `pdf.spec.ts` assert the *rule* while the findings file carries the
 * evidence for the *number*.
 *
 * ## The residual defect this fix does NOT cover, and the trap in the obvious cure
 *
 * Two runs separated by a **pure reposition** — a text-matrix or font change with
 * no numeric adjustment anywhere — still concatenate. There is nothing to key on:
 * the producer wrote no gap, so the rule above has no signal to read. Recorded
 * here 2026-08-21 when `ol-tmgap` closed as off the v0.9 path on measured
 * grounds; corpus mean word F1 through this extractor is 0.983, so the impact was
 * never large enough to justify the risk below.
 *
 * **The obvious cure fails in two directions at once, which is why it was not
 * taken.** Treating a baseline y-change as a newline breaks sub- and superscript
 * composition in maths-bearing material — a baseline shift is exactly what a
 * superscript *is* — and it necessarily moves character counts on producers that
 * position every line with a text matrix, which violates the zero-regression floor
 * the calibration above established.
 *
 * **If you take this on:** emit a newline only when the baseline shift exceeds the
 * current font size, on the reasoning that a full em cannot be a sub- or
 * superscript. Validate against the non-LaTeX zero-regression set *before*
 * measuring any improvement. **Do not guess a displacement threshold** — sweep it
 * against the private corpus with poppler as ground truth, the way the inter-word
 * gap above was settled.
 */
export const WORD_GAP_KERN_THOUSANDTHS = 200;

/**
 * **A line break is a *vertical* move, not any move** (ol-avvt).
 *
 * `Td`, `TD` and `Tm` all set the text *line* matrix, and this walker used to
 * emit a `\n` for every one of them on the reasoning that they "move to the
 * next line". For pdfTeX, which sets one line per `Td`, that is true and cost
 * nothing. For the office exporters that produce most of the past-paper corpus
 * it is badly false: they position **every glyph run individually**, with a
 * `Td` or a `Tm` per run and no vertical movement at all, so a newline landed
 * between roughly every pair of characters. Measured against poppler on that
 * corpus, the decoded letters matched to within 0.1% while word-level
 * agreement sat near zero — the words were correct and then shattered on the
 * way out. That is not a cosmetic defect: the corpus feeds retrieval, and a
 * shattered word matches nothing.
 *
 * So the question asked is whether the text line moved **down (or up)**, which
 * is what a new line actually is. A purely horizontal move leaves the line
 * alone; word boundaries on that line come from the producer's own space
 * glyphs and from `WORD_GAP_KERN_THOUSANDTHS`, both of which already worked.
 *
 * The tolerance exists so that a superscript, a subscript or a baseline nudge
 * is not read as a new line. It is deliberately *tight* — a fraction of a
 * typographic point in unscaled text space — because the failure it guards
 * against (a spurious break inside a word) is far commoner than the one a
 * loose value would cause (two genuinely different lines run together), and
 * because real line leading is an order of magnitude larger than any nudge.
 */
export const LINE_BREAK_VERTICAL_TOLERANCE = 0.5;

/** A PDF affine transform `[a b c d e f]`, the same six-number shape `cm` and `Tm` both write. */
type Mat = readonly [number, number, number, number, number, number];

const IDENTITY_MAT: Mat = [1, 0, 0, 1, 0, 0];

/**
 * `m1 × m2` under PDF's row-vector convention (`point' = point × m1 × m2`,
 * i.e. `m1` is applied first). This is exactly what the `cm` operator needs:
 * concatenating a new matrix onto the CTM means the new matrix is applied
 * before whatever the CTM already was, so `cm`'s handler computes
 * `multiplyMat(operandMatrix, ctm)`, never the other order.
 */
function multiplyMat(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/**
 * Rounding applied to a CTM's translation before it becomes half of a
 * form-position dedup key (ol-hpqn) — coarse enough to absorb floating-point
 * noise from a chain of `cm` concatenations reaching the identical intended
 * point by two different multiplication paths, tight enough that no two
 * *intentionally* distinct positions in a real document could land on the
 * same key by accident (a page is at most low hundreds of points across; two
 * placements differing by less than a hundredth of a point are not a
 * document author's two different placements).
 */
function roundedCoord(n: number): string {
  return n.toFixed(2);
}

/**
 * The running result of walking one page's content-stream tokens: the text
 * itself, plus the two facts only the tokenizer can supply about whether this
 * page *had* a text layer at all (ol-x1ch — see `plausibility.ts`).
 *
 * `pendingGap` is the state ol-pvmy exists to carry. It is a field of this
 * object rather than a local of `joinTjArray` precisely because the defect was
 * that it *was* a local: reset on every `TJ`, so a gap the producer encoded at
 * an array edge either side of a `Tf`, a colour change or a `Tm` was thrown
 * away and the two runs concatenated with no delimiter at all.
 */
interface ContentWalk {
  text: string;
  pendingGap: boolean;
  /** A text-showing operator ran (whatever it produced), at any recursion depth into a Form XObject. */
  sawTextOperator: boolean;
  /**
   * A `Do` painted an XObject. Kept true regardless of whether that XObject
   * was a Form we could walk (ol-v460): it is what `getPageContent` uses to
   * distinguish "this page's only content is a form we could not decode" —
   * a missing resource, a cycle, a depth cap, an unresolved font — from a
   * genuine scan, so the honesty `ol-x1ch` bought survives the recursion.
   */
  sawXObjectPaint: boolean;
}

/**
 * Appends one shown string, materialising a pending word gap as a single space
 * first (see `WORD_GAP_KERN_THOUSANDTHS`).
 *
 * The gap is *pending* rather than emitted immediately, so that a run of
 * several adjustments collapses to one space and so that a gap with nothing
 * after it — at the end of the page, not merely at the end of an array — emits
 * nothing. A space already present on either side of the gap suppresses it
 * too: a producer that writes both a real space glyph *and* a positioning
 * number must not yield two spaces, because INV-2 aside, doubling whitespace
 * would inflate `charCount` on material that never had the defect.
 *
 * **`walk.text.length > 0` is the leading-edge guard, and it is now asked of
 * the whole page rather than of one array** (ol-pvmy). Suppressing a gap that
 * has no text before it is right — it is not a boundary *between* two words.
 * Asking that question per array was the bug: a gap carried as the leading
 * element of the array *after* a font switch has plenty of text before it, on
 * the same line, and was discarded anyway.
 */
function showText(walk: ContentWalk, text: string): void {
  if (walk.pendingGap && walk.text.length > 0 && !/\s$/.test(walk.text) && !/^\s/.test(text)) {
    walk.text += ' ';
  }
  walk.pendingGap = false;
  walk.text += text;
}

/**
 * Shows a `TJ` array's string elements, noting a word gap wherever a numeric
 * adjustment opens one wide enough to be a word break.
 *
 * A gap left pending when the array ends is **not** cleared: it is carried on
 * the `ContentWalk` to whatever the next text-showing operator turns out to
 * be, which is the whole of the ol-pvmy fix.
 */
function showTjArray(
  walk: ContentWalk,
  items: readonly PdfToken[],
  gapThousandths: number,
  font: FontDecoder | undefined,
): void {
  for (const item of items) {
    if (item.kind === 'number') {
      // Negative only: a negative adjustment advances the cursor forward.
      if (-item.value >= gapThousandths) walk.pendingGap = true;
      continue;
    }
    if (item.kind !== 'string') continue;
    showText(walk, decodeWithFont(item.text, font));
  }
}

/**
 * Walks tokens looking for `Tj`/`'`/`"` (take the string immediately
 * preceding) and `TJ` (take the array immediately preceding, concatenating
 * its string elements and synthesising a space wherever a numeric adjustment
 * is wide enough to be a word gap — `WORD_GAP_KERN_THOUSANDTHS`, ol-frk9). No
 * general operand stack is needed: PDF content streams are strictly
 * operand(s)-then-operator, so "the last string/array token seen" is
 * exactly "the operand of the next text-showing operator that consumes
 * one" — operators this function doesn't care about are simply skipped
 * without disturbing that last-seen value. `Td`/`TD`/`T*` (move to next
 * line) insert a newline so per-line structure survives approximately, for
 * readability; it has no material bearing on char-count-based routing
 * either way. The joined result is trimmed of leading/trailing whitespace
 * before being returned — content streams routinely open with a
 * positioning `Td` *to* the first line (not a break *between* two lines),
 * which would otherwise leave every page's text starting with a spurious
 * `\n` unrelated to the page's actual content.
 *
 * **The word-gap state spans the whole walk, not one array** (ol-pvmy). See
 * `ContentWalk` and `showText`. Note what this deliberately does *not* do: it
 * does not synthesise a boundary merely because an operator sat between two
 * runs. A `Tf` or a colour change mid-word is ordinary typesetting, and a rule
 * that split there would shatter words — the failure mode opposite to the one
 * being fixed. The only thing that opens a gap is still a numeric adjustment
 * the producer wrote, tested against the same calibrated threshold; all that
 * changed is that the information is no longer discarded at an array edge.
 * That is also why this cannot move a character on the producers ol-frk9 had
 * to leave byte-identical: the threshold sits above every adjustment they
 * emit, so there is never a pending gap on their material to carry.
 *
 * **`formCtx` is what lets `Do` recurse into a Form XObject rather than only
 * flag that one was painted** (ol-v460). It is optional and absent whenever a
 * caller has no `bytes`/`objects` to resolve a form against — nothing else
 * here changes shape without it, a `Do` just stays the no-op it always was.
 * The per-level state (`font`, `lm`, `leading`, and the rest) lives inside the
 * inner `run` closure and is re-initialised fresh on every recursive call: a
 * form is its own content stream with its own `BT`/`Tf`/positioning, and the
 * PDF spec forbids a `Do` from appearing between a `BT` and its `ET`, so a
 * form is never invoked *mid-text-object* and there is no outer text state
 * for it to inherit. Only `walk` itself — the accumulated text and the
 * pending-gap flag ol-pvmy carries — is shared across every level, which is
 * what lets a word gap the producer wrote at the very edge of a form's
 * content still join correctly with whatever text came immediately before or
 * after the `Do` that painted it.
 */
function walkContentTokens(
  tokens: readonly PdfToken[],
  fonts: ReadonlyMap<string, FontDecoder> = new Map(),
  gapThousandths: number = WORD_GAP_KERN_THOUSANDTHS,
  formCtx?: {
    readonly bytes: Uint8Array;
    readonly objects: ReadonlyMap<number, PdfObjectRecord>;
    /** This level's own Form-subtype `/XObject` resources, name to object number. */
    readonly forms: ReadonlyMap<string, number>;
    /** This level's effective `/Resources` text, for a nested form to fall back to — see `resolveFormXObject`. */
    readonly resourcesText: string | undefined;
  },
): ContentWalk {
  const walk: ContentWalk = {
    text: '',
    pendingGap: false,
    sawTextOperator: false,
    sawXObjectPaint: false,
  };

  // Ancestor-*path* cycle guard (ol-v460): an object number is added just
  // before recursing into it and removed just after, so it blocks a form that
  // paints itself directly or through a longer cycle, while still allowing
  // the ordinary, non-cyclic case of the SAME form painted twice at sibling
  // positions on the page (a repeated background, a watermark) — which is not
  // a cycle and must not be refused as one. A once-ever-visited set would get
  // that case wrong.
  const formPath = new Set<number>();

  const run = (
    toks: readonly PdfToken[],
    fontMap: ReadonlyMap<string, FontDecoder>,
    formsMap: ReadonlyMap<string, number>,
    resourcesText: string | undefined,
    depth: number,
  ): void => {
    let lastString = '';
    let lastName = '';
    let lastArrayItems: readonly PdfToken[] = [];
    // Numeric operands seen since the last operator. PDF content streams are
    // strictly operands-then-operator, so this is exactly the operand list of the
    // operator about to run; it is cleared by every operator, including the ones
    // this walker ignores, so a stale number can never be read as a coordinate.
    let nums: number[] = [];
    // The text **line** matrix `[a b c d e f]`, tracked only closely enough to
    // answer "did the line move vertically?" — see `LINE_BREAK_VERTICAL_TOLERANCE`.
    // `BT` resets it to the identity, per the spec. Local to this level: a
    // form establishes its own text objects and does not inherit the
    // invoking content stream's line matrix (see the function doc).
    let lm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let leading = 0;
    // The graphics-state CTM and its `q`/`Q` save/restore stack (ol-hpqn),
    // tracked only for its translation component — see `roundedCoord` and the
    // `Do` case below. Local to this level, matching `lm`: a form establishes
    // its own initial graphics state and this walker does not thread the
    // invoking level's CTM into it (see the function doc's "level-relative"
    // reasoning — two `Do`s of the same form from the SAME immediate content
    // stream are what this dedups, and for those siblings the parent CTM is a
    // constant offset shared by both, so comparing level-local translations is
    // equivalent to comparing absolute page positions).
    let ctm: Mat = IDENTITY_MAT;
    const ctmStack: Mat[] = [];
    // Position keys (`targetObjectNum@x,y`) already painted by a `Do` at THIS
    // level — the true-duplicate memo (ol-hpqn). Deliberately scoped to one
    // `run()` call, i.e. one content stream: two different forms painting the
    // same nested form from their own, unrelated positions must never
    // collide here, and they cannot, because each gets its own `Set`.
    const paintedFormPositions = new Set<string>();

    /**
     * Ends the current line. A pending word gap is dropped rather than
     * materialised: the newline is already a boundary, and emitting both would
     * inflate `charCount` on material that never had the defect.
     */
    const breakLine = (): void => {
      walk.pendingGap = false;
      walk.text += '\n';
    };

    /** Applies `Td`'s translation to the line matrix and breaks the line if it moved vertically. */
    const moveLine = (tx: number, ty: number): void => {
      const [a, b, c, d, e, f] = lm;
      const nf = tx * b + ty * d + f;
      const moved = Math.abs(nf - f) > LINE_BREAK_VERTICAL_TOLERANCE;
      lm = [a, b, c, d, tx * a + ty * c + e, nf];
      if (moved) breakLine();
    };
    // The font in force for the next text-showing operator. `undefined` means
    // "no decoder known", which `decodeWithFont` treats as the historical
    // Latin-1 pass-through — so a page whose fonts we could not resolve behaves
    // exactly as it did before ol-avvt rather than losing its text.
    let font: FontDecoder | undefined;

    for (const tok of toks) {
      if (tok.kind === 'string') {
        lastString = tok.text;
        continue;
      }
      if (tok.kind === 'name') {
        lastName = tok.name;
        continue;
      }
      if (tok.kind === 'array') {
        lastArrayItems = tok.items;
        continue;
      }
      if (tok.kind === 'number') {
        nums.push(tok.value);
        continue;
      }

      switch (tok.name) {
        case 'BT':
          // Begin text object: the text and text-line matrices reset to identity.
          lm = [1, 0, 0, 1, 0, 0];
          break;
        case 'q':
          // Save graphics state: push the CTM so a matching `Q` can restore
          // it (ol-hpqn). Malformed/unbalanced `q`/`Q` is not specially
          // guarded — an extra `q` just leaves an unused entry on the stack,
          // which is harmless.
          ctmStack.push(ctm);
          break;
        case 'Q': {
          // Restore graphics state. An unmatched `Q` (stack already empty) is
          // left as a no-op rather than resetting to identity — guessing
          // would be more likely to manufacture a false position collision
          // than to fix a real one.
          const restored = ctmStack.pop();
          if (restored !== undefined) ctm = restored;
          break;
        }
        case 'cm':
          // `a b c d e f cm` concatenates onto the CTM (ol-hpqn) — tracked
          // only so `Do` can read its translation; see `roundedCoord`.
          if (nums.length >= 6) {
            const m = nums.slice(nums.length - 6) as unknown as Mat;
            ctm = multiplyMat(m, ctm);
          }
          break;
        case 'TL':
          leading = nums[nums.length - 1] ?? leading;
          break;
        case 'Tm':
          // `a b c d e f Tm` sets the line matrix outright.
          if (nums.length >= 6) {
            const next = nums.slice(nums.length - 6) as [
              number,
              number,
              number,
              number,
              number,
              number,
            ];
            const moved = Math.abs(next[5] - lm[5]) > LINE_BREAK_VERTICAL_TOLERANCE;
            lm = next;
            if (moved) breakLine();
          }
          break;
        case 'Td':
          moveLine(nums[nums.length - 2] ?? 0, nums[nums.length - 1] ?? 0);
          break;
        case 'TD':
          // `tx ty TD` is `Td` plus `-ty TL`.
          leading = -(nums[nums.length - 1] ?? 0);
          moveLine(nums[nums.length - 2] ?? 0, nums[nums.length - 1] ?? 0);
          break;
        case 'T*':
          // The explicit next-line operator: `0 -TL Td`. It is a line break by
          // definition, whatever the leading happens to be — including the zero
          // leading a producer that never set `TL` leaves behind — so the break
          // is unconditional rather than routed through `moveLine`.
          moveLine(0, -leading);
          if (leading === 0) breakLine();
          break;
        case 'Tf':
          // `/F1 12 Tf` — the resource name is the operand two back, resolved
          // against THIS LEVEL's font map: the page's own for the page's
          // tokens, a form's own (or inherited) for a form's — never the
          // other one, which is the trap `resolveFormXObject` exists to
          // avoid. An unknown name leaves the previous decoder in place
          // rather than clearing it: a `Tf` naming a font we could not
          // resolve is a gap in *our* resolution, and reverting to raw bytes
          // mid-page would emit exactly the mojibake this is for.
          font = fontMap.get(lastName) ?? font;
          break;
        case "'":
        case '"':
          // Both move to the next line *before* showing — `'` is `T*` then `Tj`.
          moveLine(0, -leading);
          if (leading === 0) breakLine();
          walk.sawTextOperator = true;
          if (lastString) showText(walk, decodeWithFont(lastString, font));
          break;
        case 'Tj':
          walk.sawTextOperator = true;
          if (lastString) showText(walk, decodeWithFont(lastString, font));
          break;
        case 'TJ':
          walk.sawTextOperator = true;
          showTjArray(walk, lastArrayItems, gapThousandths, font);
          break;
        case 'Do':
          walk.sawXObjectPaint = true;
          // Recurse into the named resource IF it is a Form XObject this
          // level's resources know about (ol-v460). Every guard below is a
          // skip, never a throw, matching this module's discipline
          // throughout: an unknown name, a form already on the current
          // recursion path (a cycle), a depth past `MAX_FORM_XOBJECT_DEPTH`,
          // a form already painted at this EXACT position (ol-hpqn, see
          // below), or a form whose stream/resources would not resolve all
          // leave `Do` exactly the no-op it was before this fix — the page
          // still carries `sawXObjectPaint`, so `getPageContent` still
          // reports the honest `'unreadable'` rather than a false `'absent'`.
          if (formCtx !== undefined && depth < MAX_FORM_XOBJECT_DEPTH) {
            const targetNum = formsMap.get(lastName);
            if (targetNum !== undefined && !formPath.has(targetNum)) {
              // The true-duplicate guard (ol-hpqn): the SAME Form XObject
              // painted from THIS level at the SAME translation is a real
              // duplicate — the spec has no notion of a page "collapsing"
              // repeated paints, so a producer that emits `Do` twice for the
              // same form at the same `cm` is (as measured — see the bead
              // and its evidence note) always re-stamping the exact same
              // content, never two coincidentally-identical placements of
              // different intent. A DIFFERENT position is always walked and
              // never folded, however similar its resulting text turns out
              // to be — that side of the guard is what keeps a legitimately
              // repeated element (an MCQ answer key repeating "A B C D" per
              // question, each at its own position) from losing any copy.
              const positionKey = `${targetNum}@${roundedCoord(ctm[4])},${roundedCoord(ctm[5])}`;
              if (!paintedFormPositions.has(positionKey)) {
                const resolved = resolveFormXObject(
                  targetNum,
                  formCtx.bytes,
                  formCtx.objects,
                  resourcesText,
                );
                if (resolved) {
                  paintedFormPositions.add(positionKey);
                  formPath.add(targetNum);
                  run(
                    resolved.tokens,
                    resolved.fonts,
                    resolved.forms,
                    resolved.resourcesText,
                    depth + 1,
                  );
                  formPath.delete(targetNum);
                }
              }
            }
          }
          break;
        default:
          break;
      }
      nums = [];
    }
  };

  run(tokens, fonts, formCtx?.forms ?? new Map(), formCtx?.resourcesText, 0);
  walk.text = walk.text.trim();
  return walk;
}

/**
 * The balanced `<< ... >>` value of `key`, when it is written inline in
 * `dictText` rather than as an indirect reference. Depth-counted, so a nested
 * dictionary inside it does not close it early.
 */
function dictSubDict(dictText: string, key: string): string | undefined {
  const at = new RegExp(`/${key}\\s*<<`).exec(dictText);
  if (!at) return undefined;
  let i = at.index + at[0].length;
  let depth = 1;
  const start = i;
  while (i < dictText.length && depth > 0) {
    if (dictText[i] === '<' && dictText[i + 1] === '<') {
      depth++;
      i += 2;
    } else if (dictText[i] === '>' && dictText[i + 1] === '>') {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }
  return dictText.slice(start, Math.max(start, i - 2));
}

/**
 * Resolves `/Resources`, which is either an inline dictionary or an indirect
 * reference to one, and which a page may **inherit** from an ancestor `/Pages`
 * node rather than carry itself.
 *
 * The `/Parent` chain is walked (ol-avvt). It was not, before: that cost only a
 * missed *report* while the sole consumer was `pageDrawsFormXObject`, but the
 * font table is read out of the same dictionary, and a page that inherits its
 * `/Resources` would have had no fonts, no `/ToUnicode`, and its composite-font
 * bytes shown raw. Depth is bounded and visited nodes are tracked, so a
 * malformed tree that points at its own ancestor terminates.
 */
function pageResourcesText(
  pageDict: string,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): string | undefined {
  let dict: string | undefined = pageDict;
  const seen = new Set<number>();
  while (dict !== undefined) {
    const inline = dictSubDict(dict, 'Resources');
    if (inline !== undefined) return inline;
    const ref = dictRef(dict, 'Resources');
    if (ref !== undefined) {
      const resolved = objects.get(ref)?.dictText;
      if (resolved !== undefined) return resolved;
    }
    const parent = dictRef(dict, 'Parent');
    if (parent === undefined || seen.has(parent)) return undefined;
    seen.add(parent);
    dict = objects.get(parent)?.dictText;
  }
  return undefined;
}

/**
 * The font resources named in a `/Resources /Font` dictionary — either inline
 * or indirect, both of which occur — as `/Tf` names to decoders (ol-avvt).
 * Split out to take a resources dict *text* directly rather than a page
 * (ol-v460): a page and a Form XObject differ only in *where* their
 * `/Resources` come from, never in how the font dictionary inside one is
 * read, and `resolveFormXObject` needs exactly this same logic for a form's
 * own resources.
 *
 * For each font this reads the two facts `decodeWithFont` needs: whether it is
 * **composite** (`/Subtype /Type0`, whose string bytes are two-byte glyph
 * indices rather than character codes) and its `/ToUnicode` CMap, if it has
 * one.
 *
 * Every resolvable font gets an entry, including a simple font with no
 * `/ToUnicode` — that entry decodes to the same Latin-1 pass-through the
 * extractor has always used, and having it present is what lets a `Tf` naming
 * it *replace* a composite font rather than inherit its decoder.
 */
function resourcesFontsFromText(
  bytes: Uint8Array,
  resourcesText: string,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): Map<string, FontDecoder> {
  const fonts = new Map<string, FontDecoder>();
  const inlineFontDict = dictSubDict(resourcesText, 'Font');
  const fontDictRef = dictRef(resourcesText, 'Font');
  const fontDict =
    inlineFontDict ?? (fontDictRef === undefined ? undefined : objects.get(fontDictRef)?.dictText);
  if (fontDict === undefined) return fonts;

  const entryRe = /\/([A-Za-z0-9+_.#-]+)\s+(\d+)\s+\d+\s+R/g;
  let m: RegExpExecArray | null = entryRe.exec(fontDict);
  while (m !== null) {
    const resourceName = m[1] ?? '';
    const fontRec = objects.get(Number(m[2]));
    m = entryRe.exec(fontDict);
    if (fontRec === undefined || resourceName === '') continue;

    const composite = dictName(fontRec.dictText, 'Subtype') === 'Type0';
    const toUnicodeRef = dictRef(fontRec.dictText, 'ToUnicode');
    let cmap: FontDecoder['cmap'];
    if (toUnicodeRef !== undefined) {
      const cmapRec = objects.get(toUnicodeRef);
      const cmapBytes = cmapRec === undefined ? undefined : getStreamBytes(bytes, cmapRec);
      if (cmapBytes !== undefined) {
        cmap = parseToUnicodeCMap(decodeLatin1(cmapBytes), composite ? 2 : 1);
      }
    }
    fonts.set(resourceName, cmap === undefined ? { composite } : { composite, cmap });
  }
  return fonts;
}

/**
 * The Form-subtype entries of a `/Resources /XObject` dictionary, as resource
 * name to object number (ol-v460; folds in what used to be `pageDrawsFormXObject`'s
 * boolean-only scan). Split out for the same reason `resourcesFontsFromText`
 * was: a form's own `/XObject` dictionary — a nested form — is read through
 * the identical logic as a page's, and `walkContentTokens`'s `Do` handler
 * needs the *name*, not just whether one exists, to know which object to
 * recurse into.
 *
 * Being wrong in the conservative direction (an entry this fails to resolve)
 * costs only honesty of the report, never text: `getPageContent` still sees
 * `sawXObjectPaint` from the `Do` itself and reports `'unreadable'` rather
 * than a false `'absent'`.
 */
function resourcesXObjectFormsFromText(
  resourcesText: string,
  objects: ReadonlyMap<number, PdfObjectRecord>,
): Map<string, number> {
  const forms = new Map<string, number>();
  const xobjects = dictSubDict(resourcesText, 'XObject');
  if (xobjects === undefined) return forms;
  const entryRe = /\/([A-Za-z0-9+_.#-]+)\s+(\d+)\s+\d+\s+R/g;
  let m: RegExpExecArray | null = entryRe.exec(xobjects);
  while (m !== null) {
    const resourceName = m[1] ?? '';
    const objNum = Number(m[2]);
    const rec = objects.get(objNum);
    if (rec && resourceName !== '' && dictName(rec.dictText, 'Subtype') === 'Form') {
      forms.set(resourceName, objNum);
    }
    m = entryRe.exec(xobjects);
  }
  return forms;
}

/**
 * The recursion depth `walkContentTokens` will follow into nested Form
 * XObjects before giving up, independent of the ancestor-path cycle guard
 * (ol-v460). A cycle is caught exactly, by tracking the objects on the
 * current recursion path — but an acyclic chain of forms nested implausibly
 * deep is still worth capping defensively, the same judgement
 * `pageResourcesText`'s `/Parent` walk and `collectPageNums`'s `/Kids` walk
 * already make. Nothing in the measured corpus nests more than two deep; this
 * is headroom, not a tuned figure.
 */
const MAX_FORM_XOBJECT_DEPTH = 12;

/**
 * One Form XObject's own content and resources, resolved once so
 * `walkContentTokens` can recurse into it without re-deriving any of this per
 * `Do` (ol-v460).
 */
interface ResolvedFormXObject {
  readonly tokens: readonly PdfToken[];
  readonly fonts: ReadonlyMap<string, FontDecoder>;
  /** This form's own Form-subtype `/XObject` resources, for a `Do` painted *inside* it. */
  readonly forms: ReadonlyMap<string, number>;
  /**
   * This form's *effective* `/Resources` dictionary text — its own if it
   * declared one, otherwise whatever it inherited — carried forward so a form
   * nested inside *this one* can fall back to it in turn.
   */
  readonly resourcesText: string | undefined;
}

/**
 * Resolves one Form XObject: its content stream, tokenized, and the font and
 * nested-form resources a `Tf`/`Do` inside it will need (ol-v460, the bead's
 * own name for this function).
 *
 * **THE TRAP this bead was filed to name.** A form must be decoded using the
 * *form's own* `/Resources` for font resolution, never unconditionally the
 * page's — the two can name the same resource (`/F1`) for two entirely
 * different fonts, and decoding a composite font's glyph indices through the
 * wrong font's `/ToUnicode` CMap (or none at all) produces exactly the
 * plausible-looking garbage `ol-avvt`/`ol-x1ch` exist to refuse, and that
 * failure mode passes a character-count check while failing only a
 * word-level one. What the PDF spec actually says is narrower than "always
 * use the form's own", though: a form's `/Resources` entry is *optional*, and
 * when it is absent the form uses the resources of whatever content stream
 * painted it — which is why `inheritedResourcesText` exists and is threaded
 * through rather than defaulting to the page unconditionally at every depth
 * (a form nested two deep inherits from its immediate parent, not from a page
 * it never touches).
 *
 * Every failure mode here is a skip, matching the rest of this module: an
 * object that is missing, not `/Type /XObject /Subtype /Form`, or whose
 * stream will not decode. The caller (`walkContentTokens`) treats `undefined`
 * as "this `Do` painted nothing we could read", which costs only the honesty
 * of the report — see `resourcesXObjectFormsFromText`.
 */
function resolveFormXObject(
  objNum: number,
  bytes: Uint8Array,
  objects: ReadonlyMap<number, PdfObjectRecord>,
  inheritedResourcesText: string | undefined,
): ResolvedFormXObject | undefined {
  const rec = objects.get(objNum);
  if (!rec || dictName(rec.dictText, 'Subtype') !== 'Form') return undefined;
  const streamBytes = getStreamBytes(bytes, rec);
  if (!streamBytes) return undefined;

  const ownInline = dictSubDict(rec.dictText, 'Resources');
  const ownRef = dictRef(rec.dictText, 'Resources');
  const ownResourcesText =
    ownInline ?? (ownRef === undefined ? undefined : objects.get(ownRef)?.dictText);
  const resourcesText = ownResourcesText ?? inheritedResourcesText;

  return {
    tokens: tokenizeContentStream(decodeLatin1(streamBytes)),
    fonts:
      resourcesText === undefined
        ? new Map<string, FontDecoder>()
        : resourcesFontsFromText(bytes, resourcesText, objects),
    forms:
      resourcesText === undefined
        ? new Map<string, number>()
        : resourcesXObjectFormsFromText(resourcesText, objects),
    resourcesText,
  };
}

/** One page's extracted text, plus whether there was a text layer here to extract — see `PageTextLayer` and `plausibility.ts`. */
interface PageContent {
  readonly text: string;
  /**
   * True when this page had something that should have produced text: a
   * text-showing operator ran (on the page or, since ol-v460, inside any
   * Form XObject it paints), a declared content stream would not decode, or
   * the page paints a form XObject whose contents this recursion still could
   * not read. It is the claim that separates "we could not read this page"
   * from "this page has nothing on it", which `charCount: 0` alone could
   * never do.
   */
  readonly textLayerReached: boolean;
}

function getPageContent(
  bytes: Uint8Array,
  objects: ReadonlyMap<number, PdfObjectRecord>,
  pageNum: number,
): PageContent {
  const rec = objects.get(pageNum);
  if (!rec) return { text: '', textLayerReached: false };

  const chunks: string[] = [];
  let declared = 0;
  let decoded = 0;
  for (const ref of dictContentsRefs(rec.dictText)) {
    declared++;
    const contentRec = objects.get(ref);
    if (!contentRec) continue;
    const streamBytes = getStreamBytes(bytes, contentRec);
    if (!streamBytes) continue;
    decoded++;
    chunks.push(decodeLatin1(streamBytes));
  }

  // Resolved once and threaded into `walkContentTokens` as `formCtx`
  // (ol-v460): the page's own fonts, its own Form-subtype `/XObject`
  // resources (what a `Do` at the page level may recurse into), and its own
  // effective `/Resources` text (what a form declaring none of its own falls
  // back to — see `resolveFormXObject`).
  const resourcesText = pageResourcesText(rec.dictText, objects);
  const fonts =
    resourcesText === undefined
      ? new Map<string, FontDecoder>()
      : resourcesFontsFromText(bytes, resourcesText, objects);
  const forms =
    resourcesText === undefined
      ? new Map<string, number>()
      : resourcesXObjectFormsFromText(resourcesText, objects);

  // Content streams belonging to one page are concatenated with a space —
  // PDF spec explicitly allows the split and requires readers to treat the
  // set as logically one stream.
  const walk = walkContentTokens(
    tokenizeContentStream(chunks.join(' ')),
    fonts,
    WORD_GAP_KERN_THOUSANDTHS,
    { bytes, objects, forms, resourcesText },
  );

  const textLayerReached =
    // A `/Contents` we could not turn into bytes at all: an unsupported
    // filter, a corrupt stream, a missing object. `getStreamBytes` degrades to
    // `undefined` there by design, and that silence was the whole defect.
    decoded < declared ||
    walk.sawTextOperator ||
    // A `Do` painted an XObject the page's own resources name as a Form —
    // `forms.size > 0` is exactly `pageDrawsFormXObject`'s old question,
    // answered from the map `walkContentTokens` already needed rather than a
    // second scan. Still fires when the recursion could not actually read
    // that form (an unresolved font, a cycle, a depth cap): the honesty
    // ol-x1ch bought survives the recursion this bead adds.
    (walk.sawXObjectPaint && forms.size > 0);

  return { text: walk.text, textLayerReached };
}

// ---- public extractor ------------------------------------------------

/**
 * Classifies an extraction the way `ExtractionOutcome` requires (ol-voen).
 * The ordering is the argument:
 *
 *  - **No objects at all** → `'unreadable'`. Not "an empty PDF" — bytes that
 *    contain not one `N G obj` header are not a PDF this parser read; empty
 *    input and a text file renamed to `.pdf` both land here, and neither is
 *    a claim about page count.
 *  - **At least one page record** → `'extracted'`. Deliberately says nothing
 *    about yield: a scanned deck whose every page is zero-character is fully
 *    *extracted*, and `PageExtraction.route` already reports that honestly.
 *  - **Zero pages, and the page tree declares `/Count 0`** →
 *    `'empty-document'`. The document is reachable and says it has no pages;
 *    believing it is correct.
 *  - **Zero pages, anything else** → `'no-pages-found'`. Objects parsed, so
 *    this *is* a PDF, and it either declares pages we could not reach or
 *    refuses to say — an `/ObjStm` we could not inflate, a page tree behind
 *    a filter we do not implement, an encrypted body. The one thing it is
 *    not is success, which is the entire reason this field exists.
 *  - **Every page's own text is furniture** (SCAN-1, ol-738i) →
 *    `'furniture-only'`, checked after `isReachedButUnreadable`: see
 *    `furniture.ts`. `pages` here has already been through
 *    `applyFurnitureDetection`, so this reads `PageExtraction.furniture`
 *    rather than recomputing it.
 */
function pdfOutcome(
  objects: ReadonlyMap<number, PdfObjectRecord>,
  pagesRootNum: number | undefined,
  pages: readonly PageExtraction[],
): ExtractionOutcome {
  if (objects.size === 0) return 'unreadable';
  // ol-x1ch: `pages.length > 0` on its own was the discriminant that let a
  // document decoding to *nothing* report `'extracted'`. It is still the right
  // question about whether pages were *reached* — it is just no longer the
  // whole question. See `isReachedButUnreadable` for why both of its conjuncts
  // are needed, and in particular why a genuine scan still reads `'extracted'`.
  if (pages.length > 0) {
    if (isReachedButUnreadable(pages)) return 'reached-but-unreadable';
    if (pages.some((page) => page.furniture)) return 'furniture-only';
    return 'extracted';
  }
  return declaredPageCount(pagesRootNum, objects) === 0 ? 'empty-document' : 'no-pages-found';
}

export const pdfExtractor: Extractor = {
  format: 'pdf',

  async extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult> {
    const text = decodeLatin1(input.bytes);
    const objects = parsePdfObjects(text);
    expandObjectStreams(input.bytes, objects);
    const pagesRootNum = findPagesRootNum(text, objects);

    // The fallback is guarded on the **walk**, not on the root (ol-voen, bug
    // B). A hybrid file resolves a `/Pages` root whose node is unreachable
    // while every leaf page object sits in the map in plain sight; guarding
    // on `pagesRootNum !== undefined` meant the fallback never ran for
    // exactly the documents that needed it most.
    const walked = pagesRootNum === undefined ? [] : collectPageNums(pagesRootNum, objects);
    const pageNums = walked.length > 0 ? walked : fallbackPageNums(objects);

    const pages: PageExtraction[] = pageNums.map((pageNum, idx) => {
      const { text: pageText, textLayerReached } = getPageContent(input.bytes, objects, pageNum);
      const charCount = pageText.length;
      const textLayer = classifyPageText(pageText, textLayerReached);
      // `charCount` keeps reporting what actually came out — the quality check
      // must not quietly rewrite the yield measurement every routing figure and
      // every threshold sweep reads. What it overrides is the *claim*: a page
      // whose characters are not characters has no usable text layer to offer
      // Slot G, whatever its count, so it goes to vision and carries no unit.
      // Without that override a page of control codes clears the threshold,
      // keeps its unit, and becomes eligible to be quoted back to her
      // (ol-s3xa).
      const route: RouteDecision =
        textLayer === 'unreadable'
          ? 'vision'
          : routePage(charCount, options?.textLayerCharThreshold);
      const page = idx + 1;

      const units: ExtractedUnit[] =
        route === 'text-layer' && pageText.length > 0
          ? [
              {
                text: pageText,
                provenance: {
                  sourcePath: input.path,
                  location: { page, charRange: { start: 0, end: pageText.length } },
                  ...(input.embeddedIn ? { embeddedIn: input.embeddedIn } : {}),
                },
              },
            ]
          : [];

      // `furniture` is decided below, once every page's text is known
      // (SCAN-1 needs the whole document to tell a running head from a
      // one-off coincidence) — `false` here, possibly overridden by
      // `applyFurnitureDetection`.
      return { page, charCount, textLayer, route, units, furniture: false };
    });

    const finalPages = applyFurnitureDetection(pages);

    return {
      sourcePath: input.path,
      format: 'pdf',
      outcome: pdfOutcome(objects, pagesRootNum, finalPages),
      pages: finalPages,
    };
  },
};
