/**
 * `./same-as-identity.ts` — F8.4a's concept-identity section, read/resolve/decide side
 * (`[D-257]`, TRIAGE-6, `ol-egov.141.41`).
 *
 * Every fixture string below is INVENTED per INV-3 — course codes, concept names and note text
 * are placeholders, not drawn from a real vault.
 *
 * Scenarios: `olea-service/features/F8-concepts-scope.md`, "Feature: F8.4a / `[D-257]`":
 *   - "a proposal shows the two concept names, their courses, and the supporting passages as
 *     excerpts with a way to open the note" — `buildSameAsIdentityProposals` resolves proposal.
 *   - "a proposal that cannot show its passages is not shown at all" — every drop-path test.
 */
import type { RegistryConceptEntry, RegistrySourceLocation, SameAsLinkRecord } from 'olea-core';
import { listSameAsLinkRecords, proposeSameAsLink } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildSameAsIdentityProposals,
  confirmSameAsIdentityProposal,
  declineSameAsIdentityProposal,
  IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET,
} from '../../src/registry/same-as-identity.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

function location(overrides: Partial<RegistrySourceLocation> = {}): RegistrySourceLocation {
  return { sourcePath: 'Notes/one.md', ...overrides };
}

function entry(overrides: Partial<RegistryConceptEntry> = {}): RegistryConceptEntry {
  return {
    key: 'key-a',
    displayName: 'Concept A',
    originalName: 'Concept A',
    aliases: [],
    courses: ['TESTC101'],
    tier: 2,
    pruned: false,
    instruments: [],
    explainBack: { attempted: false, attemptCount: 0 },
    sourceLocations: [location()],
    mastery: {
      conceptId: 'key-a',
      state: 'seed',
      evidence: {
        scoredEventCount: 0,
        scoredSuccessCount: 0,
        explainBackAttempts: 0,
        gradedExplainBackCount: 0,
        tiersPracticed: { recognition: false, recall: false, explanation: false },
        recognitionOnly: false,
        successfulScoredDays: 0,
        deepestSoloLevel: null,
        depthGateCleared: false,
      },
    },
    vitality: { value: 'early', weakest: null, instrumentsRead: 0 },
    noteOffer: { eligible: false },
    ...overrides,
  };
}

