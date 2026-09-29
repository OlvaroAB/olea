import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAPER_DEMANDS } from '../oracle/paper-types.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  INSTRUMENT_TARGET_DEMAND_BASIS,
  INSTRUMENT_TARGET_ORIGINS,
  INSTRUMENT_TARGET_SCHEMA_VERSION,
  INSTRUMENT_TARGET_STORE_FOLDER,
  type InstrumentTargetRecord,
  instrumentTargetStorePath,
  isInstrumentTargetRecord,
  type NewInstrumentTarget,
  QUESTION_BINDING_SCHEME,
  questionBindingOf,
  readInstrumentTarget,
  writeInstrumentTarget,
} from './target-store.js';

// `[D-437]` (`ol-egov.141.89.57`), design section 1.2 (R1, ratified 2026-09-29), tests T6 (the
// store's half: write-once, the literal `demandBasis`) and T11's store half. The materialiser's
// half of T6 ("an unspecified item writes nothing") belongs to the caller that does not exist
// yet (B4).

function input(over: Partial<NewInstrumentTarget> = {}): NewInstrumentTarget {
  return {
    instrumentId: 'mcq-1',
    declaredDemand: 'recall-a-fact',
    origin: 'heading-cue',
    questionBinding: 'a'.repeat(64),
    authoredAt: '2026-09-29T10:00:00.000Z',
    generator: { taskId: 'quiz.generate.v1', promptVersion: '2.2.0' },
    ...over,
  };
}

