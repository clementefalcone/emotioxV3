import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ShelfComparison } from '../StimulusCard';
import type { EyeTrackingAOI } from '../../../../services/analytics.service';

function columnAoi(column: number, label: string, dwellTimePercent: number): EyeTrackingAOI {
  return {
    id: `shelf-aoi-${column}`,
    label,
    x: column * 50,
    y: 0,
    width: 50,
    height: 100,
    dwellTimePercent,
    fixationCount: 1,
    avgDuration: 200,
    participantCount: 1,
  };
}

describe('ShelfComparison', () => {
  it('shows each product card with the image of its own column, not of its rank', () => {
    render(
      <ShelfComparison
        aois={[columnAoi(0, 'Producto A', 10), columnAoi(1, 'Producto B', 60)]}
        shelfColumnUrls={['a.jpg', 'b.jpg']}
      />,
    );

    expect(screen.getByAltText('Producto B').getAttribute('src')).toBe('b.jpg');
    expect(screen.getByAltText('Producto A').getAttribute('src')).toBe('a.jpg');
  });
});
