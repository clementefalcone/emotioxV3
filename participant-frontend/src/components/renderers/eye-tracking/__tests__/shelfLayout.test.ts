import { describe, it, expect } from 'vitest';
import { buildShelfColumns, orderShelfColumns } from '../shelfLayout';

describe('buildShelfColumns', () => {
    it('cycles products across the columns when there are fewer products than columns', () => {
        expect(buildShelfColumns(['a', 'b', 'c'], 5, 1)).toEqual(['a', 'b', 'c', 'a', 'b']);
    });

    it('places each repetition of a product in adjacent columns', () => {
        expect(buildShelfColumns(['a', 'b', 'c'], 5, 2)).toEqual(['a', 'a', 'b', 'b', 'c']);
    });

    it('drops products that do not fit in the columns', () => {
        expect(buildShelfColumns(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b']);
    });

    it('returns no columns without products', () => {
        expect(buildShelfColumns([], 4, 1)).toEqual([]);
    });
});

describe('orderShelfColumns', () => {
    it('shows at each position the column named by the order', () => {
        expect(orderShelfColumns(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b']);
    });
});
