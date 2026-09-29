/**
 * Passage identity tests (`[D-446]` option (a), `ol-egov.141.89.5.32`).
 *
 * The ruling (row 42, 2026-09-29): one versioned segmentation and normalisation rule shared by
 * authoring and reading, with a passage digest; demonstrate moved passages, duplicate passages
 * and segmentation-rule changes; a digest alone does not identify every edited passage, and an
 * ambiguous case stays unresolved, never guessed. Each `describe` below is one of those demands.
 */
import { describe, expect, it } from 'vitest';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import {
  CURRENT_PASSAGE_RULE,
  citePassage,
  currentPassageRule,
  digestPassage,
  locatePassageByDigest,
  locatePassageByText,
  normalisePassageText,
  PASSAGE_RULE_V1,
  PASSAGE_RULE_VERSION,
  PASSAGE_RULES,
  type PassageRule,
  type PassageSegment,
  parsePassageDigest,
  passageRecall,
  sealCitationPassage,
  segmentPassages,
  soleBlockPassage,
} from './passage-identity.js';

const LAB_NOTE = [
  '# Lab bench',
  '',
  'The fume cupboard sash stays below the marked line while it is running.',
  'The waste bottles are labelled by the door.',
  '',
  'Solvent containers are not to be stored within 1 m of the hotplate.',
  '',
].join('\n');

function textsOf(segments: readonly PassageSegment[]): string[] {
  return segments.map((segment) => `${segment.level}:${segment.normalised}`);
}

