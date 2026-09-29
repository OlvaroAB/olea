/**
 * Shared fixture for the four ranking callers' `registeredFiles` specs (`ol-egov.141.89.7.35`).
 *
 * One vault, one course, one concept, one PDF past paper the student registered (F1.5) — built
 * twice by the specs, once with the "source registered" event in her local log and once without,
 * so the ONLY difference between the two runs is the event. Every string is INVENTED (INV-3).
 *
 * The PDF is a real one (`buildPdfBytes`, the same single-page shape `olea-core`'s own tier-3 and
 * evidence-edge specs use) held in a small binary-capable wrapper over `memoryVault`, because the
 * defect is specific to a file that cannot carry frontmatter: it becomes a `Source` only through
 * the registration event, never through the folder scan.
 */

import type { ListOptions, VaultPath, VaultSource } from 'olea-core';
import { appendSourceRegisteredRecord } from 'olea-core';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

export const DEVICE = 'olea-testdevice1';
export const NOW = new Date('2026-08-10T09:00:00-04:00');
export const COURSE = 'TESTC101';
export const CONCEPT = 'Widget theory';
export const PAST_PAPER_PDF = 'Papers/TESTC101 Past Paper 2023.pdf';
export const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';

const BASE_FILE = [
  'filters:',
  '  and:',
  '    - file.inFolder("02 Assignments")',
  '    - file.ext == "md"',
  'properties:',
  '  class:',
  '  type:',
  '  weight:',
  '  due:',
  '  status:',
].join('\n');

/** The plugin's settings host, pre-loaded with the assignments Base path so the study plan is configured. */
export class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/** A one-page PDF whose text layer is `pageText` — parsed by the real extractor, never a mock of it. */
export function buildPdfBytes(pageText: string): Uint8Array {
  const escapeLiteral = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const raw = `BT /F1 12 Tf 20 150 Td (${escapeLiteral(pageText)}) Tj ET`;
  const text =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n` +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

/** `memoryVault`, plus binary files it lists, reports as existing and reads back through `readBinary`. */
function withBinaryFiles(
  base: ReturnType<typeof memoryVault>,
  binaries: Readonly<Record<string, Uint8Array>>,
): VaultSource {
  return {
    async list(options: ListOptions = {}) {
      const extensions = options.extensions?.map((ext) => ext.toLowerCase());
      const binaryPaths = Object.keys(binaries)
        .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
        .filter((path) => {
          if (extensions === undefined) return true;
          const ext = extensionOf(path);
          return ext !== undefined && extensions.includes(ext);
        });
      return [...(await base.list(options)), ...binaryPaths].sort();
    },
    read: (path) => base.read(path),
    async readBinary(path) {
      return binaries[path] ?? base.readBinary(path);
    },
    write: (path, content) => base.write(path, content),
    async exists(path) {
      return path in binaries || base.exists(path);
    },
    watch: (handler) => base.watch(handler),
  };
}

/**
 * The vault every caller's spec reads: the concept she has a note on, the quiz she is preparing
 * for, and a PDF past paper whose one question names the concept. With `registered: true` her
 * local log also carries the "source registered" event that names the PDF a past paper of her
 * course (the same event the grove's S1 and the document's S2 write, F1.5 / D-226) — and nothing
 * else in the vault differs.
 */
export async function pastPaperPdfVault(options: {
  readonly registered: boolean;
}): Promise<VaultSource> {
  const base = memoryVault({
    [`05 Zettelkasten/${CONCEPT}.md`]: `# ${CONCEPT}\n`,
    'Notes/one.md': [
      '---',
      `topic: [${CONCEPT}]`,
      `course: ${COURSE}`,
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`,
  });
  const vault = withBinaryFiles(base, {
    [PAST_PAPER_PDF]: buildPdfBytes(`Question 1. Explain ${CONCEPT}. (10 marks)`),
  });
  if (options.registered) {
    await appendSourceRegisteredRecord(
      vault,
      {
        timestamp: '2026-07-01T09:00:00.000-04:00',
        path: PAST_PAPER_PDF,
        role: 'past-paper',
        course: COURSE,
      },
      { deviceId: DEVICE },
    );
  }
  return vault;
}
