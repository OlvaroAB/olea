import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { extractConcepts } from './extract.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('extractConcepts — tier 2, against the synthetic fixture vault', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('extracts one concept per distinct `topic` string across the whole vault', async () => {
    const concepts = await extractConcepts(source);
    const names = concepts.map((c) => c.name).sort();
    // The eight topic vocab terms named in fixtures/vault/README.md — four
    // per course, deliberately shared within each course, never across the
    // two courses in this fixture.
    expect(names).toEqual([
      'Cadential preparation',
      'Chromatic harmony',
      'Clastic deposition',
      'Contrapuntal doubling',
      'Diagenetic burial',
      'Harmonic progression',
      'Sediment provenance',
      'Stratigraphic succession',
    ]);
  });

  it('associates a GEOL204 concept with every note that named it, course included', async () => {
    const concepts = await extractConcepts(source);
    const diagenetic = concepts.find((c) => c.name === 'Diagenetic burial');
    expect(diagenetic).toBeDefined();
    expect(diagenetic?.courses).toEqual(['GEOL204']);
    // Named on: Grain Provenance and Clast Imbrication, Cementation and Burial
    // Diagenesis, whirlwind-recap-callouts, lab-protocol-notes.
    expect(diagenetic?.sourcePaths).toHaveLength(4);
    expect(diagenetic?.sourcePaths).toContain(
      '01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md',
    );
    expect(diagenetic?.sourcePaths).toContain('01 Courses/GEOL204/WEEK 3/lab-protocol-notes.md');
  });

  it('associates a MUSTH104 concept with every note that named it', async () => {
    const concepts = await extractConcepts(source);
    const symbolic = concepts.find((c) => c.name === 'Chromatic harmony');
    expect(symbolic).toBeDefined();
    expect(symbolic?.courses).toEqual(['MUSTH104']);
    expect(symbolic?.sourcePaths).toEqual(
      [
        '01 Courses/MUSTH104/Chorale No. 12/Phrase One - Close Listening.md',
        '01 Courses/MUSTH104/Minuet and Trio/Cadences and Suspensions.md',
      ].sort(),
    );
  });

  it('none of the fixture vault topics bind to a tier-1 Zettelkasten note (topics and zettels are deliberately different grains)', async () => {
    const concepts = await extractConcepts(source);
    expect(concepts.every((c) => c.tier === 2)).toBe(true);
    expect(concepts.every((c) => c.boundNotePath === undefined)).toBe(true);
  });

  it('a note with `topic: []` (the Lecture Note Template) contributes nothing', async () => {
    const concepts = await extractConcepts(source);
    for (const c of concepts) {
      expect(c.sourcePaths).not.toContain('04 Templates/Lecture Note Template.md');
    }
  });

  it('a note with no frontmatter at all (scratch-thoughts) is skipped, not an error', async () => {
    await expect(extractConcepts(source)).resolves.toBeDefined();
  });

  it('is deterministic across repeated calls (stable sort order)', async () => {
    const first = await extractConcepts(source);
    const second = await extractConcepts(source);
    expect(second).toEqual(first);
  });
});

