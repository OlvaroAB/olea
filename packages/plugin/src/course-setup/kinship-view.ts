/**
 * Draws the kinship question C7.8 (`[D-098]`, point 4) puts at the same
 * moment recognition fires — see `./kinship-copy.ts` for the full clause
 * citation and the "different control, different object" boundary this
 * module holds in the DOM: it renders into its OWN `<section>`, separate
 * from `./view.ts`'s `renderRecognitionClaims` output, so nothing here can
 * read as part of F8.7's claim block.
 *
 * Plain DOM (`document.createElement`), matching `./view.ts`'s own reasoning
 * for staying Obsidian-free: whatever hosts the confirmation surface
 * (`./confirmation-view.ts`) can mount this into any container it owns, and
 * it stays testable under Vitest without a real Obsidian host.
 *
 * Ships wholly unstyled — bare `<p>` and `<button>` with no authored
 * `color`/`background` — the same theme-resilience position
 * `bulk-review-view.ts` documents in `styles.css`: nothing here reads a host
 * variable, so nothing here can read a wrong branch. A stylesheet for this
 * surface is separate work.
 *
 * ## "Asked once" is a caller obligation, not something this module can enforce
 *
 * This module is pure rendering: it has no access to any persisted course
 * record and cannot know whether kinship was already answered. **The caller
 * must not invoke `renderKinshipControl` once a course's kinship link is
 * already set** — `features/F1-sources.md`'s "kinship is asked once, at the
 * recognition moment" scenario is discharged by that caller-side check, which
 * belongs with whatever eventually persists the answer (unbuilt — see
 * ol-0r92.5's report).
 */

import { KINSHIP_NO_LABEL, KINSHIP_YES_LABEL, kinshipQuestion } from './kinship-copy.js';

export type KinshipAnswer = 'yes' | 'no';

export interface KinshipControlOptions {
  /** The earlier course recognition already named — never computed here, see `./kinship-copy.ts`. */
  readonly candidateCourse: string;
  /** Fires exactly once, on whichever control she presses. */
  readonly onAnswer: (answer: KinshipAnswer) => void;
}

/** One `<section>` holding the question and its two controls. Appended to `container`. */
export function renderKinshipControl(
  container: HTMLElement,
  options: KinshipControlOptions,
): HTMLElement {
  const { candidateCourse, onAnswer } = options;
  const doc = container.ownerDocument;

  const section = doc.createElement('section');
  section.className = 'olea-kinship-question';

  const question = doc.createElement('p');
  question.className = 'olea-kinship-question-text';
  question.textContent = kinshipQuestion(candidateCourse);
  section.appendChild(question);

  const controls = doc.createElement('div');
  controls.className = 'olea-kinship-controls';

  const yesButton = doc.createElement('button');
  yesButton.type = 'button';
  yesButton.className = 'olea-kinship-yes';
  yesButton.textContent = KINSHIP_YES_LABEL;
  yesButton.addEventListener('click', () => onAnswer('yes'));
  controls.appendChild(yesButton);

  const noButton = doc.createElement('button');
  noButton.type = 'button';
  noButton.className = 'olea-kinship-no';
  noButton.textContent = KINSHIP_NO_LABEL;
  noButton.addEventListener('click', () => onAnswer('no'));
  controls.appendChild(noButton);

  section.appendChild(controls);
  container.appendChild(section);
  return section;
}
