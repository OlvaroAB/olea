/**
 * The spend limit's declared numbers and each task's per-call price ceiling (`[D-540]`, client half
 * `ol-egov.141.89.7.76`). Pure: no clock, no vault, no network.
 *
 * **Nothing here is fitted on the client.** Each number is either a ruling's (the USD 12 limit and
 * its 80 percent pause from `[D-535]`/`[D-540]`, the 120-day period, the combined maximum of two
 * billable calls per request) or a price, an output ceiling or a prompt length read from the service
 * at a cited place; the ceilings are the service's ruled numbers (`[D-389]`), and only the numbers
 * travel here. Source for the per-call ceilings: the service repo's
 * `docs/direction/papers/examiner-scope-status/11-driver-cost.md`, section 3 (per call at the output
 * ceiling with a 20k-token input overbound: `demand.classify.v1` USD 0.0223, `outcomes.align.v1`
 * USD 0.0776) and section 9.4 (the hold is twice that; outcome extraction shares the limit, on the
 * bulk slot at USD 0.10 / 0.30 per million tokens with a 94,208-token output ceiling, and its input
 * "depends on the document"). The rates are the service's `src/slots.ts` (slot J, slot G); the
 * output ceilings are its `src/modelCeilings.ts` (`[D-389]`).
 *
 * **The input bound grows with the request, never shrinks below the paper's.** Section 9.4: "The
 * client sizes it as the Worker does (`reservationTokens`, 2 x characters / 3) over the payload plus
 * a declared per-task allowance for the prompt text it does not see", and "a test must show the
 * hold fits the largest part". So a call's input bound is the larger of section 3's 20,000-token
 * overbound and the Worker's own reservation estimate over the payload's characters plus that
 * allowance. A hold therefore never falls below the paper's figure, and it covers the Worker's
 * worst case for two attempts on a request of any size, so the Worker never refuses a call for want
 * of allowance that the client meant to grant.
 */

/** `[D-535]`: the one limit shared by the scope reads and outcome extraction, in USD. */
export const SPEND_LIMIT_USD = 12;

/** `[D-540]` item 3: the scope-reading drivers admit no new call past this share of the limit (USD 9.60). */
export const SCOPE_READING_PAUSE_FRACTION = 0.8;

/** `[D-540]` item 2: a ledger entry counts for this many days after its time (UTC), then drops out. */
export const SPEND_PERIOD_DAYS = 120;

/** A hold with no settle or release after this long is reported stale; it still counts at its hold value. */
export const STALE_HOLD_HOURS = 24;

/** `[D-540]` item 1: the most billable model calls one request may make, parse and transport retries together. */
export const BILLABLE_CALLS_PER_REQUEST = 2;

/** Section 3's input overbound per call, in tokens: the largest measured alignment prompt. */
export const DECLARED_INPUT_OVERBOUND_TOKENS = 20_000;

/**
 * The Worker's reservation estimate, restated: `reservationTokens` = ceil(2.0 x characters / 3)
 * (service `src/tokenEstimate.ts`, `RESERVATION_SAFETY_FACTOR` 2.0 over `ESTIMATED_CHARS_PER_TOKEN`
 * 3). The Worker checks an allowance against this estimate of the rendered prompt.
 */
export const RESERVATION_TOKENS_PER_CHARACTER = 2 / 3;

/** The three tasks the ledger prices. Any other task id is not admitted (fails closed). */
export const SPEND_TASK_IDS = [
  'demand.classify.v1',
  'outcomes.align.v1',
  'outcomes.extract.v1',
] as const;
export type SpendTaskId = (typeof SPEND_TASK_IDS)[number];

export interface SpendTaskPrice {
  readonly taskId: SpendTaskId;
  /** The service slot the task runs on. */
  readonly slot: 'J' | 'G';
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  /** The task's enforced output ceiling per call (`[D-389]`). */
  readonly outputCeilingTokens: number;
  /**
   * Characters allowed for the prompt text the client does not send: twice the task's system
   * prompt at the version read (service `prompts/<task>/system.prompt.md`), rounded up to the next
   * thousand, so the rendered user message's labels fit too.
   */
  readonly promptAllowanceChars: number;
  /** True for the scope reads, which pause at {@link SCOPE_READING_PAUSE_FRACTION}; outcome extraction runs to the limit. */
  readonly pausesForScopeReading: boolean;
}

