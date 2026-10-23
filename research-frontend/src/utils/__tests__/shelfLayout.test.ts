import { describe, it, expect } from 'vitest';
import { buildShelfAois, buildShelfColumns } from '../shelfLayout';

describe('buildShelfColumns', () => {
  it('cycles products across the columns when there are fewer products than columns', () => {
    expect(buildShelfColumns(['a', 'b', 'c'], 5, 1)).toEqual(['a', 'b', 'c', 'a', 'b']);
  });

  it('places each repetition of a product in adjacent columns', () => {
    expect(buildShelfColumns(['a', 'b', 'c'], 5, 2)).toEqual(['a', 'a', 'b', 'b', 'c']);
  });

  it('returns no columns without products', () => {
    expect(buildShelfColumns([], 4, 1)).toEqual([]);
  });
});

describe('buildShelfAois', () => {
  it('creates one full-height AOI per column, named after the product shown in it', () => {
    const aois = buildShelfAois(['a', 'b'], 4, 1);
    expect(aois.map(aoi => aoi.label)).toEqual(['a', 'b', 'a', 'b']);
    expect(aois[3]).toEqual({ id: 'shelf-aoi-3', label: 'b', x: 75, y: 0, width: 25, height: 100 });
  });
});
