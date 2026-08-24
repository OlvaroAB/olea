import { describe, expect, it } from 'vitest';
import { removeSpans } from '../block/edit.js';
import {
  appendFrontmatterMapEntry,
  appendMapEntry,
  getFrontmatterMapValue,
  readFrontmatterMap,
} from './map.js';
import { parseFrontmatter } from './parse.js';
import { serializeFrontmatter } from './serialize.js';
import { isFrontmatterLossless } from './types.js';

describe('readFrontmatterMap / getFrontmatterMapValue', () => {
  it('reads every line of an existing map, in source order', () => {
    const fm = parseFrontmatter(
      'olea-cloze-ids:\n  block-a1: cloze-1\n  block-b2: cloze-2\nother: x\n',
    );
    expect(readFrontmatterMap(fm, 'olea-cloze-ids')).toEqual([
      { key: 'block-a1', value: 'cloze-1' },
      { key: 'block-b2', value: 'cloze-2' },
    ]);
    expect(getFrontmatterMapValue(fm, 'olea-cloze-ids', 'block-b2')).toBe('cloze-2');
    expect(getFrontmatterMapValue(fm, 'olea-cloze-ids', 'missing')).toBeUndefined();
  });

  it('returns [] for a key that is not present, rather than throwing', () => {
    const fm = parseFrontmatter('other: x\n');
    expect(readFrontmatterMap(fm, 'olea-cloze-ids')).toEqual([]);
  });

  it('returns [] for a key that exists but carries a bare scalar, not a map', () => {
    const fm = parseFrontmatter('olea-cloze-ids: not-a-map\n');
    expect(readFrontmatterMap(fm, 'olea-cloze-ids')).toEqual([]);
  });
});

