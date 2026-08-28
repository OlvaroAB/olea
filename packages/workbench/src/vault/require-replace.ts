/**
 * `requireReplace` — a byte-exact, fail-loud string replacement shared by the
 * workbench's read-only vault overlays (`../oracle/fixture-oracle-vault.ts`,
 * `./session-no-cards-vault.ts`). Both patch specific bytes of the real,
 * frozen `packages/core/fixtures/vault/` on read, and both need the same
 * discipline: if the literal text an overlay expects has drifted (the
 * fixture note was edited upstream, by a different bead entirely), the
 * overlay must say so loudly rather than silently no-op and leave whatever
 * gap-class or session-composition finding it exists to produce quietly
 * wrong again.
 *
 * Deliberately narrow — exactly one occurrence, exact match, throws
 * otherwise — so a call site's failure always means "this note's bytes
 * moved," never "there were two matches and the wrong one got replaced."
 */
export function requireReplace(
  content: string,
  literal: string,
  replacement: string,
  where: string,
): string {
  const count = content.split(literal).length - 1;
  if (count !== 1) {
    throw new Error(
      `requireReplace: expected exactly one occurrence of ${JSON.stringify(literal)} in ` +
        `${where}, found ${count} — the fixture vault's content has moved; update the overlay ` +
        'to match.',
    );
  }
  return content.replace(literal, replacement);
}
