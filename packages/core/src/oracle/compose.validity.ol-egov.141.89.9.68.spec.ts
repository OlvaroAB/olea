/**
 * `composeOracleRanking`'s mastery join reads the ruled validity scope
 * (`ol-egov.141.89.9.68`; rulings of 2026-09-28, `ol-egov.141.89.9.66`): one
 * dispute-aware projection. A contest resolved `corrected` proves ONE
 * review's grade wrong, never the instrument; a suspension recorded as a
 * defect proves the instrument invalid until a later unsuspend.
 *
 * Kept apart from `./compose.spec.ts` so this lane's fixtures stay its own.
 * INV-3: every identifier below is a structural placeholder.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DisputeLogRecord, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import { composeOracleRanking } from './compose.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const INSTRUMENT = 'eb:widget-theory:1';

function attempt(conceptId: string, eventId: string, timestamp: string): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: INSTRUMENT,
    instrumentType: 'explain-back',
    conceptIds: [conceptId],
    rating: null,
    wasUnsure: false,
    durationMs: 4000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    supportLevelShown: 'independent',
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: 'correct',
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    },
  };
}

function correctedContest(conceptId: string): DisputeLogRecord[] {
  const base = {
    schemaVersion: 6 as const,
    kind: 'dispute' as const,
    timestamp: '2026-01-20T10:00:00+00:00',
    claimKind: 'grade' as const,
    claimRendering: 'explain-back-grade' as const,
    conceptIds: [conceptId],
    instrumentId: INSTRUMENT,
    evidenceBasis: 'evidence-fingerprint-1',
    effect: 'quarantined' as const,
  };
  return [
    { ...base, eventId: 'contest-open' } as DisputeLogRecord,
    {
      ...base,
      eventId: 'contest-resolved',
      timestamp: '2026-01-20T11:00:00+00:00',
      resolves: 'contest-open',
      outcome: 'corrected' as const,
    } as DisputeLogRecord,
  ];
}

describe('composeOracleRanking — the ruled validity scope reaches the mastery join (ol-egov.141.89.9.68)', () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];
  let widgetKey: string;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-compose-validity-'));
    source = new FolderSource(root);
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
      ].join('\n'),
    );
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );
    concepts = await extractConcepts(source, {});
    const widget = concepts.find((c) => c.name === 'Widget theory');
    if (widget === undefined) throw new Error('expected the fixture concept to extract');
    widgetKey = widget.key;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function stageFor(
    reviewLog: readonly ReviewLogEntry[],
    disputes?: readonly DisputeLogRecord[],
  ): Promise<string | undefined> {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog,
      ...(disputes !== undefined ? { disputes } : {}),
      asOf: '2026-08-15',
      concepts,
    });
    return result.mastery.get(widgetKey)?.state;
  }

  it('baseline: the qualifying attempt reaches tree', async () => {
    expect(await stageFor([attempt(widgetKey, 'eb-1', '2026-01-20T09:00:00+00:00')])).toBe('tree');
  });

  it('a corrected contest read from `disputes` withholds the top stage its proven-wrong grade earned', async () => {
    const stage = await stageFor(
      [attempt(widgetKey, 'eb-1', '2026-01-20T09:00:00+00:00')],
      correctedContest(widgetKey),
    );
    expect(stage).toBe('sprout');
  });

  it('a corrected contest no longer drops the instrument’s other reviews: an earlier sound attempt still reaches tree', async () => {
    const stage = await stageFor(
      [
        attempt(widgetKey, 'eb-0', '2026-01-10T09:00:00+00:00'),
        attempt(widgetKey, 'eb-1', '2026-01-20T09:00:00+00:00'),
      ],
      correctedContest(widgetKey),
    );
    expect(stage).toBe('tree');
  });

  it('a suspension recorded as a defect invalidates the instrument until a later unsuspend', async () => {
    const suspension = (kind: 'suspend' | 'unsuspend', eventId: string, timestamp: string) =>
      ({
        schemaVersion: 6,
        kind,
        eventId,
        timestamp,
        instrumentId: INSTRUMENT,
        conceptIds: [widgetKey],
        ...(kind === 'suspend' ? { reason: 'defect' } : {}),
      }) as ReviewLogEntry;
    const log = [
      attempt(widgetKey, 'eb-1', '2026-01-20T09:00:00+00:00'),
      suspension('suspend', 'suspend-1', '2026-01-21T09:00:00+00:00'),
    ];
    expect(await stageFor(log)).toBe('sprout');
    expect(
      await stageFor([...log, suspension('unsuspend', 'unsuspend-1', '2026-01-22T09:00:00+00:00')]),
    ).toBe('tree');
  });
});
