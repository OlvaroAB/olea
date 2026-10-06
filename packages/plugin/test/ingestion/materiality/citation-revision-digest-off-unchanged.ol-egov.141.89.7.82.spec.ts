/**
 * `ol-egov.141.89.7.82` ([D-518]): with the vision digest off, as the ingestion is composed today,
 * the rewrite after a file changes behaves exactly as it did before pages of one version were
 * merged. Today only the extraction runner's text-layer deliveries carry a digest (core
 * `ingestion/extraction-runner.ts` runNoteJob and runSourceJob; the vision page runner delivers
 * none while `deliverRevisionDigest` is off), and each covers every text-layer page of the bytes it
 * read, so a repeat of a version always covers the same pages.
 *
 * The oracle below is the rule before this change: the text held for a file is the latest
 * delivery's, whole. For every prefix of a sequence of such deliveries (a repeat, a note embedding
 * the file twice, a newer version, a late older one, a return to earlier bytes, bytes no question
 * is held for) and every version the file may then hold, the same questions are rewritten, held,
 * asked a re-extraction for and released, from the same text. This spec passes unchanged against
 * the code before the change (client c9cfb681). Every string and byte is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  DOC,
  digestOf,
  type Harness,
  heldIds,
  MemoryVaultSource,
  rewrites,
  seedQuestions,
  setup,
  unitsOf,
  versionBytes,
} from './source-rewrite-harness.ol-egov.141.89.7.82.js';

type Version = 'v0' | 'A' | 'B' | 'C';

interface Delivery {
  readonly label: string;
  readonly version: Version;
  readonly pages: Readonly<Record<number, readonly string[]>>;
}

/** A complete text-layer delivery of a version: pages 1 to 3; page 4 is read from its image and never arrives. */
function full(version: Version, copies = 1): Delivery {
  const pages: Record<number, string[]> = {};
  for (const page of [1, 2, 3]) {
    pages[page] = Array.from({ length: copies }, () => `Version ${version}, page ${page} text.`);
  }
  return {
    label: copies === 1 ? version : `${version} (note, embedded ${copies}x)`,
    version,
    pages,
  };
}

const SEQUENCE: readonly Delivery[] = [
  full('A'),
  full('A', 2),
  full('B'),
  full('A'),
  full('C'),
  full('B'),
];

/**
 * Questions on page 1, page 2 and the image page 4, all built from v0. A question citing the file
 * with no page is never held for a changed file (core `session/enumerate.ts`
 * citationToSourceProvenance gives it no source), so none is seeded.
 */
const QUESTIONS = [
  { id: 'qp1', page: 1 },
  { id: 'qp2', page: 2 },
  { id: 'qp4', page: 4 },
] as const;

/** Today's rule: the latest delivery's text for the page, whole. */
function oracleText(latest: Delivery, page: number): string {
  return (latest.pages[page] ?? []).join('\n\n').trim();
}

async function revisionOf(version: Version): Promise<string> {
  return digestOf(versionBytes(version));
}

async function baselined(): Promise<{ vault: MemoryVaultSource; harness: Harness }> {
  const vault = new MemoryVaultSource();
  vault.binaries.set(DOC, versionBytes('v0'));
  const v0 = await revisionOf('v0');
  seedQuestions(
    vault,
    QUESTIONS.map((q) => ({ ...q, revision: v0 })),
  );
  const harness = setup();
  await harness.trigger.tick(vault, harness.actions);
  expect(await heldIds(harness)).toEqual([]);
  return { vault, harness };
}

async function deliver(vault: MemoryVaultSource, harness: Harness, delivery: Delivery) {
  return harness.trigger.onSourceUnitsLanded(
    vault,
    harness.actions,
    unitsOf(delivery.pages),
    new Map([[DOC, await revisionOf(delivery.version)]]),
  );
}

describe('with the vision digest off, the rewrite behaves exactly as before ([D-518])', () => {
  for (let prefix = 0; prefix <= SEQUENCE.length; prefix++) {
    for (const current of ['A', 'B', 'C'] as const) {
      const landed = SEQUENCE.slice(0, prefix);
      it(`after landing [${landed.map((d) => d.label).join(', ')}], a pass that finds the file at ${current}`, async () => {
        const { vault, harness } = await baselined();
        for (const delivery of landed) {
          expect(await deliver(vault, harness, delivery)).toEqual({ rewritten: 0, heldNoText: 0 });
        }
        expect(harness.actions.enqueue).not.toHaveBeenCalled();

        vault.binaries.set(DOC, versionBytes(current));
        await harness.trigger.tick(vault, harness.actions);

        const latest = landed.at(-1);
        const usable = latest !== undefined && latest.version === current;
        const expected = new Map<string, { text: string; revision: string }>();
        const expectedHeld: string[] = [];
        for (const question of QUESTIONS) {
          const text = usable ? oracleText(latest, question.page) : '';
          if (text.length > 0) {
            expected.set(question.id, { text, revision: await revisionOf(current) });
          } else {
            expectedHeld.push(question.id);
          }
        }
        expect(rewrites(harness)).toEqual(expected);
        expect(harness.actions.suspend.mock.calls.map(([id]) => id).sort()).toEqual(
          [...expected.keys()].sort(),
        );
        expect(await heldIds(harness)).toEqual(expectedHeld.sort());
        // A re-extraction is asked for exactly when no text for these bytes is held.
        expect(harness.requestSourceReextraction.mock.calls).toEqual(usable ? [] : [[DOC]]);
        expect(harness.judge.judge).not.toHaveBeenCalled();

        // The bytes returning to the version the questions were built from release every hold.
        vault.binaries.set(DOC, versionBytes('v0'));
        await harness.trigger.tick(vault, harness.actions);
        expect(await heldIds(harness)).toEqual([]);
        expect(rewrites(harness)).toEqual(expected);
      });
    }
  }

  for (const current of ['A', 'B', 'C'] as const) {
    it(`questions held for ${current} first, then every delivery in turn`, async () => {
      const { vault, harness } = await baselined();
      vault.binaries.set(DOC, versionBytes(current));
      await harness.trigger.tick(vault, harness.actions);
      expect(await heldIds(harness)).toEqual(QUESTIONS.map((q) => q.id).sort());

      const stillHeld = new Set<string>(QUESTIONS.map((q) => q.id));
      const expected = new Map<string, { text: string; revision: string }>();
      for (const delivery of SEQUENCE) {
        let rewritten = 0;
        let heldNoText = 0;
        if (delivery.version === current) {
          for (const question of QUESTIONS) {
            if (!stillHeld.has(question.id)) continue;
            const text = oracleText(delivery, question.page);
            if (text.length === 0) {
              heldNoText += 1;
              continue;
            }
            rewritten += 1;
            stillHeld.delete(question.id);
            expected.set(question.id, { text, revision: await revisionOf(current) });
          }
        }
        expect(await deliver(vault, harness, delivery), delivery.label).toEqual({
          rewritten,
          heldNoText,
        });
        expect(rewrites(harness), delivery.label).toEqual(expected);
        expect(await heldIds(harness), delivery.label).toEqual([...stillHeld].sort());
      }
      expect(harness.judge.judge).not.toHaveBeenCalled();
    });
  }
});
