/**
 * `createPrimingGate` (`ol-egov.141.89.5.85`, [D-311]): lets the materiality feed wait for the
 * previous-text priming pass, so a first save never reads the tracker before priming has marked
 * the notes changed while Obsidian was closed. Pure of `obsidian`.
 *
 * `run` never rejects and always opens the gate, whatever the task does (a failed priming pass
 * must never hold evaluations back); `whenSettled` never rejects. A gate nobody runs stays shut,
 * so the caller opens it by calling `run` (or `skip`) on every path.
 */
export interface PrimingGate {
  readonly whenSettled: Promise<void>;
  run(task: () => Promise<void>): Promise<void>;
  /** Opens the gate without a task (priming skipped). */
  skip(): void;
}

export function createPrimingGate(): PrimingGate {
  let open: () => void = () => {};
  const whenSettled = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    whenSettled,
    async run(task) {
      try {
        await task();
      } catch {
        // priming never blocks evaluation
      } finally {
        open();
      }
    },
    skip: () => open(),
  };
}
