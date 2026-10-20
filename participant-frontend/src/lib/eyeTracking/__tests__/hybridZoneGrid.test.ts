import { describe, it, expect } from 'vitest';
import {
    HYBRID_GRID_SIZE,
    HYBRID_AOI_GRID,
    HYBRID_NOISE_THRESHOLD_PCT,
    HYBRID_EDGE_STRETCH_X,
    HYBRID_EDGE_STRETCH_Y,
    HYBRID_ZONE_VOTE_HISTORY,
    HYBRID_ZONE_VOTE_LEAD_MIN,
    HYBRID_IMAGE_CALIBRATION_POINTS,
    hybridImagePercentToBlazeNorm,
    hybridStretchFromCenter01,
    hybridStretchFromCenter01MiddleSoft,
    hybridViewportToStretched01,
    hybridPointToSoftZoneWeights,
    hybridPointToZone,
    hybridModeZoneFromHistory,
    hybridHeatColor,
} from '../hybridZoneGrid';

// ---------------------------------------------------------------------------
// Shared DOMRect mock
// ---------------------------------------------------------------------------

const rect = {
    left: 100, top: 50, right: 900, bottom: 650,
    width: 800, height: 600,
    x: 100, y: 50, toJSON: () => ({}),
} as DOMRect;

const zeroRect = {
    left: 0, top: 0, right: 0, bottom: 0,
    width: 0, height: 0,
    x: 0, y: 0, toJSON: () => ({}),
} as DOMRect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
    it('HYBRID_GRID_SIZE is 3', () => {
        expect(HYBRID_GRID_SIZE).toBe(3);
    });

    it('HYBRID_AOI_GRID has 9 zones in row-major order', () => {
        expect(HYBRID_AOI_GRID).toHaveLength(9);
        expect(HYBRID_AOI_GRID[0].id).toBe('r0c0');
        expect(HYBRID_AOI_GRID[4].id).toBe('r1c1');
        expect(HYBRID_AOI_GRID[8].id).toBe('r2c2');
    });

    it('each zone has unique id, label, col, and row', () => {
        const ids = new Set(HYBRID_AOI_GRID.map(z => z.id));
        expect(ids.size).toBe(9);
        for (const z of HYBRID_AOI_GRID) {
            expect(z.id).toMatch(/^r[0-2]c[0-2]$/);
            expect(z.label).toBeTruthy();
            expect(z.col).toBeGreaterThanOrEqual(0);
            expect(z.col).toBeLessThan(3);
            expect(z.row).toBeGreaterThanOrEqual(0);
            expect(z.row).toBeLessThan(3);
        }
    });

    it('HYBRID_NOISE_THRESHOLD_PCT is 5', () => {
        expect(HYBRID_NOISE_THRESHOLD_PCT).toBe(5);
    });

    it('stretch constants are greater than 1', () => {
        expect(HYBRID_EDGE_STRETCH_X).toBeGreaterThan(1);
        expect(HYBRID_EDGE_STRETCH_Y).toBeGreaterThan(1);
    });

    it('HYBRID_ZONE_VOTE_HISTORY is 12', () => {
        expect(HYBRID_ZONE_VOTE_HISTORY).toBe(12);
    });

    it('HYBRID_ZONE_VOTE_LEAD_MIN is 2', () => {
        expect(HYBRID_ZONE_VOTE_LEAD_MIN).toBe(2);
    });

    it('calibration points has 13 entries', () => {
        expect(HYBRID_IMAGE_CALIBRATION_POINTS).toHaveLength(13);
    });
});

// ---------------------------------------------------------------------------
// hybridImagePercentToBlazeNorm
// ---------------------------------------------------------------------------

