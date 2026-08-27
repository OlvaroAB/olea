/**
 * Proof that the standing check fires (N-013, ol-voen, ol-3vzn).
 *
 * A guard nobody has watched go red is a check that cannot fail, which is
 * the defect class it was written against. Every rule below is exercised
 * twice: once with the dishonest shape (must throw) and once with the
 * honest shape that most resembles it (must not), because a guard that
 * rejects legitimate output is a different way of being useless.
 *
 * Lives in its own file rather than inside `registry.spec.ts` on purpose:
 * the guard is an invariant of the interface, not a behaviour of the
 * dispatcher, and it must be findable by anyone grepping for why an
 * extraction threw.
 */

import { describe, expect, it } from 'vitest';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import {
  assertHonestExtraction,
  extractionYieldViolations,
  guardExtractor,
  SilentExtractionError,
} from './guard.js';
import { extractFromVault } from './registry.js';
import type { ExtractionOutcome, ExtractionResult, Extractor, PageExtraction } from './types.js';

// Deliberately not a real fixture-vault path: this suite asserts an interface
// invariant, not a fixture's contents, and nothing here should have to move
// when the fixture vault's course folders are renamed.
const PATH: VaultPath = 'sources/deck.pdf';

function page(overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    page: 1,
    charCount: 44,
    textLayer: 'readable',
    route: 'text-layer',
    furniture: false,
    units: [
      {
        text: 'a'.repeat(44),
        provenance: { sourcePath: PATH, location: { page: 1, charRange: { start: 0, end: 44 } } },
      },
    ],
    ...overrides,
  };
}

function result(outcome: ExtractionOutcome, pages: readonly PageExtraction[]): ExtractionResult {
  return { sourcePath: PATH, format: 'pdf', outcome, pages };
}

/** An extractor that returns whatever it is told to — the mutation vehicle. */
function fakeExtractor(returns: ExtractionResult): Extractor {
  return { format: 'pdf', extract: async () => returns };
}

class MemoryVaultSource implements VaultSource {
  constructor(private readonly files: Record<string, Uint8Array>) {}
  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return Object.keys(this.files).sort();
  }
  async read(path: VaultPath): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.files[path];
    if (!bytes) throw new Error(`not found: ${path}`);
    return bytes;
  }
  async write(): Promise<void> {}
  async exists(path: VaultPath): Promise<boolean> {
    return path in this.files;
  }
  watch(): Unsubscribe {
    return () => {};
  }
}

