/**
 * **ToUnicode CMap resolution** (ol-avvt) — the piece `pdf.ts`'s module doc
 * used to name as a deliberate limitation and that turned out to strand most
 * of a real corpus.
 *
 * ## What was actually broken
 *
 * `pdf.ts` decodes content-stream string bytes as Latin-1 and shows them. For
 * a *simple* font (`/Type1`, `/TrueType`) whose encoding is WinAnsi or
 * Standard that is right, and it is why the extractor has always worked on
 * ordinary Western lecture slides. For a **composite font** — `/Subtype
 * /Type0` with `/Encoding /Identity-H`, which is what Word, Google Docs and
 * every modern office exporter emit — the bytes in the string are not
 * character codes at all. They are *two-byte glyph indices into the embedded
 * subset font*, numbered from zero in subset order. Decoded as Latin-1 they
 * are a stream of C0 control characters and arbitrary high bytes: exactly the
 * shape `plausibility.ts` was built to catch, so the page was honestly
 * reported `'unreadable'` rather than emitting mojibake — and the text, which
 * every other reader in the world can see, never came out.
 *
 * The map back is written into the file by the producer, as the font's
 * `/ToUnicode` entry: a CMap program mapping each code to its Unicode
 * string. Consulting it is all that was missing.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is a reader for the **`/ToUnicode` subset** of the CMap language — the
 * `begincodespacerange`, `beginbfchar` and `beginbfrange` operators and
 * nothing else. It is not a PostScript interpreter and does not need to be:
 * a `/ToUnicode` CMap is generated, not written by hand, and the generated
 * shape is a flat table.
 *
 *  - **`usecmap` is not followed.** A `/ToUnicode` that inherits from another
 *    CMap resource is vanishingly rare and, when it happens, the codes it
 *    fails to resolve come back unmapped rather than wrong — see below.
 *  - **Predefined CJK CMaps (`/UniGB-UCS2-H` and friends) are not shipped.**
 *    A Type0 font using one and carrying no `/ToUnicode` is undecodable here,
 *    and reports as such.
 *  - **Mixed-width codespaces are collapsed to a single width.** Every
 *    `/ToUnicode` CMap in the measured corpus declares one width; a file that
 *    declares several gets the widest, which mis-segments rather than
 *    mis-decodes, and mis-segmented codes land unmapped.
 *
 * ## The honesty rule this module exists to keep
 *
 * `decodeWithFont` never guesses. A code the CMap does not cover comes back
 * as `UNMAPPED_CHAR` (U+FFFD) for a composite font, because a glyph index has
 * no character meaning to fall back on — there is no reading of `0x0027` as a
 * character that is better than admitting we do not know. `plausibility.ts`
 * counts U+FFFD alongside the C0 controls, so a page whose codes we could not
 * resolve still reports `'unreadable'` and still routes to vision. **The fix
 * must not convert an honest gap into plausible garbage** (ol-x1ch is the
 * bead that bought that honesty); a page that cannot be decoded correctly is
 * still reported as undecodable, it is merely undecodable for a reason we can
 * now state.
 *
 * For a **simple** font the fallback is different and deliberately so: its
 * codes *are* character codes, so a code the `/ToUnicode` table omits falls
 * back to the Latin-1/WinAnsi reading the extractor has always used. That is
 * not a guess, it is the format's own default, and it is what keeps the
 * pdfTeX-produced material that already extracted correctly byte-identical.
 */

/**
 * What a code we could not resolve decodes to. U+FFFD REPLACEMENT CHARACTER
 * is chosen because it cannot arise any other way in this pipeline — Latin-1
 * decoding is total over bytes 0-255 and never produces it — so its presence
 * in extracted text is unambiguously this module admitting it does not know,
 * which is exactly what `plausibility.ts` needs in order to count it.
 */
export const UNMAPPED_CHAR = '�';

/** A parsed `/ToUnicode` CMap: how wide a code is, and what each code means. */
export interface ToUnicodeCMap {
  /** Bytes per code, from `begincodespacerange` — 1 for a simple font, 2 for Identity-H. */
  readonly codeByteLength: number;
  /** Code (big-endian, `codeByteLength` bytes wide) to the Unicode string it stands for. A value may be several characters long: a ligature glyph maps to `"fi"`. */
  readonly map: ReadonlyMap<number, string>;
}

/**
 * How a font's string bytes become text. `cmap` is absent when the font
 * carries no usable `/ToUnicode`; `composite` is what decides whether an
 * unresolved code may fall back to Latin-1 (see the module doc).
 */
export interface FontDecoder {
  readonly composite: boolean;
  readonly cmap?: ToUnicodeCMap;
}

/** Decodes a UTF-16BE hex literal (`<0041>`, `<00660069>`) to the string it denotes. Surrogate pairs survive because `String.fromCharCode` is applied per 16-bit unit. */
function hexToUtf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  // An odd tail (a 1-byte destination, which some producers emit) is read as
  // a single byte rather than dropped.
  const rem = hex.length % 4;
  if (rem === 2) out += String.fromCharCode(Number.parseInt(hex.slice(hex.length - 2), 16));
  return out;
}

/** Strips PostScript-style `%` comments so a commented CMap cannot smuggle an operator keyword into the scan. */
function stripComments(src: string): string {
  return src.replace(/%[^\n\r]*/g, '');
}

/**
 * The code width, in bytes, that `begincodespacerange` declares. Each range
 * is a pair of hex literals whose digit count *is* the width (`<00> <FF>` is
 * one byte, `<0000> <FFFF>` is two) — the spec requires both ends of a range
 * to be written to the same width, which is what makes this readable without
 * interpreting anything.
 */
