import { describe, it, expect } from 'vitest';
import { gazePrecisionWeight } from '../gazePrecisionWeight';

describe('gazePrecisionWeight', () => {
    it('keeps full weight for gaze without a measured error', () => {
        expect(gazePrecisionWeight(undefined)).toBe(1);
        expect(gazePrecisionWeight({ x: 0, y: 0 })).toBe(1);
    });

    it('gives an imprecise phone session much less weight than a precise one', () => {
        const precise = gazePrecisionWeight({ x: 1, y: 1 });
        const phone = gazePrecisionWeight({ x: 26.8, y: 15.1 });
        expect(precise).toBeGreaterThan(0.95);
        expect(phone).toBeCloseTo(0.056, 2);
    });
});
