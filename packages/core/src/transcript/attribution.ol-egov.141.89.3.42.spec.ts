import { describe, expect, it } from 'vitest';
import { assembleVoiceExemplars } from '../generate/voice-sources.js';
import { assertBeliefBearingStatement } from '../misconception/belief-source.js';
import { classifyMateriality } from '../source/materiality.js';
import {
  attributeTranscript,
  TRANSCRIPT_SOURCE_AUTHORITY,
} from '../source/transcript-attribution.js';
import type { VaultPath } from '../vault/types.js';

const path = 'Lectures/week-3.md' as VaultPath;

describe('transcript attribution (ol-egov.141.89.3.42)', () => {
  it('speaker roles come from explicit labels, lecturer rule inferred', () => {
    const r = attributeTranscript([
      { label: 'Lecturer:', text: 'Today we cover X.' },
      { label: 'Student', text: 'Is X the same as Y?' },
    ]);
    expect(r.passages.map((p) => p.speaker)).toEqual(['lecturer', 'student-or-question']);
    expect(r.passages[0]?.speakerProvenance).toBe('inferred');
  });

  it('an unknown speaker is a valid role and the passage stays', () => {
    const r = attributeTranscript([{ label: 'Dr Invented', text: 'A sentence.' }]);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0]?.speaker).toBe('unknown-speaker');
  });

  it('missing labels never make a transcript unusable, and it is not hers', () => {
    const r = attributeTranscript([{ text: 'An unlabelled explanation of X.' }]);
    expect(r.usable).toBe(true);
    expect(r.passages.every((p) => p.speaker === 'unknown-speaker')).toBe(true);
    const c = classifyMateriality({ path, format: null, transcriptSpeaker: 'unknown-speaker' });
    expect(c.fact).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
  });

  it('authority does not depend on the speaker label', () => {
    const labelled = attributeTranscript([{ label: 'Lecturer', text: 'a' }]);
    const bare = attributeTranscript([{ text: 'a' }]);
    expect(labelled.authority).toEqual(TRANSCRIPT_SOURCE_AUTHORITY);
    expect(bare.authority).toEqual(TRANSCRIPT_SOURCE_AUTHORITY);
    expect(TRANSCRIPT_SOURCE_AUTHORITY.grain).toBe('document');
  });

  it('the transcript cue overrides a declared course-material role and the two-wikilink signature', () => {
    const text = 'See [[Concept A]] and [[Concept B]].';
    for (const speaker of ['lecturer', 'student-or-question', 'unknown-speaker'] as const) {
      const c = classifyMateriality({
        path,
        format: null,
        declaredRole: 'course-material',
        text,
        transcriptSpeaker: speaker,
      });
      expect(c.fact.authorship).not.toBe('hers');
      expect(c.provenance.source).toBe('inferred');
    }
    // Control: without the cue the declared role gives curation 'published'.
    expect(
      classifyMateriality({ path, format: null, declaredRole: 'course-material', text }).fact
        .curationAuthority,
    ).toBe('published');
    // Student or question: unknown authorship, never instructor.
    expect(
      classifyMateriality({ path, format: null, transcriptSpeaker: 'student-or-question' }).fact,
    ).toEqual({ authorship: 'unknown', curationAuthority: 'unknown' });
  });

  it('no transcript passage reaches voice exemplars or belief attribution', () => {
    for (const speaker of ['lecturer', 'student-or-question', 'unknown-speaker'] as const) {
      const fact = classifyMateriality({ path, format: null, transcriptSpeaker: speaker }).fact;
      const ex = assembleVoiceExemplars([{ text: 'x', ...fact }]);
      expect(ex.phrasing).toEqual([]);
      expect(() => assertBeliefBearingStatement(fact.authorship)).toThrow();
    }
  });
});
