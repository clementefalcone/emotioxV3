import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
    default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

import { getTrackingGazeData } from '../tracking-gaze.analytics';

function sessionRow(
    id: string,
    samples: Array<{ timestamp: number; quadrant: string; attention: string; score: number; cursorX?: number; cursorY?: number; quadrantProbs?: Record<string, number>; gazeQuality?: string }>,
    overrides: Partial<{ visitor_id: string; page_url: string }> = {},
) {
    return {
        id,
        visitor_id: overrides.visitor_id ?? `visitor-${id}`,
        page_url: overrides.page_url ?? 'https://example.com/',
        gaze_samples: JSON.stringify(samples),
    };
}

beforeEach(() => { mockQuery.mockReset(); });

describe('getTrackingGazeData', () => {
    it('returns zeroed result with no sessions', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSessions).toBe(0);
        expect(result.totalSamples).toBe(0);
        expect(result.dominantQuadrant).toBe('center');
        expect(result.avgAttentionScore).toBe(0);
    });

    it('computes quadrant distribution from samples', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 500, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 1000, quadrant: 'top-left', attention: 'engaged', score: 0.7 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSamples).toBe(3);
        expect(result.quadrantDistribution['center']).toBeCloseTo(66.7, 0);
        expect(result.quadrantDistribution['top-left']).toBeCloseTo(33.3, 0);
        expect(result.dominantQuadrant).toBe('center');
    });

    it('computes attention distribution', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 500, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 1000, quadrant: 'center', attention: 'distracted', score: 0.3 },
                { timestamp: 1500, quadrant: 'center', attention: 'away', score: 0 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.attentionDistribution.engaged).toBe(50);
        expect(result.attentionDistribution.distracted).toBe(25);
        expect(result.attentionDistribution.away).toBe(25);
    });

    it('computes average attention score', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 500, quadrant: 'center', attention: 'engaged', score: 0.7 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.avgAttentionScore).toBe(0.85);
    });

    it('builds timeline with 1s buckets', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 100, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 600, quadrant: 'top-left', attention: 'engaged', score: 0.7 },
                { timestamp: 1500, quadrant: 'center', attention: 'distracted', score: 0.3 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.timeline).toHaveLength(2);
        expect(result.timeline[0].timestampS).toBe(0);
        expect(result.timeline[1].timestampS).toBe(2);
    });

    it('filters by pageUrl when provided', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await getTrackingGazeData('r1', 'https://example.com/pricing');
        expect(mockQuery.mock.calls[0][0]).toContain('page_url');
        expect(mockQuery.mock.calls[0][1]).toContain('https://example.com/pricing');
    });

    it('skips sessions with invalid gaze_samples', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1', visitor_id: 'v1', page_url: 'https://example.com/',
                gaze_samples: 'not json',
            }],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSessions).toBe(0);
        expect(result.totalSamples).toBe(0);
    });

    it('discards samples with invalid attention state', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1 },
                { timestamp: 500, quadrant: 'center', attention: 'invalid' as 'engaged', score: 0.5 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSamples).toBe(1);
    });

    it('aggregates across multiple sessions', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [{ timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1 }]),
                sessionRow('s2', [{ timestamp: 0, quadrant: 'top-right', attention: 'engaged', score: 0.7 }]),
            ],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSessions).toBe(2);
        expect(result.totalSamples).toBe(2);
    });

    it('per-session has correct dominant quadrant and avg score', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'top-left', attention: 'engaged', score: 1 },
                { timestamp: 500, quadrant: 'top-left', attention: 'engaged', score: 0.7 },
                { timestamp: 1000, quadrant: 'center', attention: 'engaged', score: 1 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.perSession[0].dominantQuadrant).toBe('top-left');
        expect(result.perSession[0].avgScore).toBe(0.9);
        expect(result.perSession[0].sampleCount).toBe(3);
    });

    it('uses quadrantProbs weighted aggregation when available', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1,
                  quadrantProbs: { 'center': 0.5, 'center-right': 0.3, 'top-center': 0.2 } },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.quadrantDistribution['center']).toBeGreaterThan(0);
        expect(result.quadrantDistribution['center-right']).toBeGreaterThan(0);
        expect(result.quadrantDistribution['top-center']).toBeGreaterThan(0);
        const sum = Object.values(result.quadrantDistribution).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(100, 0);
    });

    it('falls back to discrete quadrant when no quadrantProbs', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'top-left', attention: 'engaged', score: 1 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.quadrantDistribution['top-left']).toBe(100);
    });

    it('mixes probabilistic and discrete samples', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, quadrant: 'center', attention: 'engaged', score: 1,
                  quadrantProbs: { 'center': 0.6, 'center-right': 0.4 } },
                { timestamp: 500, quadrant: 'top-left', attention: 'engaged', score: 0.8 },
            ])],
        });
        const result = await getTrackingGazeData('r1');
        expect(result.totalSamples).toBe(2);
        expect(result.quadrantDistribution['center']).toBeGreaterThan(0);
        expect(result.quadrantDistribution['center-right']).toBeGreaterThan(0);
        expect(result.quadrantDistribution['top-left']).toBeGreaterThan(0);
    });

    it('places gaze only from usable calibrations unless every visit was low quality', async () => {
        const good = sessionRow('good', [
            { timestamp: 0, quadrant: 'top-left', attention: 'engaged', score: 1, gazeQuality: 'fair' },
            { timestamp: 500, quadrant: 'top-left', attention: 'engaged', score: 1, gazeQuality: 'fair' },
        ]);
        const low = sessionRow('low', [
            { timestamp: 0, quadrant: 'bottom-right', attention: 'away', score: 0, gazeQuality: 'low' },
            { timestamp: 500, quadrant: 'bottom-right', attention: 'away', score: 0, gazeQuality: 'low' },
        ]);
        mockQuery.mockResolvedValueOnce({ rows: [good, low] });
        const mixed = await getTrackingGazeData('r1');
        expect(mixed.quadrantDistribution['top-left']).toBe(100);
        expect(mixed.quadrantDistribution['bottom-right']).toBe(0);
        expect(mixed.attentionDistribution.away).toBe(50);
        expect(mixed.totalSessions).toBe(2);
        expect(mixed.dataSource).toMatchObject({ lowQualitySessions: 1, excludedLowQualitySessions: 1 });

        mockQuery.mockResolvedValueOnce({ rows: [low] });
        const allLow = await getTrackingGazeData('r1');
        expect(allLow.quadrantDistribution['bottom-right']).toBe(100);
        expect(allLow.dataSource).toMatchObject({ lowQualitySessions: 1, excludedLowQualitySessions: 0 });
    });
});
