/**
 * Differently-shaped fixture vaults — the extraction eval's oracle
 * (`olea-service`'s `[FND-U3] / ol-ej59.8`).
 *
 * `packages/core/fixtures/vault/` REPLICATES her structures (folder layout,
 * `topic` property, Zettelkasten) with invented content, and every existing
 * extraction test runs against that one shape. That proves the extractor
 * works on *a* shape; it proves nothing about whether it assumes that shape.
 * F1.3 already contracts "tolerating inconsistent structures" and "do not
 * assume one shape" — this module is four vaults built to hold that clause
 * to its word, each read by `extractConcepts()` with **no shape-telling
 * option** (`test/fixture-vaults.spec.ts` calls it exactly the way a real
 * caller who has never seen this vault would).
 *
 * **N-015 applies to every ground truth in here as much as it does to a
 * review-log stream.** These vaults are an oracle for whether extraction
 * reads a shape correctly — never a distribution to fit a threshold to.
 * Nothing downstream may calibrate a number against them.
 *
 * Every course code, topic name and Zettelkasten title below is a coined
 * single token, screened whole-token against the real-vault snapshot with
 * `olea-service`'s `scripts/check-fixture-vocabulary.mjs --term` (zero hits
 * required) before being used — the same discipline `packages/core/fixtures/
 * vault/README.md` documents, and for the same reason (`ol-vs57`): a
 * multi-word "plausible academic phrase" is exactly the shape that has
 * collided before. Body prose is deliberately generic and drawn only from
 * that script's own `STOPWORDS` list (ordinary discourse words —
 * "describe", "compare", "stages", "process", "concept" and the like), never
 * domain-flavoured, so nothing here needs its own vocabulary screening pass.
 *
 * INV-3: this is the public repo. Nothing here is a fixture-vault string
 * either (`ol-yj9`) — this vocabulary is new and self-contained, distinct
 * from both `packages/core/fixtures/vault/` and this package's own
 * `./vocabulary.ts` (which is for review-log ids, a different surface).
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

/** The four shapes `[FND-U3]`'s acceptance criteria names, verbatim. */
export type FixtureVaultShapeId =
  | 'no-frontmatter'
  | 'renamed-properties'
  | 'no-zettelkasten'
  | 'week-organised';

export const FIXTURE_VAULT_SHAPES: readonly FixtureVaultShapeId[] = [
  'no-frontmatter',
  'renamed-properties',
  'no-zettelkasten',
  'week-organised',
];

/** One `ConceptRecord`'s worth of expected output — mirrors `olea-core`'s shape without importing it, so this module has no compile-time coupling to `extract.ts`'s exact type beyond what the eval itself checks. */
export interface FixtureConceptGroundTruth {
  readonly name: string;
  readonly tier: 1 | 2 | 3;
  readonly courses: readonly string[];
  readonly sourcePaths: readonly VaultPath[];
  readonly boundNotePath?: VaultPath;
}

/**
 * What `extractConcepts(vault)` — no options passed, tier 3 off, exactly the
 * unconfigured call — is expected to return **today**, plus whether that
 * result means the shape was read correctly or exposes a real gap.
 *
 * `'gap'` is not this bead's job to close — `[FND-U3]`'s acceptance
 * criteria is the oracle existing, not the extractor changing. A `'gap'`
 * verdict is the oracle doing its job: it gives a future extraction-fix
 * bead something concrete to turn green.
 */
export interface FixtureVaultGroundTruth {
  readonly shape: FixtureVaultShapeId;
  readonly expectedConcepts: readonly FixtureConceptGroundTruth[];
  readonly verdict: 'convention-independent' | 'gap';
  readonly explanation: string;
}

function extOf(path: VaultPath): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A read-only, in-memory `VaultSource` over a fixed file map — the same
 * interface `FolderSource` (disk) and `ObsidianSource` (plugin) implement,
 * so `extractConcepts` cannot tell this vault from a real one. `write` is
 * refused rather than silently accepted: nothing in this eval should ever
 * mutate a fixture, and a refusal here is the same shape as
 * `./guard.ts`'s writer refusal for real vault paths.
 */
class InMemoryFixtureVault implements VaultSource {
  private readonly files: ReadonlyMap<VaultPath, string>;

