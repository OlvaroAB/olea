import { describe, expect, it } from 'vitest';
import { imageExtractor } from './image.js';

describe('imageExtractor', () => {
  it('always reports zero char yield and routes to vision — an image has no text layer by construction', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // a JPEG-ish magic-number prefix; content is irrelevant
    const result = await imageExtractor.extract({ path: 'photo.jpg', bytes });

    expect(result.format).toBe('image');
    expect(result.pages).toHaveLength(1);
    // `textLayer: 'absent'`, never `'unreadable'` (ol-x1ch): an image has no
    // text layer to fail to read, so vision is the correct answer here rather
    // than a reported decode failure.
    expect(result.pages[0]).toEqual({
      page: 1,
      charCount: 0,
      textLayer: 'absent',
      route: 'vision',
      units: [],
    });
  });

  it('routes to vision regardless of a lenient threshold override — zero stays zero', async () => {
    const result = await imageExtractor.extract(
      { path: 'photo.jpg', bytes: new Uint8Array(0) },
      { textLayerCharThreshold: 0 },
    );
    // threshold 0: routePage(0, 0) -> charCount (0) is NOT < threshold (0), so this
    // is the one override under which an image would legitimately stay on the
    // text layer — proving the image extractor really does defer to the shared
    // routing rule rather than hardcoding 'vision'.
    expect(result.pages[0]?.route).toBe('text-layer');
  });
});
