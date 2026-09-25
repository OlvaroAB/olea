/**
 * `ol-egov.141.89.6.49`: fixture-vault coverage for
 * `resolveIntroducingPassageFromVault` — the vault-read implementation
 * behind `explain-back/modal.ts`'s `ExplainBackModalDeps.resolveIntroducingPassage`
 * port. No `obsidian` import anywhere in this file (INV-1): the function
 * under test takes `IntroducingPassageVaultReader`, a narrow structural
 * type, never `ObsidianSource` — see the source file's own module doc.
 */

import { type Provenance, parseDocument } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type IntroducingPassageVaultReader,
  resolveIntroducingPassageFromVault,
} from '../../src/explain-back/resolve-introducing-passage.js';

/** A minimal, in-memory fixture vault — only the one capability this port needs. */
class FixtureVault implements IntroducingPassageVaultReader {
  constructor(private readonly files: ReadonlyMap<string, string>) {}
  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`FixtureVault: no such file ${path}`);
    return content;
  }
}

/** The exact charRange `concept/read.ts`'s `gatherPassages` would have minted for `blockIndex` in `content` at fold time — real parsing, never a hand-picked offset. */
function anchorFor(
  content: string,
  blockIndex: number,
): { readonly start: number; readonly end: number } {
  const block = parseDocument(content).blocks[blockIndex];
  if (block === undefined) throw new Error(`fixture error: no block ${blockIndex}`);
  return { start: block.start, end: block.end };
}

describe('resolveIntroducingPassageFromVault (ol-egov.141.89.6.49)', () => {
  it('resolves a current introducing passage to a citable source block', async () => {
    // `parseDocument` inserts a `blank` block for the empty line between the
    // two paragraphs (verified against the real parser, not assumed), so the
    // second paragraph is block index 2, not 1.
    const content = 'Bronchitis causes coughing.\n\nCoughing can trigger vomiting.\n';
    const vault = new FixtureVault(new Map([['course/subject.md', content]]));
    const charRange = anchorFor(content, 2);
    const provenance: Provenance = {
      sourcePath: 'course/subject.md',
      location: { page: 1, charRange },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toEqual({
      block: {
        blockId: 'course/subject.md#2#0',
        text: 'Coughing can trigger vomiting.\n',
      },
      path: 'course/subject.md',
      blockIndex: 2,
    });
  });

  it('resolves null when the note no longer exists (missing)', async () => {
    const vault = new FixtureVault(new Map());
    const provenance: Provenance = {
      sourcePath: 'course/gone.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it('resolves null when the anchored span no longer fits the note (edited since fold time, stale)', async () => {
    const originalContent = 'Bronchitis causes coughing.\n\nCoughing can trigger vomiting.\n';
    const charRange = anchorFor(originalContent, 2);
    // The note was edited after the anchor was minted: a line inserted
    // before the anchored block shifts every later offset, so the recorded
    // charRange no longer names that block's real bounds.
    const editedContent = `A new opening line.\n\n${originalContent}`;
    const vault = new FixtureVault(new Map([['course/subject.md', editedContent]]));
    const provenance: Provenance = {
      sourcePath: 'course/subject.md',
      location: { page: 1, charRange },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it('resolves null when the anchored span now runs past the end of a shortened note (stale)', async () => {
    const vault = new FixtureVault(new Map([['course/subject.md', 'Short.\n']]));
    const provenance: Provenance = {
      sourcePath: 'course/subject.md',
      location: { page: 1, charRange: { start: 0, end: 500 } },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it('resolves null for a provenance with no charRange — no block-grain to resolve', async () => {
    const vault = new FixtureVault(new Map([['course/subject.md', 'Some text.\n']]));
    const provenance: Provenance = { sourcePath: 'course/subject.md', location: { page: 1 } };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it("resolves null for a non-markdown source path — re-extraction is out of this port's scope", async () => {
    const vault = new FixtureVault(new Map([['course/deck.pptx', 'unused']]));
    const provenance: Provenance = {
      sourcePath: 'course/deck.pptx',
      location: { page: 1, charRange: { start: 0, end: 5 } },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it('resolves null for page !== 1 — a non-markdown page grain this port cannot re-derive', async () => {
    const vault = new FixtureVault(new Map([['course/subject.md', 'Some text.\n']]));
    const provenance: Provenance = {
      sourcePath: 'course/subject.md',
      location: { page: 2, charRange: { start: 0, end: 5 } },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });

  it('resolves null for a frontmatter block — never citable as source material', async () => {
    const content = '---\ncourse: PSYCH326\n---\n\nBody paragraph.\n';
    const vault = new FixtureVault(new Map([['course/subject.md', content]]));
    const charRange = anchorFor(content, 0);
    const provenance: Provenance = {
      sourcePath: 'course/subject.md',
      location: { page: 1, charRange },
    };

    const result = await resolveIntroducingPassageFromVault(vault, provenance);

    expect(result).toBeNull();
  });
});