describe('extractConcepts — tier 3, on (F4.1, P5-T02)', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('defaults to off — omitting the option behaves like `includeTier3: false`', async () => {
    const withoutFlag = await extractConcepts(source);
    const withFlagOff = await extractConcepts(source, { includeTier3: false });
    expect(withFlagOff).toEqual(withoutFlag);
  });

  it('with tier 3 off, a Zettelkasten concept never named by any `topic` property does not exist at all', async () => {
    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Imbrication')).toBeUndefined();
    expect(concepts.find((c) => c.name === 'Hummocky stratification')).toBeUndefined();
    expect(concepts.find((c) => c.name === 'Bioturbation')).toBeUndefined();
    expect(concepts.find((c) => c.name === 'Paraconformity')).toBeUndefined();
  });

  it('with tier 3 on, that same concept is minted at tier 3, bound to its note', async () => {
    const concepts = await extractConcepts(source, { includeTier3: true });

    expect(concepts.find((c) => c.name === 'Imbrication')).toEqual({
      name: 'Imbrication',
      tier: 3,
      courses: ['GEOL204'],
      sourcePaths: ['05 Zettelkasten/Imbrication.md'],
      boundNotePath: '05 Zettelkasten/Imbrication.md',
    });

    const pump = concepts.find((c) => c.name === 'Hummocky stratification');
    expect(pump?.tier).toBe(3);
    expect(pump?.boundNotePath).toBe('05 Zettelkasten/Hummocky stratification.md');
    expect(pump?.courses).toEqual(['GEOL204']);

    // Named only in the 2023 past paper's Question 3 — a single-question
    // tier-3 concept is still real evidence, not filtered out for being small.
    const threshold = concepts.find((c) => c.name === 'Bioturbation');
    expect(threshold?.tier).toBe(3);
    const paraconformity = concepts.find((c) => c.name === 'Paraconformity');
    expect(paraconformity?.tier).toBe(3);

    // Exactly these four are new — no other Zettelkasten note (the MUSTH104
    // ones, or GEOL204's Cementation/Ripple lamination) is mentioned
    // verbatim anywhere in the fixture's past papers, objectives, or
    // generated content, so no other tier-3 record is minted.
    const tier3Names = concepts
      .filter((c) => c.tier === 3)
      .map((c) => c.name)
      .sort();
    expect(tier3Names).toEqual([
      'Bioturbation',
      'Hummocky stratification',
      'Imbrication',
      'Paraconformity',
    ]);
  });

  it('turning tier 3 on never changes an existing tier-1/2 record', async () => {
    const withoutTier3 = await extractConcepts(source);
    const withTier3 = await extractConcepts(source, { includeTier3: true });
    for (const record of withoutTier3) {
      expect(withTier3).toContainEqual(record);
    }
  });

  // Explicit timeout, and worth saying why rather than leaving a bare number.
  // This is the only test that runs the whole tier-3 sweep TWICE, so it pays
  // the fixture vault's I/O cost twice over. That cost is real: a full
  // recursive listing of the 50-file fixture measures ~350ms on this
  // container's bind-mounted filesystem, and vitest runs suites in parallel,
  // so the two ~540ms calls contend with every other file-reading suite and
  // can drift past the 5s default. The work itself is ~1.1s measured in
  // isolation. Raised deliberately instead of silently, because a test that
  // sits just under the default is one that goes red on someone else's slower
  // machine and gets re-run until green — see DF-17 for how that habit starts.
  it('is deterministic across repeated calls with tier 3 on', async () => {
    const first = await extractConcepts(source, { includeTier3: true });
    const second = await extractConcepts(source, { includeTier3: true });
    expect(second).toEqual(first);
  }, 20_000);
});