describe('the segmentation rule, version 1', () => {
  it('declares its version and is the registry current rule', () => {
    expect(PASSAGE_RULE_VERSION).toBe(1);
    expect(PASSAGE_RULE_V1.version).toBe(1);
    expect(CURRENT_PASSAGE_RULE).toBe(PASSAGE_RULE_V1);
    expect(PASSAGE_RULES).toContain(PASSAGE_RULE_V1);
  });

  it('a passage is a block of consecutive non-blank lines, and any one line of a multi-line block', () => {
    const segments = segmentPassages(LAB_NOTE);
    expect(textsOf(segments)).toEqual([
      'block:# Lab bench',
      'block:The fume cupboard sash stays below the marked line while it is running. The waste bottles are labelled by the door.',
      'line:The fume cupboard sash stays below the marked line while it is running.',
      'line:The waste bottles are labelled by the door.',
      'block:Solvent containers are not to be stored within 1 m of the hotplate.',
    ]);
    // A one-line block is its own line: it is never listed twice.
    expect(segments.filter((s) => s.normalised.startsWith('Solvent'))).toHaveLength(1);
  });

  it('gives each segment its exact source span and raw text', () => {
    const segments = segmentPassages(LAB_NOTE);
    for (const segment of segments) {
      expect(LAB_NOTE.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it('never treats front matter as a passage, and an unclosed opening line is not front matter', () => {
    const withFrontmatter = ['---', 'course: X', '---', '', 'Body line.', ''].join('\n');
    expect(textsOf(segmentPassages(withFrontmatter))).toEqual(['block:Body line.']);

    const unclosed = ['---', 'Body line.', ''].join('\n');
    expect(textsOf(segmentPassages(unclosed))).toEqual([
      'block:--- Body line.',
      'line:---',
      'line:Body line.',
    ]);
  });

  it('keeps a fenced code block whole across its blank lines and never lists its lines', () => {
    const source = ['Before.', '', '```js', 'a();', '', 'b();', '```', '', 'After.', ''].join('\n');
    const segments = segmentPassages(source);
    expect(textsOf(segments)).toEqual([
      'block:Before.',
      'block:```js a(); b(); ```',
      'block:After.',
    ]);
    expect(segments[1]?.kind).toBe('code');
  });

  it('ends a block at a heading line', () => {
    const source = ['Intro text.', '## Next', 'Body text.', ''].join('\n');
    expect(textsOf(segmentPassages(source))).toEqual([
      'block:Intro text.',
      'block:## Next',
      'block:Body text.',
    ]);
  });

  it('reads CRLF, LF and CR notes as the same passages', () => {
    const lf = 'One line.\nSecond line.\n\nThird.\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const cr = lf.replace(/\n/g, '\r');
    expect(textsOf(segmentPassages(crlf))).toEqual(textsOf(segmentPassages(lf)));
    expect(textsOf(segmentPassages(cr))).toEqual(textsOf(segmentPassages(lf)));
  });
});

describe('normalisation and the digest', () => {
  it('collapses whitespace and line endings, and nothing else', () => {
    expect(normalisePassageText('  A\r\n  B \t C  ')).toBe('A B C');
    // Wording, case, punctuation and markup are all still part of a passage's identity.
    expect(normalisePassageText('A b')).not.toBe(normalisePassageText('a b'));
    expect(normalisePassageText('- A')).not.toBe(normalisePassageText('A'));
  });

  it('is the same digest for the same passage however it is spaced or ended', async () => {
    const a = await digestPassage('The bar breaks in a swell.\nAbove two metres.');
    const b = await digestPassage('The bar   breaks in a swell.\r\nAbove two metres.  ');
    expect(a).toBe(b);
  });

  it('carries its rule version in the digest text and parses it back', async () => {
    const digest = await digestPassage('A passage.');
    expect(digest).toMatch(/^p1:[0-9a-f]{64}$/);
    expect(parsePassageDigest(digest)).toEqual({ version: 1, hash: digest.slice(3) });
    expect(parsePassageDigest('not a digest')).toBeNull();
    expect(parsePassageDigest('p0:abc')).toBeNull();
    expect(parsePassageDigest('p1:')).toBeNull();
    expect(parsePassageDigest('p1:ZZ')).toBeNull();
  });
});

describe('moved passages', () => {
  const PASSAGE = 'Solvent containers are not to be stored within 1 m of the hotplate.';

  it('finds the same passage after it moves within its note', async () => {
    const digest = await digestPassage(PASSAGE);
    const before = ['# A', '', PASSAGE, '', 'Other text.', ''].join('\n');
    const after = ['# A', '', 'Other text.', '', PASSAGE, ''].join('\n');
    const first = await locatePassageByDigest(before, digest);
    const second = await locatePassageByDigest(after, digest);
    expect(first.status).toBe('unique');
    expect(second.status).toBe('unique');
    if (first.status === 'unique' && second.status === 'unique') {
      expect(second.segment.start).not.toBe(first.segment.start);
      expect(second.segment.normalised).toBe(first.segment.normalised);
    }
  });

  it('finds the same passage in another note, when it is one line of a longer block there', async () => {
    const digest = await digestPassage(PASSAGE);
    const elsewhere = [
      '# Cupboards',
      '',
      'The extraction fan is checked each Monday.',
      PASSAGE,
      '',
    ].join('\n');
    const located = await locatePassageByDigest(elsewhere, digest);
    expect(located.status).toBe('unique');
  });

  it('follows a passage through re-wrapping and re-spacing, not through rewording', async () => {
    const digest = await digestPassage('Rinse twice\nbefore each use.');
    expect((await locatePassageByDigest('Rinse  twice before each use.\n', digest)).status).toBe(
      'unique',
    );
    expect((await locatePassageByDigest('Rinse thrice before each use.\n', digest)).status).toBe(
      'absent',
    );
  });
});

describe('duplicate passages', () => {
  it('reports ambiguity, never a first match, when the same passage stands twice in one note', async () => {
    const digest = await digestPassage('Check the seals before you leave.');
    const twice = [
      'Check the seals before you leave.',
      '',
      'Something else.',
      '',
      'Check the seals before you leave.',
      '',
    ].join('\n');
    expect(await locatePassageByDigest(twice, digest)).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('counts a copy inside a longer block as a second place', async () => {
    const digest = await digestPassage('Check the seals before you leave.');
    const source = [
      'Check the seals before you leave.',
      '',
      'Notes:',
      'Check the seals before you leave.',
      'Then lock the cabinet.',
      '',
    ].join('\n');
    expect(await locatePassageByDigest(source, digest)).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('a single occurrence is unique, and a passage that is not there is absent', async () => {
    const digest = await digestPassage('Check the seals before you leave.');
    expect(
      (await locatePassageByDigest('Check the seals before you leave.\n', digest)).status,
    ).toBe('unique');
    expect(await locatePassageByDigest('Nothing like it here.\n', digest)).toEqual({
      status: 'absent',
    });
  });

  it('locates by text with the same three answers', () => {
    const segments = segmentPassages('Same.\n\nSame.\n\nOnly once.\n');
    expect(locatePassageByText(segments, 'Same.')).toEqual({ status: 'ambiguous', count: 2 });
    expect(locatePassageByText(segments, 'Only once.').status).toBe('unique');
    expect(locatePassageByText(segments, 'Never written.')).toEqual({ status: 'absent' });
  });
});

describe('an edited passage is not identified by its digest, and nothing is guessed', () => {
  it('an edited passage reads absent, not the nearest look-alike', async () => {
    const digest = await digestPassage('The tray holds 40 vials of 5 ml each.');
    const edited = 'The tray holds 48 vials of 5 ml each.\n';
    expect(await locatePassageByDigest(edited, digest)).toEqual({ status: 'absent' });
  });

  it('measures resemblance as the share of the old words that survive, for callers that must go on', () => {
    expect(passageRecall('the tray holds 40 vials', 'the tray holds 48 vials')).toBeCloseTo(0.8, 5);
    expect(passageRecall('', 'anything')).toBe(0);
  });
});

describe('citing a passage at authoring', () => {
  it('mints the digest for a passage that stands exactly once in its source', async () => {
    const cited = await citePassage(LAB_NOTE, 'The waste bottles are labelled by the door.');
    expect(cited.status).toBe('cited');
    if (cited.status === 'cited') {
      expect(cited.digest).toBe(await digestPassage('The waste bottles are labelled by the door.'));
      const located = await locatePassageByDigest(LAB_NOTE, cited.digest);
      expect(located.status).toBe('unique');
    }
  });

  it('refuses to mint for a passage that stands twice, or not at all', async () => {
    const twice = 'Same.\n\nSame.\n';
    expect(await citePassage(twice, 'Same.')).toEqual({ status: 'ambiguous', count: 2 });
    expect(await citePassage(LAB_NOTE, 'Never written.')).toEqual({ status: 'absent' });
  });

  it('names the sole passage of a note only when there is exactly one body block', () => {
    expect(soleBlockPassage('# Title\n\nOnly this paragraph.\nOver two lines.\n')?.normalised).toBe(
      'Only this paragraph. Over two lines.',
    );
    expect(soleBlockPassage('# Title\n\nFirst.\n\nSecond.\n')).toBeUndefined();
    expect(soleBlockPassage('# Title only\n')).toBeUndefined();
    expect(soleBlockPassage('')).toBeUndefined();
  });
});

describe('segmentation rule versions', () => {
  // A later rule that treats every line as its own passage and normalises case. It exists only to
  // prove the registry mechanism: a rule change must never silently re-mean an old digest.
  const RULE_V2: PassageRule = {
    version: 2,
    normalise: (text) => text.replace(/\s+/g, ' ').trim().toLowerCase(),
    segment: (source) => {
      const segments: PassageSegment[] = [];
      let offset = 0;
      for (const line of source.split('\n')) {
        const normalised = line.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalised.length > 0) {
          segments.push({
            level: 'line',
            kind: 'text',
            start: offset,
            end: offset + line.length,
            text: line,
            normalised,
            lineCount: 1,
          });
        }
        offset += line.length + 1;
      }
      return segments;
    },
  };
  const BOTH = [PASSAGE_RULE_V1, RULE_V2] as const;

  it('the highest registered version is current', () => {
    expect(currentPassageRule(BOTH)).toBe(RULE_V2);
    expect(currentPassageRule([PASSAGE_RULE_V1])).toBe(PASSAGE_RULE_V1);
  });

  it('the same text digests differently under each version, so digests never cross-match', async () => {
    const one = await digestPassage('Same words here.', PASSAGE_RULE_V1);
    const two = await digestPassage('Same words here.', RULE_V2);
    expect(one.startsWith('p1:')).toBe(true);
    expect(two.startsWith('p2:')).toBe(true);
    expect(one.slice(3)).not.toBe(two.slice(3));
  });

  it('an older digest is still located by its own rule while that rule stays registered', async () => {
    const block = 'Line one of a block.\nLine two of a block.';
    const digest = await digestPassage(block, PASSAGE_RULE_V1);
    const source = `${block}\n`;
    // Version 2 has no whole-block passage; only version 1 can find this one.
    expect((await locatePassageByDigest(source, digest, BOTH)).status).toBe('unique');
    expect(
      (await locatePassageByDigest(source, await digestPassage(block, RULE_V2), BOTH)).status,
    ).toBe('absent');
  });

  it('a digest from a retired or unknown version is unsupported, never matched by chance', async () => {
    const digest = await digestPassage('Anything at all.', PASSAGE_RULE_V1);
    const located = await locatePassageByDigest('Anything at all.\n', digest, [RULE_V2]);
    expect(located).toEqual({ status: 'unsupported-rule', version: 1 });
    expect(await locatePassageByDigest('Anything at all.\n', 'p9:abc123', BOTH)).toEqual({
      status: 'unsupported-rule',
      version: 9,
    });
    expect(await locatePassageByDigest('Anything at all.\n', 'garbage', BOTH)).toEqual({
      status: 'malformed',
    });
  });

  it('a new digest is minted under the current version, and cites nothing the rule cannot segment', async () => {
    const cited = await citePassage('Line one.\nLine two.\n', 'Line one.', RULE_V2);
    expect(cited.status).toBe('cited');
    if (cited.status === 'cited') expect(cited.digest.startsWith('p2:')).toBe(true);
    // The whole two-line block is a version 1 passage but not a version 2 one.
    expect(
      (await citePassage('Line one.\nLine two.\n', 'Line one.\nLine two.', RULE_V2)).status,
    ).toBe('absent');
    expect(
      (await citePassage('Line one.\nLine two.\n', 'Line one.\nLine two.', PASSAGE_RULE_V1)).status,
    ).toBe('cited');
  });
});

class OneFileVault implements VaultSource {
  constructor(private readonly files: Readonly<Record<string, string>>) {}
  async list(_options?: ListOptions): Promise<readonly VaultPath[]> {
    return Object.keys(this.files).sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed');
  }
  async write(): Promise<void> {
    throw new Error('not needed');
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files[path] !== undefined;
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

describe('sealing a citation at authoring', () => {
  const HOME = 'Zettel/Topic (Olea).md';
  const SOURCE = 'Zettel/Topic.md';

  it('mints the digest of a source note that has exactly one body passage', async () => {
    const vault = new OneFileVault({
      [SOURCE]: '# Topic\n\nThe only paragraph.\nOver two lines.\n',
    });
    const sealed = await sealCitationPassage(vault, { sourcePath: SOURCE, page: 1 }, HOME);
    expect(sealed.outcome).toBe('minted');
    expect(sealed.citation.passageDigest).toBe(
      await digestPassage('The only paragraph.\nOver two lines.'),
    );
    expect(sealed.citation.sourcePath).toBe(SOURCE);
    expect(sealed.citation.page).toBe(1);
  });

  it('mints nothing for a source with several passages: which one grounded a question is not known here', async () => {
    const vault = new OneFileVault({ [SOURCE]: 'First paragraph.\n\nSecond paragraph.\n' });
    const citation = { sourcePath: SOURCE };
    const sealed = await sealCitationPassage(vault, citation, HOME);
    expect(sealed).toEqual({ citation, outcome: 'not-applicable' });
  });

  it('keeps a supplied digest that resolves to one passage, and drops one that does not', async () => {
    const vault = new OneFileVault({
      [SOURCE]: 'First paragraph.\n\nSecond paragraph.\n\nSecond paragraph.\n',
    });
    const good = await digestPassage('First paragraph.');
    const duplicated = await digestPassage('Second paragraph.');
    const gone = await digestPassage('A paragraph that was never here.');

    const kept = await sealCitationPassage(
      vault,
      { sourcePath: SOURCE, passageDigest: good },
      HOME,
    );
    expect(kept.outcome).toBe('kept');
    expect(kept.citation.passageDigest).toBe(good);

    for (const digest of [duplicated, gone, 'p9:abc', 'garbage']) {
      const dropped = await sealCitationPassage(
        vault,
        { sourcePath: SOURCE, section: 'S', passageDigest: digest },
        HOME,
      );
      expect(dropped.outcome).toBe('dropped');
      expect(dropped.citation).toEqual({ sourcePath: SOURCE, section: 'S' });
    }
  });

  it('leaves a non-markdown source, a self-referential citation and an unreadable source untouched', async () => {
    const vault = new OneFileVault({ [HOME]: 'Only paragraph.\n' });
    const pdf = { sourcePath: 'Lectures/deck.pdf', page: 4 };
    expect(await sealCitationPassage(vault, pdf, HOME)).toEqual({
      citation: pdf,
      outcome: 'not-applicable',
    });
    const self = { sourcePath: HOME };
    expect(await sealCitationPassage(vault, self, HOME)).toEqual({
      citation: self,
      outcome: 'not-applicable',
    });
    const missing = { sourcePath: 'Nowhere.md' };
    expect(await sealCitationPassage(vault, missing, HOME)).toEqual({
      citation: missing,
      outcome: 'not-applicable',
    });
    const missingWithDigest = { sourcePath: 'Nowhere.md', passageDigest: await digestPassage('X') };
    expect((await sealCitationPassage(vault, missingWithDigest, HOME)).outcome).toBe('dropped');
  });
});
