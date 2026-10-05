/**
 * `classifyMateriality` / `resolveMateriality` tests (`ol-2zfj.36`,
 * `[D-101]`) — one test per scenario in `features/F1-sources.md`'s
 * "Two source-materiality facts, assigned structure-first" cluster
 * (`@auto:core/source/materiality.spec`), in the same order they appear
 * there.
 */
import { describe, expect, it } from 'vitest';
import * as materiality from './materiality.js';
import {
  classifyMateriality,
  expireCorrectionIfMaterial,
  type MaterialityCorrection,
  type MaterialityCues,
  resolveMateriality,
  UNKNOWN_MATERIALITY,
} from './materiality.js';

describe('classifyMateriality — [D-101] (features/F1-sources.md)', () => {
  it('a PDF slide deck classifies from structure alone, with no prose read', () => {
    let textAccessed = false;
    const cues: MaterialityCues = {
      path: '01 Courses/COURSE101/WEEK 2/Lecture Slides/deck.pdf',
      format: 'pdf',
      get text() {
        textAccessed = true;
        return 'irrelevant if this is ever read';
      },
    };

    const result = classifyMateriality(cues);

    expect(result.fact).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
    expect(textAccessed).toBe(false);
  });

  it('the folder prior informs and is never load-bearing', () => {
    const nestedInSlidesSubfolder = classifyMateriality({
      path: '01 Courses/COURSE101/WEEK 2/Lecture Slides/transcript.md',
      format: null,
    });
    const sameFileFlat = classifyMateriality({
      path: '01 Courses/COURSE101/WEEK 2/transcript.md',
      format: null,
    });

    expect(nestedInSlidesSubfolder.fact).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'instructor',
    });
    // No kind-named folder segment and no other structural cue: an honest
    // `unknown`, not an error and not something requiring her to file it —
    // UNKNOWN_MATERIALITY is itself a complete, valid classification.
    expect(sameFileFlat).toEqual(UNKNOWN_MATERIALITY);
  });

  it('her filing bends the prior, never the reverse: links never conclude hers (D-490)', () => {
    // Was: two wikilinks overrode a not-hers folder prior to hers. Now links describe
    // organisation, not who wrote the prose, so the not-hers folder prior stands.
    const result = classifyMateriality({
      path: '01 Courses/COURSE101/WEEK 2/Lecture Slides/my-reflection.md',
      format: null,
      text: 'My own synthesis of [[Concept A]] connects to [[Concept B]] in a way the deck never showed.',
    });

    expect(result.fact).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
    expect('hasHersLinkStructure' in materiality).toBe(false);
  });

  it('the folder prior never concludes hers: her own folders give curation hers, authorship unknown (D-490)', () => {
    for (const path of [
      '01 Courses/ISLD130/Zettelkasten/Anything.md',
      '01 Courses/ISLD130/Lecture 1 - Skerries/Any note.md',
      '02 Assignments/essay.md',
      '05 Zettelkasten/daily notes/today.md',
    ]) {
      const { fact } = classifyMateriality({ path, format: null });
      expect(fact.authorship).not.toBe('hers');
    }
    expect(
      classifyMateriality({ path: '01 Courses/ISLD130/Zettelkasten/Anything.md', format: null })
        .fact,
    ).toEqual({ authorship: 'unknown', curationAuthority: 'hers' });
  });

  describe('her made-by declaration (D-490, knowledge model 3.2)', () => {
    const base = { format: null } as const;

    it('me reads hers, declared, at full confidence, outranking the folder prior', () => {
      const result = classifyMateriality({
        ...base,
        path: '01 Courses/ISLD130/Notes/Mooring Basics.md',
        declaredMadeBy: 'me',
      });
      expect(result.fact).toEqual({ authorship: 'hers', curationAuthority: 'unknown' });
      expect(result.provenance).toEqual({ source: 'declared', confidence: 1 });
      const inLectureFolder = classifyMateriality({
        ...base,
        path: '01 Courses/ISLD130/Lecture 1 - Skerries/x.md',
        declaredMadeBy: 'me',
      });
      expect(inLectureFolder.fact.authorship).toBe('hers');
    });

    it('assistant reads not-hers with curation unknown, declared; an edit never makes it hers', () => {
      const result = classifyMateriality({
        ...base,
        path: '01 Courses/ISLD130/Notes/Tideline Drift Digest.md',
        declaredMadeBy: 'assistant',
        text: 'Last Tuesday I watched the line move. I am going to ask in the next session.',
      });
      expect(result.fact).toEqual({ authorship: 'not-hers', curationAuthority: 'unknown' });
      expect(result.provenance.source).toBe('declared');
    });

    it('mixed reads nothing as hers in v0.9', () => {
      const result = classifyMateriality({
        ...base,
        path: '05 Zettelkasten/x.md',
        declaredMadeBy: 'mixed',
      });
      expect(result.fact).toEqual({ authorship: 'unknown', curationAuthority: 'unknown' });
      expect(result.provenance.source).toBe('declared');
    });

    it('an invalid value is ignored, so the note reads as undeclared', () => {
      for (const raw of ['', 'Me?', 'human', 42, undefined, null, ['me']]) {
        expect(materiality.parseMadeBy(raw)).toBeUndefined();
      }
      expect(materiality.parseMadeBy('  ME ')).toBe('me');
      expect(materiality.parseMadeBy('Assistant')).toBe('assistant');
    });

    it('a transcript, a slide export and a declared role still outrank made-by', () => {
      expect(
        classifyMateriality({
          ...base,
          path: 'a.md',
          declaredMadeBy: 'me',
          transcriptSpeaker: 'unknown-speaker',
        }).fact.authorship,
      ).toBe('not-hers');
      expect(
        classifyMateriality({ path: 'a.pdf', format: 'pdf', declaredMadeBy: 'me' }).fact.authorship,
      ).toBe('not-hers');
      expect(
        classifyMateriality({
          ...base,
          path: 'a.md',
          declaredMadeBy: 'me',
          declaredRole: 'course-material',
        }).fact.authorship,
      ).toBe('not-hers');
    });
  });

  it('stylometry may demote to unknown, never promote to hers', () => {
    // Structurally presumed hers (the Zettelkasten folder prior), but its
    // prose carries heavy citation markers — demotes to unknown.
    const divergentStyle = classifyMateriality({
      path: '05 Zettelkasten/borrowed-note.md',
      format: null,
      text: 'As argued by Smith (2020) and Jones (2019); see also DOI: 10.1234/abcd.5678.',
    });
    expect(divergentStyle.fact.authorship).toBe('unknown');

    // Prose reads like her own voice, but structural cues are absent — no
    // folder cue, no declared role. Never promoted to hers on style alone.
    const styleMatchesNoStructure = classifyMateriality({
      path: '01 Courses/COURSE101/WEEK 2/loose-note.md',
      format: null,
      text: 'I think the effect holds because of X, which reminds me of what we covered.',
    });
    expect(styleMatchesNoStructure.fact.authorship).not.toBe('hers');
  });

  it('pasted third-party prose lands as unknown, not as hers', () => {
    const result = classifyMateriality({
      path: '01 Courses/COURSE101/WEEK 2/pasted.md',
      format: null,
      text: "Another student's raw notes pasted verbatim, no linking, no synthesis.",
    });

    expect(result.fact.authorship).not.toBe('hers');
  });

  it('every assignment carries its own provenance, and correction outranks all', () => {
    const inferred = classifyMateriality({ path: '05 Zettelkasten/note.md', format: null });
    expect(inferred.provenance.source).toBe('inferred');

    const declared = classifyMateriality({
      path: '05 Zettelkasten/note.md',
      format: null,
      declaredRole: 'course-material',
    });
    expect(declared.provenance.source).toBe('declared');

    const correction: MaterialityCorrection = {
      fact: { authorship: 'hers', curationAuthority: 'unknown' },
      anchorContentHash: 'hash-1',
    };
    const corrected = resolveMateriality(
      { path: '05 Zettelkasten/note.md', format: null, declaredRole: 'course-material' },
      correction,
    );
    expect(corrected.provenance.source).toBe('corrected');
    expect(corrected.fact).toEqual(correction.fact);
  });

  it('passage grain exists only where a document signals mixture', () => {
    const documentFact = classifyMateriality({
      path: '05 Zettelkasten/mixed-note.md',
      format: null,
    });
    expect(documentFact.fact.authorship).toBe('unknown');

    const plainChunk = classifyMateriality({
      path: '05 Zettelkasten/mixed-note.md',
      format: null,
      text: 'My own argument connecting [[Concept A]] and [[Concept B]].',
    });
    const embeddedFragmentChunk = classifyMateriality({
      path: '05 Zettelkasten/mixed-note.md',
      format: null,
      text: '![[deck.pdf#page=3]] Slide 3 summarised the mechanism.',
    });

    expect(plainChunk.fact).toEqual({ authorship: 'unknown', curationAuthority: 'hers' });
    expect(embeddedFragmentChunk.fact).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'instructor',
    });
  });

  it('a correction expires with the text it judged, on the same materiality threshold', () => {
    const correction: MaterialityCorrection = {
      fact: { authorship: 'not-hers', curationAuthority: 'peer' },
      anchorContentHash: 'hash-of-pasted-paragraph',
    };

    expect(expireCorrectionIfMaterial(correction, true)).toBeUndefined();
    expect(expireCorrectionIfMaterial(correction, false)).toEqual(correction);
  });

  it('source kind never resolves a disagreement on substance — exports no authority-ranking function', () => {
    const exportNames = Object.keys(materiality);
    const forbidden = exportNames.filter((name) =>
      /rank|weight|priorit|resolve.*disagree|winner/i.test(name),
    );
    expect(forbidden).toEqual([]);
  });
});
