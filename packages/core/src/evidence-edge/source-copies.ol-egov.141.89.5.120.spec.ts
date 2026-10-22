/**
 * ol-egov.141.89.5.120 ([D-577]): byte-identical copies of a registered past paper or objectives
 * document count once in the ranking's evidence (citation count, source count, confidence and its
 * denominator, yield rank), whatever the file is called or what format it is. Every string here is
 * INVENTED (INV-3).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractTier3Evidence } from '../tier3-evidence/build.js';
import { FolderSource } from '../vault/folder-source.js';
import { buildConceptAssessmentEdges } from './build.js';

const BASE = '02 Assignments/Assignments.base';

function paper(year: string, lines: readonly string[]): string {
  return [
    '---',
    'role: past-paper',
    'course: TESTC101',
    '---',
    '',
    `# TESTC101 Past Paper ${year}`,
    '',
    ...lines.flatMap((line, i) => [`## Question ${i + 1} (10 marks)`, '', line, '']),
  ].join('\n');
}

const OBJECTIVES = [
  '---',
  'role: objectives',
  'course: TESTC101',
  '---',
  '',
  '# TESTC101 Objectives',
  '',
  '- Describe the essentials of Flux capacitor tuning.',
  '',
].join('\n');

function buildPdfBytes(pageText: string): Uint8Array {
  const escapeLiteral = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const raw = `BT /F1 12 Tf 20 150 Td (${escapeLiteral(pageText)}) Tj ET`;
  const text =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n` +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

describe('byte-identical copies of a registered source count once in the ranking evidence (ol-egov.141.89.5.120)', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string | Uint8Array): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }

  async function seed(): Promise<void> {
    await write('05 Zettelkasten/Widget theory.md', '# Widget theory\n');
    await write('05 Zettelkasten/Gadget assembly.md', '# Gadget assembly\n');
    await write('05 Zettelkasten/Sprocket alignment.md', '# Sprocket alignment\n');
    await write('05 Zettelkasten/Flux capacitor tuning.md', '# Flux capacitor tuning\n');
    await write(
      BASE,
      'filters:\n  and:\n    - file.inFolder("02 Assignments")\n    - file.ext == "md"\nproperties:\n  class:\n  type:\n',
    );
    await write('02 Assignments/Quiz 1.md', '---\nclass: TESTC101\ntype: Quiz\n---\n\n# Quiz 1\n');
    // The papers every vault below shares.
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      paper('2023', ['Explain Widget theory.', 'Describe Sprocket alignment.']),
    );
    await write(
      '03 Research/TESTC101 Past Paper 2024.md',
      paper('2024', ['Derive Gadget assembly.', 'Widget theory again, under load.']),
    );
  }

  async function edges() {
    const result = await buildConceptAssessmentEdges(source, { basePath: BASE, concepts: [] });
    return result.edges
      .filter((e) => e.assessmentPath === '02 Assignments/Quiz 1.md')
      .map((e) => ({
        concept: e.conceptName,
        basis: e.basis,
        yieldRank: e.yieldRank,
        confidence: e.confidence,
        citations: e.citations.length,
        objectives: e.objectivesCitations?.length ?? 0,
      }))
      .sort((a, b) => (a.concept + a.basis).localeCompare(b.concept + b.basis));
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-source-copies-'));
    source = new FolderSource(root);
    await seed();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a Markdown past paper filed twice under different names ranks exactly as one copy does, and both paths stay named', async () => {
    const once = await edges();
    await write(
      '03 Research/Archive/an old copy of the 2024 paper.md',
      paper('2024', ['Derive Gadget assembly.', 'Widget theory again, under load.']),
    );
    expect(await edges()).toEqual(once);
    const tier3 = await extractTier3Evidence(source);
    const cited = tier3.citations.filter(
      (c) => c.kind === 'past-paper' && c.conceptName === 'Gadget assembly',
    );
    expect(cited).toHaveLength(1);
    // The first path in code-unit order cites; the other is named, never hidden.
    const both = [
      '03 Research/Archive/an old copy of the 2024 paper.md',
      '03 Research/TESTC101 Past Paper 2024.md',
    ];
    expect(cited[0]?.sourcePath).toBe(both[0]);
    expect(cited[0]?.duplicateSourcePaths).toEqual([both[1]]);
    const row = tier3.sourceCoverage.find((r) => r.sourcePath === both[0]);
    expect(row?.duplicateSourcePaths).toEqual([both[1]]);
    expect(tier3.sourceCoverage.some((r) => r.sourcePath === both[1])).toBe(false);
  });

  it('a Markdown objectives document filed twice counts once', async () => {
    await write('03 Research/TESTC101 Objectives.md', OBJECTIVES);
    const once = await edges();
    await write('03 Research/Archive/objectives backup.md', OBJECTIVES);
    expect(await edges()).toEqual(once);
  });

  it('a PDF past paper filed twice leaves the confidence denominator as one copy does', async () => {
    const pdf = buildPdfBytes('Question 1. Explain Flux capacitor tuning. (10 marks)');
    await write('03 Research/2025.pdf', pdf);
    const registered = [
      { path: '03 Research/2025.pdf', role: 'past-paper' as const, course: 'TESTC101' },
    ];
    const once = await buildConceptAssessmentEdges(source, {
      basePath: BASE,
      concepts: [],
      registeredFiles: registered,
    });
    await write('99 Archive/2025 copy.pdf', pdf);
    const twice = await buildConceptAssessmentEdges(source, {
      basePath: BASE,
      concepts: [],
      registeredFiles: [
        ...registered,
        { path: '99 Archive/2025 copy.pdf', role: 'past-paper' as const, course: 'TESTC101' },
      ],
    });
    const key = (r: typeof once) =>
      r.edges.map((e) => [e.conceptName, e.basis, e.yieldRank, e.confidence, e.citations.length]);
    expect(key(twice)).toEqual(key(once));
  });

  it('different papers that share one identical question stay two sources', async () => {
    const shared = 'Explain Sprocket alignment on a test rig.';
    await write(
      '03 Research/TESTC101 Past Paper 2025.md',
      paper('2025', [shared, 'Derive Gadget assembly.']),
    );
    await write(
      '03 Research/TESTC101 Past Paper 2026.md',
      paper('2026', [shared, 'Derive Widget theory.']),
    );
    const tier3 = await extractTier3Evidence(source);
    const sprocket = tier3.citations.filter(
      (c) => c.kind === 'past-paper' && c.conceptName === 'Sprocket alignment',
    );
    expect(new Set(sprocket.map((c) => c.sourcePath)).size).toBe(3);
    expect(sprocket.every((c) => c.duplicateSourcePaths === undefined)).toBe(true);
  });
});
