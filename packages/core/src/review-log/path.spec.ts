import { describe, expect, it } from 'vitest';
import { isValidDeviceId, REVIEW_LOG_FOLDER, reviewLogPath } from './path.js';

describe('reviewLogPath', () => {
  it('builds `<folder>/<date>.<deviceId>.jsonl`', () => {
    expect(reviewLogPath('2026-08-10', 'desktop-1')).toBe(
      `${REVIEW_LOG_FOLDER}/2026-08-10.desktop-1.jsonl`,
    );
  });

  it('lives under the C5.2 folder', () => {
    expect(REVIEW_LOG_FOLDER).toBe('.olea/reviews');
  });

  it('differs per device for the same date', () => {
    const a = reviewLogPath('2026-08-10', 'desktop');
    const b = reviewLogPath('2026-08-10', 'mobile');
    expect(a).not.toBe(b);
  });

  it('differs per date for the same device', () => {
    const a = reviewLogPath('2026-08-10', 'desktop');
    const b = reviewLogPath('2026-08-11', 'desktop');
    expect(a).not.toBe(b);
  });

  it.each([
    ['2026-8-10', 'not zero-padded'],
    ['2026/08/10', 'wrong separator'],
    ['not-a-date', 'not a date at all'],
    ['', 'empty'],
  ])('rejects an invalid date %j (%s)', (date) => {
    expect(() => reviewLogPath(date, 'desktop')).toThrow();
  });

  it.each([
    ['', 'empty'],
    ['has/slash', 'contains a path separator'],
    ['../escape', 'path traversal'],
    ['.hidden', 'leading dot'],
    ['has space', 'contains whitespace'],
  ])('rejects an invalid device id %j (%s)', (deviceId) => {
    expect(() => reviewLogPath('2026-08-10', deviceId)).toThrow();
  });
});

describe('isValidDeviceId', () => {
  it('accepts alphanumerics, dot, dash, underscore, not leading with a separator', () => {
    expect(isValidDeviceId('desktop-1')).toBe(true);
    expect(isValidDeviceId('MacBook_Pro.14')).toBe(true);
    expect(isValidDeviceId('a')).toBe(true);
  });

  it('rejects empty and separator-led ids', () => {
    expect(isValidDeviceId('')).toBe(false);
    expect(isValidDeviceId('-leading-dash')).toBe(false);
    expect(isValidDeviceId('.leading-dot')).toBe(false);
  });
});
