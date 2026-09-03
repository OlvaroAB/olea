import { describe, expect, it } from 'vitest';
import { EMPTY_REGISTRY_OVERRIDES } from './overrides.js';
import {
  acceptRenameProposal,
  declinedRenameSignaturesFrom,
  declineSignature,
  gateRenameCandidate,
  outranksCurrent,
  type RenameProposalMemory,
  recordDeclinedRenameProposal,
  renameProposalMemoryFrom,
} from './rename-proposal.js';
import type { RegistryOverrides, RenameProposal } from './types.js';

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
      sourceTier: 1,
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

describe('recordDeclinedRenameProposal (`[D-206]`)', () => {
  const proposal: RenameProposal = {
    key: 'k1',
    currentDisplayName: 'Old wording',
    currentTier: 3,
    candidate: { tier: 1, wording: 'New wording' },
  };

  it('adds the signature to RegistryOverrides.declinedRenameSignatures', () => {
    const next = recordDeclinedRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    expect(next.declinedRenameSignatures).toEqual([declineSignature(proposal.candidate)]);
  });

  it('declining the same proposal twice returns the same reference', () => {
    const once = recordDeclinedRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    const twice = recordDeclinedRenameProposal(once, proposal);
    expect(twice).toBe(once);
  });

  it('a different concept declining a different candidate accumulates rather than replacing', () => {
    const other: RenameProposal = {
      key: 'k2',
      currentDisplayName: 'Another old wording',
      currentTier: 2,
      candidate: { tier: 1, wording: 'Another new wording' },
    };
    const afterFirst = recordDeclinedRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    const afterSecond = recordDeclinedRenameProposal(afterFirst, other);
    expect(afterSecond.declinedRenameSignatures).toEqual(
      expect.arrayContaining([
        declineSignature(proposal.candidate),
        declineSignature(other.candidate),
      ]),
    );
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-206] —
// the rename-proposal baseline survives a restart", tagged
// `@auto:core/registry/rename-proposal.spec`.
describe('renameProposalMemoryFrom (`[D-206]`)', () => {
  it('reconstructs the baseline from an override written by accepting a proposal', () => {
    const proposal: RenameProposal = {
      key: 'k1',
      currentDisplayName: 'Slide-deck wording',
      currentTier: 3,
      candidate: { tier: 2, wording: 'Tag wording' },
    };
    const overrides = acceptRenameProposal(EMPTY_REGISTRY_OVERRIDES, proposal);
    expect(renameProposalMemoryFrom(overrides, 'k1')).toEqual({
      tier: 2,
      displayName: 'Tag wording',
    });
  });

  it('is undefined for a concept with no override at all', () => {
    expect(renameProposalMemoryFrom(EMPTY_REGISTRY_OVERRIDES, 'k1')).toBeUndefined();
  });

  it('is undefined for a plain hand-typed rename, which carries no sourceTier', () => {
    // `acceptRenameProposal` is the only writer that supplies a tier;
    // building the override the way `overrides.ts`'s own spec does for a
    // typed rename (no fifth argument) leaves `sourceTier` absent.
    const overrides = {
      ...EMPTY_REGISTRY_OVERRIDES,
      renames: { k1: { displayName: 'Her own wording', aliases: ['Old wording'] } },
    };
    expect(renameProposalMemoryFrom(overrides, 'k1')).toBeUndefined();
  });
});

describe('declinedRenameSignaturesFrom (`[D-206]`)', () => {
  it('reads back every persisted signature as a Set', () => {
    const overrides: RegistryOverrides = {
      ...EMPTY_REGISTRY_OVERRIDES,
      declinedRenameSignatures: ['1:Tag wording', '2:Other wording'],
    };
    const result = declinedRenameSignaturesFrom(overrides);
    expect(result.has('1:Tag wording')).toBe(true);
    expect(result.has('2:Other wording')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('an overrides value with the field absent (pre-[D-206]) reads back as an empty set, not an error', () => {
    expect(declinedRenameSignaturesFrom(EMPTY_REGISTRY_OVERRIDES).size).toBe(0);
  });
});

describe('gateRenameCandidate — declined signature survives across a simulated restart (`[D-206]`)', () => {
  it('a declined proposal does not re-fire when its memory and declined set are both reconstructed from persisted overrides, not carried over in a live session Map/Set', () => {
    // Simulates the exact sequence `[D-206]`'s scenario describes: she
    // declines a proposal, Obsidian restarts (a FRESH `gateRenameCandidate`
    // call site with no session memory of its own), and the same source
    // proposes the identical wording again. Everything the gate needs this
    // time is reconstructed fresh from `RegistryOverrides` — never from a
    // `Map`/`Set` surviving the "restart".
    const declineProposal: RenameProposal = {
      key: 'k1',
      currentDisplayName: 'Slide-deck wording',
      currentTier: 3,
      candidate: { tier: 1, wording: 'Her own wording' },
    };
    const overridesAfterDecline = recordDeclinedRenameProposal(
      EMPTY_REGISTRY_OVERRIDES,
      declineProposal,
    );

    // "Restart": a brand-new read reconstructs both gate inputs purely from
    // the persisted overrides — no override exists yet (she declined, she
    // did not accept), so the baseline comes from THIS read's own
    // extraction, exactly as a genuine first sight would.
    const reconstructedMemory = renameProposalMemoryFrom(overridesAfterDecline, 'k1') ?? {
      tier: 3,
      displayName: 'Slide-deck wording',
    };
    const reconstructedDeclined = declinedRenameSignaturesFrom(overridesAfterDecline);

    const result = gateRenameCandidate(
      { key: 'k1', displayName: 'Her own wording', originalName: 'Her own wording', tier: 1 },
      reconstructedMemory,
      reconstructedDeclined,
    );
    expect(result.renameProposal).toBeNull();
    expect(result.displayName).toBe('Slide-deck wording');
  });
});
