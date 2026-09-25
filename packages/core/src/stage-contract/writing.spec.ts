/**
 * The Writing stage contract (`ol-egov.141.89.20`): draft, checks, receipt.
 * The receipt lists passed, repaired, failed, inconclusive and not-run
 * checks; a code-only receipt never claims more than its checks; a failed
 * draft is never carried.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { codeProvenance, modelProvenance, type StageProvenance } from './provenance.js';
import {
  buildWritingReceipt,
  passedItsChecks,
  type WritingCheckResult,
  writingEnvelopeProblems,
  writingFromChecks,
  writingReceiptProblems,
} from './writing.js';

const provenance: StageProvenance = modelProvenance({
  seat: 'candidate',
  taskId: 'example.write.v1',
  stamp: { promptVersion: 'p-1', modelId: 'm-1' },
  evidenceDigests: ['digest-a'],
});

const passed = (check: string): WritingCheckResult => ({ check, kind: 'code', status: 'passed' });

describe('buildWritingReceipt', () => {
  it('lists each check under the status it reached, in order', () => {
    const receipt = buildWritingReceipt(
      [
        passed('shape'),
        { check: 'count', kind: 'code', status: 'repaired', note: '1 dropped' },
        { check: 'cites', kind: 'code', status: 'inconclusive', note: 'no text layer' },
        { check: 'meaning', kind: 'semantic', status: 'not-run' },
      ],
      provenance,
    );
    expect(receipt.passed).toEqual([{ check: 'shape', kind: 'code' }]);
    expect(receipt.repaired).toEqual([{ check: 'count', kind: 'code', note: '1 dropped' }]);
    expect(receipt.failed).toEqual([]);
    expect(receipt.inconclusive).toEqual([{ check: 'cites', kind: 'code', note: 'no text layer' }]);
    expect(receipt.notRun).toEqual([{ check: 'meaning', kind: 'semantic' }]);
    expect(receipt.disposition).toBe('unverified');
    expect(receipt.assurance).toBe('code-checks-only');
    expect(receipt.provenance).toBe(provenance);
  });

  it('derives the disposition from the lists alone', () => {
    const disposition = (results: WritingCheckResult[]) =>
      buildWritingReceipt(results, provenance).disposition;
    expect(disposition([passed('a'), passed('b')])).toBe('checks-passed');
    expect(disposition([passed('a'), { check: 'b', kind: 'code', status: 'repaired' }])).toBe(
      'repaired',
    );
    expect(disposition([passed('a'), { check: 'b', kind: 'code', status: 'not-run' }])).toBe(
      'unverified',
    );
    expect(disposition([passed('a'), { check: 'b', kind: 'code', status: 'inconclusive' }])).toBe(
      'unverified',
    );
    expect(
      disposition([
        { check: 'a', kind: 'code', status: 'failed' },
        { check: 'b', kind: 'code', status: 'not-run' },
      ]),
    ).toBe('refused');
  });

  it('never reads an empty check list as passed', () => {
    const receipt = buildWritingReceipt([], provenance);
    expect(receipt.disposition).toBe('unverified');
    expect(passedItsChecks(receipt)).toBe(false);
  });

  it('keeps a code-only receipt at code-checks-only, however clean', () => {
    const receipt = buildWritingReceipt([passed('a'), passed('b'), passed('c')], provenance);
    expect(receipt.disposition).toBe('checks-passed');
    expect(receipt.assurance).toBe('code-checks-only');
    expect(JSON.stringify(receipt)).not.toMatch(/correct|sound/);
  });

  it('reports semantic checks only when one actually held', () => {
    expect(
      buildWritingReceipt(
        [passed('a'), { check: 'meaning', kind: 'semantic', status: 'passed' }],
        provenance,
      ).assurance,
    ).toBe('includes-semantic-checks');
    expect(
      buildWritingReceipt(
        [passed('a'), { check: 'meaning', kind: 'semantic', status: 'inconclusive' }],
        provenance,
      ).assurance,
    ).toBe('code-checks-only');
  });

  it('throws on a check named twice', () => {
    expect(() => buildWritingReceipt([passed('a'), passed('a')], provenance)).toThrow(
      /listed twice/,
    );
  });
});

describe('writingFromChecks', () => {
  it('carries the draft when no check failed', () => {
    const outcome = writingFromChecks({ text: 'draft' }, [passed('a')], provenance);
    expect(outcome.kind).toBe('written');
    expect(outcome.kind === 'written' && outcome.draft).toEqual({ text: 'draft' });
  });

  it('never carries a draft that failed a check', () => {
    const outcome = writingFromChecks(
      { text: 'draft' },
      [passed('a'), { check: 'b', kind: 'code', status: 'failed', note: '2 defects' }],
      provenance,
    );
    expect(outcome.kind).toBe('refused');
    expect('draft' in outcome).toBe(false);
    expect(outcome.receipt.failed).toEqual([{ check: 'b', kind: 'code', note: '2 defects' }]);
  });
});

describe('writingEnvelopeProblems and writingReceiptProblems', () => {
  it('accept every well-formed outcome, including after a JSON round trip', () => {
    const outcomes = [
      writingFromChecks({ text: 'draft' }, [passed('a')], provenance),
      writingFromChecks(null, [{ check: 'a', kind: 'code', status: 'failed' }], provenance),
      { kind: 'declined', basis: 'nothing-to-write-from', provenance: codeProvenance('r', []) },
      { kind: 'unavailable', cause: 'malformed', provenance },
    ];
    for (const outcome of outcomes) {
      expect(writingEnvelopeProblems(outcome)).toEqual([]);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });

  it('reject a receipt whose disposition or assurance disagrees with its lists', () => {
    const receipt = buildWritingReceipt(
      [{ check: 'a', kind: 'code', status: 'failed' }],
      provenance,
    );
    expect(writingReceiptProblems({ ...receipt, disposition: 'checks-passed' })).toContain(
      'receipt.disposition does not match its check lists',
    );
    expect(writingReceiptProblems({ ...receipt, assurance: 'includes-semantic-checks' })).toContain(
      'receipt.assurance does not match its check lists',
    );
  });

  it('reject a check listed twice across lists', () => {
    const receipt = buildWritingReceipt([passed('a')], provenance);
    expect(
      writingReceiptProblems({ ...receipt, notRun: [{ check: 'a', kind: 'code' }] }),
    ).toContain('receipt.notRun[0] names a check listed elsewhere');
  });

  it('reject a refused outcome that still carries a draft, and a written one with a refused receipt', () => {
    const refusedReceipt = buildWritingReceipt(
      [{ check: 'a', kind: 'code', status: 'failed' }],
      provenance,
    );
    expect(
      writingEnvelopeProblems({ kind: 'refused', receipt: refusedReceipt, draft: 'x' }),
    ).toContain('outcome is refused but still carries a draft');
    expect(
      writingEnvelopeProblems({ kind: 'written', receipt: refusedReceipt, draft: 'x' }),
    ).toContain('outcome is written but its receipt is refused');
  });

  it('reject an unknown kind or decline basis', () => {
    expect(writingEnvelopeProblems({ kind: 'maybe' })).toEqual([
      'outcome.kind is not written, refused, declined or unavailable',
    ]);
    expect(writingEnvelopeProblems({ kind: 'declined', basis: 'tired', provenance })).toContain(
      'outcome.basis is not a known decline basis',
    );
  });
});
