import { describe, expect, it } from 'vitest';
import {
  isEscalationTrigger,
  lowerSupportLevel,
  raiseSupportLevel,
  SUPPORT_LEVEL_ORDER,
} from './types.js';

describe('SUPPORT_LEVEL_ORDER', () => {
  it("is exactly [D-094]'s three-tier ladder, weakest to strongest", () => {
    expect(SUPPORT_LEVEL_ORDER).toEqual(['independent', 'prompted', 'guided']);
  });
});

describe('raiseSupportLevel', () => {
  it('moves up one tier', () => {
    expect(raiseSupportLevel('independent')).toBe('prompted');
    expect(raiseSupportLevel('prompted')).toBe('guided');
  });

  it('caps at the top of the ladder', () => {
    expect(raiseSupportLevel('guided')).toBe('guided');
  });
});

describe('lowerSupportLevel', () => {
  it('moves down one tier', () => {
    expect(lowerSupportLevel('guided')).toBe('prompted');
    expect(lowerSupportLevel('prompted')).toBe('independent');
  });

  it('floors at the bottom of the ladder', () => {
    expect(lowerSupportLevel('independent')).toBe('independent');
  });
});

describe('isEscalationTrigger', () => {
  it("[D-094]'s two named failure shapes trigger escalation", () => {
    expect(isEscalationTrigger('blank')).toBe(true);
    expect(isEscalationTrigger('wrong-concept')).toBe(true);
  });

  it('a minor slip and a clean pass do not', () => {
    expect(isEscalationTrigger('minor-slip')).toBe(false);
    expect(isEscalationTrigger('none')).toBe(false);
  });
});
