/**
 * Minimal XML entity decoding shared by `pptx.ts` and `docx.ts` (both OOXML,
 * both regex-extracted rather than run through a general XML parser — see
 * those files' module docs for why a full parser wasn't pulled in). Order
 * matters: `&amp;` is decoded **last**, otherwise a source string like
 * `&amp;lt;` (a literal ampersand followed by "lt;") would wrongly collapse
 * to `<` instead of the correct `&lt;`.
 */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}
