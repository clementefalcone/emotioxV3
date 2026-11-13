import { describe, expect, it } from 'vitest';
import {
    HEATMAP_GRADIENTS,
    OVERLAY_DIM_FACTORS,
} from '../../components/results/cognitive-task/components/paintHeatmap';
import { COLD_MAP_GRADIENT } from '../coldMapRender';
import { THERMAL_GRADIENT } from '../thermalContrast';
import type { HeatmapVisualProfile } from '../attentionPrediction.utils';

/* ─── Helpers ─── */

const WARM_PROFILES: HeatmapVisualProfile[] = ['lab', 'precise', 'balanced', 'smooth'];
const ALL_PROFILES: HeatmapVisualProfile[] = [...WARM_PROFILES, 'gaze'];

/** Parse 6-digit hex to {r, g, b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

/** Relative luminance (WCAG) — lower = darker, higher = lighter */
function relativeLuminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(
        c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)),
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function sortedKeys(obj: Record<number, string>): number[] {
    return Object.keys(obj).map(Number).sort((a, b) => a - b);
}

/* ═══════════════════════════════════════════════════════════════
   1. HEATMAP GRADIENTS — completeness & structure
   ═══════════════════════════════════════════════════════════════ */

describe('HEATMAP_GRADIENTS — completeness & structure', () => {
    it('covers every HeatmapVisualProfile exactly', () => {
        const gradientProfiles = Object.keys(HEATMAP_GRADIENTS).sort();
        expect(gradientProfiles).toEqual([...ALL_PROFILES].sort());
    });

    it.each(ALL_PROFILES)('%s — has at least 4 gradient stops', (profile) => {
        expect(Object.keys(HEATMAP_GRADIENTS[profile]).length).toBeGreaterThanOrEqual(4);
    });

    it.each(ALL_PROFILES)('%s — stops are strictly ascending', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        for (let i = 1; i < keys.length; i++) {
            expect(keys[i]).toBeGreaterThan(keys[i - 1]);
        }
    });

    it.each(ALL_PROFILES)('%s — all stops in range (0, 1]', (profile) => {
        for (const key of sortedKeys(HEATMAP_GRADIENTS[profile])) {
            expect(key).toBeGreaterThan(0);
            expect(key).toBeLessThanOrEqual(1);
        }
    });

    it.each(ALL_PROFILES)('%s — last stop is exactly 1.0', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        expect(keys[keys.length - 1]).toBe(1.0);
    });

    it.each(ALL_PROFILES)('%s — all hex values are valid 6-digit', (profile) => {
        for (const hex of Object.values(HEATMAP_GRADIENTS[profile])) {
            expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
    });

    it('smooth has more stops than lab (wider spread for diffuse rendering)', () => {
        expect(Object.keys(HEATMAP_GRADIENTS.smooth).length)
            .toBeGreaterThan(Object.keys(HEATMAP_GRADIENTS.lab).length);
    });

    it('smooth starts earlier than lab (lower first stop key)', () => {
        const smoothFirst = sortedKeys(HEATMAP_GRADIENTS.smooth)[0];
        const labFirst = sortedKeys(HEATMAP_GRADIENTS.lab)[0];
        expect(smoothFirst).toBeLessThan(labFirst);
    });
});

/* ═══════════════════════════════════════════════════════════════
   2. PALETTE COLOR SCIENCE — warm green→yellow→red, no cool leaks

   Image heatmaps use the warm gradient (v0.84.2). A blue→violet
   palette was tried and reverted: it reads as "cold/inactive" to
   researchers, the opposite of what a hotspot means. Videos use the
   thermal gradient instead — see section 4.
   ═══════════════════════════════════════════════════════════════ */