function proposedLink(overrides: Partial<SameAsLinkRecord> = {}): SameAsLinkRecord {
  return {
    keyA: 'key-a',
    keyB: 'key-b',
    status: 'proposed',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-18T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('buildSameAsIdentityProposals — F8.4a', () => {
  it('resolves the two names, their courses, and each side’s passage excerpt, never a score', async () => {
    const vault = memoryVault({
      'Notes/one.md':
        'A long enough introductory paragraph about the first concept, for the excerpt.\n',
      'Notes/two.md': 'A separate paragraph introducing the second concept, on its own note.\n',
    });
    const a = entry({
      key: 'key-a',
      displayName: 'Concept A',
      courses: ['TESTC101'],
      sourceLocations: [location({ sourcePath: 'Notes/one.md' })],
    });
    const b = entry({
      key: 'key-b',
      displayName: 'Concept B',
      courses: ['TESTC202'],
      sourceLocations: [location({ sourcePath: 'Notes/two.md' })],
    });

    const proposals = await buildSameAsIdentityProposals(vault, [proposedLink()], [a, b]);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal?.nameA).toBe('Concept A');
    expect(proposal?.nameB).toBe('Concept B');
    expect(proposal?.coursesA).toEqual(['TESTC101']);
    expect(proposal?.coursesB).toEqual(['TESTC202']);
    expect(proposal?.passageA.excerpt).toContain('first concept');
    expect(proposal?.passageB.excerpt).toContain('second concept');
    // Nothing here is a score — `SameAsLinkRecord.evidenceFingerprint` never travels through.
    expect(proposal).not.toHaveProperty('evidenceFingerprint');
    expect(proposal).not.toHaveProperty('confidence');
  });

  it("only resolves 'proposed' links — confirmed, declined and severed never appear here", async () => {
    const vault = memoryVault({
      'Notes/one.md': 'Text.\n',
      'Notes/two.md': 'Text.\n',
    });
    const concepts = [
      entry({ key: 'key-a' }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];

    for (const status of ['confirmed', 'declined', 'severed'] as const) {
      const proposals = await buildSameAsIdentityProposals(
        vault,
        [proposedLink({ status })],
        concepts,
      );
      expect(proposals).toHaveLength(0);
    }
  });

  it('withholds a proposal when either concept key is not in this model (cannot show its passages)', async () => {
    const vault = memoryVault({ 'Notes/one.md': 'Text.\n' });
    const proposals = await buildSameAsIdentityProposals(
      vault,
      [proposedLink()],
      [entry({ key: 'key-a' })],
    );
    expect(proposals).toHaveLength(0);
  });

  it('withholds a proposal when a concept has no source location at all', async () => {
    const vault = memoryVault({ 'Notes/one.md': 'Text.\n', 'Notes/two.md': 'Text.\n' });
    const concepts = [
      entry({ key: 'key-a', sourceLocations: [] }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];
    const proposals = await buildSameAsIdentityProposals(vault, [proposedLink()], concepts);
    expect(proposals).toHaveLength(0);
  });

  it('withholds a proposal when a concept’s note cannot be read', async () => {
    const concepts = [
      entry({ key: 'key-a', sourceLocations: [location({ sourcePath: 'Notes/missing.md' })] }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];
    const proposals = await buildSameAsIdentityProposals(
      unreadableVault() as ReturnType<typeof memoryVault>,
      [proposedLink()],
      concepts,
    );
    expect(proposals).toHaveLength(0);
  });

  it('reads the block at a recorded blockId, not the whole note', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        'An unrelated opening paragraph that must not be picked as the excerpt.',
        '',
        'The actually anchored sentence lives right here. ^myblock',
        '',
        'A trailing paragraph that also must not be picked.',
        '',
      ].join('\n'),
      'Notes/two.md': 'Other concept text.\n',
    });
    const concepts = [
      entry({
        key: 'key-a',
        sourceLocations: [location({ sourcePath: 'Notes/one.md', blockId: 'myblock' })],
      }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];
    const proposals = await buildSameAsIdentityProposals(vault, [proposedLink()], concepts);
    expect(proposals[0]?.passageA.excerpt).toContain('actually anchored sentence');
    expect(proposals[0]?.passageA.excerpt).not.toContain('unrelated opening');
    expect(proposals[0]?.passageA.excerpt).not.toContain('trailing paragraph');
  });

  it('reads the section under a recorded heading, not the whole note', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        '# Unrelated heading',
        '',
        'Text under the wrong heading, never picked.',
        '',
        '# The right heading',
        '',
        'Text under the right heading is the excerpt.',
        '',
      ].join('\n'),
      'Notes/two.md': 'Other concept text.\n',
    });
    const concepts = [
      entry({
        key: 'key-a',
        sourceLocations: [location({ sourcePath: 'Notes/one.md', heading: 'The right heading' })],
      }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];
    const proposals = await buildSameAsIdentityProposals(vault, [proposedLink()], concepts);
    expect(proposals[0]?.passageA.excerpt).toContain('right heading is the excerpt');
    expect(proposals[0]?.passageA.excerpt).not.toContain('wrong heading');
  });

  it('bounds a long passage to the declared excerpt budget, with an ellipsis', async () => {
    const longParagraph = 'x'.repeat(IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET + 50);
    const vault = memoryVault({
      'Notes/one.md': `${longParagraph}\n`,
      'Notes/two.md': 'Other concept text.\n',
    });
    const concepts = [
      entry({ key: 'key-a', sourceLocations: [location({ sourcePath: 'Notes/one.md' })] }),
      entry({ key: 'key-b', sourceLocations: [location({ sourcePath: 'Notes/two.md' })] }),
    ];
    const proposals = await buildSameAsIdentityProposals(vault, [proposedLink()], concepts);
    const excerpt = proposals[0]?.passageA.excerpt ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET + 1);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('confirmSameAsIdentityProposal / declineSameAsIdentityProposal', () => {
  it('confirm calls the core confirmSameAsLink for exactly this pair', async () => {
    const source = memoryVault();
    await proposeSameAsLink(source, 'key-a', 'key-b', { now: () => '2026-09-18' });
    const link = (await listSameAsLinkRecords(source))[0]?.record;
    if (link === undefined) throw new Error('missing same-as link record');
    const proposal = {
      keyA: link.keyA,
      keyB: link.keyB,
      nameA: 'Concept A',
      nameB: 'Concept B',
      coursesA: [],
      coursesB: [],
      passageA: { location: location(), excerpt: 'a' },
      passageB: { location: location(), excerpt: 'b' },
    };

    await confirmSameAsIdentityProposal(source, proposal);

    const after = (await listSameAsLinkRecords(source))[0]?.record;
    if (after === undefined) throw new Error('missing same-as link record');
    expect(after.status).toBe('confirmed');
  });

  it('decline calls the core declineSameAsLink for exactly this pair, recording declinedAt and keeping evidenceFingerprint', async () => {
    const source = memoryVault();
    await proposeSameAsLink(source, 'key-a', 'key-b', {
      now: () => '2026-09-18',
      evidenceFingerprint: 'fp-1',
    });
    const link = (await listSameAsLinkRecords(source))[0]?.record;
    if (link === undefined) throw new Error('missing same-as link record');
    const proposal = {
      keyA: link.keyA,
      keyB: link.keyB,
      nameA: 'Concept A',
      nameB: 'Concept B',
      coursesA: [],
      coursesB: [],
      passageA: { location: location(), excerpt: 'a' },
      passageB: { location: location(), excerpt: 'b' },
    };

    await declineSameAsIdentityProposal(source, proposal);

    const after = (await listSameAsLinkRecords(source))[0]?.record;
    if (after === undefined) throw new Error('missing same-as link record');
    expect(after.status).toBe('declined');
    expect(after.declinedAt).toBeDefined();
    // `[D-257]` ruling 3 / `ol-egov.141.33` [TRIAGE-5]: `evidenceFingerprint` survives a decline
    // unchanged, so the SAME evidence never re-proposes and only the `[D-093]` changed-evidence
    // event can — `same-as.spec.ts` proves that reopen rule for the core function this wrapper
    // is a thin caller of; this test only proves the wrapper reaches that same state.
    expect(after.evidenceFingerprint).toBe('fp-1');
  });
});
