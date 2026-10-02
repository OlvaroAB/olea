/**
 * Lecture-transcript attribution (D-465; knowledge model section 3.2; functional scope C3.6;
 * `ol-egov.141.89.3.42`).
 *
 * THREE SEPARATE FACTS per passage, never collapsed into one field:
 *  1. **Source authority** - an official transcript is instructor-curated course material at
 *     DOCUMENT grain, labelled or not. It does not depend on any speaker label.
 *  2. **Speaker** - `lecturer`, `student-or-question`, or `unknown-speaker`, read from EXPLICIT
 *     labels in the file only. No labels means every passage is `unknown-speaker`, and the
 *     transcript stays admissible.
 *  3. **Claim endorsement** - asserted, quoted-and-rejected, question, ambiguous. This module
 *     holds the TYPES and a carrier only. Judging endorsement from the dialogue around a claim is
 *     the model's job; nothing here infers it.
 *
 * Nothing in a transcript is a voice exemplar or evidence of belief (knowledge model 3.2): the
 * classification half of that rule lives in `./materiality.ts` (the `transcript` cue), which
 * returns `not-hers` for every transcript passage.
 *
 * The lecturer rule is PROVISIONAL: fixed on the sample (runsheet 93), provenance `inferred`.
 * Replace the rule, never the shape.
 */

export type TranscriptSpeaker = 'lecturer' | 'student-or-question' | 'unknown-speaker';

export type EndorsementType = 'asserted' | 'quoted-and-rejected' | 'question' | 'ambiguous';

/** Fact 1 - one constant, because it never varies per passage or per label. */
export const TRANSCRIPT_SOURCE_AUTHORITY = {
  kind: 'instructor-curated-course-material',
  grain: 'document',
} as const;

export type TranscriptSourceAuthority = typeof TRANSCRIPT_SOURCE_AUTHORITY;

/** How a speaker was assigned: a rule matched an explicit label ('inferred'), or no label matched ('absent'). */
export type SpeakerProvenance = 'inferred' | 'absent';

export interface SpeakerLabelRule {
  /** Provisional: fixed on the sample (runsheet 93). */
  readonly version: 'provisional-sample-1';
  /** Normalised (trimmed, lower-cased, trailing colon removed) labels that mean the lecturer. */
  readonly lecturerLabels: ReadonlySet<string>;
  /** Normalised labels that mean a student or an audience question. */
  readonly studentOrQuestionLabels: ReadonlySet<string>;
}

export const PROVISIONAL_SPEAKER_LABEL_RULE: SpeakerLabelRule = {
  version: 'provisional-sample-1',
  lecturerLabels: new Set(['lecturer', 'professor', 'prof', 'instructor', 'teacher', 'presenter']),
  studentOrQuestionLabels: new Set([
    'student',
    'question',
    'q',
    'audience',
    'attendee',
    'participant',
    'class',
  ]),
};

/** One passage as the reader hands it over: its explicit label if the file carried one. */
export interface TranscriptPassageInput {
  readonly text: string;
  /** The speaker label exactly as written in the file; absent when the file has none. */
  readonly label?: string;
}

export interface AttributedPassage {
  readonly index: number;
  readonly text: string;
  readonly speaker: TranscriptSpeaker;
  readonly speakerProvenance: SpeakerProvenance;
}

export interface TranscriptAttribution {
  readonly authority: TranscriptSourceAuthority;
  readonly passages: readonly AttributedPassage[];
  /** Always true: a transcript with no labels is usable, only every passage is `unknown-speaker`. */
  readonly usable: true;
}

function normaliseLabel(label: string): string {
  return label.trim().replace(/:$/, '').trim().toLowerCase();
}

/** Speaker for one explicit label. A label that matches no rule (a personal name, say) is `unknown-speaker`. */
export function speakerForLabel(
  label: string | undefined,
  rule: SpeakerLabelRule = PROVISIONAL_SPEAKER_LABEL_RULE,
): { readonly speaker: TranscriptSpeaker; readonly provenance: SpeakerProvenance } {
  if (label === undefined) return { speaker: 'unknown-speaker', provenance: 'absent' };
  const key = normaliseLabel(label);
  if (rule.lecturerLabels.has(key)) return { speaker: 'lecturer', provenance: 'inferred' };
  if (rule.studentOrQuestionLabels.has(key)) {
    return { speaker: 'student-or-question', provenance: 'inferred' };
  }
  return { speaker: 'unknown-speaker', provenance: 'absent' };
}

/** Facts 1 and 2 for every passage. Pure; never drops a passage. */
export function attributeTranscript(
  passages: readonly TranscriptPassageInput[],
  rule: SpeakerLabelRule = PROVISIONAL_SPEAKER_LABEL_RULE,
): TranscriptAttribution {
  return {
    authority: TRANSCRIPT_SOURCE_AUTHORITY,
    usable: true,
    passages: passages.map((p, index) => {
      const { speaker, provenance } = speakerForLabel(p.label, rule);
      return { index, text: p.text, speaker, speakerProvenance: provenance };
    }),
  };
}

/**
 * Whether a passage may serve as an EXPLANATION of the material. A lecturer's passage and an
 * unlabelled one do; a student's turn or an audience question is context, never an explanation
 * of the material (knowledge model 3.2: other speakers are unknown authorship).
 */
export function isAdmissibleExplanation(speaker: TranscriptSpeaker): boolean {
  return speaker !== 'student-or-question';
}

/** Fact 3's carrier. The type is supplied by the model's judgement; this module never sets it. */
export interface EndorsedClaim {
  readonly claim: string;
  readonly endorsement: EndorsementType;
}

export type ClaimUse = 'correct-account' | 'answer-key' | 'grading-basis' | 'ordinary-context';

/**
 * Where a claim may be used, by endorsement. Only an asserted claim is ever correct, an answer key
 * or a grading basis. An ambiguous one is not used for those and stays ordinary context; a question
 * is context only; a quoted-and-rejected claim is none of these.
 */
export function endorsementAllowsUse(endorsement: EndorsementType, use: ClaimUse): boolean {
  switch (endorsement) {
    case 'asserted':
      return true;
    case 'ambiguous':
    case 'question':
      return use === 'ordinary-context';
    case 'quoted-and-rejected':
      return false;
  }
}

export function claimsUsableFor(claims: readonly EndorsedClaim[], use: ClaimUse): EndorsedClaim[] {
  return claims.filter((c) => endorsementAllowsUse(c.endorsement, use));
}
