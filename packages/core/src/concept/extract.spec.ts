import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { extractConcepts, noteDefinition } from './extract.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('extractConcepts — tier 2, against the synthetic fixture vault', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('extracts one concept per distinct `topic` string, plus one per Zettelkasten title a course-folder note wikilinks (F1.3 widened, `ol-2zfj.33`)', async () => {
    const concepts = await extractConcepts(source);
    const names = concepts.map((c) => c.name).sort();
    // The eight topic vocab terms named in fixtures/vault/README.md — four
    // per course, deliberately shared within each course, never across the
    // two courses in this fixture — PLUS the nine of the fixture's twelve
    // Zettelkasten titles that some course-folder note's body plainly
    // wikilinks (`./course.js`'s `courseFromPath`, applied per note). The
    // remaining three (Consecutive fifths, Deceptive cadence — cited only
    // from `03 Research`, outside the course folders — and Tierce picarde,
    // cited nowhere at all) are exactly the ones the tier-3 describe block
    // below still finds absent.
    expect(names).toEqual([
      'Appoggiatura',
      'Bioturbation',
      'Cadential anacrusis',
      'Cementation',
      'Chromatic harmony',
      'Clastic deposition',
      'Climbing lamination',
      'Contrapuntal doubling',
      'Diagenetic burial',
      'Harmonic sequence',
      'Hummocky stratification',
      'Imbrication',
      'Paraconformity',
      'Plagal cadence',
      'Sediment provenance',
      'Stratigraphic succession',
      'Suspension',
    ]);
  });

  it('associates a GEOL204 concept with every note that named it, course included', async () => {
    const concepts = await extractConcepts(source);
    const diagenetic = concepts.find((c) => c.name === 'Diagenetic burial');
    expect(diagenetic).toBeDefined();
    expect(diagenetic?.courses).toEqual(['GEOL204']);
    // Named on: Clast Provenance and Imbrication, Cementation and Burial
    // Diagenesis, whirlwind-recap-callouts, lab-protocol-notes.
    expect(diagenetic?.sourcePaths).toHaveLength(4);
    expect(diagenetic?.sourcePaths).toContain(
      '01 Courses/GEOL204/WEEK 1/Lecture - Clast Provenance and Imbrication.md',
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
        '01 Courses/MUSTH104/Chorale No. 12/Phrase One - Aural Study.md',
        '01 Courses/MUSTH104/Minuet and Trio/Cadences and Suspensions.md',
      ].sort(),
    );
  });

  it('none of the fixture vault `topic` strings collide with a Zettelkasten title — topics and zettels are deliberately different grains, so every `topic`-only name stays tier 2, unbound', async () => {
    const concepts = await extractConcepts(source);
    const topicOnlyNames = [
      'Cadential anacrusis',
      'Chromatic harmony',
      'Clastic deposition',
      'Contrapuntal doubling',
      'Diagenetic burial',
      'Harmonic sequence',
      'Sediment provenance',
      'Stratigraphic succession',
    ];
    for (const name of topicOnlyNames) {
      const c = concepts.find((x) => x.name === name);
      expect(c?.tier).toBe(2);
      expect(c?.boundNotePath).toBeUndefined();
    }
  });

  it('every course-reference-derived name binds at tier 1, to the exact Zettelkasten note a course-folder note wikilinked (F1.3 widened, `ol-2zfj.33`)', async () => {
    const concepts = await extractConcepts(source);
    const referencedTitles = [
      'Appoggiatura',
      'Bioturbation',
      'Cementation',
      'Hummocky stratification',
      'Imbrication',
      'Paraconformity',
      'Plagal cadence',
      'Climbing lamination',
      'Suspension',
    ];
    for (const title of referencedTitles) {
      const c = concepts.find((x) => x.name === title);
      expect(c?.tier).toBe(1);
      expect(c?.boundNotePath).toBe(`05 Zettelkasten/${title}.md`);
    }
  });

  it('a note with `topic: []` (the Lecture Note Template) contributes nothing', async () => {
    const concepts = await extractConcepts(source);
    for (const c of concepts) {
      expect(c.sourcePaths).not.toContain('04 Templates/Lecture Note Template.md');
    }
  });

  it('a note with no frontmatter at all (scratch-thoughts) no longer skips entirely — its body still counts as a course-reference (F1.3 widened, `ol-2zfj.33`)', async () => {
    await expect(extractConcepts(source)).resolves.toBeDefined();
    // scratch-thoughts.md carries no frontmatter at all, but it sits under
    // `01 Courses/GEOL204/` and its body wikilinks `[[Paraconformity]]` — so
    // it now names a course the same way a `topic:`-tagged note would, even
    // though it has never had a `topic:` property to read.
    const concepts = await extractConcepts(source);
    const paraconformity = concepts.find((c) => c.name === 'Paraconformity');
    expect(paraconformity?.sourcePaths).toContain('01 Courses/GEOL204/WEEK 3/scratch-thoughts.md');
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

  // `ol-2zfj.33` (F1.3 widened) changed what this section can show against
  // THIS fixture. Imbrication, Hummocky stratification, Bioturbation and
  // Paraconformity used to be reachable ONLY through tier-3 evidence (a
  // past-paper or generated-content citation, with no `topic:` anywhere) —
  // that was the whole point of the section below. They are now ALSO reached
  // by the widened course-reference rule (a course-folder note's own body
  // wikilinks each of them, see the describe block above), and that rule
  // runs regardless of `includeTier3`. Since `./extract.js`'s tier-3 minting
  // loop only mints a name **absent** from `byName` ("enrichment only" —
  // see its own comment), a name the reference rule already placed in
  // `byName` is never re-minted at tier 3, even with the flag on: tier 1
  // (the more precise, exact-title-linked source) wins by construction,
  // never by a tie-break this module has to make. Verified against a real
  // run of both variants: with `includeTier3` on or off, this fixture
  // produces the exact same 17 records — tier 3 contributes nothing new
  // here any more. What tier 3 still *can* mint — a concept reached by
  // neither `topic:` nor a course-folder reference — is proved on an
  // isolated synthetic vault below, where the fixture's coincidental overlap
  // can't hide the mechanism.
  it('with tier 3 off, a concept named by neither `topic:` nor a course-folder reference does not exist at all', async () => {
    const concepts = await extractConcepts(source);
    // Consecutive fifths and Deceptive cadence are cited only from
    // `03 Research`, outside the course folders the reference rule reads;
    // Tierce picarde is cited nowhere in this fixture at all.
    expect(concepts.find((c) => c.name === 'Consecutive fifths')).toBeUndefined();
    expect(concepts.find((c) => c.name === 'Deceptive cadence')).toBeUndefined();
    expect(concepts.find((c) => c.name === 'Tierce picarde')).toBeUndefined();
  });

  it('turning tier 3 on adds nothing on this fixture any more — the widened reference rule already covers every name tier 3 used to mint here', async () => {
    const withoutTier3 = await extractConcepts(source);
    const withTier3 = await extractConcepts(source, { includeTier3: true });
    expect(withTier3).toEqual(withoutTier3);
    expect(withTier3.some((c) => c.tier === 3)).toBe(false);
  });

  it('a concept reached by neither `topic:` nor a course-folder reference is still minted at tier 3 from a past-paper citation, isolated on a synthetic vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olea-concept-tier3-isolated-'));
    try {
      const isolated = new FolderSource(root);
      async function write(relPath: string, content: string): Promise<void> {
        const full = join(root, ...relPath.split('/'));
        await mkdir(join(full, '..'), { recursive: true });
        await writeFile(full, content, 'utf8');
      }

      await write(
        '05 Zettelkasten/Quartz cleavage.md',
        '---\ntype: concept\n---\n\n# Quartz cleavage\n\nHer definition.\n',
      );
      // Named in a past paper's question text, verbatim — not a wikilink,
      // not a `topic:` — the one path tier 3 still owns.
      await write(
        '03 Research/COURSEA Past Paper 2024.md',
        '---\nrole: past-paper\ncourse: COURSEA\nyear: 2024\n---\n\n' +
          '# COURSEA Past Paper — 2024\n\n## Question 1 (10 marks)\n\n' +
          'Explain the mechanism behind Quartz cleavage in a metamorphic setting.\n',
      );
      // A course-folder note that names and links nothing at all, so the
      // widened reference rule (and `topic:`) genuinely find no path here.
      await write(
        '01 Courses/COURSEA/WEEK 1/Lecture.md',
        '---\ncourse: COURSEA\n---\n\n# Lecture\n\nNothing here names or links the concept.\n',
      );

      const withoutTier3 = await extractConcepts(isolated);
      expect(withoutTier3.find((c) => c.name === 'Quartz cleavage')).toBeUndefined();

      const withTier3 = await extractConcepts(isolated, { includeTier3: true });
      const mint = withTier3.find((c) => c.name === 'Quartz cleavage');
      expect(mint?.tier).toBe(3);
      expect(mint?.boundNotePath).toBe('05 Zettelkasten/Quartz cleavage.md');
      expect(mint?.courses).toEqual(['COURSEA']);
      // `[DF-13]`: a tier-3 mint binds by the same exact-title match as
      // tier 1, so it carries a definition too.
      expect(mint?.definition).toBe('Her definition.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
    // `[DF-13]`: her definition rides along with the binding, verbatim.
    expect(wm?.definition).toBe('Definition text, hers.');
  });

  it('a topic-tagged note with no bind carries no `definition` field at all (`[DF-13]`)', async () => {
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts[0]).not.toHaveProperty('definition');
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
    // `[DF-13]`: the wikilink path binds via the same `resolveTitle` as the
    // bare-string path, so definition capture is identical either way.
    expect(concepts[0]?.definition).toBe('Definition text, hers.');
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

// `[DF-13]`. Tier-1 binding recorded `boundNotePath` but not her definition,
// even though knowledge model §3 says a bound concept note is canonical
// because it "adopts her name, her definition, and binds to that note." This
// block is the positive case the bead needed: none of the frozen fixture
// vault's topics bind at tier 1 by design (see the `describe` above, and
// `fixtures/vault/README.md`), so every case here is synthetic, the same
// pattern the R1/R2 describe block above already uses for tier-1 binding
// itself.
describe('extractConcepts — definition capture at bind time (`[DF-13]`)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-definition-'));
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

  it('a multi-paragraph definition is captured whole, verbatim markup included', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\n' +
        'A plane of weakness in [[Basalt weathering|the crystal lattice]].\n\n' +
        'It postdates formation and predates any later fracture.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const wm = concepts.find((c) => c.name === 'Quartz cleavage');
    // Both paragraphs, the wikilink untouched, no rendering or stripping.
    expect(wm?.definition).toBe(
      'A plane of weakness in [[Basalt weathering|the crystal lattice]].\n\n' +
        'It postdates formation and predates any later fracture.',
    );
  });

  it('a sub-heading is not folded into the definition — only the content before it', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\n' +
        'The defining prose.\n\n## Worked example\n\nNot part of the definition.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const wm = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(wm?.definition).toBe('The defining prose.');
  });

  it('a note with no heading at all uses its whole body as the definition', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\nJust prose, no heading.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')?.definition).toBe(
      'Just prose, no heading.',
    );
  });

  it('a note whose only heading does not match the bound title still yields that heading’s content', async () => {
    // Her heading text need not be byte-identical to the filename she used —
    // binding already matches on the FILENAME, not the heading, so a single
    // heading is still unambiguously "the" concept note.
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Cleavage in quartz\n\nThe defining prose.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')?.definition).toBe(
      'The defining prose.',
    );
  });

  it('a note with an empty body (frontmatter and heading only) has no definition', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')).not.toHaveProperty('definition');
  });

  it('an ambiguous (duplicate-title) bind has no definition — there is no single note to read it from', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nFirst copy.\n',
    );
    await write(
      '05 Zettelkasten/Outcrop Sketches/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nSecond copy.\n',
    );
    await write(
      '01 Courses/COURSEA/Lecture.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Lecture\n',
    );

    const concepts = await extractConcepts(source);
    const quartz = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(quartz?.tier).toBe(2);
    expect(quartz).not.toHaveProperty('definition');
  });

  // `noteDefinition` itself, exercised directly rather than only through
  // `extractConcepts` — the unit the previous cases integrate.
  describe('noteDefinition', () => {
    it('returns undefined for several headings, none matching the title', () => {
      const content = '# Alpha\n\nOne.\n\n# Beta\n\nTwo.\n';
      expect(noteDefinition(content, 'Gamma')).toBeUndefined();
    });

    it('falls back to the sole heading when there is exactly one, even if its text differs from the title', () => {
      const content = '# Alpha\n\nOnly section.\n';
      expect(noteDefinition(content, 'Something else entirely')).toBe('Only section.');
    });

    it('returns undefined for a fully empty body', () => {
      const content = '---\ntype: concept\n---\n';
      expect(noteDefinition(content, 'Anything')).toBeUndefined();
    });
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
    // `key` is neutralised too: with no bound note, it derives from `name`
    // (`./concept-key.js`), so "Concept One" and "Concept Two" legitimately
    // mint different keys — that difference is `key` doing its job, not a
    // primary/secondary distinction this test is checking for.
    expect({ ...first, name: '', key: '' }).toEqual({ ...second, name: '', key: '' });
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

// F1.3 widened (`ol-2zfj.33`), layered on top of the `topic:` rule above,
// never replacing it. `findings/embedding-proximity-threshold.md` Part II
// §12 (`olea-service`) measured production's `topic:`-only course
// association against a reference-based rule — a concept note acquires the
// course of any note under the course folder that plainly wikilinks it — on
// a real vault: 29 of 131 concept notes against 115. This describe block
// proves the mechanism synthetically, the same pattern the R1/R2 block above
// uses for tier-1 binding: real vault findings are cited by path, never by
// content, so what is asserted here is coined.
describe('extractConcepts — course-reference course attribution (F1.3 widened, `ol-2zfj.33`)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-reference-'));
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

  it('a course-folder note that merely wikilinks a Zettelkasten note attributes its course, with no `topic:` anywhere', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nHer definition.\n',
    );
    await write(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ncourse: COURSEA\n---\n\n# Lecture\n\nSee [[Quartz cleavage]] for the mechanism.\n',
    );

    const concepts = await extractConcepts(source);
    const quartz = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(quartz).toBeDefined();
    expect(quartz?.tier).toBe(1);
    expect(quartz?.boundNotePath).toBe('05 Zettelkasten/Quartz cleavage.md');
    expect(quartz?.courses).toEqual(['COURSEA']);
    expect(quartz?.sourcePaths).toEqual(['01 Courses/COURSEA/WEEK 1/Lecture.md']);
    // `[DF-13]` rides along, same as any other tier-1 bind.
    expect(quartz?.definition).toBe('Her definition.');
  });

  it('a concept note linked from two different courses carries the union — the bridging case the corpus-relation `shareACourse` check already handles', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ncourse: COURSEA\n---\n\n# A\n\nCompare [[Quartz cleavage]].\n',
    );
    await write(
      '01 Courses/COURSEB/WEEK 1/Lecture.md',
      '---\ncourse: COURSEB\n---\n\n# B\n\nAlso see [[Quartz cleavage]] here.\n',
    );

    const concepts = await extractConcepts(source);
    const quartz = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(quartz?.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(quartz?.sourcePaths).toEqual(
      ['01 Courses/COURSEA/WEEK 1/Lecture.md', '01 Courses/COURSEB/WEEK 1/Lecture.md'].sort(),
    );
  });

  it('a `topic:` citation and a separate course-folder reference merge into ONE record, courses unioned — neither source is preferred over the other', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# A\n',
    );
    await write(
      '01 Courses/COURSEB/WEEK 1/Lecture.md',
      '---\ncourse: COURSEB\n---\n\n# B\n\nSee [[Quartz cleavage]].\n',
    );

    const concepts = await extractConcepts(source);
    const matches = concepts.filter((c) => c.name === 'Quartz cleavage');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(matches[0]?.tier).toBe(1);
    expect(matches[0]?.sourcePaths).toEqual(
      ['01 Courses/COURSEA/WEEK 1/Lecture.md', '01 Courses/COURSEB/WEEK 1/Lecture.md'].sort(),
    );
  });

  it('a pipe alias or a heading anchor on the link still resolves to the plain title', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/WEEK 1/Alias.md',
      '---\ncourse: COURSEA\n---\n\n# Alias\n\nSee [[Quartz cleavage|the mineral property]].\n',
    );
    await write(
      '01 Courses/COURSEA/WEEK 2/Anchor.md',
      '---\ncourse: COURSEA\n---\n\n# Anchor\n\nSee [[Quartz cleavage#Detail]].\n',
    );

    const concepts = await extractConcepts(source);
    const quartz = concepts.find((c) => c.name === 'Quartz cleavage');
    expect(quartz?.courses).toEqual(['COURSEA']);
    expect(quartz?.sourcePaths).toEqual(
      ['01 Courses/COURSEA/WEEK 1/Alias.md', '01 Courses/COURSEA/WEEK 2/Anchor.md'].sort(),
    );
  });

  it('a wikilink that does not land on an actual Zettelkasten note mints nothing — the same precision `topic:` already has', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ncourse: COURSEA\n---\n\n# Lecture\n\nSee [[Some Other Course Note]] for background.\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts).toEqual([]);
  });

  it('a Zettelkasten note cross-linking another Zettelkasten note attributes no course — only a note under the COURSE folder counts', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\n---\n\n# Quartz cleavage\n\nSee [[Basalt weathering]].\n',
    );
    await write('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Basalt weathering')).toBeUndefined();
  });

  it('a research-folder note wikilinking a concept note attributes no course — `03 Research` sits outside the course folders (F7.9-adjacent, out of scope here)', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '03 Research/Some Paper.md',
      '---\nrole: past-paper\n---\n\n# Some Paper\n\nCites [[Quartz cleavage]].\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')).toBeUndefined();
  });

  it('a note loose directly in the course folder root wikilinking a concept attributes no course — a file is not a course code (F1.3)', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write('01 Courses/Loose note.md', '# Loose\n\nSee [[Quartz cleavage]] in passing.\n');

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')).toBeUndefined();
  });

  it('a course-folder note carrying an explicit two-course `course:` property attributes both, not just its folder', async () => {
    await write('05 Zettelkasten/Quartz cleavage.md', '---\ntype: concept\n---\n\n# Q\n');
    await write(
      '01 Courses/COURSEA/WEEK 1/Cross-listed.md',
      '---\ncourse: [COURSEA, COURSEB]\n---\n\n# Cross-listed\n\nSee [[Quartz cleavage]].\n',
    );

    const concepts = await extractConcepts(source);
    expect(concepts.find((c) => c.name === 'Quartz cleavage')?.courses).toEqual([
      'COURSEA',
      'COURSEB',
    ]);
  });
});
