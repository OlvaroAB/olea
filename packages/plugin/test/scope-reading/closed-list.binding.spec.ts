/** `buildClosedList` through the REAL enumeration: a definition binds only when the concept's name is a note title reached by a link from a course note (`ol-egov.141.89.7.74`). Invented wording only. */

import { describe, expect, it } from 'vitest';
import { buildClosedList } from '../../src/scope-reading/closed-list.js';
import { COURSE, setup } from './drivers-kit.js';

/**
 * Why the older fixtures bound nothing: `drivers-kit.ts` `conceptNotes` puts course notes under
 * `Courses/`, but the default courses folder is `01 Courses` (core `concept/course.ts:47`), and
 * `courseFromPath` (`course.ts:63`) returns undefined for any other prefix. The link closure
 * (`extract.ts` `resolveLinkClosure`) skips such notes, so no Zettelkasten note is reachable, the
 * concept stays tier 2, and `definition` / `boundNotePath` are never set. The fixture, not
 * production code. Binding needs: a course note under `01 Courses/<course>/`, a link to a note whose
 * file name equals the concept name.
 */
const files = {
  [`01 Courses/${COURSE}/lecture.md`]: [
    '---',
    'topic: [Alpha idea, Beta idea]',
    `course: ${COURSE}`,
    '---',
    '',
    'See [[Alpha idea]] for the first one.',
    '',
  ].join('\n'),
  '05 Zettelkasten/Alpha idea.md':
    '# Alpha idea\n\nAlpha is a  made-up thing.\n\n## Aside\n\nNot part of it.\n',
};

describe('the closed list descriptions, through the real enumeration', () => {
  it('carries a bound definition checked against its note; a concept with none carries null', async () => {
    const { vault } = setup(files);
    const list = await buildClosedList(vault, COURSE);
    const alpha = list.find((c) => c.name === 'Alpha idea');
    const beta = list.find((c) => c.name === 'Beta idea');
    expect(alpha?.source.definition).toBe('Alpha is a  made-up thing.');
    expect(alpha?.source.definitionFoundInSource).toBe(true);
    expect(alpha?.source.definitionSourceIsAssessment).toBe(false);
    expect(beta?.source.definition).toBeNull();
    expect(beta?.source.definitionFoundInSource).toBeNull();
  });

  it('excludes the definition when its bound note is a registered assessment document', async () => {
    const { vault } = setup(files);
    const list = await buildClosedList(vault, COURSE, {
      assessmentPaths: new Set(['05 Zettelkasten/Alpha idea.md']),
    });
    expect(list.find((c) => c.name === 'Alpha idea')?.source.definitionSourceIsAssessment).toBe(
      true,
    );
  });

  it('binds none when the note exists but no course note links to it', async () => {
    const { vault } = setup({
      ...files,
      [`01 Courses/${COURSE}/lecture.md`]: files[`01 Courses/${COURSE}/lecture.md`].replace(
        '[[Alpha idea]]',
        'it',
      ),
    });
    const list = await buildClosedList(vault, COURSE);
    expect(list.find((c) => c.name === 'Alpha idea')?.source.definition).toBeNull();
  });
});
