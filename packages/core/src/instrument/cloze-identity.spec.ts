import { describe, expect, it } from 'vitest';
import { removeSpans } from '../block/edit.js';
import {
  CLOZE_ID_FRONTMATTER_KEY,
  type ClozeIdAnchor,
  clozeMapKey,
  readClozeId,
  stampClozeId,
} from './cloze-identity.js';

function anchor(overrides: Partial<ClozeIdAnchor> = {}): ClozeIdAnchor {
  return {
    noteUid: 'note-uid-1',
    notePath: 'topic/note.md',
    heading: 'Heading one',
    ordinal: 1,
    ...overrides,
  };
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}

describe('clozeMapKey', () => {
  it('is a pure function: same input, same key, every time', () => {
    const a = anchor();
    expect(clozeMapKey(a)).toBe(clozeMapKey({ ...a }));
    expect(clozeMapKey(a)).toBe(clozeMapKey(a));
  });

  it('roots on notePath when there is no olea-uid', () => {
    const withUid = clozeMapKey(anchor({ noteUid: null }));
    expect(withUid).toContain('topic/note.md');
  });

  it('falls back to "-" with no heading above the cloze', () => {
    expect(clozeMapKey(anchor({ heading: null }))).toMatch(/#-#1$/);
  });

  it('escapes structural characters in the heading so a collision cannot be forged', () => {
    const key = clozeMapKey(anchor({ heading: 'A: tricky # heading' }));
    expect(key).not.toMatch(/hA: tricky # heading/);
    expect(key).toContain('%3A');
    expect(key).toContain('%23');
  });

  it('changes only with the anchor or ordinal, never anything else', () => {
    const base = clozeMapKey(anchor());
    expect(clozeMapKey(anchor({ heading: 'Heading two' }))).not.toBe(base);
    expect(clozeMapKey(anchor({ ordinal: 2 }))).not.toBe(base);
  });
});

describe('stampClozeId — first sight mints, and only mints, into frontmatter', () => {
  it('mints an id and appends it under the cloze frontmatter key', () => {
    const source = '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n';
    const result = stampClozeId(source, anchor(), counter('cloze'));
    expect(result.changed).toBe(true);
    expect(result.value).toBe('cloze-1');
    expect(result.content).toContain(`${CLOZE_ID_FRONTMATTER_KEY}:`);
    expect(readClozeId(result.content, anchor())).toBe('cloze-1');
  });

  it('is a byte-identical no-op the second time — idempotent', () => {
    const source = '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n';
    const first = stampClozeId(source, anchor(), counter('cloze'));
    const second = stampClozeId(first.content, anchor(), counter('cloze'));
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.value).toBe(first.value);
  });

  it('reads the existing id, never recomputes — a generator that would mint a different id is ignored', () => {
    const source = '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n';
    const first = stampClozeId(source, anchor(), () => 'first-id');
    const second = stampClozeId(first.content, anchor(), () => 'a-different-id-entirely');
    expect(second.value).toBe('first-id');
    expect(second.content).toBe(first.content);
  });

  it('the inserted span is the only change — subtracting it recovers the source exactly (C1.2, INV-2)', () => {
    const source =
      '---\nolea-uid: note-uid-1\ncitekey: x\n---\n\n## Heading one\n\nSome ==cloze== text.\n\nMore prose.\n';
    const result = stampClozeId(source, anchor(), counter('cloze'));
    expect(result.insertedSpan).not.toBeNull();
    const recovered = removeSpans(result.content, [
      result.insertedSpan as NonNullable<typeof result.insertedSpan>,
    ]);
    expect(recovered).toBe(source);
  });

  it('the stamped id survives editing the cloze text around it, as long as the anchor is untouched', () => {
    const before = '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n';
    const stamped = stampClozeId(before, anchor(), counter('cloze'));

    // She fixes a typo inside the cloze paragraph; heading and ordinal are unchanged.
    const edited = stamped.content.replace('Some ==cloze== text.', 'Some ==clozed== text, fixed.');
    expect(readClozeId(edited, anchor())).toBe(stamped.value);
  });

  it('does not write anything when reading only — round-trip byte-identity with no stamp present', () => {
    const source = '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n';
    expect(readClozeId(source, anchor())).toBeUndefined();
    // readClozeId took no content parameter by reference mutation and the
    // caller's own string is untouched — there is no write path at all here.
    expect(source).toBe(
      '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nSome ==cloze== text.\n',
    );
  });

  it('two different clozes under two different headings mint two independent ids', () => {
    const source =
      '---\nolea-uid: note-uid-1\n---\n\n## Heading one\n\nOne ==cloze==.\n\n## Heading two\n\nTwo ==cloze==.\n';
    const a = anchor({ heading: 'Heading one' });
    const b = anchor({ heading: 'Heading two' });
    const mint = counter('cloze');
    const first = stampClozeId(source, a, mint);
    const second = stampClozeId(first.content, b, mint);
    expect(readClozeId(second.content, a)).not.toBe(readClozeId(second.content, b));
  });

  it('handles a note with no frontmatter block at all', () => {
    const source = '## Heading one\n\nSome ==cloze== text.\n';
    const result = stampClozeId(source, anchor({ noteUid: null }), counter('cloze'));
    expect(result.changed).toBe(true);
    expect(readClozeId(result.content, anchor({ noteUid: null }))).toBe(result.value);
  });
});
