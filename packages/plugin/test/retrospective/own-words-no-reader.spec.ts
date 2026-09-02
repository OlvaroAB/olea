/**
 * F8.8 free text (Sep 2026, `[D-190]`): "read by nothing." `[D-190]`'s own
 * ruling is that this guarantee must be structural — "the retrospective is
 * pure client computation over the review log, nothing consumes the kept
 * notes as input, and no model call exists on this path" — not a promise a
 * future parser could quietly break.
 *
 * A unit test on `note-writer.ts`/`copy.ts` alone cannot show the ABSENCE of
 * a reader anywhere else in the codebase; only a source-level sweep can, the
 * same technique `main-wiring.spec.ts` already uses for "is this reachable"
 * (there, positively; here, negatively — "is this reached by nothing but the
 * write path"). Two separate claims, both asserted here:
 *
 *   1. No identifier this bead introduced for her line (`ownWords`) appears
 *      anywhere outside the four files that carry it end to end: the view
 *      (collects it), the provider and `main.ts` (pass it through), and
 *      `note-writer.ts` (the only place that writes it anywhere).
 *   2. D-005 (never log content): the retrospective's offer/open/dismiss
 *      event log (`review-log/write.ts`'s `appendRetrospectiveOfferRecord`,
 *      reached via `offer-events.ts`) never carries her line — its call
 *      site names only `kind`, `assessmentPath` and `timestamp`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginSrcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const coreSrcDir = fileURLToPath(new URL('../../../core/src/', import.meta.url));

/** Source with comments stripped, so a doc paragraph mentioning the identifier does not satisfy (or fail) a code-level assertion about it. */
function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function everySourceFile(rootDir: string, dir = ''): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(rootDir + dir, { withFileTypes: true })) {
    const relPath = dir + entry.name;
    if (entry.isDirectory()) {
      out.push(...everySourceFile(rootDir, `${relPath}/`));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(relPath);
    }
  }
  return out;
}

/** Files allowed to carry her line at all — the whole path from input to write. */
const ALLOWED_OWN_WORDS_FILES = new Set([
  'retrospective/view.ts',
  'retrospective/provider.ts',
  'retrospective/note-writer.ts',
  'main.ts',
]);

describe('the own-words line has no reader outside the write path (`[D-190]`)', () => {
  it('appears only in the view, the provider, note-writer, and their main.ts wiring', () => {
    const files = everySourceFile(pluginSrcDir);
    const carriers = files.filter((relPath) => codeOf(pluginSrcDir + relPath).includes('ownWords'));
    expect(carriers.sort()).toEqual([...ALLOWED_OWN_WORDS_FILES].sort());
  });

  it('no file under olea-core references it either — the pure computation layer never sees it', () => {
    const files = everySourceFile(coreSrcDir);
    const carriers = files.filter((relPath) => codeOf(coreSrcDir + relPath).includes('ownWords'));
    expect(carriers).toEqual([]);
  });

  it('note-writer.ts is the only writer of it — it never round-trips back out through a reader function', () => {
    const noteWriter = codeOf(`${pluginSrcDir}retrospective/note-writer.ts`);
    // The identifier is written into `lines` (the note body) and nowhere
    // returned as data — there is no `readOwnWords`/`parseOwnWords`/
    // `extractOwnWords` export anywhere in this file or its siblings.
    const files = everySourceFile(pluginSrcDir);
    for (const relPath of files) {
      const code = codeOf(pluginSrcDir + relPath);
      expect(code).not.toMatch(/\b(read|parse|extract)OwnWords\b/);
    }
    expect(noteWriter).toContain('ownWords');
  });
});

describe('D-005: the retrospective offer/open/dismiss log never carries her line', () => {
  it('the offer-events append call names only kind, assessmentPath and timestamp', () => {
    const offerEvents = codeOf(`${pluginSrcDir}retrospective/offer-events.ts`);
    expect(offerEvents).toMatch(
      /appendRetrospectiveOfferRecord\(\s*deps\.vault,\s*\{\s*kind:\s*event\.kind,\s*assessmentPath:\s*event\.assessmentPath,\s*timestamp:\s*event\.timestamp,?\s*\}/,
    );
    expect(offerEvents).not.toContain('ownWords');
  });

  it('the core append function validates a record shape with no free-text field', () => {
    const write = codeOf(`${coreSrcDir}review-log/write.ts`);
    // The whole function body from its signature to the schema parse call —
    // if a content field were ever threaded through, it would show up here.
    const match = write.match(
      /export async function appendRetrospectiveOfferRecord\([\s\S]*?retrospectiveOfferLogRecord\.safeParse/,
    );
    expect(match).not.toBeNull();
    expect(match?.[0]).not.toMatch(/ownWords|freeText|reflection|comment/i);
  });
});
