/**
 * The course-setup confirmation surface (`ol-0r92.5`, `[D-098]`): the host
 * `packages/core/src/today/earlier-course-recognition.ts`'s own module doc
 * names as genuinely missing — *"no course-setup trigger event to hang it
 * on ... whoever eventually builds that confirmation flow calls this
 * function with the course being confirmed"* — and the host `./view.ts`'s
 * doc names for the kinship control by the same gap. This module is that
 * host: it renders the BEGINNING-of-course confirmation (`./confirmation-copy.ts`,
 * C7.8/`[D-098]` point 1), the kinship question (`./kinship-view.ts`, point 4)
 * when a candidate is offered, and F8.7's recognition claims
 * (`./view.ts`'s `renderRecognitionClaims`) — three separate DOM subtrees in
 * one screen, matching `features/F8-concepts-scope.md`'s "the kinship
 * question ... is about the course, not about the recognition" scenario:
 * nothing here folds the three into a single control.
 *
 * ## What this module does NOT build
 *
 * - **Detection itself** (the root-path proposal, `features/F1-sources.md`'s
 *   `core/course/lifecycle.spec` / `core/course/mapping.spec`) is core-side
 *   and unbuilt. `CourseSetupProposal` is taken as an explicit input, the
 *   same "caller supplies the fact" split `earlier-course-recognition.ts`
 *   uses for `newCourse` — whoever builds detection calls this module with
 *   its output.
 * - **Per-document exceptions and root-path editing** (`features/F1-sources.md`
 *   scenario "the mapping is root paths with per-document exceptions") are a
 *   separate, later surface for managing an already-confirmed course's
 *   mapping — out of scope for the initial confirmation screen, which shows
 *   the proposed root path as information only.
 * - **The paused/upcoming entry state** (C7.8/`[D-098]` point 2's START
 *   sentence, `features/F1-sources.md` scenario "a course may be set up
 *   paused or upcoming") is a real, clause-backed affordance this module
 *   deliberately omits — recorded as a gap in `ol-0r92.5`'s report rather
 *   than added speculatively; setup-confirmation through this surface always
 *   implies running.
 * - **Persistence.** `onConfirm` hands the caller a plain result; writing a
 *   `CourseRecord` (Class C persisted-schema addition per `[D-098]`'s close
 *   reason) is not this module's decision to make.
 *
 * ## No DOM test for this file
 *
 * Same accepted boundary `./view.ts` and `bulk-review-view.ts` already carry:
 * this workspace has no DOM test environment (no `jsdom`/`happy-dom`
 * dependency, and adding one is a shared-lockfile decision outside this
 * lane's file ownership). `./confirmation-copy.ts`, `./kinship-copy.ts` and
 * `./copy.ts` carry the corpus tests instead. Ships wholly unstyled — no
 * `styles.css` rule added — for the same theme-resilience reason
 * `bulk-review-view.ts` documents.
 */

import {
  CONFIRM_BUTTON_LABEL,
  COURSE_NAME_FIELD_LABEL,
  COURSE_PROPOSAL_HEADING,
} from './confirmation-copy.js';
import type { RecognitionClaimCopy } from './copy.js';
import { type KinshipAnswer, renderKinshipControl } from './kinship-view.js';
import { renderRecognitionClaims } from './view.js';

/** What detection would propose, taken as given — see this module's doc. */
export interface CourseSetupProposal {
  /** Detection's suggested name — she may accept or overwrite it. */
  readonly suggestedName: string;
  /** Shown as information only; editing exceptions is a later surface, not this one. */
  readonly rootPath: string;
}

export interface CourseSetupConfirmationResult {
  /** The name field's value at confirm time — her edit if she made one, the suggestion otherwise. */
  readonly name: string;
  /** `null` when no kinship control was rendered, or when she confirmed without answering it. */
  readonly kinshipAnswer: KinshipAnswer | null;
}

export interface CourseSetupConfirmationOptions {
  readonly proposal: CourseSetupProposal;
  /**
   * The earlier course to ask about, when recognition surfaced kinship at
   * this same setup moment. Omit entirely to render no kinship control —
   * never pass a candidate the caller has not itself checked is still
   * unanswered (see `./kinship-view.ts`'s "asked once" note).
   */
  readonly kinshipCandidateCourse?: string;
  /** F8.7's recognition claims for this course, already built by `./copy.ts`'s `buildRecognitionClaimCopy`. */
  readonly recognitionClaims: readonly RecognitionClaimCopy[];
  /** Fires once, when she presses confirm. */
  readonly onConfirm: (result: CourseSetupConfirmationResult) => void;
}

/** Renders the whole confirmation screen into `container`. */
export function renderCourseSetupConfirmation(
  container: HTMLElement,
  options: CourseSetupConfirmationOptions,
): void {
  const { proposal, kinshipCandidateCourse, recognitionClaims, onConfirm } = options;
  const doc = container.ownerDocument;

  const root = doc.createElement('section');
  root.className = 'olea-course-setup-confirmation';

  const heading = doc.createElement('h2');
  heading.className = 'olea-course-setup-heading';
  heading.textContent = COURSE_PROPOSAL_HEADING;
  root.appendChild(heading);

  const nameLabel = doc.createElement('label');
  nameLabel.className = 'olea-course-setup-name-label';
  nameLabel.textContent = COURSE_NAME_FIELD_LABEL;
  const nameInput = doc.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'olea-course-setup-name-input';
  nameInput.value = proposal.suggestedName;
  nameLabel.appendChild(nameInput);
  root.appendChild(nameLabel);

  const rootPathLine = doc.createElement('p');
  rootPathLine.className = 'olea-course-setup-root-path';
  rootPathLine.textContent = proposal.rootPath;
  root.appendChild(rootPathLine);

  let kinshipAnswer: KinshipAnswer | null = null;
  if (kinshipCandidateCourse !== undefined) {
    renderKinshipControl(root, {
      candidateCourse: kinshipCandidateCourse,
      onAnswer: (answer) => {
        kinshipAnswer = answer;
      },
    });
  }

  renderRecognitionClaims(root, recognitionClaims);

  const confirmButton = doc.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'olea-course-setup-confirm';
  confirmButton.textContent = CONFIRM_BUTTON_LABEL;
  confirmButton.addEventListener('click', () => {
    onConfirm({ name: nameInput.value, kinshipAnswer });
  });
  root.appendChild(confirmButton);

  container.appendChild(root);
}
