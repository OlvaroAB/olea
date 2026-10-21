/**
 * The paper-context wire fragment for `quiz.generate.v1` and `cards.generate.v1`
 * (`[D-561]` the earlier part's question, `[D-562]` a group's shared passage; the service-repo
 * build bead is `ol-egov.141.89.7.97`, cited by id — private repo).
 *
 * Like `./authoring-demand.ts`, this file does not restate either task's request or response body;
 * it fixes only the ONE additive request fragment, so the client caller and the Worker parse with a
 * single definition and a drift check (`contracts/` in the service is a vendored copy) can see it
 * move. There is no response change.
 *
 * Request, all optional; absent means today's request, byte for byte:
 *
 *  - `earlierParts` — for a paper part that builds on earlier ones, the earlier parts' questions
 *    (and their answers, when written), in paper order. One to ten entries.
 *  - `sharedPassage` — for a group of parts that share one stimulus, that passage as text, with its
 *    form. A figure is not a form here: its content is not text, so it cannot travel in this field.
 *
 * Both are her held material that travels transiently, like `sourceChunks` (D-005): the Worker
 * builds a prompt from them and forgets them. Neither is ever trimmed or normalised here.
 */

import { z } from 'zod';

/** At most this many earlier parts travel with one request. */
export const AUTHORING_EARLIER_PARTS_LIMIT = 10;

/** The longest `question`, and the longest `answer`, of one earlier part, in characters. */
export const AUTHORING_EARLIER_PART_MAX_CHARS = 2000;

/**
 * The forms a shared passage may take: core's `PAPER_STIMULUS_FORMS` without `figure`, because a
 * figure's content is not text.
 */
export const AUTHORING_SHARED_PASSAGE_FORMS = Object.freeze([
  'scenario',
  'extract',
  'table',
  'data-set',
] as const);

/** The longest shared passage, in characters. */
export const AUTHORING_SHARED_PASSAGE_MAX_CHARS = 6000;

const notBlank = (value: string): boolean => value.trim() !== '';

/** One earlier part: its question, and its answer when it has been written. */
export const authoringEarlierPart = z.object({
  question: z
    .string()
    .max(AUTHORING_EARLIER_PART_MAX_CHARS)
    .refine(notBlank, { message: 'question must not be blank.' }),
  answer: z.string().max(AUTHORING_EARLIER_PART_MAX_CHARS).optional(),
});
export type AuthoringEarlierPart = z.infer<typeof authoringEarlierPart>;

/** The request's earlier parts, optional; when present, one to ten entries. */
export const authoringEarlierPartsField = z
  .array(authoringEarlierPart)
  .min(1)
  .max(AUTHORING_EARLIER_PARTS_LIMIT)
  .optional();

/** A group's shared passage: its form and its text. */
export const authoringSharedPassage = z.object({
  form: z.enum(AUTHORING_SHARED_PASSAGE_FORMS),
  text: z
    .string()
    .max(AUTHORING_SHARED_PASSAGE_MAX_CHARS)
    .refine(notBlank, { message: 'text must not be blank.' }),
});
export type AuthoringSharedPassage = z.infer<typeof authoringSharedPassage>;

/** The request's shared passage, optional. */
export const authoringSharedPassageField = authoringSharedPassage.optional();
