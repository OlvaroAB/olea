/** `buildClosedList` description sources: her definition is checked against its bound note and excluded when that note is an assessment (`ol-egov.141.89.7.52`). Invented wording only. */

import { describe, expect, it, vi } from 'vitest';
import { memoryVault } from '../review/memory-vault.js';

vi.mock('olea-core', async (importActual) => {
  const actual = await importActual<typeof import('olea-core')>();
  return {
    ...actual,
    enumerateVaultInstruments: async () => ({
      concepts: [
        {
          key: 'concept-key1:a',
          name: 'Gamma idea',
          tier: 1,
          courses: ['TESTC1'],
          sourcePaths: ['note-g.md'],
          boundNotePath: 'note-g.md',
          definition: 'Gamma is a made-up thing.',
        },
        {
          key: 'concept-key1:b',
          name: 'Delta idea',
          tier: 1,
          courses: ['TESTC1'],
          sourcePaths: ['note-d.md'],
          boundNotePath: 'note-d.md',
          definition: 'Not in the note any more.',
        },
        {
          key: 'concept-prov1:c',
          name: 'Epsilon idea',
          tier: 2,
          courses: ['TESTC1'],
          sourcePaths: [],
        },
      ],
    }),
  };
});

const { buildClosedList } = await import('../../src/scope-reading/closed-list.js');

describe('the closed list descriptions', () => {
  const vault = memoryVault({
    'note-g.md': '# Gamma idea\n\nGamma is a  made-up thing.\n',
    'note-d.md': '# Delta idea\n\nSomething else.\n',
  });

  it('marks a definition found in its bound note, one that is not, and a concept with none; marks provisional keys unstable', async () => {
    const [a, b, c] = await buildClosedList(vault, 'TESTC1');
    expect(a?.source.definitionFoundInSource).toBe(true);
    expect(b?.source.definitionFoundInSource).toBe(false);
    expect(c?.source.definition).toBeNull();
    expect(c?.source.definitionFoundInSource).toBeNull();
    expect([a?.stableKey, b?.stableKey, c?.stableKey]).toEqual([true, true, false]);
  });

  it('excludes a definition bound to a registered assessment document', async () => {
    const [a, b] = await buildClosedList(vault, 'TESTC1', {
      assessmentPaths: new Set(['note-g.md']),
    });
    expect(a?.source.definitionSourceIsAssessment).toBe(true);
    expect(b?.source.definitionSourceIsAssessment).toBe(false);
  });
});
