import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
    default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

import { getTrackingZoneData } from '../tracking-zones.analytics';

const ctaZone = { id: 'cta', label: 'Comprar', pageUrl: 'https://shop.example.com/pricing', selector: '#buy' };

const fixation = (x: number, y: number, timestamp: number, duration: number, zones: Record<string, number[]>) =>
    ({ type: 'fixation', x, y, timestamp, duration, zones });

const session = (id: string, pageUrl: string, gaze: unknown[], emotions: unknown[] = []) => ({
    id,
    page_url: pageUrl,
    gaze_samples: JSON.stringify(gaze),
    emotion_samples: JSON.stringify(emotions),
});

const mockDatabase = (zones: unknown[], sessions: unknown[]) => {
    mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM researches')) return Promise.resolve({ rows: [{ config: JSON.stringify({ trackingConfig: { zones } }) }] });
        return Promise.resolve({ rows: sessions });
    });
};

beforeEach(() => {
    mockQuery.mockReset();
});

describe('getTrackingZoneData', () => {
    it('returns no zones without querying sessions when the researcher marked none', async () => {
        mockDatabase([], []);
        expect(await getTrackingZoneData('r1')).toEqual({ zones: [] });
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('ignores stored zones missing a selector or page', async () => {
        mockDatabase([{ id: 'x', label: 'X', pageUrl: '', selector: '#a' }, { id: 'y', label: 'Y', pageUrl: 'https://a.com/' }], []);
        expect(await getTrackingZoneData('r1')).toEqual({ zones: [] });
    });

    it('computes the Eye Tracking zone metrics from the zone position each visitor saw', async () => {
        mockDatabase([ctaZone], [
            session('s1', 'https://shop.example.com/pricing?utm=ad', [
                fixation(500, 900, 0, 300, { cta: [400, 850, 200, 100] }),
                fixation(100, 100, 400, 300, { cta: [400, 850, 200, 100] }),
            ], [
                { timestamp: 100, emotion: 'joy', confidence: 0.9 },
                { timestamp: 500, emotion: 'anger', confidence: 0.9 },
            ]),
            session('s2', 'https://shop.example.com/pricing', [
                fixation(150, 2000, 0, 200, { cta: [100, 1950, 120, 80] }),
                fixation(150, 2000, 1000, 600, { cta: [100, 1950, 120, 80] }),
            ]),
        ]);

        const { zones: [cta] } = await getTrackingZoneData('r1');

        expect(cta).toMatchObject({
            id: 'cta',
            label: 'Comprar',
            visits: 2,
            participantCount: 2,
            noticeRate: 100,
            fixationCount: 3,
            dwellTimePercent: 79,
            avgDuration: 367,
            avgTTFF: 0,
            dominantEmotion: 'joy',
            emotionDistribution: expect.objectContaining({ joy: 100, anger: 0 }),
        });
    });

    it('counts a visitor who never reached the zone toward the notice rate', async () => {
        mockDatabase([ctaZone], [
            session('s1', 'https://shop.example.com/pricing', [fixation(500, 900, 0, 300, { cta: [400, 850, 200, 100] })]),
            session('s2', 'https://shop.example.com/pricing', [fixation(50, 50, 0, 300, {})]),
        ]);

        const { zones: [cta] } = await getTrackingZoneData('r1');

        expect(cta.noticeRate).toBe(50);
        expect(cta.participantCount).toBe(1);
    });

    it('ignores visits to other pages', async () => {
        mockDatabase([ctaZone], [
            session('s1', 'https://shop.example.com/about', [fixation(500, 900, 0, 300, { cta: [400, 850, 200, 100] })]),
        ]);

        const { zones: [cta] } = await getTrackingZoneData('r1');

        expect(cta.visits).toBe(0);
        expect(cta.participantCount).toBe(0);
    });

    it('leaves out low-quality calibrations unless every visit was low quality', async () => {
        mockDatabase([ctaZone], [
            session('good', 'https://shop.example.com/pricing', [
                { timestamp: 0, gazeQuality: 'good' },
                fixation(50, 50, 0, 300, { cta: [400, 850, 200, 100] }),
            ]),
            session('bad', 'https://shop.example.com/pricing', [
                { timestamp: 0, gazeQuality: 'low' },
                fixation(500, 900, 0, 300, { cta: [400, 850, 200, 100] }),
            ]),
        ]);

        const { zones: [cta] } = await getTrackingZoneData('r1');

        expect(cta.visits).toBe(1);
        expect(cta.participantCount).toBe(0);
    });

    it('skips fixations and zone positions that are not well formed', async () => {
        mockDatabase([ctaZone], [
            session('s1', 'https://shop.example.com/pricing', [
                { type: 'fixation', x: 'a', y: 1, timestamp: 0, duration: 100 },
                fixation(500, 900, 0, 300, { cta: [400, 850, 0, 100] }),
            ]),
        ]);

        const { zones: [cta] } = await getTrackingZoneData('r1');

        expect(cta.visits).toBe(1);
        expect(cta.fixationCount).toBe(0);
    });
});
