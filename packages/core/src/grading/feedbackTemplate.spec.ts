import { describe, expect, it } from 'vitest';
import { type FeedbackTemplateInput, renderExplainBackFeedback } from './feedbackTemplate.js';
import type { CitedIssue, MisconceptionCandidate } from './gradingPipeline.js';

// Synthetic, invented material — never real vault content (INV-3).
const OMISSION: CitedIssue = {
  kind: 'omission',
  description: 'The answer never says why the pump needs a valve',
  sourceBlockIds: ['b1'],
};
const ERROR: CitedIssue = {
  kind: 'error',
  description: 'The answer says the valve opens inward.',
  sourceBlockIds: ['b2'],
  answerSpans: ['the valve opens inward'],
};
const CONFUSION: CitedIssue = {
  kind: 'confusion',
  description: 'The answer treats the pump and the tank as one part',
  sourceBlockIds: ['b3'],
};
const CANDIDATE: MisconceptionCandidate = {
  concept: 'concept-opaque-id-77',
  confusedWith: 'concept-opaque-id-88',
  statement: 'The valve stores pressure',
  correction: 'The valve only directs flow',
  correctionSourceBlockIds: ['b2'],
};

const base = (over: Partial<FeedbackTemplateInput> = {}): FeedbackTemplateInput => ({
  verdict: 'partial',
  citedIssues: [],
  misconceptionCandidates: [],
  ...over,
});

describe('renderExplainBackFeedback', () => {
  it('names exactly its own verdict, deterministically', () => {
    const texts = {
      correct: renderExplainBackFeedback(base({ verdict: 'correct' })),
      partial: renderExplainBackFeedback(base({ verdict: 'partial' })),
      incorrect: renderExplainBackFeedback(base({ verdict: 'incorrect' })),
    };
    expect(texts.correct).toBe('This explanation was marked correct.');
    expect(texts.partial).toBe('This explanation was marked partly correct.');
    expect(texts.incorrect).toBe('This explanation was marked incorrect.');
    expect(renderExplainBackFeedback(base({ verdict: 'correct' }))).toBe(texts.correct);
    // the three verdict lines are distinct and none is a substring-confusion of another
    expect(texts.partial).not.toContain('marked correct');
    expect(texts.partial).not.toContain('marked incorrect');
    expect(texts.correct).not.toContain('partly');
  });

  it('renders each finding once, in order, labelled by kind', () => {
    const text = renderExplainBackFeedback(base({ citedIssues: [CONFUSION, OMISSION, ERROR] }));
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('- Mixed up: The answer treats the pump and the tank as one part.');
    expect(lines[2]).toBe('- Missing: The answer never says why the pump needs a valve.');
    expect(lines[3]).toBe(
      '- Mistaken: The answer says the valve opens inward. You wrote: "the valve opens inward".',
    );
    for (const d of [CONFUSION, OMISSION].map((i) => i.description)) {
      expect(text.split(d).length - 1).toBe(1);
    }
  });

  it('quotes her words only where a finding carries them', () => {
    const text = renderExplainBackFeedback(base({ citedIssues: [OMISSION, ERROR] }));
    expect(text.match(/You wrote:/g)).toHaveLength(1);
    expect(renderExplainBackFeedback(base({ citedIssues: [OMISSION] }))).not.toContain('You wrote');
    const empty = renderExplainBackFeedback(
      base({ citedIssues: [{ ...ERROR, answerSpans: ['  ', ''] }] }),
    );
    expect(empty).not.toContain('You wrote');
  });

  it('renders a candidate with or without findings, never its ids', () => {
    const only = renderExplainBackFeedback(base({ misconceptionCandidates: [CANDIDATE] }));
    expect(only).toBe(
      'This explanation was marked partly correct.\n- A belief to check: The valve stores pressure. The passage says: The valve only directs flow.',
    );
    expect(only).not.toContain('concept-opaque');
    const both = renderExplainBackFeedback(
      base({ citedIssues: [OMISSION], misconceptionCandidates: [CANDIDATE] }),
    );
    expect(both.split('\n')).toHaveLength(3);
    expect(renderExplainBackFeedback(base({ citedIssues: [OMISSION] }))).not.toContain('belief');
  });

  it('with no findings and no candidates is the verdict line alone', () => {
    expect(renderExplainBackFeedback(base({ verdict: 'incorrect' }))).toBe(
      'This explanation was marked incorrect.',
    );
  });

  it('skips a finding with no text rather than printing an empty label', () => {
    const text = renderExplainBackFeedback(
      base({
        citedIssues: [{ ...OMISSION, description: '   ' }],
        misconceptionCandidates: [{ ...CANDIDATE, statement: '', correction: '' }],
      }),
    );
    expect(text).toBe('This explanation was marked partly correct.');
  });

  it('ignores the Worker free-text feedback and adds no sentence of its own beyond the fixed ones', () => {
    const a = {
      ...base({ citedIssues: [ERROR], misconceptionCandidates: [CANDIDATE] }),
      feedback: 'Great job overall!',
    };
    const b = { ...a, feedback: 'Totally different invented claim.' };
    expect(renderExplainBackFeedback(a)).toBe(renderExplainBackFeedback(b));
    expect(renderExplainBackFeedback(a)).not.toContain('Great job');
    // strip everything a finding/candidate/fixed label carries; nothing may remain
    let rest = renderExplainBackFeedback(a);
    for (const piece of [
      'This explanation was marked partly correct.',
      'Mistaken:',
      ERROR.description,
      'You wrote:',
      '"the valve opens inward"',
      'A belief to check:',
      'The valve stores pressure.',
      'The passage says:',
      'The valve only directs flow.',
    ])
      rest = rest.replace(piece, '');
    expect(rest.replace(/[\s\-.]/g, '')).toBe('');
  });

  it('adds no forbidden or retired register word of its own', () => {
    const all = ['correct', 'partial', 'incorrect'] as const;
    const text = all
      .map((verdict) =>
        renderExplainBackFeedback(
          base({
            verdict,
            citedIssues: [
              { kind: 'omission', description: 'x', sourceBlockIds: [] },
              { kind: 'error', description: 'x', sourceBlockIds: [] },
              { kind: 'confusion', description: 'x', sourceBlockIds: [] },
            ],
            misconceptionCandidates: [{ ...CANDIDATE, statement: 'x', correction: 'x' }],
          }),
        ),
      )
      .join('\n')
      .toLowerCase();
    for (const word of [
      'yield',
      'sucker',
      'graft',
      'harvest',
      'shaky',
      'fading',
      'holds up',
      'hold up',
      'crown',
      'canopy',
      'sitting',
      'retry',
      'deferred',
      'exhausted',
      'coverage',
      'demand',
    ]) {
      expect(text).not.toContain(word);
    }
  });
});
