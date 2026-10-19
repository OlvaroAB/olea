/**
 * `[D-544]` (ruled by David 2026-10-17, `ol-egov.141.89.3.52`) in F8.4a's existing identity section:
 * the same-as proposal between a course-scoped identity and the other course's identity shows both
 * names, both courses and both passages — the course-scoped side's taken from its own assessment
 * document where the wording appears, read through the extractor when that document is a PDF — and
 * is not shown when that passage cannot be read. No new command, view or button: this is the same
 * `buildSameAsIdentityProposals` the section already renders from.
 *
 * Every fixture string is invented.
 */
import type { RegistryConceptEntry, RegistrySourceLocation, SameAsLinkRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildSameAsIdentityProposals } from '../../src/registry/same-as-identity.js';
import { memoryVault } from '../review/memory-vault.js';

const WORDING = 'Tessellite';
const C_KEY = 'concept-key1:cee-tessellite';
const D_KEY = 'concept-key1:dee-tessellite';

function entry(overrides: Partial<RegistryConceptEntry>): RegistryConceptEntry {
  return {
    key: 'unset',
    displayName: WORDING,
    originalName: WORDING,
    aliases: [],
    courses: [],
    tier: 2,
    pruned: false,
    instruments: [],
    explainBack: { attempted: false, attemptCount: 0 },
    sourceLocations: [],
    mastery: {
      conceptId: 'unset',
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
        topStageQualified: false,
      },
    },
    vitality: { value: 'early', weakest: null, instrumentsRead: 0 },
    noteOffer: { eligible: false },
    ...overrides,
  };
}

const link: SameAsLinkRecord = {
  keyA: C_KEY,
  keyB: D_KEY,
  status: 'proposed',
  reason: 'normalisation-collision',
  proposedAt: '2026-10-17T00:00:00.000Z',
  schemaVersion: 1,
};

const D_NOTE = 'Zettelkasten/Tessellite.md';
const dEntry = entry({
  key: D_KEY,
  tier: 1,
  courses: ['DEE202'],
  sourceLocations: [{ sourcePath: D_NOTE }],
});

function cEntry(location: RegistrySourceLocation): RegistryConceptEntry {
  return entry({ key: C_KEY, tier: 3, courses: ['CEE101'], sourceLocations: [location] });
}

/** A text-layer PDF as an ASCII string, in the shape `olea-core`'s PDF extractor reads. */
function pdfText(pages: readonly string[]): string {
  const escapePdf = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  pages.forEach((text, i) => {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapePdf(text)}) Tj ET`;
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
      `${5 + i * 2} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  });
  return `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${4 + pages.length * 2} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
}

describe('[D-544] the course-scoped identity’s same-as proposal in F8.4a’s identity section', () => {
  it("shows both names and courses, with C's passage taken from where its own past paper names the wording", async () => {
    const paper = '03 Research/CEE101 Past Paper 2024.md';
    const vault = memoryVault({
      [paper]: [
        '---',
        'role: past-paper',
        'course: CEE101',
        '---',
        '',
        '# CEE101 Past Paper — 2024',
        '',
        '## Question 1 (10 marks)',
        '',
        `Explain ${WORDING} with an example.`,
        '',
      ].join('\n'),
      [D_NOTE]: 'An invented crystal habit, as her own concept note defines it.\n',
    });
    const [proposal] = await buildSameAsIdentityProposals(
      vault,
      [link],
      [cEntry({ sourcePath: paper, page: 1 }), dEntry],
      { canonicalKeys: { canonicalOf: (key) => key, superseded: new Map() } },
    );
    expect(proposal).toMatchObject({
      nameA: WORDING,
      nameB: WORDING,
      coursesA: ['CEE101'],
      coursesB: ['DEE202'],
      passageA: { excerpt: `Explain ${WORDING} with an example.` },
      passageB: { excerpt: 'An invented crystal habit, as her own concept note defines it.' },
    });
  });

  it("reads C's PDF past paper through the extractor at the cited page, never its raw bytes", async () => {
    const paper = '03 Research/CEE101 Past Paper 2023.pdf';
    const vault = memoryVault({
      [paper]: pdfText(['Cover page with no question.', `Question 2: describe ${WORDING}.`]),
      [D_NOTE]: 'An invented crystal habit, as her own concept note defines it.\n',
    });
    const [proposal] = await buildSameAsIdentityProposals(
      vault,
      [link],
      [cEntry({ sourcePath: paper, page: 2 }), dEntry],
      { canonicalKeys: { canonicalOf: (key) => key, superseded: new Map() } },
    );
    expect(proposal?.passageA.excerpt).toContain(WORDING);
    expect(proposal?.passageA.excerpt).not.toContain('%PDF');
  });

  it("is not shown when C's assessment document cannot be read", async () => {
    const vault = memoryVault({
      [D_NOTE]: 'An invented crystal habit, as her own concept note defines it.\n',
    });
    const proposals = await buildSameAsIdentityProposals(
      vault,
      [link],
      [cEntry({ sourcePath: '03 Research/missing paper.pdf', page: 1 }), dEntry],
      { canonicalKeys: { canonicalOf: (key) => key, superseded: new Map() } },
    );
    expect(proposals).toEqual([]);
  });
});