  constructor(files: ReadonlyMap<VaultPath, string>) {
    this.files = files;
  }

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    const paths = [...this.files.keys()]
      .filter((path) => under === undefined || path === under || path.startsWith(`${under}/`))
      .filter((path) => extensions === undefined || extensions.includes(extOf(path)))
      .sort(byCodeUnit);
    return Promise.resolve(paths);
  }

  read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`InMemoryFixtureVault: no such file ${path}`));
    }
    return Promise.resolve(content);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((text) => new TextEncoder().encode(text));
  }

  write(_path: VaultPath, _content: string): Promise<void> {
    return Promise.reject(
      new Error('InMemoryFixtureVault is read-only — fixtures are not mutated'),
    );
  }

  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  /** `VaultSource.delete` (`ol-ppxj.15`) — refused, same reasoning as `write` above: nothing in this eval should ever mutate a fixture. */
  delete(_path: VaultPath): Promise<void> {
    return Promise.reject(
      new Error('InMemoryFixtureVault is read-only — fixtures are not mutated'),
    );
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

function vaultOf(files: Record<VaultPath, string>): VaultSource {
  return new InMemoryFixtureVault(new Map(Object.entries(files)));
}

// ---------------------------------------------------------------------------
// Shape 1: no frontmatter anywhere in the vault.
// ---------------------------------------------------------------------------
//
// Course folder structure (F1.3's default shape) is intact; every note body
// still mentions its topic in prose and headings. What's missing is the
// *property* the extractor keys on. `extractConcepts` skips any note whose
// first block is not `frontmatter` (`extract.ts:105`) before ever reading a
// value — so this exercises "read for meaning declines gracefully, not a
// crash", not "extraction can read meaning from headings". Heading-derived
// tier-3 extraction is a documented, separate gap
// (`concept/types.ts`'s module doc: "not covered; see ./evidence.js's module
// doc for why") — this vault gives that limitation its first concrete oracle
// case rather than inventing a new one.

function buildNoFrontmatterVault(): VaultSource {
  return vaultOf({
    '01 Courses/ZOVRENT/Lecture One.md': [
      '# Lecture One',
      '',
      'Three main stages for Xelbrun: first, second, third.',
      '',
    ].join('\n'),
    '01 Courses/ZOVRENT/Lecture Two.md': [
      '# Lecture Two',
      '',
      'Describe the process for Marnith.',
      '',
    ].join('\n'),
    '05 Zettelkasten/Xelbrun.md': ['# Xelbrun', '', 'A concept note.', ''].join('\n'),
  });
}

const NO_FRONTMATTER_GROUND_TRUTH: FixtureVaultGroundTruth = {
  shape: 'no-frontmatter',
  expectedConcepts: [],
  verdict: 'gap',
  explanation:
    'Every note is skipped before any value is read (extract.ts:105), so extraction returns ' +
    'zero concepts even though both lecture notes name a topic in prose. Graceful, not a crash ' +
    '— but confirms tiers 1/2 have no path into a vault with no frontmatter at all, and that ' +
    "heading-derived tier-3 extraction (concept/types.ts's documented gap) is the only thing " +
    'that could ever recover this shape.',
};

// ---------------------------------------------------------------------------
// Shape 2: differently-named properties in place of her conventions.
// ---------------------------------------------------------------------------
//
// One note uses the right `topic` key but a wrong course-property name
// (`class` instead of `course`); the other uses the right `course` key but a
// wrong topic-property name (`subject` instead of `topic`). This isolates
// the two axes: `course` aliasing degrades gracefully (F1.3's path fallback
// still finds the course), `topic` aliasing has no fallback at all — there
// is no alias table (`[FND-U3]`'s own description names this gap).

function buildRenamedPropertiesVault(): VaultSource {
  return vaultOf({
    '01 Courses/KIRLASH/Session A.md': [
      '---',
      'topic: Corvane',
      'class: KIRLASH',
      '---',
      '',
      '# Session A',
      '',
      'Notes about Corvane.',
      '',
    ].join('\n'),
    '01 Courses/KIRLASH/Session B.md': [
      '---',
      'subject: Ulspar',
      'course: KIRLASH',
      '---',
      '',
      '# Session B',
      '',
      'Notes about Ulspar.',
      '',
    ].join('\n'),
  });
}

const RENAMED_PROPERTIES_GROUND_TRUTH: FixtureVaultGroundTruth = {
  shape: 'renamed-properties',
  expectedConcepts: [
    {
      name: 'Corvane',
      tier: 2,
      courses: ['KIRLASH'],
      sourcePaths: ['01 Courses/KIRLASH/Session A.md'],
    },
  ],
  verdict: 'gap',
  explanation:
    'Session A uses the right `topic` key with a wrong course-property name (`class`) and is ' +
    "still extracted correctly — course.ts's path fallback recovers KIRLASH with no `course` " +
    'key at all. Session B uses the right `course` key with a wrong topic-property name ' +
    '(`subject`) and vanishes entirely: extract.ts only ever reads the literal key `topic` ' +
    '(extract.ts:118), so a note that names its own topic under any other key contributes ' +
    'nothing, and there is no alias table to catch it.',
};

// ---------------------------------------------------------------------------
// Shape 3: no card-index / Zettelkasten folder anywhere.
// ---------------------------------------------------------------------------
//
// Ordinary `topic`/`course` frontmatter, ordinary course folder — the only
// thing missing is `05 Zettelkasten` itself, not one note inside it.

function buildNoZettelkastenVault(): VaultSource {
  return vaultOf({
    '01 Courses/DUMBRAL/Overview.md': [
      '---',
      'topic: Brissel',
      'course: DUMBRAL',
      '---',
      '',
      '# Overview',
      '',
      'Three main stages for Brissel.',
      '',
    ].join('\n'),
    '01 Courses/DUMBRAL/Detail.md': [
      '---',
      'topic: Trevoke',
      '---',
      '',
      '# Detail',
      '',
      'Compare Trevoke and Brissel.',
      '',
    ].join('\n'),
  });
}

const NO_ZETTELKASTEN_GROUND_TRUTH: FixtureVaultGroundTruth = {
  shape: 'no-zettelkasten',
  expectedConcepts: [
    {
      name: 'Brissel',
      tier: 2,
      courses: ['DUMBRAL'],
      sourcePaths: ['01 Courses/DUMBRAL/Overview.md'],
    },
    {
      name: 'Trevoke',
      tier: 2,
      courses: ['DUMBRAL'],
      sourcePaths: ['01 Courses/DUMBRAL/Detail.md'],
    },
  ],
  verdict: 'convention-independent',
  explanation:
    'A missing 05 Zettelkasten folder is read correctly: vault.list() on an absent subtree ' +
    'returns empty rather than throwing, so tier-1 binding is simply never offered and tier-2 ' +
    'extraction — including the path-fallback course on Detail.md, which carries no `course` ' +
    'key — proceeds exactly as it would with the folder present. No option was needed.',
};

// ---------------------------------------------------------------------------
// Shape 4: organised by week rather than by topic/course.
// ---------------------------------------------------------------------------
//
// No `01 Courses` folder anywhere — top-level `Week 1/`, `Week 2/` folders
// instead, with `course` carried entirely by frontmatter. A Zettelkasten
// folder is present so this shape also proves tier-1 binding survives a
// totally different folder skeleton, not just tier-2.

function buildWeekOrganisedVault(): VaultSource {
  return vaultOf({
    'Week 1/Opening.md': [
      '---',
      'topic: Fenrask',
      'course: PELWICK',
      '---',
      '',
      '# Opening',
      '',
      'Three main stages for Fenrask.',
      '',
    ].join('\n'),
    'Week 2/Follow-up.md': [
      '---',
      'topic: [Fenrask, Moldyne]',
      'course: PELWICK',
      '---',
      '',
      '# Follow-up',
      '',
      'Compare Fenrask and Moldyne.',
      '',
    ].join('\n'),
    '05 Zettelkasten/Fenrask.md': ['# Fenrask', '', 'A concept note.', ''].join('\n'),
  });
}

const WEEK_ORGANISED_GROUND_TRUTH: FixtureVaultGroundTruth = {
  shape: 'week-organised',
  expectedConcepts: [
    {
      name: 'Fenrask',
      tier: 1,
      courses: ['PELWICK'],
      sourcePaths: ['Week 1/Opening.md', 'Week 2/Follow-up.md'],
      boundNotePath: '05 Zettelkasten/Fenrask.md',
    },
    {
      name: 'Moldyne',
      tier: 2,
      courses: ['PELWICK'],
      sourcePaths: ['Week 2/Follow-up.md'],
    },
  ],
  verdict: 'convention-independent',
  explanation:
    'No note sits under 01 Courses anywhere in this vault — every course comes from an ' +
    'explicit `course` property, F1.3\'s "her property outranks the path" rule doing the whole ' +
    'job. Tier-1 binding for Fenrask still resolves against 05 Zettelkasten even though the ' +
    'folder skeleton around it (week-numbered, no course subfolder) has nothing else in common ' +
    'with the default-shape fixture vault. No option was needed.',
};

const GROUND_TRUTH: Readonly<Record<FixtureVaultShapeId, FixtureVaultGroundTruth>> = {
  'no-frontmatter': NO_FRONTMATTER_GROUND_TRUTH,
  'renamed-properties': RENAMED_PROPERTIES_GROUND_TRUTH,
  'no-zettelkasten': NO_ZETTELKASTEN_GROUND_TRUTH,
  'week-organised': WEEK_ORGANISED_GROUND_TRUTH,
};

const BUILDERS: Readonly<Record<FixtureVaultShapeId, () => VaultSource>> = {
  'no-frontmatter': buildNoFrontmatterVault,
  'renamed-properties': buildRenamedPropertiesVault,
  'no-zettelkasten': buildNoZettelkastenVault,
  'week-organised': buildWeekOrganisedVault,
};

/** A fresh in-memory `VaultSource` for the given shape. Deterministic — the same static content every call. */
export function buildFixtureVault(shape: FixtureVaultShapeId): VaultSource {
  return BUILDERS[shape]();
}

/** The oracle for `shape`: what `extractConcepts(vault)` — no options — is expected to return today, and why. */
export function fixtureVaultGroundTruth(shape: FixtureVaultShapeId): FixtureVaultGroundTruth {
  return GROUND_TRUTH[shape];
}
