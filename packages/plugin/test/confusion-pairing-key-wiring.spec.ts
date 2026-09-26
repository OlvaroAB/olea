/**
 * `ol-2zfj.164`: `main.ts`'s `tickIngestionAndMaybeRunCorpusRelations` (the only
 * production caller of `corroborateConfusionPairings`, around line 2261) must
 * thread each concept's `[D-088]` opaque key through to
 * `ConfusionPairingConcept.key`, not name/aliases alone, so an
 * `'opaque-key'`-scheme `MisconceptionRecord` resolves through
 * `corroborateConfusionPairs`'s key index (`ol-2zfj.155`) instead of counting
 * as an unresolved record forever.
 *
 * `main.ts` imports `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all (`main-wiring.spec.ts`'s own doc) — no
 * fake, no shim, no import. Two instruments together stand in for the
 * missing direct test:
 *
 *  - a SOURCE-LEVEL assertion (`main-wiring.spec.ts`'s technique) that the
 *    real call site's object literal includes `key: concept.key`, proving
 *    production text actually changed, not merely a doc comment;
 *  - a BEHAVIOURAL test that builds the exact same shape that call site
 *    builds (`{ name, aliases, key }` from a `ReadConcept`-shaped concept,
 *    `pass.read.concepts` in `main.ts`) and hands it to the real
 *    `corroborateConfusionPairings` this repo ships, proving an
 *    opaque-keyed record actually resolves through the key index once that
 *    shape is passed — the thing the source-level assertion alone cannot
 *    show.
 *
 * INV-3: every concept name, id and statement here is coined. No course
 * code, note title or wording comes from any real vault.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ConceptRelation, MisconceptionRecord, ReadConcept } from 'olea-core';
import {
  corroborateConfusionPairings,
  deriveRelationSet,
  OPAQUE_CONCEPT_KEY_PREFIX,
} from 'olea-core';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Source with prose removed — same technique `main-wiring.spec.ts` uses, so a doc paragraph describing the change cannot satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

describe("main.ts passes each concept's opaque key into confusion-pair corroboration (ol-2zfj.164)", () => {
  it('the corroborateConfusionPairings call site maps concept.key, not just name/aliases', () => {
    expect(main).toMatch(
      /corroborateConfusionPairings\(\s*pass\.relations,\s*records,\s*pass\.read\.concepts\.map/,
    );
    expect(main).toMatch(
      /pass\.read\.concepts\.map\(\(concept\)\s*=>\s*\(\{\s*name:\s*concept\.name,\s*aliases:\s*concept\.aliases,\s*key:\s*concept\.key,?\s*\}\)\)/,
    );
  });

  it('does not still pass only name/aliases (the pre-fix shape) at that call site', () => {
    expect(main).not.toMatch(
      /pass\.read\.concepts\.map\(\(concept\)\s*=>\s*\(\{\s*name:\s*concept\.name,\s*aliases:\s*concept\.aliases\s*\}\)\)/,
    );
  });
});

// --- Behavioural half: the exact shape above, exercised against the real reader ---

function readConcept(overrides: Partial<ReadConcept>): ReadConcept {
  return {
    key: overrides.key ?? overrides.name ?? 'concept-key1:default',
    name: 'Default concept',
    aliases: [],
    provenanceTier: 1,
    courses: [],
    anchor: undefined,
    alsoIn: [],
    sourcePaths: [],
    size: { band: 'fine', extent: { noteCount: 0, structureCorroborated: false } },
    ...overrides,
  };
}

function contrastsWith(from: string, to: string): ConceptRelation {
  return {
    type: 'contrasts-with',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages: {
      from: { sourcePath: `${from}.md`, location: { page: 1, charRange: { start: 0, end: 10 } } },
      to: { sourcePath: `${to}.md`, location: { page: 1, charRange: { start: 0, end: 10 } } },
    },
  };
}

function record(overrides: Partial<MisconceptionRecord>): MisconceptionRecord {
  return {
    id: 'm-default',
    conceptId: 'Widget',
    confusedWithConceptId: 'Gadget',
    statement: 'Believes Widget implies Gadget unconditionally.',
    correction: 'Widget only implies Gadget under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    firstSeen: '2026-08-01T09:00:00-04:00',
    lastSeen: '2026-08-01T09:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:widget:1',
    ...overrides,
  };
}

/** Mirrors main.ts's call-site mapping exactly (`pass.read.concepts.map(...)`), from `ReadConcept`-shaped inputs. */
function toConfusionPairingConcepts(concepts: readonly ReadConcept[]) {
  return concepts.map((concept) => ({
    name: concept.name,
    aliases: concept.aliases,
    key: concept.key,
  }));
}

describe('the production call shape resolves an opaque-keyed record through the key index', () => {
  it('an opaque-keyed misconception record resolves and corroborates, once ReadConcept.key is threaded through', () => {
    const widgetKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:widget-nonce`;
    const gadgetKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:gadget-nonce`;

    const relations = deriveRelationSet([contrastsWith('Widget', 'Gadget')]);
    const records: readonly MisconceptionRecord[] = [
      record({ conceptId: widgetKey, confusedWithConceptId: gadgetKey }),
    ];
    const readConcepts: readonly ReadConcept[] = [
      readConcept({ key: widgetKey, name: 'Widget' }),
      readConcept({ key: gadgetKey, name: 'Gadget' }),
    ];

    const verdicts = corroborateConfusionPairings(
      relations,
      records,
      toConfusionPairingConcepts(readConcepts),
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe('corroborated');
    expect(verdicts[0]?.misconceptionRecordCount).toBe(1);
  });

  it('the same opaque-keyed record is left unresolved (no corroboration) when key is dropped from the shape — proving the fix matters', () => {
    const widgetKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:widget-nonce`;
    const gadgetKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:gadget-nonce`;

    const relations = deriveRelationSet([contrastsWith('Widget', 'Gadget')]);
    const records: readonly MisconceptionRecord[] = [
      record({ conceptId: widgetKey, confusedWithConceptId: gadgetKey }),
    ];
    const readConcepts: readonly ReadConcept[] = [
      readConcept({ key: widgetKey, name: 'Widget' }),
      readConcept({ key: gadgetKey, name: 'Gadget' }),
    ];

    // The pre-fix shape: name/aliases only, no key — what main.ts passed before this bead.
    const preFixShape = readConcepts.map((concept) => ({
      name: concept.name,
      aliases: concept.aliases,
    }));

    const verdicts = corroborateConfusionPairings(relations, records, preFixShape);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe('noise-candidate');
  });
});