describe('HEATMAP_GRADIENTS — warm color science', () => {
    it.each(WARM_PROFILES)('%s — no blue-dominant stop (never reads as cold)', (profile) => {
        for (const hex of Object.values(HEATMAP_GRADIENTS[profile])) {
            const { r, g, b } = hexToRgb(hex);
            expect(b).toBeLessThanOrEqual(Math.max(r, g));
        }
    });

    it.each(WARM_PROFILES)('%s — blue channel stays off (b === 0 in every stop)', (profile) => {
        for (const hex of Object.values(HEATMAP_GRADIENTS[profile])) {
            expect(hexToRgb(hex).b).toBe(0);
        }
    });

    it.each(WARM_PROFILES)('%s — lowest-intensity stop is green (g dominates)', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        const { r, g } = hexToRgb(HEATMAP_GRADIENTS[profile][keys[0]]);
        expect(g).toBeGreaterThan(r);
    });

    it.each(WARM_PROFILES)('%s — highest-intensity stop is red (r dominates)', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        const { r, g } = hexToRgb(HEATMAP_GRADIENTS[profile][keys[keys.length - 1]]);
        expect(r).toBeGreaterThan(g);
    });

    it.each(WARM_PROFILES)('%s — red rises monotonically with intensity', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        for (let i = 1; i < keys.length; i++) {
            const prev = hexToRgb(HEATMAP_GRADIENTS[profile][keys[i - 1]]).r;
            const curr = hexToRgb(HEATMAP_GRADIENTS[profile][keys[i]]).r;
            expect(curr).toBeGreaterThanOrEqual(prev);
        }
    });

    // `smooth` brightens before it warms (#00cc00 → #66ff00), so green peaks a
    // stop or two in. What must hold is that green only falls after that peak
    // and reaches zero at full intensity.
    it.each(WARM_PROFILES)('%s — green falls monotonically after its peak', (profile) => {
        const greens = sortedKeys(HEATMAP_GRADIENTS[profile])
            .map(k => hexToRgb(HEATMAP_GRADIENTS[profile][k]).g);
        const peakIdx = greens.indexOf(Math.max(...greens));
        for (let i = peakIdx + 1; i < greens.length; i++) {
            expect(greens[i]).toBeLessThanOrEqual(greens[i - 1]);
        }
    });

    it.each(WARM_PROFILES)('%s — green is fully off at peak intensity', (profile) => {
        const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
        expect(hexToRgb(HEATMAP_GRADIENTS[profile][keys[keys.length - 1]]).g).toBe(0);
    });

    // The heatmap sits over a dimmed stimulus (OVERLAY_DIM_FACTORS), not over
    // white — so the guard is saturation, not WCAG contrast against a white bg.
    it.each(WARM_PROFILES)('%s — every stop is saturated (peak channel >= 0xcc)', (profile) => {
        for (const hex of Object.values(HEATMAP_GRADIENTS[profile])) {
            const { r, g, b } = hexToRgb(hex);
            expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(0xcc);
        }
    });

    it('all profiles share the same red anchor at full intensity', () => {
        for (const profile of ALL_PROFILES) {
            const keys = sortedKeys(HEATMAP_GRADIENTS[profile]);
            expect(HEATMAP_GRADIENTS[profile][keys[keys.length - 1]].toLowerCase()).toBe('#ff0000');
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   3. OVERLAY DIM FACTORS — completeness & ordering
   ═══════════════════════════════════════════════════════════════ */

describe('HEATMAP_GRADIENTS — eye tracking gaze', () => {
    it('starts with a cyan halo and ends red', () => {
        const keys = sortedKeys(HEATMAP_GRADIENTS.gaze);
        const lowest = hexToRgb(HEATMAP_GRADIENTS.gaze[keys[0]]);
        const highest = hexToRgb(HEATMAP_GRADIENTS.gaze[keys[keys.length - 1]]);
        expect(lowest.b).toBeGreaterThan(lowest.r);
        expect(highest).toEqual({ r: 255, g: 0, b: 0 });
    });
});

describe('OVERLAY_DIM_FACTORS — completeness & ordering', () => {
    it('covers every HeatmapVisualProfile exactly', () => {
        const dimProfiles = Object.keys(OVERLAY_DIM_FACTORS).sort();
        expect(dimProfiles).toEqual([...ALL_PROFILES].sort());
    });

    it.each(ALL_PROFILES)('%s — dim factor is positive and < 1', (profile) => {
        expect(OVERLAY_DIM_FACTORS[profile]).toBeGreaterThan(0);
        expect(OVERLAY_DIM_FACTORS[profile]).toBeLessThan(1);
    });

    it('ordering: lab < precise <= balanced < smooth', () => {
        expect(OVERLAY_DIM_FACTORS.lab).toBeLessThan(OVERLAY_DIM_FACTORS.precise);
        expect(OVERLAY_DIM_FACTORS.precise).toBeLessThanOrEqual(OVERLAY_DIM_FACTORS.balanced);
        expect(OVERLAY_DIM_FACTORS.balanced).toBeLessThan(OVERLAY_DIM_FACTORS.smooth);
    });

    it('lab is the least dim (most transparent overlay)', () => {
        const min = Math.min(...Object.values(OVERLAY_DIM_FACTORS));
        expect(OVERLAY_DIM_FACTORS.lab).toBe(min);
    });

    it('smooth is the most dim (strongest overlay)', () => {
        const max = Math.max(...Object.values(OVERLAY_DIM_FACTORS));
        expect(OVERLAY_DIM_FACTORS.smooth).toBe(max);
    });
});

/* ═══════════════════════════════════════════════════════════════
   4. THERMAL GRADIENT (video) — FLIR-style cold→hot progression

   Videos use a full thermal ramp (dark blue → blue → green → yellow
   → red) rather than the image warm gradient: accumulated video
   attention needs to show the cold end explicitly, since "never
   looked at" is a meaningful result across a timeline.
   ═══════════════════════════════════════════════════════════════ */

describe('THERMAL_GRADIENT — FLIR cold→hot progression', () => {
    it('has at least 4 gradient stops', () => {
        expect(Object.keys(THERMAL_GRADIENT).length).toBeGreaterThanOrEqual(4);
    });

    it('stops are ascending and within [0, 1]', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        for (const key of keys) {
            expect(key).toBeGreaterThanOrEqual(0);
            expect(key).toBeLessThanOrEqual(1);
        }
        for (let i = 1; i < keys.length; i++) {
            expect(keys[i]).toBeGreaterThan(keys[i - 1]);
        }
    });

    it('last stop is exactly 1.0', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        expect(keys[keys.length - 1]).toBe(1.0);
    });

    it('all hex values are valid 6-digit', () => {
        for (const hex of Object.values(THERMAL_GRADIENT)) {
            expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
    });

    it('coldest stop is blue-dominant (unviewed regions read as cold)', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        const { r, g, b } = hexToRgb(THERMAL_GRADIENT[keys[0]]);
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
    });

    it('hottest stop is red (peak attention reads as hot)', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        const { r, g, b } = hexToRgb(THERMAL_GRADIENT[keys[keys.length - 1]]);
        expect(r).toBeGreaterThan(g);
        expect(r).toBeGreaterThan(b);
    });

    it('red rises monotonically with intensity', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        for (let i = 1; i < keys.length; i++) {
            expect(hexToRgb(THERMAL_GRADIENT[keys[i]]).r)
                .toBeGreaterThanOrEqual(hexToRgb(THERMAL_GRADIENT[keys[i - 1]]).r);
        }
    });

    it('blue fades out before the hot end (no violet tail)', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        const topHalf = keys.filter(k => k >= 0.6);
        for (const key of topHalf) {
            const { r, b } = hexToRgb(THERMAL_GRADIENT[key]);
            expect(b).toBeLessThan(r);
        }
    });

    it('luminance rises from cold to hot (dark blue → bright red)', () => {
        const keys = sortedKeys(THERMAL_GRADIENT);
        const first = hexToRgb(THERMAL_GRADIENT[keys[0]]);
        const last = hexToRgb(THERMAL_GRADIENT[keys[keys.length - 1]]);
        expect(relativeLuminance(last.r, last.g, last.b))
            .toBeGreaterThan(relativeLuminance(first.r, first.g, first.b));
    });
});

