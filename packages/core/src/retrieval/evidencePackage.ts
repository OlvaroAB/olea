/**
 * The evidence package builder (`docs/dev/intelligence-build/evd.md` §2 and
 * §3, `[ILB-EVD-4]`) — the pure step between grounded chunks and what the
 * sufficiency decision (`grounding.judge.v1` and its successors) is actually
 * asked about.
 *
 * **Aliases are request-local and stable in input order** (`p1`, `p2`, …,
 * one per `chunks` entry in the order it was passed) — never derived from
 * `blockIndex` or sorted by anything, so two packages built from the same
 * chunks in the same order are byte-identical, and a caller citing `p3` in a
 * decision-stage response always means "the third passage this package
 * carried," nothing else.
 *
 * **The digest is computed by an injected async hasher, not `hashText`
 * (`../ingestion/hash.ts`).** That module already exists and already wraps
 * `globalThis.crypto.subtle` for exactly this repo's cross-platform reason
 * (INV-1: desktop and mobile Obsidian both need it) — but hard-wiring it
 * here would make every test in this file's spec an async round-trip
 * through real SHA-256 for no assertion that cares about the actual digest
 * value, only about digest *identity* (same text, same digest; different
 * text, different digest) and about *where* it lands in the package.
 * Injecting the hasher keeps that testable with a trivial fake and keeps
 * this module honest about depending on nothing platform-specific — a
 * caller in production is free to pass `hashText` itself.
 *
 * **`sourceRevisions` is a caller-supplied fact, like `courseOf` in
 * `scopeFilter.ts`.** `GroundedChunk` carries no revision/version field of
 * its own (`groundedContext.ts`), so there is nothing in a chunk this module
 * could derive a "has this source changed since it was embedded" answer
 * from. `revisionOf` is optional; a caller with no revision source yet gets
 * `undefined` for every path, which is the honest "unknown" this field is
 * for rather than a manufactured value.
 *
 * **`conflicts` is always `[]` in this pure-logic build.** Detecting that
 * two passages disagree is the decision stage's job (`evd.md` §3's
 * `conflicting` verdict) — this builder only reserves the slot the wire
 * shape needs so a later stage has somewhere to write into without another
 * schema change.
 */

import type { VaultPath } from '../vault/types.js';
import type { GroundedChunk } from './groundedContext.js';

/** One passage in an evidence package, addressable by its request-local alias. */
export interface EvidencePassage {
  readonly alias: string;
  readonly sourcePath: VaultPath;
  readonly blockIndex: number;
  readonly passageDigest: string;
  readonly text: string;
}

/**
 * A reserved, unpopulated shape for a detected disagreement between two
 * passages — see this module's doc for why `buildEvidencePackage` never
 * produces one yet.
 */
export interface EvidenceConflict {
  readonly aliases: readonly [string, string];
  readonly note: string;
}

export interface EvidencePackage {
  readonly passages: readonly EvidencePassage[];
  /** Keyed by `sourcePath`; `undefined` where no revision fact is known for that source. */
  readonly sourceRevisions: Readonly<Record<string, string | undefined>>;
  readonly conflicts: readonly EvidenceConflict[];
}

export interface BuildEvidencePackageDeps {
  /** Computes `passageDigest` from a passage's own text. Injected so this module never touches platform crypto directly — see this file's doc. */
  readonly hash: (text: string) => Promise<string>;
  /** Resolves a source's current revision marker, if the caller has one. Omit to leave every `sourceRevisions` entry `undefined`. */
  readonly revisionOf?: (sourcePath: VaultPath) => string | undefined;
}

/**
 * Builds an `EvidencePackage` from grounded chunks, in the order they were
 * given. Pure apart from the injected `deps.hash` call — no network, no
 * platform crypto, no ordering decision of its own (a caller that wants a
 * particular passage order, e.g. retrieval rank, orders `chunks` before
 * calling this).
 */
export async function buildEvidencePackage(
  chunks: readonly GroundedChunk[],
  deps: BuildEvidencePackageDeps,
): Promise<EvidencePackage> {
  const passages: EvidencePassage[] = [];
  const sourceRevisions: Record<string, string | undefined> = {};

  let index = 0;
  for (const chunk of chunks) {
    index += 1;
    const passageDigest = await deps.hash(chunk.text);
    passages.push({
      alias: `p${index}`,
      sourcePath: chunk.path,
      blockIndex: chunk.blockIndex,
      passageDigest,
      text: chunk.text,
    });

    if (!(chunk.path in sourceRevisions)) {
      sourceRevisions[chunk.path] = deps.revisionOf?.(chunk.path);
    }
  }

  return { passages, sourceRevisions, conflicts: [] };
}
