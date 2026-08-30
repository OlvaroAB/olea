import { describe, expect, it } from 'vitest';
import {
  type FirstInvitationCandidate,
  pickNextExplainBackInvitation,
  TIER_ORDER,
} from './first-invitation-picker.js';

const candidates: FirstInvitationCandidate[] = [
  { id: 'a', invitationTier: 'mid' },
  { id: 'b', invitationTier: 'first' },
  { id: 'c', invitationTier: 'first' },
  { id: 'd', invitationTier: 'last' },
];

describe('pickNextExplainBackInvitation — F5.1 (ol-0r92.22)', () => {
  it('offers the earliest tier present, never a later one while an earlier one remains', () => {
    const picked = pickNextExplainBackInvitation(candidates);
    expect(picked?.invitationTier).toBe('first');
  });

  it("breaks ties within a tier by the caller's own candidate order — declared, not arbitrary", () => {
    const picked = pickNextExplainBackInvitation(candidates);
    expect(picked?.id).toBe('b'); // 'b' precedes 'c' in the input array, both 'first'
  });

  it('skips already-invited candidates, even the earliest-tier one', () => {
    const picked = pickNextExplainBackInvitation(candidates, new Set(['b']));
    expect(picked?.id).toBe('c');
  });

  it('accepts a plain array for alreadyInvitedIds, not only a Set', () => {
    const picked = pickNextExplainBackInvitation(candidates, ['b', 'c']);
    expect(picked?.id).toBe('a'); // both 'first' candidates gone; 'mid' is next
  });

  it('falls through tiers in order as each is exhausted', () => {
    const onlyMidAndLast: FirstInvitationCandidate[] = [
      { id: 'x', invitationTier: 'last' },
      { id: 'y', invitationTier: 'mid' },
    ];
    expect(pickNextExplainBackInvitation(onlyMidAndLast)?.id).toBe('y');
    expect(pickNextExplainBackInvitation(onlyMidAndLast, ['y'])?.id).toBe('x');
  });

  it('returns null once every candidate has been invited, rather than repeating one', () => {
    const allIds = candidates.map((c) => c.id);
    expect(pickNextExplainBackInvitation(candidates, allIds)).toBeNull();
  });

  it('returns null for an empty candidate list, without throwing', () => {
    expect(pickNextExplainBackInvitation([])).toBeNull();
  });

  it("TIER_ORDER states the priority explicitly, matching SEEDING.md's own tierOrder field", () => {
    expect(TIER_ORDER).toEqual(['first', 'mid', 'last']);
  });

  it('passes richer candidate shapes through unchanged (generic over T)', () => {
    interface RichCandidate extends FirstInvitationCandidate {
      readonly note: string;
    }
    const rich: RichCandidate[] = [{ id: 'r1', invitationTier: 'first', note: 'kept' }];
    const picked = pickNextExplainBackInvitation(rich);
    expect(picked?.note).toBe('kept');
  });
});
