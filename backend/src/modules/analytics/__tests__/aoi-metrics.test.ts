import { describe, it, expect } from 'vitest';
import { softAoiWeight } from '../aoi-metrics';

describe('softAoiWeight', () => {
  const column = { x: 40, y: 0, width: 20, height: 100 };

  it('counts a fixation inside the AOI fully', () => {
    expect(softAoiWeight(50, 50, column)).toBe(1);
  });

  it('does not give a tall shelf column the gaze of a column two places away', () => {
    expect(softAoiWeight(90, 50, column)).toBeLessThan(0.01);
  });

  it('keeps a small margin next to the edge for gaze error', () => {
    expect(softAoiWeight(62, 50, column)).toBeGreaterThan(0.9);
  });

  it('scales the margin of each axis by the AOI size on that axis', () => {
    const wide = { x: 0, y: 40, width: 100, height: 20 };
    expect(softAoiWeight(50, 90, wide)).toBeLessThan(0.01);
    expect(softAoiWeight(50, 62, wide)).toBeGreaterThan(0.9);
  });
});