function codespaceByteLength(src: string): number | undefined {
  const block = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let widest: number | undefined;
  let m: RegExpExecArray | null = block.exec(src);
  while (m !== null) {
    const hexes = (m[1] ?? '').match(/<([0-9a-fA-F]*)>/g) ?? [];
    for (const h of hexes) {
      const digits = h.length - 2;
      if (digits <= 0) continue;
      const bytes = Math.ceil(digits / 2);
      if (widest === undefined || bytes > widest) widest = bytes;
    }
    m = block.exec(src);
  }
  return widest;
}

/**
 * Parses a `/ToUnicode` CMap program.
 *
 * Returns `undefined` when nothing usable came out — an empty table is not a
 * CMap, and returning one would claim every code is unmappable and turn
 * material that decodes fine today into U+FFFD. Absent beats empty here.
 *
 * `defaultCodeByteLength` is what the *font* implies (2 for a composite font,
 * 1 for a simple one) and is used only when the CMap declares no codespace.
 */
export function parseToUnicodeCMap(
  source: string,
  defaultCodeByteLength: number,
): ToUnicodeCMap | undefined {
  const src = stripComments(source);
  const declared = codespaceByteLength(src);
  const codeByteLength = Math.min(2, Math.max(1, declared ?? defaultCodeByteLength));
  const map = new Map<number, string>();

  // ---- bfchar: `<src> <dst>` pairs, one code each.
  const charBlock = /beginbfchar([\s\S]*?)endbfchar/g;
  let cb: RegExpExecArray | null = charBlock.exec(src);
  while (cb !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
    let pm: RegExpExecArray | null = pairRe.exec(cb[1] ?? '');
    while (pm !== null) {
      const code = Number.parseInt(pm[1] ?? '', 16);
      const text = hexToUtf16(pm[2] ?? '');
      if (Number.isFinite(code) && text.length > 0) map.set(code, text);
      pm = pairRe.exec(cb[1] ?? '');
    }
    cb = charBlock.exec(src);
  }

  // ---- bfrange: `<lo> <hi> <dstStart>` (destination increments with the
  // code) or `<lo> <hi> [<d0> <d1> ...]` (one destination per code).
  const rangeBlock = /beginbfrange([\s\S]*?)endbfrange/g;
  let rb: RegExpExecArray | null = rangeBlock.exec(src);
  while (rb !== null) {
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[\s\S]*?\]|<[0-9a-fA-F]*>)/g;
    let em: RegExpExecArray | null = entryRe.exec(rb[1] ?? '');
    while (em !== null) {
      const lo = Number.parseInt(em[1] ?? '', 16);
      const hi = Number.parseInt(em[2] ?? '', 16);
      const dst = em[3] ?? '';
      // A range whose ends are transposed or absurdly wide is a producer bug,
      // not an instruction to allocate: cap it rather than trust it.
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo && hi - lo <= 0xffff) {
        if (dst.startsWith('[')) {
          const items = dst.match(/<([0-9a-fA-F]*)>/g) ?? [];
          for (let i = 0; i < items.length && lo + i <= hi; i++) {
            const text = hexToUtf16((items[i] ?? '').slice(1, -1));
            if (text.length > 0) map.set(lo + i, text);
          }
        } else {
          const base = hexToUtf16(dst.slice(1, -1));
          if (base.length > 0) {
            // Only the *last* UTF-16 unit increments across the range, per the
            // spec — a ligature destination keeps its prefix.
            const prefix = base.slice(0, -1);
            const start = base.charCodeAt(base.length - 1);
            for (let c = lo; c <= hi; c++) {
              map.set(c, prefix + String.fromCharCode((start + (c - lo)) & 0xffff));
            }
          }
        }
      }
      em = entryRe.exec(rb[1] ?? '');
    }
    rb = rangeBlock.exec(src);
  }

  if (map.size === 0) return undefined;
  return { codeByteLength, map };
}

/**
 * Turns one shown string's raw bytes (as a Latin-1 string, one char per byte —
 * see `pdf.ts` on why that round-trips) into text, through `decoder`.
 *
 * With no decoder at all — a simple font with no `/ToUnicode`, which is the
 * overwhelmingly common correct case — the bytes pass through unchanged, so
 * material that extracted correctly before this module existed is untouched.
 *
 * A composite font with no `/ToUnicode` yields `UNMAPPED_CHAR` per code
 * rather than its Latin-1 reading. That is a *deliberate* change from letting
 * the glyph indices through: their Latin-1 reading is not text, and whether
 * it happened to land in the control range (caught) or the printable range
 * (not caught) was luck. Saying "unknown" makes the page's unreadability a
 * fact rather than an accident of which glyphs the subset happened to use.
 */
export function decodeWithFont(raw: string, decoder: FontDecoder | undefined): string {
  if (decoder === undefined) return raw;
  const cmap = decoder.cmap;

  if (cmap === undefined) {
    if (!decoder.composite) return raw;
    // Composite, unmapped: report one unknown per 2-byte code.
    return UNMAPPED_CHAR.repeat(Math.ceil(raw.length / 2));
  }

  const width = cmap.codeByteLength;
  let out = '';
  for (let i = 0; i < raw.length; i += width) {
    let code = 0;
    for (let k = 0; k < width; k++) code = (code << 8) | (raw.charCodeAt(i + k) & 0xff);
    const mapped = cmap.map.get(code);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    // Unmapped. A simple font's codes are character codes, so the format's own
    // default reading is the right fallback; a composite font's are glyph
    // indices, and there is nothing to fall back to. See the module doc.
    out += decoder.composite ? UNMAPPED_CHAR : raw.slice(i, i + width);
  }
  return out;
}