// The frozen fixture vault's topic vocabulary never repeats across courses
// and never differs only by case (fixtures/vault/README.md, P0-T07) — by
// design, so the golden suite stays a clean regression target. R1/R2 and
// cross-course M:N are real requirements regardless, so they're proved here
// against a small synthetic vault built for exactly this purpose, the same
// pattern vault/folder-source.spec.ts already uses for temp-directory cases.
describe('extractConcepts — R1/R2 verbatim names, tier-1 binding, and M:N course association (synthetic)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-extract-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('two topics differing only by case are two distinct records, not deduplicated', async () => {
    await write(
      '01 Courses/COURSEA/Note One.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Note One\n',
    );
    await write(
      '01 Courses/COURSEA/Note Two.md',
      '---\ntopic: [basalt weathering]\ncourse: COURSEA\n---\n\n# Note Two\n',
    );

    const concepts = await extractConcepts(source);
    const names = concepts.map((c) => c.name).sort();
    expect(names).toEqual(['Basalt weathering', 'basalt weathering']);
    // Each stayed a one-note concept — no cross-case merging happened.
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.sourcePaths).toEqual([
      '01 Courses/COURSEA/Note One.md',
    ]);
  });

  it('binds tier 1 when a topic matches a Zettelkasten note title exactly', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nDefinition text, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const wm = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(wm).toBeDefined();
    expect(wm?.tier).toBe(1);
    expect(wm?.boundNotePath).toBe('05 Zettelkasten/Quartz cleavage.md');
  });

  it('binding is exact-match only — a near-miss title stays tier 2, unbound', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [quartz Cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const wm = concepts.find((c) => c.name === 'quartz Cleavage');
    expect(wm).toBeDefined();
    expect(wm?.tier).toBe(2);
    expect(wm?.boundNotePath).toBeUndefined();
  });

  it('course association is M:N — one concept spans two courses, one course has several concepts', async () => {
    await write(
      '01 Courses/COURSEA/Note A.md',
      '---\ntopic: [Shared concept, Only in A]\ncourse: COURSEA\n---\n\n# A\n',
    );
    await write(
      '01 Courses/COURSEB/Note B.md',
      '---\ntopic: [Shared concept]\ncourse: COURSEB\n---\n\n# B\n',
    );

    const concepts = await extractConcepts(source);
    const shared = concepts.find((c) => c.name === 'Shared concept');
    expect(shared?.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(shared?.sourcePaths).toEqual(
      ['01 Courses/COURSEA/Note A.md', '01 Courses/COURSEB/Note B.md'].sort(),
    );

    const onlyInA = concepts.find((c) => c.name === 'Only in A');
    expect(onlyInA?.courses).toEqual(['COURSEA']);

    // COURSEA carries two concepts (Shared concept, Only in A) — the M side.
    const courseAConcepts = concepts.filter((c) => c.courses.includes('COURSEA'));
    expect(courseAConcepts.map((c) => c.name).sort()).toEqual(['Only in A', 'Shared concept']);
  });

  it('a note whose `course` is a flow list contributes every course it names', async () => {
    await write(
      '01 Courses/Shared/Cross-listed lecture.md',
      '---\ntopic: [Cross-listed topic]\ncourse: [COURSEA, COURSEB]\n---\n\n# Cross-listed\n',
    );

    const concepts = await extractConcepts(source);
    const crossListed = concepts.find((c) => c.name === 'Cross-listed topic');
    expect(crossListed?.courses).toEqual(['COURSEA', 'COURSEB']);
  });

  // ol-aq2p. Her live `topic` convention is a wikilink at the Zettelkasten
  // note, a shape the frozen fixture vault does not carry (its topics are all
  // bare strings — which is exactly why no test caught this). Dereferencing
  // the link was decided on evidence measured against a real-world vault: it
  // is what lets a topic bind at tier 1 at all under that convention, and every
  // one of those binds a byte-identical title match. The census itself is
  // private — see `olea-service/findings/G1-concept-review.md` §(f).
  it('binds tier 1 when a topic is a wikilink at a Zettelkasten note', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nDefinition text, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    // The concept's name is the link target, not the bracketed source text:
    // the target is the note title byte-for-byte, which is what R1/R2 means
    // by her name for it.
    expect(concepts.map((c) => c.name)).toEqual(['Quartz cleavage']);
    expect(concepts[0]?.tier).toBe(1);
    expect(concepts[0]?.boundNotePath).toBe('05 Zettelkasten/Quartz cleavage.md');
  });

  it('binds a block-list of wikilink topics, and a wikilink naming no note stays tier 2 under its target name', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic:\n  - [[Quartz cleavage]]\n  - [[Note she has not written]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.map((c) => c.name)).toEqual(['Note she has not written', 'Quartz cleavage']);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')?.tier).toBe(1);
    // An unresolved link is a note she has not written yet, not a matching
    // failure — it stays tier 2 and nothing is invented for it.
    const unwritten = concepts.find((c) => c.name === 'Note she has not written');
    expect(unwritten?.tier).toBe(2);
    expect(unwritten?.boundNotePath).toBeUndefined();
  });

  it('dereferencing is exact — a wikilink differing from a title by case or spacing does not bind', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/Case.md',
      '---\ntopic: [[quartz Cleavage]]\ncourse: COURSEA\n---\n\n# Case\n',
    );
    await write(
      '01 Courses/COURSEA/Space.md',
      '---\ntopic: [[Quartz  cleavage]]\ncourse: COURSEA\n---\n\n# Space\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.every((c) => c.tier === 2)).toBe(true);
    expect(concepts.every((c) => c.boundNotePath === undefined)).toBe(true);
  });

  it('a topic property mixing both conventions loses neither topic', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic:\n  - [[Quartz cleavage]]\n  - Basalt weathering\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.map((c) => c.name)).toEqual(['Basalt weathering', 'Quartz cleavage']);
    expect(concepts.every((c) => c.tier === 1)).toBe(true);
  });

  it('a topic that only mentions a wikilink keeps its own text and does not bind', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: see [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.map((c) => c.name)).toEqual(['see [[Quartz cleavage]]']);
    expect(concepts[0]?.tier).toBe(2);
  });

  // ol-lzwe. Calibrating against a real-world vault turned up Zettelkasten
  // titles carried by more than one note, so this case is live rather than
  // hypothetical. The counts are private — see
  // `olea-service/findings/G1-concept-review.md`.
  it('a title carried by two notes is recorded as ambiguous and not bound, whichever order the vault lists', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '05 Zettelkasten/Outcrop Sketches/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Q\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const quartz = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(quartz?.tier).toBe(2);
    expect(quartz?.boundNotePath).toBeUndefined();
    expect(quartz?.ambiguousNotePaths).toEqual([
      '05 Zettelkasten/Outcrop Sketches/Quartz cleavage.md',
      '05 Zettelkasten/Quartz cleavage.md',
    ]);
  });

  it('the ambiguous result does not depend on the order vault.list returns the notes', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '05 Zettelkasten/Outcrop Sketches/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Q\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const forward = await extractConcepts(source);
    // Same vault, same reads, but the Zettelkasten arrives in the opposite
    // order — the previous binder returned a different `boundNotePath` here.
    const reversed = await extractConcepts(
      new Proxy(source, {
        get(target, prop, receiver) {
          if (prop !== 'list') return Reflect.get(target, prop, receiver);
          return async (options?: Parameters<FolderSource['list']>[0]) =>
            [...(await target.list(options))].reverse();
        },
      }),
    );
    expect(reversed).toEqual(forward);
  });

  it('a concept with no duplicate title carries no ambiguity field at all', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts[0]).not.toHaveProperty('ambiguousNotePaths');
  });

  it('respects a custom zettelkastenFolder option', async () => {
    await write('Concepts/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Quartz cleavage\n');
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const withDefault = await extractConcepts(source);
    expect(withDefault.find((c) => c.name === 'Quartz cleavage')?.tier).toBe(2);

    const withCustom = await extractConcepts(source, { zettelkastenFolder: 'Concepts' });
    expect(withCustom.find((c) => c.name === 'Quartz cleavage')?.tier).toBe(1);
    expect(withCustom.find((c) => c.name === 'Quartz cleavage')?.boundNotePath).toBe(
      'Concepts/Quartz cleavage.md',
    );
  });
});

