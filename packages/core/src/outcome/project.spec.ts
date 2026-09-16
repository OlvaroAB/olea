import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import type { OutcomeEvent } from './events.js';
import { applyOutcomeEvent, projectOutcomeRecords } from './project.js';

// Scenarios: olea-service/features/F4-oracle.md — "Outcome events project into a record
// ([ONT-R5], F4.1)", tagged `@auto:core/outcome/project.spec`.

const SOURCE = { path: '02 Assignments/Objectives.md' as VaultPath, blockIndex: 3 };
const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };

function createdEvent(outcomeId: string, timestamp = '2026-09-16T00:00:00Z'): OutcomeEvent {
  return {
    kind: 'created',
    schemaVersion: 1,
    eventId: `evt-${outcomeId}-created`,
    timestamp,
    outcomeId,
    courses: ['COURSEB', 'COURSEA'],
    source: SOURCE,
    label: 'Explain the mechanism of X',
    provenance: PROVENANCE,
  };
}

describe('applyOutcomeEvent — created', () => {
  it('mints a fresh record from undefined, sorting courses', () => {
    const record = applyOutcomeEvent(undefined, createdEvent('outcome-1'));
    expect(record).toEqual({
      id: 'outcome-1',
      courses: ['COURSEA', 'COURSEB'],
      source: SOURCE,
      label: 'Explain the mechanism of X',
      conceptKeys: [],
      status: 'active',
      provenance: PROVENANCE,
      mintedAt: '2026-09-16T00:00:00Z',
      schemaVersion: 1,
    });
  });

  it('is idempotent: a duplicate created event for an existing record changes nothing', () => {
    const first = applyOutcomeEvent(undefined, createdEvent('outcome-1', '2026-01-01T00:00:00Z'));
    const second = applyOutcomeEvent(first, createdEvent('outcome-1', '2099-01-01T00:00:00Z'));
    expect(second).toBe(first); // same reference — a true no-op, not merely an equal value
  });
});

describe('applyOutcomeEvent — concept-attached', () => {
  it('appends a concept key to an existing record', () => {
    const record = applyOutcomeEvent(undefined, createdEvent('outcome-1'));
    const updated = applyOutcomeEvent(record, {
      kind: 'concept-attached',
      schemaVersion: 1,
      eventId: 'evt-attach-1',
      timestamp: '2026-09-16T01:00:00Z',
      outcomeId: 'outcome-1',
      conceptKey: 'concept-key1:abc',
    });
    expect(updated?.conceptKeys).toEqual(['concept-key1:abc']);
  });

  it('is idempotent: attaching the same concept key twice writes it once', () => {
    const record = applyOutcomeEvent(undefined, createdEvent('outcome-1'));
    const attach = (r: typeof record) =>
      applyOutcomeEvent(r, {
        kind: 'concept-attached',
        schemaVersion: 1,
        eventId: 'evt-attach',
        timestamp: '2026-09-16T01:00:00Z',
        outcomeId: 'outcome-1',
        conceptKey: 'concept-key1:abc',
      });
    const once = attach(record);
    const twice = attach(once);
    expect(twice).toBe(once); // no-op the second time
    expect(twice?.conceptKeys).toEqual(['concept-key1:abc']);
  });

  it('is dropped, never invents a parent, when applied against no existing record', () => {
    const result = applyOutcomeEvent(undefined, {
      kind: 'concept-attached',
      schemaVersion: 1,
      eventId: 'evt-attach',
      timestamp: '2026-09-16T01:00:00Z',
      outcomeId: 'no-such-outcome',
      conceptKey: 'concept-key1:abc',
    });
    expect(result).toBeUndefined();
  });
});

describe('applyOutcomeEvent — retired', () => {
  it('moves an active record to retired', () => {
    const record = applyOutcomeEvent(undefined, createdEvent('outcome-1'));
    const retired = applyOutcomeEvent(record, {
      kind: 'retired',
      schemaVersion: 1,
      eventId: 'evt-retire',
      timestamp: '2026-09-16T02:00:00Z',
      outcomeId: 'outcome-1',
    });
    expect(retired?.status).toBe('retired');
    // F8.5: retiring never removes anything else on the record.
    expect(retired?.id).toBe('outcome-1');
    expect(retired?.label).toBe(record?.label);
  });

  it('is idempotent: retiring an already-retired record writes nothing', () => {
    const record = applyOutcomeEvent(undefined, createdEvent('outcome-1'));
    const retireEvent: OutcomeEvent = {
      kind: 'retired',
      schemaVersion: 1,
      eventId: 'evt-retire',
      timestamp: '2026-09-16T02:00:00Z',
      outcomeId: 'outcome-1',
    };
    const once = applyOutcomeEvent(record, retireEvent);
    const twice = applyOutcomeEvent(once, retireEvent);
    expect(twice).toBe(once);
  });

  it('is dropped when applied against no existing record', () => {
    const result = applyOutcomeEvent(undefined, {
      kind: 'retired',
      schemaVersion: 1,
      eventId: 'evt-retire',
      timestamp: '2026-09-16T02:00:00Z',
      outcomeId: 'no-such-outcome',
    });
    expect(result).toBeUndefined();
  });
});

describe('projectOutcomeRecords', () => {
  it('folds a full create/attach/retire sequence for one outcome', () => {
    const events: OutcomeEvent[] = [
      createdEvent('outcome-1'),
      {
        kind: 'concept-attached',
        schemaVersion: 1,
        eventId: 'evt-attach-1',
        timestamp: '2026-09-16T01:00:00Z',
        outcomeId: 'outcome-1',
        conceptKey: 'concept-key1:a',
      },
      {
        kind: 'concept-attached',
        schemaVersion: 1,
        eventId: 'evt-attach-2',
        timestamp: '2026-09-16T01:05:00Z',
        outcomeId: 'outcome-1',
        conceptKey: 'concept-key1:b',
      },
      {
        kind: 'retired',
        schemaVersion: 1,
        eventId: 'evt-retire-1',
        timestamp: '2026-09-16T02:00:00Z',
        outcomeId: 'outcome-1',
      },
    ];
    const records = projectOutcomeRecords(events);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'outcome-1',
      conceptKeys: ['concept-key1:a', 'concept-key1:b'],
      status: 'retired',
    });
  });

  it('scopes each event to its own outcomeId — two outcomes never interfere', () => {
    const events: OutcomeEvent[] = [
      createdEvent('outcome-1'),
      createdEvent('outcome-2'),
      {
        kind: 'concept-attached',
        schemaVersion: 1,
        eventId: 'evt-attach',
        timestamp: '2026-09-16T01:00:00Z',
        outcomeId: 'outcome-1',
        conceptKey: 'concept-key1:only-on-1',
      },
    ];
    const records = projectOutcomeRecords(events);
    expect(records).toHaveLength(2);
    const one = records.find((r) => r.id === 'outcome-1');
    const two = records.find((r) => r.id === 'outcome-2');
    expect(one?.conceptKeys).toEqual(['concept-key1:only-on-1']);
    expect(two?.conceptKeys).toEqual([]);
  });

  it('drops an attach/retire event for an id with no created event in the same batch', () => {
    const events: OutcomeEvent[] = [
      {
        kind: 'concept-attached',
        schemaVersion: 1,
        eventId: 'evt-attach',
        timestamp: '2026-09-16T01:00:00Z',
        outcomeId: 'orphan',
        conceptKey: 'concept-key1:x',
      },
    ];
    expect(projectOutcomeRecords(events)).toEqual([]);
  });
});
