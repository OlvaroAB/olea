/** `runScopeReadingDrivers` tests (`ol-egov.141.89.7.52`): both drivers run in order, and a failure in either never reaches the caller. Synthetic only. */

import { describe, expect, it } from 'vitest';
import { runScopeReadingDrivers } from '../../src/scope-reading/drivers.js';
import {
  alignAll,
  COURSE,
  conceptNotes,
  demandAnswer,
  outcome,
  STAMP,
  setup,
  transport,
  unitsOf,
} from './drivers-kit.js';

describe('runScopeReadingDrivers', () => {
  it('runs the demand driver and then the alignment driver on one delivery', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction({
      sourcePath: 'doc-o',
      documentKind: 'objectives',
      revisionDigest: 'r1',
      coverage: { unitsRead: 2, unitsTotal: 2 },
      declarationCount: 1,
      paperStructure: { sections: [] },
      stamp: STAMP,
    });
    const t = transport((s) => (s.taskId === 'outcomes.align.v1' ? alignAll(s) : demandAnswer(s)));
    await runScopeReadingDrivers({
      persistence,
      ref: { sourcePath: 'doc-o', documentKind: 'objectives', revisionDigest: 'r1' },
      basis: { revisionDigest: 'r1', unitsRead: 2, unitsTotal: 2, pages: [1, 2] },
      recorded,
      units: unitsOf(2),
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [outcome('o1', 0)],
      transport: t.transport,
      vault,
    });
    expect(t.sent.map((s) => s.taskId)).toEqual(['outcomes.align.v1']);
    expect((await persistence.load()).alignments.size).toBe(1);
  });

  it('never throws, whatever the transport, the store or the vault does', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction({
      sourcePath: 'doc-o',
      documentKind: 'objectives',
      revisionDigest: 'r1',
      coverage: { unitsRead: 2, unitsTotal: 2 },
      declarationCount: 1,
      paperStructure: { sections: [] },
      stamp: STAMP,
    });
    const broken = {
      ...persistence,
      load: async () => {
        throw new Error('store down');
      },
    };
    const t = transport(() => {
      throw new Error('offline');
    });
    const spy = console.error;
    console.error = () => undefined;
    try {
      await expect(
        runScopeReadingDrivers({
          persistence: broken,
          ref: { sourcePath: 'doc-o', documentKind: 'objectives', revisionDigest: 'r1' },
          basis: { revisionDigest: 'r1', unitsRead: 2, unitsTotal: 2, pages: [1, 2] },
          recorded,
          units: unitsOf(2),
          deliveryRevisionDigest: 'r1',
          courses: [COURSE],
          declarations: [outcome('o1', 0)],
          transport: t.transport,
          vault,
        }),
      ).resolves.toBeUndefined();
    } finally {
      console.error = spy;
    }
  });
});