describe('extract/guard — an extractor may never report success with zero yield', () => {
  describe("R1: outcome 'extracted' over an empty page list (the ol-voen shape)", () => {
    it('fires — this is the exact result the affected real lecture PDFs used to return', () => {
      expect(() => assertHonestExtraction(result('extracted', []))).toThrow(SilentExtractionError);
    });

    it('names the violation rather than throwing a bare error', () => {
      expect(extractionYieldViolations(result('extracted', []))).toEqual([
        expect.stringContaining("outcome 'extracted' with zero pages"),
      ]);
    });

    it("does not fire for the honest report of the same situation ('no-pages-found')", () => {
      expect(extractionYieldViolations(result('no-pages-found', []))).toEqual([]);
    });

    it('does not fire for a genuinely empty document, or an unreadable one', () => {
      expect(extractionYieldViolations(result('empty-document', []))).toEqual([]);
      expect(extractionYieldViolations(result('unreadable', []))).toEqual([]);
    });
  });

  describe('R2: pages produced while the outcome denies them', () => {
    it('fires — a caller branching on outcome would discard real work', () => {
      expect(() => assertHonestExtraction(result('no-pages-found', [page()]))).toThrow(
        SilentExtractionError,
      );
    });
  });

  describe('R3: a page routed to the text layer carrying nothing', () => {
    it('fires — routing to Slot G is a claim that this page has usable text', () => {
      const violations = extractionYieldViolations(
        result('extracted', [page({ charCount: 0, route: 'text-layer', units: [] })]),
      );
      expect(violations).toEqual([
        expect.stringContaining('routed to the text layer with no extracted text'),
      ]);
    });

    it('does not fire for a zero-yield page routed to vision — that report is honest', () => {
      expect(
        extractionYieldViolations(
          result('extracted', [page({ charCount: 0, route: 'vision', units: [] })]),
        ),
      ).toEqual([]);
    });
  });

  describe('R4/R5: a unit that carries no text, and a count that disagrees with its units', () => {
    it("fires on an empty-text unit — zero yield wearing a unit's clothes", () => {
      const empty = page({
        units: [
          {
            text: '',
            provenance: {
              sourcePath: PATH,
              location: { page: 1, charRange: { start: 0, end: 0 } },
            },
          },
        ],
      });
      expect(extractionYieldViolations(result('extracted', [empty]))).toEqual([
        expect.stringContaining('routed to the text layer with no extracted text'),
        expect.stringContaining('unit 0 carries empty text'),
      ]);
    });

    it('fires when charCount is 0 but units are present', () => {
      expect(extractionYieldViolations(result('extracted', [page({ charCount: 0 })]))).toEqual([
        expect.stringContaining('the count and the units disagree'),
      ]);
    });
  });

  describe('the guard is wired into the registry, not merely available', () => {
    it('guardExtractor throws for a dishonest extractor at the point of extraction', async () => {
      const guarded = guardExtractor(fakeExtractor(result('extracted', [])));
      await expect(guarded.extract({ path: PATH, bytes: new Uint8Array([1]) })).rejects.toThrow(
        SilentExtractionError,
      );
    });

    it('extractFromVault refuses a zero-yield page presented as text-layer, through the real extractors', async () => {
      // The one configuration under which a *shipped* extractor produces the
      // banned shape without any mutation: `routePage(0, 0)` is not `0 < 0`,
      // so a threshold of 0 sends an image — which has no text layer by
      // construction — to Slot G carrying nothing. Before this guard that
      // returned a "successful" text-layer page with an empty unit list, and
      // an ingestion runner would have submitted it as grounding.
      const vault = new MemoryVaultSource({ 'screenshot.png': new Uint8Array([1, 2, 3]) });
      await expect(
        extractFromVault(vault, 'screenshot.png', 'image', { textLayerCharThreshold: 0 }),
      ).rejects.toThrow(SilentExtractionError);
    });

    it('leaves every honest extraction through the registry untouched', async () => {
      const vault = new MemoryVaultSource({ 'screenshot.png': new Uint8Array([1, 2, 3]) });
      const extracted = await extractFromVault(vault, 'screenshot.png', 'image');
      expect(extracted.outcome).toBe('extracted');
      expect(extracted.pages[0]?.route).toBe('vision');
    });
  });

  it('reports every violation in one pass rather than the first', () => {
    const violations = extractionYieldViolations(
      result('no-pages-found', [page({ charCount: 0, route: 'text-layer', units: [] })]),
    );
    expect(violations).toHaveLength(2);
  });

  it('never puts extracted text in the error message (D-005)', () => {
    const secret = 'SHIBBOLETH-DO-NOT-LOG';
    const leaky = page({
      charCount: 0,
      units: [
        {
          text: secret,
          provenance: {
            sourcePath: PATH,
            location: { page: 1, charRange: { start: 0, end: secret.length } },
          },
        },
      ],
    });
    try {
      assertHonestExtraction(result('extracted', [leaky]));
      expect.unreachable('the guard should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SilentExtractionError);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe('extract/guard — a page may never claim a text layer it could not read', () => {
  describe('R6: outcome extracted over pages whose text layer was reached and yielded nothing (ol-x1ch)', () => {
    it('fires — this is the exact result the affected producer class used to return', () => {
      // Measured shape: the page tree reached, the page count exact, every
      // page charCount 0 over material another reader gets ordinary text out
      // of. `pages.length > 0` satisfied R1, so the guard was silent and every
      // page went to the vision slot at full price.
      const pages = [1, 2, 3].map((n) =>
        page({ page: n, charCount: 0, textLayer: 'unreadable', route: 'vision', units: [] }),
      );
      expect(extractionYieldViolations(result('extracted', pages))).toEqual([
        expect.stringContaining("outcome 'extracted' over 3 page(s)"),
      ]);
      expect(() => assertHonestExtraction(result('extracted', pages))).toThrow(
        SilentExtractionError,
      );
    });

    it('does NOT fire on a genuine scan — a check that reds on everything discriminates nothing', () => {
      const pages = [1, 2].map((n) =>
        page({ page: n, charCount: 0, textLayer: 'absent', route: 'vision', units: [] }),
      );
      expect(extractionYieldViolations(result('extracted', pages))).toEqual([]);
    });

    it('does NOT fire when one page among several was unreadable', () => {
      const pages = [
        page({ page: 1, charCount: 0, textLayer: 'unreadable', route: 'vision', units: [] }),
        page({ page: 2 }),
      ];
      expect(extractionYieldViolations(result('extracted', pages))).toEqual([]);
    });

    it('accepts the honest report of the same document', () => {
      const pages = [page({ charCount: 0, textLayer: 'unreadable', route: 'vision', units: [] })];
      expect(extractionYieldViolations(result('reached-but-unreadable', pages))).toEqual([]);
    });
  });

  describe('R7: reached-but-unreadable over pages that do not support it', () => {
    it('fires when a page was readable after all', () => {
      expect(extractionYieldViolations(result('reached-but-unreadable', [page()]))).toEqual([
        expect.stringContaining(
          "outcome 'reached-but-unreadable' over pages that do not support it",
        ),
      ]);
    });

    it('fires when there are no pages at all — the outcome asserts page records', () => {
      expect(extractionYieldViolations(result('reached-but-unreadable', []))).toEqual([
        expect.stringContaining(
          "outcome 'reached-but-unreadable' over pages that do not support it",
        ),
      ]);
    });
  });

  describe('R8: a page routed to the text layer whose text is not text (ol-s3xa)', () => {
    it('fires even though the page cleared the routing threshold comfortably', () => {
      // The whole difficulty of this one: charCount is *large*. Every
      // count-based control in this repo passes it, and the page goes on to be
      // eligible to be quoted back to her.
      // Paired with a readable page so this asserts R8 alone: a document
      // whose *every* page is unreadable is R6's business, and a test that
      // could not tell which rule fired would prove neither.
      const garbage = page({
        page: 2,
        charCount: 367,
        textLayer: 'unreadable',
        route: 'text-layer',
      });
      expect(extractionYieldViolations(result('extracted', [page(), garbage]))).toEqual([
        expect.stringContaining('routed to the text layer with an unreadable text layer'),
      ]);
    });

    it('does NOT fire on an ordinary readable page — the control', () => {
      expect(extractionYieldViolations(result('extracted', [page()]))).toEqual([]);
    });

    it('does not name the text it is rejecting (D-005, INV-3)', () => {
      const secret = 'x'.repeat(40);
      const garbage = page({
        charCount: 40,
        textLayer: 'unreadable',
        route: 'text-layer',
        units: [
          {
            text: secret,
            provenance: {
              sourcePath: PATH,
              location: { page: 1, charRange: { start: 0, end: secret.length } },
            },
          },
        ],
      });
      try {
        assertHonestExtraction(result('extracted', [garbage]));
        expect.unreachable('the guard should have thrown');
      } catch (err) {
        expect((err as Error).message).not.toContain(secret);
      }
    });
  });

  describe('R9: a page with no text layer that produced characters anyway', () => {
    it('fires — the quality signal and the count cannot both be right', () => {
      const impossible = page({ charCount: 44, textLayer: 'absent', route: 'text-layer' });
      expect(extractionYieldViolations(result('extracted', [impossible]))).toEqual([
        expect.stringContaining("reports textLayer 'absent' alongside charCount 44"),
      ]);
    });
  });
});

describe('extract/guard — a furniture page may never be offered as content (SCAN-1, ol-738i)', () => {
  describe('R10: a furniture page routed to the text layer', () => {
    it('fires — a page that is furniture must not be offered to Slot G', () => {
      const bad = page({ furniture: true, route: 'text-layer' });
      expect(extractionYieldViolations(result('extracted', [bad]))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('marked furniture but routed to the text layer'),
        ]),
      );
    });

    it('does not fire on the honest report — furniture routed to vision', () => {
      const honest = page({ furniture: true, route: 'vision', units: [], charCount: 40 });
      expect(extractionYieldViolations(result('furniture-only', [honest]))).toEqual([]);
    });
  });

  describe('R11: a furniture page carrying units', () => {
    it('fires — a furniture page has nothing to hand to Slot G', () => {
      const bad = page({ furniture: true, route: 'vision' });
      expect(extractionYieldViolations(result('extracted', [bad]))).toEqual(
        expect.arrayContaining([expect.stringContaining('carries 1 unit(s)')]),
      );
    });
  });

  describe('R12: outcome vs the per-page furniture signal', () => {
    it("fires when a page is marked furniture but outcome says 'extracted'", () => {
      const furniturePage = page({ furniture: true, route: 'vision', units: [], charCount: 40 });
      expect(extractionYieldViolations(result('extracted', [furniturePage]))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("outcome 'extracted' with a page marked furniture"),
        ]),
      );
    });

    it("fires when outcome says 'furniture-only' but no page agrees", () => {
      expect(extractionYieldViolations(result('furniture-only', [page()]))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("outcome 'furniture-only' with no page marked furniture"),
        ]),
      );
    });

    it('accepts the honest furniture-only report', () => {
      const furniturePage = page({ furniture: true, route: 'vision', units: [], charCount: 40 });
      expect(extractionYieldViolations(result('furniture-only', [furniturePage]))).toEqual([]);
    });
  });
});