/* ═══════════════════════════════════════════════════════════════
   5. COLD MAP GRADIENT — differentiation from classic
   ═══════════════════════════════════════════════════════════════ */

describe('COLD_MAP_GRADIENT — green→cyan differentiation', () => {
    it('has at least 4 gradient stops', () => {
        expect(Object.keys(COLD_MAP_GRADIENT).length).toBeGreaterThanOrEqual(4);
    });

    it('stops are in valid range (0, 1] and ascending', () => {
        const keys = sortedKeys(COLD_MAP_GRADIENT);
        for (const key of keys) {
            expect(key).toBeGreaterThan(0);
            expect(key).toBeLessThanOrEqual(1);
        }
        for (let i = 1; i < keys.length; i++) {
            expect(keys[i]).toBeGreaterThan(keys[i - 1]);
        }
    });

    it('last stop is 1.0', () => {
        const keys = sortedKeys(COLD_MAP_GRADIENT);
        expect(keys[keys.length - 1]).toBe(1.0);
    });

    it('all hex values are valid 6-digit', () => {
        for (const hex of Object.values(COLD_MAP_GRADIENT)) {
            expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
    });

    it('green channel >= red channel in every stop (green/cyan family)', () => {
        for (const hex of Object.values(COLD_MAP_GRADIENT)) {
            const { r, g } = hexToRgb(hex);
            expect(g).toBeGreaterThanOrEqual(r);
        }
    });

    it('no purple/violet colors (red <= green always)', () => {
        for (const hex of Object.values(COLD_MAP_GRADIENT)) {
            const { r, g } = hexToRgb(hex);
            expect(r).toBeLessThanOrEqual(g);
        }
    });

    it('zero overlap with any classic profile gradient colors', () => {
        const coldColors = new Set(Object.values(COLD_MAP_GRADIENT).map(c => c.toLowerCase()));
        for (const profile of ALL_PROFILES) {
            for (const classicHex of Object.values(HEATMAP_GRADIENTS[profile])) {
                expect(coldColors.has(classicHex.toLowerCase())).toBe(false);
            }
        }
    });

    it('zero overlap with the thermal (video) gradient', () => {
        const thermalHexes = Object.values(THERMAL_GRADIENT).map(h => h.toLowerCase());
        for (const cold of Object.values(COLD_MAP_GRADIENT)) {
            expect(thermalHexes).not.toContain(cold.toLowerCase());
        }
    });

    it('visually distinct — hue angle differs from classic by at least 60deg', () => {
        // Classic first stop hue is ~220-240 (blue), cold should be ~120-180 (green-cyan)
        const classicFirstHex = Object.values(HEATMAP_GRADIENTS.lab)[0];
        const coldFirstHex = Object.values(COLD_MAP_GRADIENT)[0];
        const { r: cr, g: cg, b: cb } = hexToRgb(classicFirstHex);
        const { r: dr, g: dg, b: db } = hexToRgb(coldFirstHex);

        const classicHue = Math.atan2(Math.sqrt(3) * (cg - cb), 2 * cr - cg - cb) * 180 / Math.PI;
        const coldHue = Math.atan2(Math.sqrt(3) * (dg - db), 2 * dr - dg - db) * 180 / Math.PI;

        const hueDiff = Math.abs(classicHue - coldHue);
        const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
        expect(normalizedDiff).toBeGreaterThanOrEqual(60);
    });
});

/* ═══════════════════════════════════════════════════════════════
   6. CROSS-MODE CONSISTENCY — no two modes share colors
   ═══════════════════════════════════════════════════════════════ */

describe('cross-mode color isolation', () => {
    it('classic and cold use distinct color palettes (zero hex overlap)', () => {
        const classicHexes = new Set<string>();
        for (const profile of ALL_PROFILES) {
            for (const hex of Object.values(HEATMAP_GRADIENTS[profile])) {
                classicHexes.add(hex.toLowerCase());
            }
        }
        const coldHexes = new Set(Object.values(COLD_MAP_GRADIENT).map(c => c.toLowerCase()));

        for (const hex of classicHexes) {
            expect(coldHexes.has(hex)).toBe(false);
        }
    });

    it('cold and thermal use distinct hex values', () => {
        const thermalHexes = new Set(Object.values(THERMAL_GRADIENT).map(h => h.toLowerCase()));
        for (const cold of Object.values(COLD_MAP_GRADIENT)) {
            expect(thermalHexes.has(cold.toLowerCase())).toBe(false);
        }
    });

    it('classic is warm, cold is green→cyan, thermal spans cold→hot (semantically distinct)', () => {
        // Classic: warm ramp — never blue, ends red
        const labKeys = sortedKeys(HEATMAP_GRADIENTS.lab);
        expect(hexToRgb(HEATMAP_GRADIENTS.lab[labKeys[0]]).b).toBe(0);
        expect(hexToRgb(HEATMAP_GRADIENTS.lab[labKeys[labKeys.length - 1]]).r).toBe(255);

        // Cold: all stops have g >= r
        for (const hex of Object.values(COLD_MAP_GRADIENT)) {
            const { r, g } = hexToRgb(hex);
            expect(g).toBeGreaterThanOrEqual(r);
        }

        // Thermal: starts blue-dominant, ends red-dominant
        const thermalKeys = sortedKeys(THERMAL_GRADIENT);
        const tFirst = hexToRgb(THERMAL_GRADIENT[thermalKeys[0]]);
        const tLast = hexToRgb(THERMAL_GRADIENT[thermalKeys[thermalKeys.length - 1]]);
        expect(tFirst.b).toBeGreaterThan(tFirst.r);
        expect(tLast.r).toBeGreaterThan(tLast.b);
    });
});
