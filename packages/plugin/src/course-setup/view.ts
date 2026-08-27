/**
 * F8.7's recognition claim, drawn as a static block of facts (`RECOG-1`,
 * `[D-058]`).
 *
 * Plain DOM (`document.createElement`), not Obsidian's `createDiv`/`createSpan`
 * extensions — deliberately, because **no course-setup screen exists anywhere
 * in this codebase to host an `ItemView` on** (component register row 4.5:
 * "no course-setup trigger event to hang it on"; a repo-wide search for
 * course-setup UI turns up nothing). Building on plain DOM means whatever
 * eventually hosts this — a modal, a settings tab, a workbench panel — can
 * call `renderRecognitionClaims` against any container it owns, and this file
 * itself is testable under Vitest without a real Obsidian host, the same
 * reason `insights/` and other core-adjacent modules stay Obsidian-free.
 *
 * ## What this deliberately does not draw
 *
 * No button, no checkbox, no link reading "confirm" / "merge" / "accept" /
 * "dismiss" — F8.7 in full: *"she is not asked to confirm, merge or accept
 * anything, there is no decision to make, and declining is not a state."*
 * There is nothing here for her to press: `renderClaim` below creates exactly
 * three `<p>` elements per claim and nothing with a `role`, an event handler
 * or an `href`. **This file has no test of its own** — same accepted boundary
 * `sprig/render-sprig.ts`'s `renderSprig` and `today/view.ts` already carry:
 * this workspace has no DOM test environment (no `jsdom`/`happy-dom`
 * dependency), and adding one to exercise a single view module is not this
 * bead's call to make against a shared lockfile. What IS asserted, in
 * `test/course-setup/copy.spec.ts`, is that `RecognitionClaimCopy` — every
 * field this file reads — never carries a confirm/merge/accept/decline
 * string; a renderer with no action field to draw from cannot draw one.
 *
 * The kinship question C7.8 (`[D-098]`) puts at the same moment — "a
 * continuation of the earlier course?" — is a DIFFERENT control about a
 * DIFFERENT object (the two course records, not this concept-level claim, per
 * the scenario in `features/F8-concepts-scope.md`). It is now built at
 * `./kinship-view.ts`, hosted alongside this module's `renderRecognitionClaims`
 * by `./confirmation-view.ts` (`ol-0r92.5`), in its own separate `<section>` —
 * this module still draws nothing that could be mistaken for it, and
 * `renderRecognitionClaims` itself is unchanged.
 */

import { RECOGNITION_CLAIM_HEADING, type RecognitionClaimCopy } from './copy.js';

/** One `<section>` per recognised concept, or nothing at all when `claims` is empty. */
export function renderRecognitionClaims(
  container: HTMLElement,
  claims: readonly RecognitionClaimCopy[],
): void {
  if (claims.length === 0) return;

  const root = container.ownerDocument.createElement('section');
  root.className = 'olea-recognition-claims';

  const heading = container.ownerDocument.createElement('h3');
  heading.className = 'olea-recognition-heading';
  heading.textContent = RECOGNITION_CLAIM_HEADING;
  root.appendChild(heading);

  for (const claim of claims) {
    root.appendChild(renderClaim(container.ownerDocument, claim));
  }

  container.appendChild(root);
}

function renderClaim(doc: Document, claim: RecognitionClaimCopy): HTMLElement {
  const article = doc.createElement('article');
  article.className = 'olea-recognition-claim';
  article.dataset.conceptId = claim.conceptId;

  const courses = doc.createElement('p');
  courses.className = 'olea-recognition-courses';
  // Real course codes, from the vault at runtime — never a string from
  // `copy.ts` (see that module's doc).
  courses.textContent = claim.earlierCourses.join(', ');
  article.appendChild(courses);

  const stage = doc.createElement('p');
  stage.className = 'olea-recognition-stage';
  stage.textContent = claim.vitality === null ? claim.stage : `${claim.stage} — ${claim.vitality}`;
  article.appendChild(stage);

  const evidence = doc.createElement('p');
  evidence.className = 'olea-recognition-evidence';
  evidence.textContent = claim.evidence;
  article.appendChild(evidence);

  return article;
}