describe('instrument-target-store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-instrument-target-store-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lives under its own dot-prefixed folder, beside the citation and distractor-provenance sidecars', () => {
    expect(INSTRUMENT_TARGET_STORE_FOLDER).toBe('.olea/instrument-targets');
    expect(instrumentTargetStorePath('mcq-1')).toBe('.olea/instrument-targets/mcq-1.json');
    expect(instrumentTargetStorePath('a/b c')).toBe('.olea/instrument-targets/a%2Fb%20c.json');
  });

  it('writes a record and reads it back exactly, with the schema version and the literal authoring-intent basis stamped by the writer', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentTarget(vault, input());

    const read = await readInstrumentTarget(vault, 'mcq-1');
    const expected: InstrumentTargetRecord = {
      schemaVersion: 'instrument-target.v1',
      instrumentId: 'mcq-1',
      demandBasis: 'authoring-intent',
      declaredDemand: 'recall-a-fact',
      origin: 'heading-cue',
      questionBinding: 'a'.repeat(64),
      authoredAt: '2026-09-29T10:00:00.000Z',
      generator: { taskId: 'quiz.generate.v1', promptVersion: '2.2.0' },
    };
    expect(read).toEqual({ kind: 'record', record: expected });
    expect(INSTRUMENT_TARGET_SCHEMA_VERSION).toBe('instrument-target.v1');
    expect(INSTRUMENT_TARGET_DEMAND_BASIS).toBe('authoring-intent');
  });

  it('has no argument through which another demand basis could be written: the on-disk file always says authoring-intent', async () => {
    const vault = new FolderSource(tempRoot);
    // A caller that tries to smuggle a different basis through the input is not stopped by the
    // type alone (excess-property checks do not run on a spread), so the writer must ignore it.
    const smuggled = {
      ...input(),
      demandBasis: 'checked-delivery',
    } as unknown as NewInstrumentTarget;
    await writeInstrumentTarget(vault, smuggled);
    const onDisk = JSON.parse(
      await readFile(join(tempRoot, instrumentTargetStorePath('mcq-1')), 'utf8'),
    );
    expect(onDisk.demandBasis).toBe('authoring-intent');
    // @ts-expect-error demandBasis is not part of what a caller may supply
    const typed: NewInstrumentTarget = { ...input(), demandBasis: 'authoring-intent' };
    expect(typed).toBeDefined();
  });

  it('is write-once: a second write for the same id throws and leaves the first file byte-identical', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentTarget(vault, input());
    const path = join(tempRoot, instrumentTargetStorePath('mcq-1'));
    const before = await readFile(path, 'utf8');

    await expect(
      writeInstrumentTarget(vault, input({ declaredDemand: 'calculate', origin: 'revision' })),
    ).rejects.toThrow(/already has a target record/);

    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('refuses a corrupt file that is already there rather than overwriting it (immutable means immutable)', async () => {
    const vault = new FolderSource(tempRoot);
    await vault.write(instrumentTargetStorePath('mcq-1'), '{ not json');
    await expect(writeInstrumentTarget(vault, input())).rejects.toThrow(
      /already has a target record/,
    );
    expect(await readFile(join(tempRoot, instrumentTargetStorePath('mcq-1')), 'utf8')).toBe(
      '{ not json',
    );
  });

  it('accepts every one of the five demand words and every origin, and nothing else', async () => {
    const vault = new FolderSource(tempRoot);
    let n = 0;
    for (const demand of PAPER_DEMANDS) {
      for (const origin of INSTRUMENT_TARGET_ORIGINS) {
        const id = `i-${n++}`;
        await writeInstrumentTarget(
          vault,
          input({ instrumentId: id, declaredDemand: demand, origin }),
        );
        expect(await readInstrumentTarget(vault, id)).toMatchObject({ kind: 'record' });
      }
    }
    await expect(
      writeInstrumentTarget(
        vault,
        input({ instrumentId: 'x', declaredDemand: 'explain' as never }),
      ),
    ).rejects.toThrow(/not a valid instrument-target\.v1 record/);
    await expect(
      writeInstrumentTarget(vault, input({ instrumentId: 'y', origin: 'backfill' as never })),
    ).rejects.toThrow(/not a valid instrument-target\.v1 record/);
    expect(await vault.exists(instrumentTargetStorePath('x'))).toBe(false);
    expect(await vault.exists(instrumentTargetStorePath('y'))).toBe(false);
  });

  it('refuses to write a record that would not read back: blank id, blank binding, blank generator, a non-ISO time', async () => {
    const vault = new FolderSource(tempRoot);
    const bad: Partial<NewInstrumentTarget>[] = [
      { instrumentId: '' },
      { questionBinding: '' },
      { generator: { taskId: '', promptVersion: '1' } },
      { generator: { taskId: 't', promptVersion: '' } },
      { authoredAt: 'yesterday' },
      { authoredAt: '2026-13-45T99:99:99Z' },
    ];
    for (const over of bad) {
      await expect(writeInstrumentTarget(vault, input(over))).rejects.toThrow(
        /not a valid instrument-target\.v1 record/,
      );
    }
    await expect(readdir(join(tempRoot, INSTRUMENT_TARGET_STORE_FOLDER))).rejects.toThrow();
  });

  describe('the optional specification member (TARGET-3, absent until its gate is met)', () => {
    it('round-trips when its own declaredDemand equals the record’s', async () => {
      const vault = new FolderSource(tempRoot);
      const specification = {
        bundle: { schemaVersion: 'explain-back-target.v1', declaredDemand: 'recall-a-fact' },
        digest: 'd'.repeat(64),
      };
      await writeInstrumentTarget(vault, input({ specification }));
      const read = await readInstrumentTarget(vault, 'mcq-1');
      expect(read.kind === 'record' && read.record.specification).toEqual(specification);
    });

    it('refuses to write a specification whose declaredDemand differs from the record’s (checked on write)', async () => {
      const vault = new FolderSource(tempRoot);
      await expect(
        writeInstrumentTarget(
          vault,
          input({
            declaredDemand: 'recall-a-fact',
            specification: { bundle: { declaredDemand: 'calculate' }, digest: 'd'.repeat(64) },
          }),
        ),
      ).rejects.toThrow(/not a valid instrument-target\.v1 record/);
      expect(await vault.exists(instrumentTargetStorePath('mcq-1'))).toBe(false);
    });

    it('reads a file whose specification disagrees as unreadable (checked on read)', async () => {
      const vault = new FolderSource(tempRoot);
      const record = {
        ...input(),
        schemaVersion: 'instrument-target.v1',
        demandBasis: 'authoring-intent',
        specification: { bundle: { declaredDemand: 'calculate' }, digest: 'd'.repeat(64) },
      };
      await vault.write(instrumentTargetStorePath('mcq-1'), JSON.stringify(record));
      expect(await readInstrumentTarget(vault, 'mcq-1')).toEqual({ kind: 'unreadable' });
    });
  });

  describe('read never throws, and tells absent from unreadable', () => {
    it('absent: no file, and an empty id', async () => {
      const vault = new FolderSource(tempRoot);
      expect(await readInstrumentTarget(vault, 'never-written')).toEqual({ kind: 'absent' });
      expect(await readInstrumentTarget(vault, '')).toEqual({ kind: 'absent' });
    });

    it('unreadable: corrupt JSON, wrong shape, a non-object, the wrong basis, an unknown demand, an id that does not match the path', async () => {
      const vault = new FolderSource(tempRoot);
      const good = {
        ...input(),
        schemaVersion: 'instrument-target.v1',
        demandBasis: 'authoring-intent',
      };
      const cases: Record<string, string> = {
        'corrupt-json': '{ not json',
        'wrong-shape': JSON.stringify({ hello: 'world' }),
        'not-an-object': JSON.stringify(['a']),
        'null-literal': 'null',
        'wrong-basis': JSON.stringify({
          ...good,
          instrumentId: 'wrong-basis',
          demandBasis: 'checked-delivery',
        }),
        'wrong-version': JSON.stringify({
          ...good,
          instrumentId: 'wrong-version',
          schemaVersion: 'instrument-target.v2',
        }),
        'unknown-demand': JSON.stringify({
          ...good,
          instrumentId: 'unknown-demand',
          declaredDemand: 'explain',
        }),
        'unknown-origin': JSON.stringify({
          ...good,
          instrumentId: 'unknown-origin',
          origin: 'backfill',
        }),
        'id-mismatch': JSON.stringify({ ...good, instrumentId: 'someone-else' }),
      };
      for (const [id, body] of Object.entries(cases)) {
        await vault.write(instrumentTargetStorePath(id), body);
        expect(await readInstrumentTarget(vault, id), id).toEqual({ kind: 'unreadable' });
      }
    });

    it('unreadable: a vault whose exists or read throws', async () => {
      const vault = new FolderSource(tempRoot);
      const throwingExists = Object.create(vault) as FolderSource;
      throwingExists.exists = async () => {
        throw new Error('io');
      };
      expect(await readInstrumentTarget(throwingExists, 'mcq-1')).toEqual({ kind: 'unreadable' });

      await writeInstrumentTarget(vault, input());
      const throwingRead = Object.create(vault) as FolderSource;
      throwingRead.read = async () => {
        throw new Error('io');
      };
      expect(await readInstrumentTarget(throwingRead, 'mcq-1')).toEqual({ kind: 'unreadable' });
    });

    it('a record written for one id is never read as another id’s (no upgrade across a revision)', async () => {
      const vault = new FolderSource(tempRoot);
      await writeInstrumentTarget(vault, input({ instrumentId: 'predecessor' }));
      expect(await readInstrumentTarget(vault, 'successor')).toEqual({ kind: 'absent' });
    });
  });

  describe('isInstrumentTargetRecord', () => {
    it('is false for non-objects and for a record missing any required field', () => {
      expect(isInstrumentTargetRecord(null)).toBe(false);
      expect(isInstrumentTargetRecord('x')).toBe(false);
      const full = {
        ...input(),
        schemaVersion: 'instrument-target.v1',
        demandBasis: 'authoring-intent',
      } as Record<string, unknown>;
      expect(isInstrumentTargetRecord(full)).toBe(true);
      for (const key of Object.keys(full)) {
        const { [key]: _omitted, ...rest } = full;
        expect(isInstrumentTargetRecord(rest), `without ${key}`).toBe(false);
      }
    });
  });

  describe('questionBindingOf — one function, one meaning', () => {
    it('is deterministic lowercase-hex SHA-256 and names its scheme', async () => {
      const block = { type: 'mcq' as const, stem: 'What is A?', answer: 'B' };
      const a = await questionBindingOf(block);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(await questionBindingOf({ ...block })).toBe(a);
      expect(QUESTION_BINDING_SCHEME).toBe('olea-question-binding/1');
    });

    it('binds the question and the keyed answer: editing the stem, the key, the front, the back, or the blanked span changes it', async () => {
      const mcq = { type: 'mcq' as const, stem: 'What is A?', answer: 'B' };
      const qa = { type: 'qa' as const, front: 'What is A?', back: 'B' };
      const cloze = { type: 'cloze' as const, before: 'A is ', clozeText: 'B', after: '.' };
      const base = [
        await questionBindingOf(mcq),
        await questionBindingOf(qa),
        await questionBindingOf(cloze),
      ];
      expect(new Set(base).size).toBe(3);
      expect(await questionBindingOf({ ...mcq, stem: 'What is A really?' })).not.toBe(base[0]);
      expect(await questionBindingOf({ ...mcq, answer: 'C' })).not.toBe(base[0]);
      expect(await questionBindingOf({ ...qa, front: 'What is A really?' })).not.toBe(base[1]);
      expect(await questionBindingOf({ ...qa, back: 'C' })).not.toBe(base[1]);
      expect(await questionBindingOf({ ...cloze, clozeText: 'C' })).not.toBe(base[2]);
      expect(await questionBindingOf({ ...cloze, before: 'A was ' })).not.toBe(base[2]);
      expect(await questionBindingOf({ ...cloze, after: '!' })).not.toBe(base[2]);
    });

    it('does not move when only what is not the question or key changes: a distractor, the feedback, the fence', async () => {
      // The block type the binding reads has no such fields; passing a fuller parsed instrument
      // (what a caller really holds) must give the same digest as the picked fields alone.
      const picked = { type: 'mcq' as const, stem: 'What is A?', answer: 'B' };
      const full = {
        ...picked,
        distractors: ['C', 'D'],
        feedback: 'because',
        fence: '```',
      };
      expect(await questionBindingOf(full)).toBe(await questionBindingOf(picked));
    });

    it('cannot be fooled by a field boundary: moving a character from one field to the next changes it', async () => {
      const a = await questionBindingOf({ type: 'qa', front: 'ab', back: 'c' });
      const b = await questionBindingOf({ type: 'qa', front: 'a', back: 'bc' });
      expect(a).not.toBe(b);
    });
  });
});
