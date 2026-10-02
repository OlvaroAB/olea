// `[D-446]` option (a), the draft-time half (`ol-egov.141.89.2.29`). What this file has to prove:
//
//   1. the fragment is optional: an item without it parses exactly as it always did;
//   2. a malformed value never fails the item (it reads as absent), so a citation never costs one;
//   3. the reader voids the whole citation on any defect, and on any position the caller did not send;
//   4. the task pair is the same pair the demand fragment names.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AUTHORING_CITATION_TASK_IDS,
  authoringGroundedIn,
  authoringGroundedInField,
  readAuthoringGroundedIn,
} from './authoring-citation.js';
import { AUTHORING_DEMAND_TASK_IDS } from './authoring-demand.js';
import { TASK_IDS } from './tasks.js';

const item = z.object({ stem: z.string(), groundedIn: authoringGroundedInField });

describe('authoringGroundedIn', () => {
  it('names 0-based positions, at least one', () => {
    expect(authoringGroundedIn.safeParse([0]).success).toBe(true);
    expect(authoringGroundedIn.safeParse([2, 0]).success).toBe(true);
    expect(authoringGroundedIn.safeParse([]).success).toBe(false);
    expect(authoringGroundedIn.safeParse([-1]).success).toBe(false);
    expect(authoringGroundedIn.safeParse([1.5]).success).toBe(false);
    expect(authoringGroundedIn.safeParse(['1']).success).toBe(false);
  });
});

describe('authoringGroundedInField on an item', () => {
  it('absent parses to an item without the key, exactly as before the fragment', () => {
    const parsed = item.parse({ stem: 's' });
    expect(parsed).toEqual({ stem: 's' });
    expect('groundedIn' in parsed).toBe(false);
    expect(JSON.stringify(parsed)).toBe('{"stem":"s"}');
  });

  it('a well-formed value is kept', () => {
    expect(item.parse({ stem: 's', groundedIn: [1] })).toEqual({ stem: 's', groundedIn: [1] });
  });

  it('a malformed value reads as absent and never fails the item', () => {
    for (const bad of [[], [-1], [0.5], ['0'], 'x', 3, null, {}]) {
      const parsed = item.safeParse({ stem: 's', groundedIn: bad });
      expect(parsed.success, JSON.stringify(bad)).toBe(true);
      expect(parsed.success && parsed.data.groundedIn).toBeUndefined();
    }
  });
});

describe('readAuthoringGroundedIn', () => {
  it('returns the positions when every one names a chunk the caller sent', () => {
    expect(readAuthoringGroundedIn([0], 1)).toEqual([0]);
    expect(readAuthoringGroundedIn([2, 0], 3)).toEqual([2, 0]);
  });

  it('voids the whole citation when any position is out of range, rather than keeping the rest', () => {
    expect(readAuthoringGroundedIn([0, 3], 3)).toBeUndefined();
    expect(readAuthoringGroundedIn([0], 0)).toBeUndefined();
  });

  it('reads absent, empty and malformed values as no citation', () => {
    for (const bad of [undefined, null, [], [-1], [1.5], ['1'], '1', {}]) {
      expect(readAuthoringGroundedIn(bad, 8), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('the task pair', () => {
  it('is the authoring pair, and both are registered task ids', () => {
    expect([...AUTHORING_CITATION_TASK_IDS]).toEqual([...AUTHORING_DEMAND_TASK_IDS]);
    expect(AUTHORING_CITATION_TASK_IDS).toContain(TASK_IDS.QUIZ_GENERATE);
    expect(AUTHORING_CITATION_TASK_IDS).toContain(TASK_IDS.CARDS_GENERATE);
  });
});
