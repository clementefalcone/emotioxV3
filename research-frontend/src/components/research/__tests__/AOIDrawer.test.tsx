import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AOIDrawer } from '../AOIDrawer';

describe('AOIDrawer', () => {
  it('shows the original product image as thumbnail when one is resolved for the AOI', () => {
    render(
      <AOIDrawer
        imageUrl="shelf-composite.jpg"
        aois={[{ id: 'a1', label: 'Pepsi', x: 20, y: 0, width: 20, height: 100 }]}
        onChange={() => {}}
        resolveThumbnailUrl={() => 'pepsi.jpg'}
      />,
    );
    expect(screen.getByAltText('Pepsi').getAttribute('src')).toBe('pepsi.jpg');
  });
});
