/**
 * Course-scoped identities for a wording a course's own assessment documents name but only another
 * course holds (`[D-544]`, ruled by David 2026-10-17, `ol-egov.141.89.3.52`).
 *
 * **The ruling.** "Create the course-scoped identity and same-as proposal." Before it, when course
 * C's registered past papers, objectives or declared assessment scope named a wording whose only
 * concept identity was course D's, C's assessment edges took D's identity: C ranked D's concept,
 * served D's instruments through its own rows, and could draft nothing for what it ranked. That is
 * the case `[D-402]` left open (identical wording is never enough to say two courses mean one
 * concept, and each course keeps its own assessment demand), and `[D-544]` answers it the way
 * `[D-402]` answers a split wording: C gets an identity of its own, and whether the two are one
 * concept is hers to say, through a same-as proposal she confirms or declines in F8.4a's identity
 * section. Nothing is confirmed automatically (`[D-295]`), even on an exact match (F8.6).
 *
 * **What the identity is.** A tier-3 identity (found only in her course documents) anchored on the
 * course and the wording, `{ kind: 'topic', course, name }`, with the course's own citing
 * documents as its introducing material. That is the anchor `./extract.ts` would give a topic-only
 * concept of that course, so if her course material later names the wording too, extraction finds
 * this same key rather than minting a second one. The other course's identities are recorded at
 * mint (`./key-store.ts`'s `ConceptKeyRequest.collisionsWith`), and the ingestion tick's
 * `proposeSameAsFromMintCollisions` turns each into one proposed same-as link: no new proposal
 * route and no new persisted shape.
 *
 * **What the identity does not carry.** No instruments, no mastery and no material from the other
 * course. A confirmed same-as link lets the identity readers (earlier-course recognition, the
 * retrospective, the concept read) read the two as one concept, and nothing more: identity
 * equivalence, assessment relevance and permission to reuse another course's material are separate
 * decisions (David, 2026-10-17). The assessment edges never read same-as links, so each course's
 * assessments keep ranking only its own identity, and drafting retrieval is scoped to the course's
 * own reading set whatever the link says (`../retrieval/course-reading-set.ts`).
 *
 * **Stamped or not.** With `stampConceptKeys` the identity is resolved through the key store,
 * looked up first and minted only the first time, exactly as extraction resolves every other
 * identity. Without it (a caller that keys concepts provisionally, such as a test or the
 * workbench), a provisional stand-in qualified by the course is returned, the same shape
 * `./extract.ts` gives a wording split by course, and nothing is written.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import type { OpaqueKeyNonceSource } from './concept-key.js';
import { provisionalConceptKey } from './concept-key.js';
import { resolveConceptKeys } from './key-store.js';

/** One course-scoped identity to resolve: the course, its wording, and what it was split from. */
export interface CourseScopedIdentityRequest {
  readonly course: string;
  /** The wording verbatim, as the course's documents matched it (R1/R2). */
  readonly name: string;
  /** The course's own documents that name the wording: the identity's introducing material. */
  readonly introducingPaths: readonly VaultPath[];
  /** The other courses' identities carrying the wording, each proposed as a same-as link at mint. */
  readonly otherKeys: readonly string[];
}

export interface ResolveCourseScopedIdentitiesOptions {
  /** Resolve through the persisted key store (see the module doc). Off by default, like extraction. */
  readonly stampConceptKeys?: boolean;
  /** Injectable for deterministic tests; passed to the key store. */
  readonly now?: () => string;
  /** Injectable for deterministic tests; passed to the key store. */
  readonly generateKey?: OpaqueKeyNonceSource;
}

/** The provisional stand-in for `name`'s identity in `course` — `./extract.ts`'s split-wording shape. */
export function courseScopedStandInKey(name: string, course: string): string {
  return `${provisionalConceptKey({ name, boundNotePath: null })}@${course}`;
}

/**
 * The key of each request's course-scoped identity, in order (module doc). One store turn for the
 * whole batch when stamping, so a second pass running at the same time finds what this one minted.
 */
export async function resolveCourseScopedIdentities(
  vault: VaultSource,
  requests: readonly CourseScopedIdentityRequest[],
  options: ResolveCourseScopedIdentitiesOptions = {},
): Promise<readonly string[]> {
  if (options.stampConceptKeys !== true) {
    return requests.map(({ name, course }) => courseScopedStandInKey(name, course));
  }
  return resolveConceptKeys(
    vault,
    requests.map(({ course, name, introducingPaths, otherKeys }) => ({
      tier: 3,
      anchor: {
        kind: 'topic',
        course,
        name,
        aliases: [],
        introducingPaths: [...new Set(introducingPaths)].sort(),
      },
      collisionsWith: otherKeys,
    })),
    {
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.generateKey !== undefined ? { generateKey: options.generateKey } : {}),
    },
  );
}
