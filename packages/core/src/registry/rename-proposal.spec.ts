import { describe, expect, it } from 'vitest';
import { EMPTY_REGISTRY_OVERRIDES } from './overrides.js';
import {
  acceptRenameProposal,
  declineSignature,
  gateRenameCandidate,
  outranksCurrent,
  type RenameProposalMemory,
  recordDeclinedRenameProposal,
} from './rename-proposal.js';
import type { RenameProposal } from './types.js';

const LOCATION = { sourcePath: 'course/Her note.md' };

describe('outranksCurrent', () => {
  it('tier 1 outranks tier 2 and tier 3', () => {
    expect(outranksCurrent(1, 2)).toBe(true);
    expect(outranksCurrent(1, 3)).toBe(true);
  });

  it('tier 2 outranks tier 3 but not tier 1', () => {
    expect(outranksCurrent(2, 3)).toBe(true);
    expect(outranksCurrent(2, 1)).toBe(false);
  });

  it('an equal tier never outranks itself', () => {
    expect(outranksCurrent(2, 2)).toBe(false);
  });
});

describe('gateRenameCandidate', () => {
  it('first sight (no prior memory) proposes nothing and establishes the baseline', () => {
    const result = gateRenameCandidate(
      {
        key: 'k1',
        displayName: 'Igneous rock',
        originalName: 'Igneous rock',
        tier: 3,
        sourceLocation: LOCATION,
      },
      undefined,
      new Set(),
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Igneous rock');
    expect(result.memory).toEqual({ tier: 3, displayName: 'Igneous rock' });
  });

  it('an unchanged tier and wording proposes nothing', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Igneous rock' };
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Igneous rock', originalName: 'Igneous rock', tier: 3 },
      memory,
      new Set(),
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Igneous rock');
  });

  it('a higher tier proposing the SAME wording already showing is not a rename and proposes nothing', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Igneous rock' };
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Igneous rock', originalName: 'Igneous rock', tier: 1 },
      memory,
      new Set(),
    );
    expect(result.renameProposal).toBeNull();
  });

  it('a LOWER-ranked candidate never proposes over a higher-ranked current name', () => {
    const memory: RenameProposalMemory = { tier: 1, displayName: 'Her wording' };
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her wording', originalName: 'Slide-deck wording', tier: 3 },
      memory,
      new Set(),
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Her wording');
  });

  it('a genuine higher-ranked, differently-worded candidate raises a proposal and freezes the display name', () => {
    // `displayName === originalName` because no manual override is active —
    // this is what `./build.ts`'s `resolvedDisplayName` actually returns
    // for this concept this read; the freeze is this function's OUTPUT, not
    // something the caller ever feeds back in as `displayName`.
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Slide-deck wording' };
    const result = gateRenameCandidate(
      {
        key: 'k1',
        displayName: 'Her own wording',
        originalName: 'Her own wording',
        tier: 1,
        sourceLocation: LOCATION,
      },
      memory,
      new Set(),
    );
    expect(result.displayName).toBe('Slide-deck wording');
    expect(result.renameProposal).toEqual({
      key: 'k1',
      currentDisplayName: 'Slide-deck wording',
      currentTier: 3,
      candidate: { tier: 1, wording: 'Her own wording', sourceLocation: LOCATION },
    });
    // memory stays frozen at the OLD state so the same proposal re-derives next read
    expect(result.memory).toEqual({ tier: 3, displayName: 'Slide-deck wording' });
  });

  it('an active manual override suppresses every candidate, regardless of tier', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Slide-deck wording' };
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her chosen wording', originalName: 'Her own wording', tier: 1 },
      memory,
      new Set(),
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Her chosen wording');
  });

  it('a declined (tier, wording) pair does not re-fire, but keeps the freeze', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Slide-deck wording' };
    const declined = new Set([declineSignature({ tier: 1, wording: 'Her own wording' })]);
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her own wording', originalName: 'Her own wording', tier: 1 },
      memory,
      declined,
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Slide-deck wording');
    expect(result.memory).toEqual(memory);
  });

  it('a DIFFERENT candidate (different wording) still fires after an earlier one was declined', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Slide-deck wording' };
    const declined = new Set([declineSignature({ tier: 1, wording: 'A different wording' })]);
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her own wording', originalName: 'Her own wording', tier: 1 },
      memory,
      declined,
    );
    expect(result.renameProposal).not.toBeNull();
  });

  it('is honest about an absent source location rather than fabricating one', () => {
    const memory: RenameProposalMemory = { tier: 3, displayName: 'Slide-deck wording' };
    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her own wording', originalName: 'Her own wording', tier: 1 },
      memory,
      new Set(),
    );
    expect(result.renameProposal?.candidate.sourceLocation).toBeUndefined();
  });
});

describe('acceptRenameProposal', () => {
  it('demotes the frozen wording to an alias and adopts the candidate as the new display name', () => {
    const proposal: RenameProposal = {
      key: 'k1',
      currentDisplayName: 'Slide-deck wording',
      currentTier: 3,
      candidate: { tier: 1, wording: 'Her own wording' },
    };
    const next = acceptRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    expect(next.renames.k1).toEqual({
      displayName: 'Her own wording',
      aliases: ['Slide-deck wording'],
    });
  });

  it('accepting is a real rename even though the candidate wording already equals the raw extraction name', () => {
    // Guards the exact bug this function's doc calls out: passing the raw
    // extraction name (rather than the frozen `currentDisplayName`) as
    // `renameConcept`'s `originalName` would make it see "already current"
    // and no-op, silently dropping the alias.
    const proposal: RenameProposal = {
      key: 'k1',
      currentDisplayName: 'Old wording',
      currentTier: 2,
      candidate: { tier: 1, wording: 'New wording' },
    };
    const next = acceptRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    expect(next).not.toBe(EMPTY_REGISTRY_OVERRIDES);
    expect(next.renames.k1?.displayName).toBe('New wording');
    expect(next.renames.k1?.aliases).toContain('Old wording');
  });
});

describe('recordDeclinedRenameProposal', () => {
  const proposal: RenameProposal = {
    key: 'k1',
    currentDisplayName: 'Old wording',
    currentTier: 3,
    candidate: { tier: 1, wording: 'New wording' },
  };

  it('adds the signature', () => {
    const next = recordDeclinedRenameProposal(new Set(), proposal);
    expect(next.has(declineSignature(proposal.candidate))).toBe(true);
  });

  it('declining the same proposal twice returns the same reference', () => {
    const once = recordDeclinedRenameProposal(new Set(), proposal);
    const twice = recordDeclinedRenameProposal(once, proposal);
    expect(twice).toBe(once);
  });
});
