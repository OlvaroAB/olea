/**
 * `buildWorld` — one seeded constructor bundling a review stream, a
 * curriculum and a corpus under a single inherited provenance stamp
 * (`olea-service`'s `ol-opmb.1` [TB-1]).
 *
 * `./curriculum.js` and `./corpus.js` are deterministic constants over the
 * fixed vocabulary (`./vocabulary.js`) — nothing about them varies with
 * `spec`. Only `stream` does: it is `generateStream` over the `StreamSpec`
 * this `WorldSpec` implies, so a `SyntheticWorld` is exactly "a persona's
 * fabricated ninety days, plus the fixed curriculum and corpus those days'
 * concepts are evidence for." See `curriculum.ts`'s module doc for why the
 * three pieces agree on concept identity without any relabelling step: they
 * all key on `./vocabulary.js`'s own `CONCEPTS`/`COURSES` ids.
 */

import { buildCorpus, type SyntheticCorpus } from './corpus.js';
import { buildCurriculum, type SyntheticCurriculum } from './curriculum.js';
import { generateStream, type StreamSpec, type SyntheticStream } from './generate.js';
import type { PersonaId } from './personas.js';
import { joinProvenance, type WorldProvenance } from './provenance.js';

export interface WorldSpec {
  readonly persona: PersonaId;
  readonly seed: string;
  readonly startDate: string;
  readonly days: number;
  readonly deviceId: string;
  readonly utcOffset: string;
  readonly assessmentDayOffsets: readonly number[];
}

export interface SyntheticWorld {
  readonly provenance: WorldProvenance;
  readonly spec: WorldSpec;
  readonly stream: SyntheticStream;
  readonly curriculum: SyntheticCurriculum;
  readonly corpus: SyntheticCorpus;
}

function toStreamSpec(spec: WorldSpec): StreamSpec {
  return {
    persona: spec.persona,
    seed: spec.seed,
    startDate: spec.startDate,
    days: spec.days,
    deviceId: spec.deviceId,
    utcOffset: spec.utcOffset,
    assessmentDayOffsets: spec.assessmentDayOffsets,
  };
}

/**
 * Build a world. Deterministic: same `spec` in, byte-identical `stream` out
 * (`generateStream`'s own property), and `curriculum`/`corpus` are constants,
 * so the whole `SyntheticWorld` is a pure function of `spec`.
 */
export function buildWorld(spec: WorldSpec): SyntheticWorld {
  const stream = generateStream(toStreamSpec(spec));
  return {
    provenance: joinProvenance(stream.provenance),
    spec,
    stream,
    curriculum: buildCurriculum(),
    corpus: buildCorpus(),
  };
}
