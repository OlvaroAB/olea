import { describe, expect, it } from 'vitest';
import { applySelfAssessment } from './self-assessment.js';

describe('applySelfAssessment', () => {
  it("'unsure' raises the offered level by one tier", () => {
    expect(applySelfAssessment('independent', 'unsure')).toBe('prompted');
    expect(applySelfAssessment('prompted', 'unsure')).toBe('guided');
  });

  it("'unsure' caps at 'guided'", () => {
    expect(applySelfAssessment('guided', 'unsure')).toBe('guided');
  });

  it("'confident' never lowers the offered level — F2.20: recession is evidence-only", () => {
    expect(applySelfAssessment('guided', 'confident')).toBe('guided');
    expect(applySelfAssessment('prompted', 'confident')).toBe('prompted');
    expect(applySelfAssessment('independent', 'confident')).toBe('independent');
  });

  it('null (no self-assessment given) leaves the computed level untouched', () => {
    expect(applySelfAssessment('prompted', null)).toBe('prompted');
  });
});