// D-031 (`ol-4ekt`), superseded by `ol-t3sd`. A note may name several `topic:`
// values, and an instrument parsed out of it is evidence for **every** one of
// them. D-031 could not deliver that — the review-log record persisted one
// `conceptId` — so it settled for binding to her first value and recording, on
// each concept that lost the note's instruments, that it had lost them
// (`ConceptRecord.ambiguousTopicPaths`). v3 of the record carries a list, the
// ruling on `ol-t3sd` made the many-to-many reading the real one, and both the
// narrowing and the diagnostic are gone.
//
// This block is the evidence for the new rule, and for the absence of the old
// field. The absence is asserted explicitly rather than left to the type system:
// `ConceptRecord` has optional fields, so a re-introduction would type-check
// everywhere and only these assertions would notice.
describe('extractConcepts — a multi-valued `topic:` contributes to every concept it names', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-multitopic-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('records the note on every co-listed concept, on equal footing', async () => {
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Concept One, Concept Two, Concept Three]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const first = concepts.find((c) => c.name === 'Concept One');
    const second = concepts.find((c) => c.name === 'Concept Two');
    const third = concepts.find((c) => c.name === 'Concept Three');

    // All three name the note as a source — that was true before too.
    for (const record of [first, second, third]) {
      expect(record?.sourcePaths).toEqual(['01 Courses/COURSEA/Lecture.md']);
    }
    // What changed: none of them is marked as having lost anything, because
    // none of them did. Her position in the list no longer decides which
    // concept receives the note's instruments — all of them do.
    for (const record of [first, second, third]) {
      expect(record).not.toHaveProperty('ambiguousTopicPaths');
    }
  });

  it('records are otherwise indistinguishable — position in her list confers nothing', async () => {
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Concept One, Concept Two]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const [first, second] = ['Concept One', 'Concept Two'].map((name) =>
      concepts.find((c) => c.name === name),
    );
    // Same tier, same courses, same sources. If a later change reintroduced a
    // primary/secondary distinction, it would have to show up in one of these.
    expect({ ...first, name: '' }).toEqual({ ...second, name: '' });
  });

  it('a single-valued `topic:` is the same shape as a co-listed one', async () => {
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Concept One]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).not.toHaveProperty('ambiguousTopicPaths');
    expect(concepts[0]?.sourcePaths).toEqual(['01 Courses/COURSEA/Lecture.md']);
  });

  it('membership is symmetric across notes — listing order in either note changes nothing', async () => {
    // The predecessor of this test asserted the *asymmetry* her authoring order
    // produced: a concept listed second in one note recorded that note as a
    // loss. Both notes now contribute to both concepts, in both directions.
    await write(
      '01 Courses/COURSEA/Alpha first.md',
      '---\ntopic: [Concept One, Concept Two]\ncourse: COURSEA\n---\n\n# A\n',
    );
    await write(
      '01 Courses/COURSEA/Beta first.md',
      '---\ntopic: [Concept Two, Concept One]\ncourse: COURSEA\n---\n\n# B\n',
    );

    const concepts = await extractConcepts(source);
    const both = ['01 Courses/COURSEA/Alpha first.md', '01 Courses/COURSEA/Beta first.md'];
    expect(concepts.find((c) => c.name === 'Concept One')?.sourcePaths).toEqual(both);
    expect(concepts.find((c) => c.name === 'Concept Two')?.sourcePaths).toEqual(both);
    for (const record of concepts) expect(record).not.toHaveProperty('ambiguousTopicPaths');
  });

  it('a repeated value is one membership, not two', async () => {
    // `[A, B, A]`. `sourcePaths` is a set, so A names the note once; the
    // repetition is her restating a value, not a second, subordinate listing.
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Concept One, Concept Two, Concept One]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.map((c) => c.name)).toEqual(['Concept One', 'Concept Two']);
    for (const record of concepts) {
      expect(record.sourcePaths).toEqual(['01 Courses/COURSEA/Lecture.md']);
      expect(record).not.toHaveProperty('ambiguousTopicPaths');
    }
  });

  it('the recorded paths are sorted and do not depend on the order vault.list returns the notes', async () => {
    await write(
      '01 Courses/COURSEA/Second note.md',
      '---\ntopic: [Concept One, Concept Two]\ncourse: COURSEA\n---\n\n# S\n',
    );
    await write(
      '01 Courses/COURSEA/First note.md',
      '---\ntopic: [Concept One, Concept Two]\ncourse: COURSEA\n---\n\n# F\n',
    );

    const forward = await extractConcepts(source);
    expect(forward.find((c) => c.name === 'Concept Two')?.sourcePaths).toEqual([
      '01 Courses/COURSEA/First note.md',
      '01 Courses/COURSEA/Second note.md',
    ]);

    const reversed = await extractConcepts(
      new Proxy(source, {
        get(target, prop, receiver) {
          if (prop !== 'list') return Reflect.get(target, prop, receiver);
          return async (options?: Parameters<FolderSource['list']>[0]) =>
            [...(await target.list(options))].reverse();
        },
      }),
    );
    expect(reversed).toEqual(forward);
  });
});

