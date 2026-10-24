/**
 * Whether the practice view's passage search can run at all (`[D-629]`, `[D-633]`): the three
 * things `main.ts`'s `composeExplainBackSourceBlocks` needs. `retrieval/wiring.ts` leaves the
 * embedding provider and cache `null` until a Worker token is pasted (F7.8), so no Worker means
 * no search, and the view says it is unavailable instead of reporting a search that found nothing.
 * Pure; here rather than in `main.ts` so a test can run it (`main.ts` imports `obsidian`).
 */
export function explainBackSearchConfigured(parts: {
  readonly embeddingCache: unknown;
  readonly embeddingProvider: unknown;
  readonly keywordIndex: unknown;
}): boolean {
  const present = (value: unknown): boolean => value !== null && value !== undefined;
  return (
    present(parts.embeddingCache) && present(parts.embeddingProvider) && present(parts.keywordIndex)
  );
}
