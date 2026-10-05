/**
 * T13a, core side (`ol-egov.141.89.104.2`): a write queued before a delete of the same record
 * never recreates it. The delete joins the record file's queue, so the write lands first and the
 * delete then removes it. `OverlapVault` lands writes a macrotask late and deletes at once — the
 * interleaving in which an unqueued delete runs first and the write then puts the record back.
 * Every course and id here is invented.
 */

import { describe, expect, it } from 'vitest';
import { OverlapVault } from '../../test/support/overlap-vault.js';
import {
  addManualAssessmentEntry,
  manualAssessmentRecordPath,
  mintManualAssessmentId,
  removeManualAssessmentEntry,
} from '../assessment/manual.js';

describe('T13a: a write queued before a delete of the same record', () => {
  it('manual assessment: the entry added, then removed, stays removed', async () => {
    const vault = new OverlapVault();
    const nonce = () => 'entry-1';
    const path = manualAssessmentRecordPath(mintManualAssessmentId(nonce));
    const add = addManualAssessmentEntry(
      vault,
      { course: 'COURSEA', type: 'Quiz' },
      { generateId: nonce },
    );
    const remove = removeManualAssessmentEntry(vault, path);
    await Promise.all([add, remove]);
    expect(vault.raw(path)).toBeUndefined();
    expect(vault.paths()).toEqual([]);
  });
});
