/**
 * One queue per normalised vault path, for whole-file read-modify-writes and deletes
 * (`ol-egov.141.89.104.2`).
 *
 * **The problem.** Every Olea store under `.olea/` rewrites a whole file: it reads the file,
 * works out the new content and writes all of it back. A JSONL "append" is the same thing (read
 * the day's file, write it back with one more line). `VaultSource` has no append, no conditional
 * write and no lock, so two read-modify-writes of one file that overlap in time both read the old
 * bytes, and the second write discards the first one's change.
 *
 * **The rule.** A store runs the whole read, modify and write of one file as one task on that
 * file's queue (`withPathQueue`), and a delete of the file joins the same queue. Tasks on one path
 * run one at a time, in the order they were queued; tasks on different paths run concurrently. So
 * two overlapping writes to one file both land, in issue order, and a write queued before a delete
 * lands first and is then removed by it, never recreating the record afterwards.
 *
 * **Module-wide, keyed by path alone,** like the concept-key store's own queue
 * (`../concept/key-store.ts`): many `VaultSource` objects can front one vault, so the queue cannot
 * live on any one of them. Two unrelated vaults in one process (a test suite) that happen to use
 * one path only wait for each other.
 *
 * **The key** (`pathQueueKey`) is one per file a disk could store the path as: Unicode NFC, empty
 * and `.` segments dropped, and letter case folded, because a case-insensitive disk (the default
 * on macOS and Windows) stores `A.json` and `a.json` as one file. Folding can only make two
 * distinct files share a queue, which costs waiting, never a lost write.
 *
 * **One install only.** Nothing here coordinates two devices, or two installs sharing a vault.
 *
 * **One rule for callers: never queue inside a queued task.** A task that waits on its own
 * path's queue never resumes, and two tasks that each hold one path and wait for the other's
 * never resume either. So a store takes the queue at its public entry point, does that path's read
 * and write inside, and finishes before it touches the next path; a store that must move from one
 * path to another (`../concept/same-as.ts`'s look-up by identity) releases the first first.
 */

import type { VaultPath } from './types.js';

/** The tail of each path's queue: settles when the last task queued on it has settled. */
const tails = new Map<string, Promise<void>>();

/** The queue key for `path` — see the module doc. */
export function pathQueueKey(path: VaultPath): string {
  return path
    .normalize('NFC')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
    .toLowerCase();
}

/**
 * Runs `task` once every task queued before it on `path` has settled, and holds the queue until
 * `task` settles. A rejected task releases the queue exactly as a fulfilled one does, and its
 * rejection reaches only its own caller.
 */
export function withPathQueue<T>(path: VaultPath, task: () => Promise<T>): Promise<T> {
  const key = pathQueueKey(path);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = tails.get(key) ?? Promise.resolve();
  tails.set(key, held);

  const run = before.then(task);
  const settle = (): void => {
    release();
    if (tails.get(key) === held) tails.delete(key);
  };
  run.then(settle, settle);
  return run;
}

/** Test-only: how many paths currently have a task queued or running. */
export function pathQueueDepthForTests(): number {
  return tails.size;
}
