/**
 * ol-5zgr: `packages/synthetic` used to carry its own private copy of the MCQ
 * rating mapping (a `mapMcqOutcome` function in `generate.ts`, "reproduced
 * here rather than imported") instead of importing `olea-core`'s canonical
 * `mapMcqRating` (F2.16: wrong → Again, correct + "wasn't sure" → Hard,
 * correct → Good). A third copy of that rule is exactly the drift this test
 * guards against — a synthetic stream mapped by a different rule than the
 * product uses would silently mistrain any detector built against it.
 *
 * Two checks, deliberately different in kind:
 *  - **Structural**: `generate.ts` must not reimplement the mapping and must
 *    import the real one. This is what actually catches "a copy came back".
 *  - **Behavioural**: every emitted MCQ record obeys the rule `mapMcqRating`
 *    defines. Weaker on its own — `contract.spec.ts` already proves "never
 *    easy", which a swapped hard/good mapping would still pass — but it is
 *    the check that would catch the mapping itself going wrong, which the
 *    structural check cannot.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapMcqRating } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { generateStream, PERSONA_IDS, reviewsOf, streamSpec } from '../src/index.js';

const GENERATE_SRC = readFileSync(
  fileURLToPath(new URL('../src/generate.ts', import.meta.url)),
  'utf8',
);

describe('MCQ rating mapping has one home (ol-5zgr)', () => {
  it('generate.ts does not reimplement the MCQ rating mapping', () => {
    // The historical defect: a private function reproducing F2.16's three-line
    // rule instead of importing it. Match on the old name and shape rather
    // than "any function with these words" so the test does not fire on the
    // (correct) import statement itself.
    expect(GENERATE_SRC).not.toMatch(/function\s+mapMcqOutcome\s*\(/);
  });

  it('generate.ts imports the mapping from olea-core', () => {
    expect(GENERATE_SRC).toMatch(/import\s*\{[^}]*\bmapMcqRating\b[^}]*\}\s*from\s*'olea-core'/);
  });

  it("every emitted MCQ record matches core's mapMcqRating rule exactly", () => {
    const streams = PERSONA_IDS.map((persona) =>
      generateStream(
        streamSpec(persona, 'mcq-rating-check', {
          days: persona === 'single-session' ? 1 : 60,
        }),
      ),
    );

    let mcqCount = 0;
    for (const stream of streams) {
      for (const record of reviewsOf(stream.entries)) {
        if (record.instrumentType !== 'mcq') continue;
        mcqCount++;
        // `wasCorrect` is not itself logged — only `rating` and `wasUnsure`
        // are — but the mapping makes it recoverable: `again` happens if and
        // only if she was wrong. Re-deriving it here and feeding it back
        // through the real mapping checks that the generator's *actual*
        // rating agrees with what the canonical rule would have produced,
        // which is exactly what a reintroduced, subtly-wrong duplicate would
        // fail.
        const wasCorrect = record.rating !== 'again';
        const expected = mapMcqRating({
          type: 'mcq',
          correct: wasCorrect,
          wasUnsure: record.wasUnsure,
        });
        expect(record.rating).toBe(expected);
      }
    }
    // A suite that never exercised an MCQ record would pass both assertions
    // above vacuously — guard against that so this test cannot go green by
    // going unused.
    expect(mcqCount).toBeGreaterThan(0);
  });
});
