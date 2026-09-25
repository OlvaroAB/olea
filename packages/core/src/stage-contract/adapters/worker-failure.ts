/**
 * How a seam's Worker error code reads under the stage contracts. Shared by
 * the adapters whose seams surface the Worker's `ErrorCode` on a thrown
 * error (`WorkerJudgeError`, `WorkerSoloJudgeError`).
 *
 * `grounding-refused` is the one code that is not an operational failure.
 * `olea-contracts`' own doc for it: the task refused rather than invent from
 * empty context (C4.7, INV-5), "a success of the system, not a fault". So it
 * reads as "nothing to work from", which a decision reports as undecided and
 * a writing step as declined, never as unavailable. No decision task returns
 * it today; the reading is fixed here so the day one does, it is not
 * presented to her as an outage.
 *
 * Every other code is `service-refused`, carrying the code. A missing code
 * means the response was unusable for some other reason (both errors'
 * own docs say so), which is `malformed`.
 */

export const GROUNDING_REFUSED_CODE = 'grounding-refused';

export type WorkerErrorReading =
  | { readonly kind: 'nothing-to-work-from' }
  | { readonly kind: 'service-refused'; readonly serviceCode: string }
  | { readonly kind: 'malformed' };

export function readWorkerErrorCode(code: string | undefined): WorkerErrorReading {
  if (code === undefined || code.length === 0) return { kind: 'malformed' };
  if (code === GROUNDING_REFUSED_CODE) return { kind: 'nothing-to-work-from' };
  return { kind: 'service-refused', serviceCode: code };
}