// ol-jbnu / F1.3. Course association derives from FOLDER STRUCTURE — "map
// course folders to courses, tolerating inconsistent structures" — and the
// frontmatter key is an override, not the only path. The frozen fixture vault
// carries `course:` on every note that carries `topic:`, which is why no test
// caught the omission: the two agreed everywhere it looked. The measurement
// that found it is private (`olea-service/findings/G1-concept-review.md`
// §(c)), so the shapes are reproduced synthetically here.
describe('extractConcepts — course association derives from folder structure (F1.3, ol-jbnu)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-course-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('a topic-tagged note with NO `course` key still gets its course, from the folder it lives in', async () => {
    await write(
      '01 Courses/COURSEA/WEEK 2/Lecture.md',
      '---\ntopic: [Basalt weathering]\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.courses).toEqual(['COURSEA']);
  });

  it('tolerates inconsistent structures — a week-numbered course and a name-organised one derive the same way', async () => {
    await write(
      '01 Courses/COURSEA/WEEK 2/Lecture.md',
      '---\ntopic: [Shared concept]\n---\n\n# Weeks\n',
    );
    await write(
      '01 Courses/COURSEB/Some Set Text/Reading.md',
      '---\ntopic: [Shared concept]\n---\n\n# Texts\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Shared concept')?.courses).toEqual([
      'COURSEA',
      'COURSEB',
    ]);
  });

  it('the frontmatter key is an OVERRIDE — her convention outranks the folder when the two disagree', async () => {
    await write(
      '01 Courses/COURSEA/WEEK 2/Lecture.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEB\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.courses).toEqual(['COURSEB']);
  });

  it('nothing is guessed outside the course folder — a topic-tagged note elsewhere has no course at all', async () => {
    await write('03 Research/Loose note.md', '---\ntopic: [Basalt weathering]\n---\n\n# Loose\n');

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.courses).toEqual([]);
  });

  it('a note sitting loose directly in the course folder has no course — a file is not a course code', async () => {
    await write('01 Courses/Loose note.md', '---\ntopic: [Basalt weathering]\n---\n\n# Loose\n');

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.courses).toEqual([]);
  });

  it('honours a non-default `coursesFolder`', async () => {
    await write(
      'Papers/COURSEA/WEEK 1/Lecture.md',
      '---\ntopic: [Basalt weathering]\n---\n\n# L\n',
    );

    const concepts = await extractConcepts(source, { coursesFolder: 'Papers' });
    expect(concepts.find((c) => c.name === 'Basalt weathering')?.courses).toEqual(['COURSEA']);
  });
});
