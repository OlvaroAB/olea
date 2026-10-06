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
  it('renders no verdict and no grading word for any verdict, deterministically', () => {
    const issues = [OMISSION, ERROR, CONFUSION];
    for (const verdict of ['correct', 'partial', 'incorrect'] as const) {
      const input = base({ verdict, citedIssues: issues, misconceptionCandidates: [CANDIDATE] });
      const text = renderExplainBackFeedback(input);
      expect(text).toBe(renderExplainBackFeedback(input));
      expect(text.toLowerCase()).not.toMatch(/correct|partly|partial|incorrect|marked|verdict/);
      // the verdict never changes the text
      expect(text).toBe(renderExplainBackFeedback({ ...input, verdict: 'correct' }));
      expect(renderExplainBackFeedback(base({ verdict }))).toBe('');
    }
  });

  it('renders each finding once, in order, labelled by kind', () => {
    const text = renderExplainBackFeedback(base({ citedIssues: [CONFUSION, OMISSION, ERROR] }));
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- Mixed up: The answer treats the pump and the tank as one part.');
    expect(lines[1]).toBe('- Missing: The answer never says why the pump needs a valve.');
    expect(lines[2]).toBe(
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
      '- A belief to check: The valve stores pressure. The passage says: The valve only directs flow.',
    );
    expect(only).not.toContain('concept-opaque');
    const both = renderExplainBackFeedback(
      base({ citedIssues: [OMISSION], misconceptionCandidates: [CANDIDATE] }),
    );
    expect(both.split('\n')).toHaveLength(2);
    expect(renderExplainBackFeedback(base({ citedIssues: [OMISSION] }))).not.toContain('belief');
  });

  it('with no findings and no candidates is an empty string', () => {
    expect(renderExplainBackFeedback(base({ verdict: 'incorrect' }))).toBe('');
  });

  it('skips a finding with no text rather than printing an empty label', () => {
    const text = renderExplainBackFeedback(
      base({
        citedIssues: [{ ...OMISSION, description: '   ' }],
        misconceptionCandidates: [{ ...CANDIDATE, statement: '', correction: '' }],
      }),
    );
    expect(text).toBe('');
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