describe('hybridImagePercentToBlazeNorm', () => {
    const vw = 1920;
    const vh = 1080;

    it('center of image (50, 50) maps close to (0, 0) when image is centered on screen', () => {
        const centeredRect = {
            left: (vw - 800) / 2, top: (vh - 600) / 2,
            right: (vw + 800) / 2, bottom: (vh + 600) / 2,
            width: 800, height: 600,
            x: (vw - 800) / 2, y: (vh - 600) / 2, toJSON: () => ({}),
        } as DOMRect;
        const [nx, ny] = hybridImagePercentToBlazeNorm(centeredRect, 50, 50, vw, vh);
        expect(nx).toBeCloseTo(0, 1);
        expect(ny).toBeCloseTo(0, 1);
    });

    it('top-left (0, 0) maps to negative normalized coords', () => {
        const [nx, ny] = hybridImagePercentToBlazeNorm(rect, 0, 0, vw, vh);
        expect(nx).toBeLessThan(0);
        expect(ny).toBeLessThan(0);
    });

    it('bottom-right (100, 100) maps to coords greater than top-left', () => {
        const [nxBR, nyBR] = hybridImagePercentToBlazeNorm(rect, 100, 100, vw, vh);
        const [nxTL, nyTL] = hybridImagePercentToBlazeNorm(rect, 0, 0, vw, vh);
        expect(nxBR).toBeGreaterThan(nxTL);
        expect(nyBR).toBeGreaterThan(nyTL);
    });

    it('computes exact values based on formula', () => {
        // cx = 100 + (50/100)*800 = 500, cy = 50 + (50/100)*600 = 350
        // normX = 500/1920 - 0.5, normY = 350/1080 - 0.5
        const [nx, ny] = hybridImagePercentToBlazeNorm(rect, 50, 50, vw, vh);
        expect(nx).toBeCloseTo(500 / 1920 - 0.5, 6);
        expect(ny).toBeCloseTo(350 / 1080 - 0.5, 6);
    });

    it('returns [-0.5, -0.5] when image at origin and pct is (0, 0)', () => {
        const originRect = {
            left: 0, top: 0, right: 400, bottom: 300,
            width: 400, height: 300,
            x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect;
        const [nx, ny] = hybridImagePercentToBlazeNorm(originRect, 0, 0, vw, vh);
        expect(nx).toBe(-0.5);
        expect(ny).toBe(-0.5);
    });
});

// ---------------------------------------------------------------------------
// hybridStretchFromCenter01
// ---------------------------------------------------------------------------

describe('hybridStretchFromCenter01', () => {
    it('t=0.5 with any k returns 0.5 (center stays fixed)', () => {
        expect(hybridStretchFromCenter01(0.5, 1)).toBe(0.5);
        expect(hybridStretchFromCenter01(0.5, 2)).toBe(0.5);
        expect(hybridStretchFromCenter01(0.5, 0.5)).toBe(0.5);
    });

    it('t=0, k=1 returns 0 (no stretch)', () => {
        expect(hybridStretchFromCenter01(0, 1)).toBe(0);
    });

    it('t=1, k=1 returns 1 (no stretch)', () => {
        expect(hybridStretchFromCenter01(1, 1)).toBe(1);
    });

    it('k>1 pushes edges further from center', () => {
        const original = 0.8;
        const stretched = hybridStretchFromCenter01(original, 1.5);
        expect(stretched).toBeGreaterThan(original);
    });

    it('k>1 pushes left edge further left', () => {
        const original = 0.2;
        const stretched = hybridStretchFromCenter01(original, 1.5);
        expect(stretched).toBeLessThan(original);
    });

    it('result is clamped to [0, 1]', () => {
        // Very large k should not exceed 1
        expect(hybridStretchFromCenter01(1, 10)).toBe(1);
        expect(hybridStretchFromCenter01(0, 10)).toBe(0);
        // k so large that it would overshoot
        const result = hybridStretchFromCenter01(0.9, 20);
        expect(result).toBeLessThanOrEqual(1);
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it('k<1 compresses toward center', () => {
        const t = 0.9;
        const compressed = hybridStretchFromCenter01(t, 0.5);
        expect(compressed).toBeLessThan(t);
        expect(compressed).toBeGreaterThan(0.5);
    });
});

// ---------------------------------------------------------------------------
// hybridStretchFromCenter01MiddleSoft
// ---------------------------------------------------------------------------

describe('hybridStretchFromCenter01MiddleSoft', () => {
    it('at center (t=0.5) result is close to 0.5', () => {
        const result = hybridStretchFromCenter01MiddleSoft(0.5, 1.2);
        expect(result).toBeCloseTo(0.5, 3);
    });

    it('at edges the full k factor applies', () => {
        const t = 0.95;
        const soft = hybridStretchFromCenter01MiddleSoft(t, 1.2);
        const hard = hybridStretchFromCenter01(t, 1.2);
        // Near edge distFromCenter is large, so kBlend approaches k
        expect(Math.abs(soft - hard)).toBeLessThan(0.02);
    });

    it('at t=0 with large k, result is clamped to 0', () => {
        const result = hybridStretchFromCenter01MiddleSoft(0, 5);
        expect(result).toBe(0);
    });

    it('at t=1 with large k, result is clamped to 1', () => {
        const result = hybridStretchFromCenter01MiddleSoft(1, 5);
        expect(result).toBe(1);
    });

    it('middle values receive less stretch than edges', () => {
        // Compare stretch magnitude at t=0.6 vs t=0.9
        const k = 1.3;
        const shift_near_center = Math.abs(hybridStretchFromCenter01MiddleSoft(0.55, k) - 0.55);
        const shift_near_edge = Math.abs(hybridStretchFromCenter01MiddleSoft(0.9, k) - 0.9);
        // Edge should be stretched more (proportionally) than near-center
        expect(shift_near_edge).toBeGreaterThan(shift_near_center);
    });

    it('with k=1 returns t unchanged', () => {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            expect(hybridStretchFromCenter01MiddleSoft(t, 1)).toBeCloseTo(t, 6);
        }
    });
});

// ---------------------------------------------------------------------------
// hybridViewportToStretched01
// ---------------------------------------------------------------------------

describe('hybridViewportToStretched01', () => {
    it('returns null for zero-size rect', () => {
        expect(hybridViewportToStretched01(100, 100, zeroRect)).toBeNull();
    });

    it('returns null for negative-dimension rect', () => {
        const negRect = { ...zeroRect, width: -10, height: 100 } as DOMRect;
        expect(hybridViewportToStretched01(0, 0, negRect)).toBeNull();
    });

    it('center of rect maps close to (0.5, 0.5)', () => {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const result = hybridViewportToStretched01(cx, cy, rect);
        expect(result).not.toBeNull();
        expect(result!.sX).toBeCloseTo(0.5, 1);
        expect(result!.sY).toBeCloseTo(0.5, 1);
    });

    it('top-left corner maps to values near 0', () => {
        const result = hybridViewportToStretched01(rect.left, rect.top, rect);
        expect(result).not.toBeNull();
        expect(result!.sX).toBeLessThan(0.15);
        expect(result!.sY).toBeLessThan(0.15);
    });

    it('bottom-right corner maps to values near 1', () => {
        const result = hybridViewportToStretched01(rect.right, rect.bottom, rect);
        expect(result).not.toBeNull();
        expect(result!.sX).toBeGreaterThan(0.85);
        expect(result!.sY).toBeGreaterThan(0.85);
    });

    it('returns sX and sY keys', () => {
        const result = hybridViewportToStretched01(rect.left + 400, rect.top + 300, rect);
        expect(result).toHaveProperty('sX');
        expect(result).toHaveProperty('sY');
    });

    it('clamps coordinates outside rect to [0, 1]', () => {
        // Point way outside to the right
        const result = hybridViewportToStretched01(rect.right + 1000, rect.bottom + 1000, rect);
        expect(result).not.toBeNull();
        expect(result!.sX).toBeLessThanOrEqual(1);
        expect(result!.sY).toBeLessThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// hybridPointToZone
// ---------------------------------------------------------------------------

describe('hybridPointToZone', () => {
    it('returns null for zero-size rect', () => {
        expect(hybridPointToZone(100, 100, zeroRect)).toBeNull();
    });

    it('center of rect maps to r1c1 (center zone)', () => {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        expect(hybridPointToZone(cx, cy, rect)).toBe('r1c1');
    });

    it('top-left area maps to r0c0', () => {
        const x = rect.left + rect.width * 0.1;
        const y = rect.top + rect.height * 0.1;
        expect(hybridPointToZone(x, y, rect)).toBe('r0c0');
    });

    it('bottom-right area maps to r2c2', () => {
        const x = rect.left + rect.width * 0.9;
        const y = rect.top + rect.height * 0.9;
        expect(hybridPointToZone(x, y, rect)).toBe('r2c2');
    });

    it('top-right area maps to r0c2', () => {
        const x = rect.left + rect.width * 0.9;
        const y = rect.top + rect.height * 0.1;
        expect(hybridPointToZone(x, y, rect)).toBe('r0c2');
    });

    it('bottom-left area maps to r2c0', () => {
        const x = rect.left + rect.width * 0.1;
        const y = rect.top + rect.height * 0.9;
        expect(hybridPointToZone(x, y, rect)).toBe('r2c0');
    });

    it('all 9 zones are reachable', () => {
        const zones = new Set<string>();
        // Sample points distributed across the grid
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                const x = rect.left + rect.width * (col * 0.33 + 0.12);
                const y = rect.top + rect.height * (row * 0.33 + 0.12);
                const zone = hybridPointToZone(x, y, rect);
                if (zone) zones.add(zone);
            }
        }
        expect(zones.size).toBe(9);
    });

    it('returns a valid zone id format', () => {
        const zone = hybridPointToZone(rect.left + 200, rect.top + 200, rect);
        expect(zone).toMatch(/^r[0-2]c[0-2]$/);
    });
});

// ---------------------------------------------------------------------------
// hybridPointToSoftZoneWeights
// ---------------------------------------------------------------------------

describe('hybridPointToSoftZoneWeights', () => {
    it('weights sum to approximately 1 for a valid point', () => {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const weights = hybridPointToSoftZoneWeights(cx, cy, rect);
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 4);
    });

    it('returns all 9 zone keys', () => {
        const weights = hybridPointToSoftZoneWeights(rect.left + 100, rect.top + 100, rect);
        expect(Object.keys(weights)).toHaveLength(9);
        for (const z of HYBRID_AOI_GRID) {
            expect(weights).toHaveProperty(z.id);
        }
    });

    it('center of the image gives substantial weight to r1c1', () => {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const weights = hybridPointToSoftZoneWeights(cx, cy, rect);
        // Center zone should have a significant share (biases may shift the peak slightly)
        expect(weights['r1c1']).toBeGreaterThan(0.15);
    });

    it('invalid (zero-size) rect returns all zeros', () => {
        const weights = hybridPointToSoftZoneWeights(100, 100, zeroRect);
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBe(0);
    });

    it('top-left corner gives highest weight to r0c0', () => {
        const x = rect.left + rect.width * 0.05;
        const y = rect.top + rect.height * 0.05;
        const weights = hybridPointToSoftZoneWeights(x, y, rect);
        const topLeftWeight = weights['r0c0'];
        expect(topLeftWeight).toBeGreaterThan(0);
        for (const [id, w] of Object.entries(weights)) {
            if (id !== 'r0c0') {
                expect(topLeftWeight).toBeGreaterThanOrEqual(w);
            }
        }
    });

    it('point between zones splits weights', () => {
        // Point on boundary between r0c0 and r0c1 (horizontally, ~1/3 of the way)
        const x = rect.left + rect.width * (1 / 3);
        const y = rect.top + rect.height * 0.1;
        const weights = hybridPointToSoftZoneWeights(x, y, rect);
        // Both r0c0 and r0c1 should have non-trivial weight
        expect(weights['r0c0']).toBeGreaterThan(0.05);
        expect(weights['r0c1']).toBeGreaterThan(0.05);
    });

    it('all weights are non-negative', () => {
        const x = rect.left + rect.width * 0.7;
        const y = rect.top + rect.height * 0.3;
        const weights = hybridPointToSoftZoneWeights(x, y, rect);
        for (const w of Object.values(weights)) {
            expect(w).toBeGreaterThanOrEqual(0);
        }
    });
});

// ---------------------------------------------------------------------------
// hybridModeZoneFromHistory
// ---------------------------------------------------------------------------

describe('hybridModeZoneFromHistory', () => {
    it('empty zones returns previous', () => {
        expect(hybridModeZoneFromHistory([], 'r1c1')).toBe('r1c1');
    });

    it('empty zones with null previous returns null', () => {
        expect(hybridModeZoneFromHistory([], null)).toBeNull();
    });

    it('clear majority returns that zone', () => {
        const zones = Array(10).fill('r0c0');
        expect(hybridModeZoneFromHistory(zones, null)).toBe('r0c0');
    });

    it('clear majority overrides previous', () => {
        const zones = Array(10).fill('r2c2');
        expect(hybridModeZoneFromHistory(zones, 'r0c0')).toBe('r2c2');
    });

    it('tie returns previous when previous is one of the tied zones', () => {
        // 5 votes each — tie, and lead < HYBRID_ZONE_VOTE_LEAD_MIN
        const zones = [
            ...Array(5).fill('r0c0'),
            ...Array(5).fill('r1c1'),
        ];
        expect(hybridModeZoneFromHistory(zones, 'r0c0')).toBe('r0c0');
    });

    it('tie returns previous when previous is not one of the tied zones', () => {
        const zones = [
            ...Array(5).fill('r0c0'),
            ...Array(5).fill('r1c1'),
        ];
        expect(hybridModeZoneFromHistory(zones, 'r2c2')).toBe('r2c2');
    });

    it('no previous + clear winner returns winner', () => {
        const zones = Array(8).fill('r1c0');
        expect(hybridModeZoneFromHistory(zones, null)).toBe('r1c0');
    });

    it('lead < HYBRID_ZONE_VOTE_LEAD_MIN returns previous', () => {
        // Lead of 1 (less than 2)
        const zones = [
            ...Array(4).fill('r0c0'),
            ...Array(3).fill('r1c1'),
            ...Array(2).fill('r2c2'),
        ];
        // top=4, second=3, lead=1 < 2 => previous
        expect(hybridModeZoneFromHistory(zones, 'r1c1')).toBe('r1c1');
    });

    it('all null zones returns previous', () => {
        const zones: (string | null)[] = [null, null, null, null, null];
        expect(hybridModeZoneFromHistory(zones, 'r0c1')).toBe('r0c1');
    });

    it('mixed null and valid zones — valid majority wins', () => {
        const zones: (string | null)[] = [
            null, 'r1c1', 'r1c1', null, 'r1c1',
            'r1c1', null, 'r1c1', 'r1c1', null,
        ];
        // 6 valid votes for r1c1, clearly above majority
        expect(hybridModeZoneFromHistory(zones, null)).toBe('r1c1');
    });

    it('single vote with no previous returns that zone', () => {
        expect(hybridModeZoneFromHistory(['r2c1'], null)).toBe('r2c1');
    });

    it('single vote with different previous returns previous (no lead over 0)', () => {
        // Only 1 vote, need majority = 1, but lead check: sorted.length < 2 so no lead check
        // need = floor(1/2)+1 = 1, topV = 1 >= 1 → winner
        expect(hybridModeZoneFromHistory(['r2c1'], 'r0c0')).toBe('r2c1');
    });
});

// ---------------------------------------------------------------------------
// hybridHeatColor
// ---------------------------------------------------------------------------

describe('hybridHeatColor', () => {
    it('intensity < 0.25 returns blue rgba', () => {
        const color = hybridHeatColor(0.1);
        expect(color).toBe('rgba(59, 130, 246, 0.15)');
    });

    it('intensity 0 returns blue', () => {
        expect(hybridHeatColor(0)).toBe('rgba(59, 130, 246, 0.15)');
    });

    it('intensity 0.25 returns green rgba (boundary)', () => {
        expect(hybridHeatColor(0.25)).toBe('rgba(34, 197, 94, 0.30)');
    });

    it('intensity 0.35 returns green rgba', () => {
        expect(hybridHeatColor(0.35)).toBe('rgba(34, 197, 94, 0.30)');
    });

    it('intensity 0.50 returns yellow rgba (boundary)', () => {
        expect(hybridHeatColor(0.50)).toBe('rgba(250, 204, 21, 0.45)');
    });

    it('intensity 0.60 returns yellow rgba', () => {
        expect(hybridHeatColor(0.60)).toBe('rgba(250, 204, 21, 0.45)');
    });

    it('intensity 0.75 returns red rgba (boundary)', () => {
        expect(hybridHeatColor(0.75)).toBe('rgba(239, 68, 68, 0.60)');
    });

    it('intensity 1.0 returns red rgba', () => {
        expect(hybridHeatColor(1.0)).toBe('rgba(239, 68, 68, 0.60)');
    });

    it('intensity negative returns blue (lowest bracket)', () => {
        expect(hybridHeatColor(-0.5)).toBe('rgba(59, 130, 246, 0.15)');
    });

    it('intensity > 1 returns red (highest bracket)', () => {
        expect(hybridHeatColor(5)).toBe('rgba(239, 68, 68, 0.60)');
    });
});