describe('appendMapEntry — growing an existing map, preserving every other line', () => {
  it('appends one line to a two-entry map, and every other byte in the frontmatter survives untouched', () => {
    const inner =
      'citekey: x\nolea-cloze-ids:\n  block-a1: cloze-1\n  block-b2: cloze-2\nother: y\n';
    const fm = parseFrontmatter(inner);

    const result = appendMapEntry(fm, 'olea-cloze-ids', 'block-c3', 'cloze-3');

    expect(result.changed).toBe(true);
    expect(result.value).toBe('cloze-3');
    expect(serializeFrontmatter(result.frontmatter)).toBe(
      'citekey: x\nolea-cloze-ids:\n  block-a1: cloze-1\n  block-b2: cloze-2\n  block-c3: cloze-3\nother: y\n',
    );
    expect(isFrontmatterLossless(result.frontmatter)).toBe(true);

    // The direct proof (C1.2 shape): subtracting the inserted span from the
    // new inner recovers the original inner exactly.
    const newInner = serializeFrontmatter(result.frontmatter);
    expect(result.insertedSpan).not.toBeNull();
    const spliced = result.insertedSpan
      ? newInner.slice(0, result.insertedSpan.start) + newInner.slice(result.insertedSpan.end)
      : newInner;
    expect(spliced).toBe(inner);
  });

  it('does not mutate the input Frontmatter', () => {
    const inner = 'olea-cloze-ids:\n  block-a1: cloze-1\n';
    const fm = parseFrontmatter(inner);
    appendMapEntry(fm, 'olea-cloze-ids', 'block-b2', 'cloze-2');
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('creates the map from scratch when the key does not exist yet, leaving sibling entries untouched', () => {
    const inner = 'citekey: x\nyear: 2019\n';
    const fm = parseFrontmatter(inner);
    const result = appendMapEntry(fm, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    expect(result.changed).toBe(true);
    expect(serializeFrontmatter(result.frontmatter)).toBe(
      'citekey: x\nyear: 2019\nolea-cloze-ids:\n  block-a1: cloze-1\n',
    );
  });

  it('throws rather than silently reinterpreting an existing scalar entry as an empty map', () => {
    const fm = parseFrontmatter('olea-cloze-ids: already-a-scalar\n');
    expect(() => appendMapEntry(fm, 'olea-cloze-ids', 'block-a1', 'cloze-1')).toThrow(/scalar/);
  });

  it('rejects a mapKey containing a colon or a line break', () => {
    const fm = parseFrontmatter('olea-cloze-ids:\n');
    expect(() => appendMapEntry(fm, 'olea-cloze-ids', 'bad:key', 'x')).toThrow();
    expect(() => appendMapEntry(fm, 'olea-cloze-ids', 'bad\nkey', 'x')).toThrow();
  });
});

describe('appendMapEntry — idempotence (re-append of an existing entry is a no-op)', () => {
  it('appending the same mapKey twice yields a byte-identical Frontmatter the second time', () => {
    const inner = 'olea-cloze-ids:\n  block-a1: cloze-1\n';
    const fm = parseFrontmatter(inner);

    const first = appendMapEntry(fm, 'olea-cloze-ids', 'block-a1', 'ignored-should-not-be-written');
    expect(first.changed).toBe(false);
    expect(first.value).toBe('cloze-1'); // the existing value wins, not the caller's argument
    expect(first.insertedSpan).toBeNull();
    expect(serializeFrontmatter(first.frontmatter)).toBe(inner);
  });

  it('idempotence holds across two real appends: appending a second, different key, then re-appending the first, is a no-op for the first', () => {
    const inner = 'olea-cloze-ids:\n  block-a1: cloze-1\n';
    const fm = parseFrontmatter(inner);
    const withSecond = appendMapEntry(fm, 'olea-cloze-ids', 'block-b2', 'cloze-2').frontmatter;
    const reappendFirst = appendMapEntry(
      withSecond,
      'olea-cloze-ids',
      'block-a1',
      'should-not-land',
    );
    expect(reappendFirst.changed).toBe(false);
    expect(serializeFrontmatter(reappendFirst.frontmatter)).toBe(serializeFrontmatter(withSecond));
  });
});

describe('appendMapEntry — CRLF', () => {
  it('appends using the entry’s own CRLF terminator, adding no bare LF', () => {
    const inner = 'olea-cloze-ids:\r\n  block-a1: cloze-1\r\nother: y\r\n';
    const fm = parseFrontmatter(inner);
    const result = appendMapEntry(fm, 'olea-cloze-ids', 'block-b2', 'cloze-2');
    expect(serializeFrontmatter(result.frontmatter)).toBe(
      'olea-cloze-ids:\r\n  block-a1: cloze-1\r\n  block-b2: cloze-2\r\nother: y\r\n',
    );
  });

  it('creates a fresh CRLF map when the frontmatter is entirely CRLF and the key is new', () => {
    const inner = 'citekey: x\r\n';
    const fm = parseFrontmatter(inner);
    const result = appendMapEntry(fm, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    expect(serializeFrontmatter(result.frontmatter)).toBe(
      'citekey: x\r\nolea-cloze-ids:\r\n  block-a1: cloze-1\r\n',
    );
  });
});

describe('appendFrontmatterMapEntry — the empty-frontmatter case', () => {
  it('a frontmatter block that exists but is entirely empty gets the map created inside it', () => {
    const before = '---\n---\n\n# Title\n';
    const result = appendFrontmatterMapEntry(before, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    expect(result.changed).toBe(true);
    expect(result.content).toBe('---\nolea-cloze-ids:\n  block-a1: cloze-1\n---\n\n# Title\n');
    // C1.2: subtracting the inserted span recovers the original exactly.
    expect(result.insertedSpan).not.toBeNull();
    const recovered = result.insertedSpan
      ? removeSpans(result.content, [result.insertedSpan])
      : result.content;
    expect(recovered).toBe(before);
  });
});

describe('appendFrontmatterMapEntry — the missing-frontmatter case (no frontmatter block at all)', () => {
  it('creates a minimal frontmatter block ahead of the file and appends the original body byte-for-byte', () => {
    const before = '# Title\n\nSome body text.\n';
    const result = appendFrontmatterMapEntry(before, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    expect(result.changed).toBe(true);

    const expectedBlock = '---\nolea-cloze-ids:\n  block-a1: cloze-1\n---\n';
    expect(result.content.startsWith(expectedBlock)).toBe(true);
    const body = result.content.slice(expectedBlock.length);
    expect(body).toBe(before);

    // C1.2 proof for this branch too.
    expect(result.insertedSpan).not.toBeNull();
    const recovered = result.insertedSpan
      ? removeSpans(result.content, [result.insertedSpan])
      : result.content;
    expect(recovered).toBe(before);
  });

  it('uses CRLF for the created block when the original file is CRLF', () => {
    const before = '# Title\r\n\r\nbody\r\n';
    const result = appendFrontmatterMapEntry(before, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    expect(
      result.content.startsWith('---\r\nolea-cloze-ids:\r\n  block-a1: cloze-1\r\n---\r\n'),
    ).toBe(true);
  });
});

describe('appendFrontmatterMapEntry — a growing map on a real note, C1.2 whole-file proof', () => {
  it('adding a second entry to an already-populated map leaves every other line — including the rest of the frontmatter and the whole body — untouched', () => {
    const before =
      '---\ncitekey: x\nolea-cloze-ids:\n  block-a1: cloze-1\nyear: 2019\n---\n\n# A note\n\nSome prose about the topic.\n';
    const result = appendFrontmatterMapEntry(before, 'olea-cloze-ids', 'block-b2', 'cloze-2');

    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      '---\ncitekey: x\nolea-cloze-ids:\n  block-a1: cloze-1\n  block-b2: cloze-2\nyear: 2019\n---\n\n# A note\n\nSome prose about the topic.\n',
    );

    expect(result.insertedSpan).not.toBeNull();
    const recovered = result.insertedSpan
      ? removeSpans(result.content, [result.insertedSpan])
      : result.content;
    expect(recovered).toBe(before);
  });

  it('is idempotent at the whole-file level: appending an existing mapKey again is a byte-identical no-op', () => {
    const before = '---\nolea-cloze-ids:\n  block-a1: cloze-1\n  block-b2: cloze-2\n---\n\nbody\n';
    const result = appendFrontmatterMapEntry(
      before,
      'olea-cloze-ids',
      'block-a1',
      'should-not-land',
    );
    expect(result.changed).toBe(false);
    expect(result.value).toBe('cloze-1');
    expect(result.insertedSpan).toBeNull();
    expect(result.content).toBe(before);
  });

  it('re-running the same append twice at the whole-file level converges: first call writes, second is a no-op', () => {
    const before = '---\ncitekey: x\n---\n\nbody\n';
    const first = appendFrontmatterMapEntry(before, 'olea-cloze-ids', 'block-a1', 'cloze-1');
    const second = appendFrontmatterMapEntry(
      first.content,
      'olea-cloze-ids',
      'block-a1',
      'ignored',
    );
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.value).toBe('cloze-1');
  });
});

// ---------------------------------------------------------------------------
// D-107's third named acceptance item: round-trip safety against Obsidian's
// own YAML rendering of the key.
//
// This engine deliberately depends on no YAML library anywhere on the
// round-trip path (../frontmatter/types.ts's header explains why — a
// library that reinterprets structure loses her bytes silently), so this
// test does not invoke one either. Obsidian's Properties editor serializes
// frontmatter through js-yaml with its default block-style settings: two-
// space indentation, unquoted plain scalars for simple identifier-shaped
// strings, and a bare `key:` header line (nothing after the colon) for a
// nested mapping — exactly the shape documented at the top of ./map.ts and
// hard-coded here as a fixture, not generated, so the test exercises this
// module's own parser/appender against the *exact bytes* that renderer is
// known to produce rather than against a shape this engine invented for
// itself.
// ---------------------------------------------------------------------------
describe("D-107 named test: round-trip against Obsidian's own YAML rendering of the key", () => {
  const OBSIDIAN_RENDERED_MAP =
    '---\ncitekey: some-note\nolea-cloze-ids:\n  block-a1b2c3: cloze-x9y8z7\n  block-d4e5f6: cloze-p4q5r6\ntags:\n  - study\n---\n\nBody text untouched by any of this.\n';

  it('parses the Obsidian-rendered map back into the same key/value pairs that were written', () => {
    const doc = OBSIDIAN_RENDERED_MAP;
    const innerStart = doc.indexOf('\n') + 1;
    const closeIdx = doc.indexOf('\n---', innerStart);
    const inner = doc.slice(innerStart, closeIdx + 1);
    const fm = parseFrontmatter(inner);

    expect(readFrontmatterMap(fm, 'olea-cloze-ids')).toEqual([
      { key: 'block-a1b2c3', value: 'cloze-x9y8z7' },
      { key: 'block-d4e5f6', value: 'cloze-p4q5r6' },
    ]);
    // Round-trip identity: parse ∘ serialize is exact for Obsidian's own bytes.
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('appending a third cloze entry to the Obsidian-rendered map produces the same block-style shape Obsidian itself would write for the next entry, and every other Obsidian-written line survives byte-identically', () => {
    const result = appendFrontmatterMapEntry(
      OBSIDIAN_RENDERED_MAP,
      'olea-cloze-ids',
      'block-g7h8i9',
      'cloze-a1b2c3',
    );
    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      '---\ncitekey: some-note\nolea-cloze-ids:\n  block-a1b2c3: cloze-x9y8z7\n  block-d4e5f6: cloze-p4q5r6\n  block-g7h8i9: cloze-a1b2c3\ntags:\n  - study\n---\n\nBody text untouched by any of this.\n',
    );
    // Every byte outside the one appended line — including the sibling
    // `tags:` block list Obsidian rendered right after our map — survives.
    expect(result.insertedSpan).not.toBeNull();
    const recovered = result.insertedSpan
      ? removeSpans(result.content, [result.insertedSpan])
      : result.content;
    expect(recovered).toBe(OBSIDIAN_RENDERED_MAP);
  });

  it('idempotence holds against Obsidian-rendered bytes specifically: re-appending an entry that map already has is a no-op', () => {
    const result = appendFrontmatterMapEntry(
      OBSIDIAN_RENDERED_MAP,
      'olea-cloze-ids',
      'block-a1b2c3',
      'some-other-value',
    );
    expect(result.changed).toBe(false);
    expect(result.value).toBe('cloze-x9y8z7');
    expect(result.content).toBe(OBSIDIAN_RENDERED_MAP);
  });
});