export const SPEND_TASK_PRICES: Readonly<Record<SpendTaskId, SpendTaskPrice>> = {
  // Slot J (`@cf/nvidia/nemotron-3-120b-a12b`, USD 0.50 / 1.50 per million); ceiling 8,192 (13.3,
  // `modelCeilings.ts`); system prompt 4,430 characters at prompt 1.0.0.
  'demand.classify.v1': {
    taskId: 'demand.classify.v1',
    slot: 'J',
    inputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 1.5,
    outputCeilingTokens: 8_192,
    promptAllowanceChars: 9_000,
    pausesForScopeReading: true,
  },
  // Slot J; ceiling 45,056 (13.2); system prompt 5,920 characters at prompt 1.1.0.
  'outcomes.align.v1': {
    taskId: 'outcomes.align.v1',
    slot: 'J',
    inputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 1.5,
    outputCeilingTokens: 45_056,
    promptAllowanceChars: 12_000,
    pausesForScopeReading: true,
  },
  // Slot G (`@cf/google/gemma-4-26b-a4b-it`, USD 0.10 / 0.30 per million); ceiling 94,208
  // (`OUTCOMES_EXTRACT_DERIVED_CEILING`); system prompt 9,751 characters at prompt 1.2.0.
  'outcomes.extract.v1': {
    taskId: 'outcomes.extract.v1',
    slot: 'G',
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.3,
    outputCeilingTokens: 94_208,
    promptAllowanceChars: 20_000,
    pausesForScopeReading: false,
  },
};

export function isSpendTaskId(taskId: string): taskId is SpendTaskId {
  return (SPEND_TASK_IDS as readonly string[]).includes(taskId);
}

/** USD as whole micro-dollars, rounded UP after removing float noise below a nano-dollar: a sum of these never under-counts. */
export function toMicroUsd(usd: number): number {
  return Math.ceil(Math.round(usd * 1e9) / 1e3);
}

/** The input tokens one call is priced at: section 3's overbound, or the Worker's estimate over the payload and the prompt allowance, whichever is larger. */
export function inputBoundTokens(taskId: SpendTaskId, payloadChars: number): number {
  const chars =
    Math.max(0, Math.ceil(payloadChars)) + SPEND_TASK_PRICES[taskId].promptAllowanceChars;
  return Math.max(
    DECLARED_INPUT_OVERBOUND_TOKENS,
    Math.ceil(RESERVATION_TOKENS_PER_CHARACTER * chars),
  );
}

/** One call's worst-case price in USD: the input bound at the input rate plus the output ceiling at the output rate. */
export function perCallCeilingUsd(taskId: SpendTaskId, payloadChars = 0): number {
  const price = SPEND_TASK_PRICES[taskId];
  return (
    (inputBoundTokens(taskId, payloadChars) * price.inputUsdPerMillionTokens +
      price.outputCeilingTokens * price.outputUsdPerMillionTokens) /
    1e6
  );
}

/**
 * The hold reserved before one request: the per-call ceiling times {@link BILLABLE_CALLS_PER_REQUEST},
 * rounded up to a whole micro-dollar. It is also the request's `remainingAllowanceUsd`.
 */
export function holdUsdFor(taskId: SpendTaskId, payloadChars = 0): number {
  return toMicroUsd(perCallCeilingUsd(taskId, payloadChars) * BILLABLE_CALLS_PER_REQUEST) / 1e6;
}

/**
 * What one line the reader cannot trust counts as (`[D-540]` hub change 1): the largest declared
 * hold of any task at section 3's input overbound (today `outcomes.align.v1`'s, USD 0.155168).
 */
export const WORST_CASE_HOLD_USD: number = Math.max(
  ...SPEND_TASK_IDS.map((taskId) => holdUsdFor(taskId)),
);
