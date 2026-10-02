// Flags in the request field (ol-egov.141.89.1.64; D-465). Synthetic text only.

import { describe, expect, it } from 'vitest';
import { sourceChunkOriginsFragment } from './source-origin.js';

const host = {
  frontmatterFor: () => undefined,
  lectureTermsFor: () => ['neighbour threshold', 'lattice'],
};

describe('sourceChunkOriginsFragment flags', () => {
  it('carries the kinds, in contract order, for a flagged transcript part', () => {
    const out = sourceChunkOriginsFragment(
      [
        { path: 'lec/week1.txt', text: 'On this graph, the neighbor rule fires [inaudible].' },
        { path: 'notes/a.pdf', text: 'On this graph, the rise flattens.' },
      ],
      host,
    );
    expect(out.sourceChunkOrigins).toEqual([
      {
        kind: 'transcript',
        speakerRole: 'unknown',
        flags: ['inaudible', 'visual-reference', 'term-discrepancy'],
      },
      null,
    ]);
  });

  it('omits the flags key when the part is clean, and the field when there is no transcript', () => {
    const clean = sourceChunkOriginsFragment(
      [{ path: 'lec/w.txt', text: 'The lattice is a grid.' }],
      host,
    );
    expect(clean.sourceChunkOrigins).toEqual([{ kind: 'transcript', speakerRole: 'unknown' }]);
    expect(sourceChunkOriginsFragment([{ path: 'a.pdf', text: 'this graph' }], host)).toEqual({});
  });

  it('runs no term check without lectureTermsFor', () => {
    const out = sourceChunkOriginsFragment([{ path: 'lec/w.txt', text: 'The neighbor rule.' }]);
    expect(out.sourceChunkOrigins).toEqual([{ kind: 'transcript', speakerRole: 'unknown' }]);
  });
});
