import { describe, expect, it } from 'vitest';
import { supportLevelReviewFields } from './record.js';

describe('supportLevelReviewFields', () => {
  it('carries exactly the shown level', () => {
    expect(supportLevelReviewFields('guided')).toEqual({ supportLevelShown: 'guided' });
  });

  it('has no other field — structurally, there is nowhere for a self-rating to travel through this shape', () => {
    const fields = supportLevelReviewFields('prompted');
    expect(Object.keys(fields)).toEqual(['supportLevelShown']);
  });
});
