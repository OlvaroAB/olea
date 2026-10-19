// Scenarios: features/F8-concepts-scope.md, the `ol-egov.141.89.3.51` ([D-068]) block —
// @auto:core/session/enumerate.read-minted.d-068.spec
//
// A concept the material read minted (a tier-3, topic-anchored key on the course its passages sit
// in) reaches the concept list the ranking reads: `enumerateVaultInstruments`'s `concepts`. A
// course-scoped identity of `[D-544]` is the same kind of key. Her conventions still win on
// conflict (`[D-088]`), a split wording stays split (`[D-402]`), and listing a minted concept binds
// no instrument. Every fixture string is invented.
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import { type ConceptKeyAnchor, resolveConceptKey } from '../concept/key-store.js';
import { enumerateVaultInstruments } from './enumerate.js';

const X = 'XEE101';
const Y = 'YEE202';
const X_LECTURE = `01 Courses/${X}/Lecture one.md`;
const Y_LECTURE = `01 Courses/${Y}/Lecture one.md`;
const PROSE = '# Lecture one\n\nTessellite is an interlocking crystal habit, discussed in prose.\n';
const STAMPED = { concepts: { stampConceptKeys: true } } as const;

function topicAnchor(course: string, name: string, paths: readonly string[]): ConceptKeyAnchor {
  return { kind: 'topic', course, name, aliases: [], introducingPaths: paths };
}

const MCQ = [
  '```olea-mcq',
  'stem: Which habit is it?',
  'answer: The interlocking one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'feedback: Because.',
  '```',
].join('\n');

describe('[D-068] a concept the material read minted reaches the ranking list', () => {
  it('lists the minted concept under its minted key, for its own course alone', async () => {
    const vault = memoryVault({
      [X_LECTURE]: PROSE,
      [Y_LECTURE]: '# Lecture one\n\nOther prose.\n',
    });
    const key = await resolveConceptKey(vault, 3, topicAnchor(X, 'Tessellite', [X_LECTURE]));

    const { concepts } = await enumerateVaultInstruments(vault, STAMPED);

    const listed = concepts.filter((c) => c.name === 'Tessellite');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe(key);
    expect(listed[0]?.courses).toEqual([X]);
    expect(listed[0]?.sourcePaths).toEqual([X_LECTURE]);
    expect(listed[0]?.tier).toBe(3);
  });

  it('a concept her own conventions name gets no second key from the read ([D-088])', async () => {
    const vault = memoryVault({
      [X_LECTURE]: `---\ntopic: [Tessellite]\ncourse: ${X}\n---\n\n${PROSE}`,
    });
    // The read corroborated her record: it carries her record's key, so nothing new is minted.
    const first = await enumerateVaultInstruments(vault, STAMPED);
    const herKey = first.concepts.find((c) => c.name === 'Tessellite')?.key;
    expect(herKey).toBeDefined();
    await resolveConceptKey(vault, 3, topicAnchor(X, 'Tessellite', [X_LECTURE]));

    const { concepts } = await enumerateVaultInstruments(vault, STAMPED);

    const listed = concepts.filter((c) => c.name === 'Tessellite');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe(herKey);
  });

  it('a wording split by course stays two identities, each in its own course ([D-402])', async () => {
    const vault = memoryVault({ [X_LECTURE]: PROSE, [Y_LECTURE]: PROSE });
    const keyX = await resolveConceptKey(vault, 3, topicAnchor(X, 'Tessellite', [X_LECTURE]));
    const keyY = await resolveConceptKey(vault, 3, topicAnchor(Y, 'Tessellite', [Y_LECTURE]));
    expect(keyX).not.toBe(keyY);

    const { concepts } = await enumerateVaultInstruments(vault, STAMPED);

    const listed = concepts.filter((c) => c.name === 'Tessellite');
    expect(listed.map((c) => [c.key, c.courses])).toEqual(
      expect.arrayContaining([
        [keyX, [X]],
        [keyY, [Y]],
      ]),
    );
    expect(listed).toHaveLength(2);
  });

  it('binds no instrument by being listed', async () => {
    const vault = memoryVault({
      [X_LECTURE]: `---\ntopic: [Her topic]\ncourse: ${X}\n---\n\n${PROSE}\n${MCQ}\n`,
    });
    const before = await enumerateVaultInstruments(vault, STAMPED);
    await resolveConceptKey(vault, 3, topicAnchor(X, 'Tessellite', [X_LECTURE]));

    const after = await enumerateVaultInstruments(vault, STAMPED);

    expect(after.records.map((r) => r.conceptIds)).toEqual(before.records.map((r) => r.conceptIds));
    expect(after.records.length).toBeGreaterThan(0);
    expect(after.concepts.some((c) => c.name === 'Tessellite')).toBe(true);
  });

  it('lists nothing extra when keys are not stamped, or when the introducing material is gone', async () => {
    const vault = memoryVault({ [X_LECTURE]: PROSE });
    await resolveConceptKey(vault, 3, topicAnchor(X, 'Tessellite', [X_LECTURE]));
    await resolveConceptKey(
      vault,
      3,
      topicAnchor(X, 'Vanished', [`01 Courses/${X}/Deleted note.md`]),
    );

    const unstamped = await enumerateVaultInstruments(vault);
    const stamped = await enumerateVaultInstruments(vault, STAMPED);

    expect(unstamped.concepts.map((c) => c.name)).not.toContain('Tessellite');
    expect(stamped.concepts.map((c) => c.name)).toContain('Tessellite');
    expect(stamped.concepts.map((c) => c.name)).not.toContain('Vanished');
  });
});
