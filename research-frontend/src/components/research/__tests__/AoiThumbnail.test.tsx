import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AoiThumbnail } from '../AoiThumbnail';

vi.mock('../../../utils/stimulusImageCache', () => ({
  loadCachedStimulusImage: () => Promise.resolve({ naturalWidth: 2000, naturalHeight: 1000 }),
}));

describe('AoiThumbnail', () => {
  it('crops the AOI region in image pixels so the thumbnail keeps the real aspect', async () => {
    const { container } = render(
      <AoiThumbnail imageUrl="stimulus.png" aoi={{ x: 10, y: 20, width: 25, height: 50 }} alt="AOI 1" />,
    );

    await waitFor(() => {
      expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('200 200 500 500');
    });
  });
});
