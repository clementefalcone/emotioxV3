/**
 * Unit tests for tracking-emotion.analytics.ts
 * Mocks the database pool to test aggregation logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
    default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

import { getTrackingEmotionData } from '../tracking-emotion.analytics';

/** Build a session row as the DB returns it (emotion_samples as a JSON string). */
function sessionRow(
    id: string,
    samples: Array<{ timestamp: number; emotion: string; confidence: number; actionUnits?: Record<string, unknown> }>,
    overrides: Partial<{ visitor_id: string; page_url: string }> = {},
) {
    return {
        id,
        visitor_id: overrides.visitor_id ?? `visitor-${id}`,
        page_url: overrides.page_url ?? 'https://example.com/',
        emotion_samples: JSON.stringify(samples),
    };
}

beforeEach(() => {
    mockQuery.mockReset();
});

// ─── Query construction ──────────────────────────────────────────────

describe('getTrackingEmotionData — query construction', () => {
    it('filters by researchId only when no pageUrl given', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await getTrackingEmotionData('r1');

        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain('emotion_samples IS NOT NULL');
        expect(params).toEqual(['r1']);
    });

    it('adds a page_url filter when pageUrl is given', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await getTrackingEmotionData('r1', 'https://example.com/pricing');

        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain('page_url = ?');
        expect(params).toEqual(['r1', 'https://example.com/pricing']);
    });
});

// ─── Empty / degenerate input ────────────────────────────────────────

describe('getTrackingEmotionData — empty input', () => {
    it('returns a zeroed result when no sessions have emotion data', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getTrackingEmotionData('r1');

        expect(result.totalSessions).toBe(0);
        expect(result.emotions.totalSamples).toBe(0);
        expect(result.emotions.avgConfidence).toBe(0);
        expect(result.emotions.timeline).toEqual([]);
        expect(result.valenceArousal).toEqual([]);
        expect(result.perSession).toEqual([]);
    });

    // Guards a real reporting hazard: with zero samples every emotion count is
    // tied at 0, so a naive "highest count" pick reports whichever emotion is
    // first in the list. An empty study must not claim its visitors felt joy.
    it('reports neutral (not the first-listed emotion) when there is no data', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.dominantEmotion).toBe('neutral');
    });

    it('reports every emotion at 0% when there is no data', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.distribution).toEqual({
            joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0,
        });
    });

    it('skips sessions whose sample array is empty', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', []), sessionRow('s2', [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.totalSessions).toBe(1);
        expect(result.perSession[0].sessionId).toBe('s2');
    });
});

// ─── Malformed input ─────────────────────────────────────────────────

describe('getTrackingEmotionData — malformed input', () => {
    it('survives unparseable JSON in emotion_samples', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                { id: 's1', visitor_id: 'v1', page_url: '/', emotion_samples: '{not json' },
                sessionRow('s2', [{ timestamp: 0, emotion: 'joy', confidence: 0.8 }]),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.totalSessions).toBe(1);
        expect(result.emotions.totalSamples).toBe(1);
    });

    it('survives emotion_samples holding a non-array JSON value', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 's1', visitor_id: 'v1', page_url: '/', emotion_samples: '{"a":1}' }],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(0);
    });

    it('accepts emotion_samples already parsed by the driver', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1',
                visitor_id: 'v1',
                page_url: '/',
                emotion_samples: [{ timestamp: 0, emotion: 'anger', confidence: 0.7 }],
            }],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
        expect(result.emotions.dominantEmotion).toBe('anger');
    });

    // Samples arrive from a browser we do not control, so an unrecognized label
    // must never leak into the reported figures.
    it('discards samples with an emotion outside the Ekman set', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 100, emotion: 'contempt', confidence: 0.95 },
                { timestamp: 200, emotion: 'hacked', confidence: 0.99 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
        expect(result.emotions.dominantEmotion).toBe('joy');
        expect(result.emotions.distribution.joy).toBe(100);
    });

    it('keeps the distribution summing to 100% when junk samples are present', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 100, emotion: 'sadness', confidence: 0.5 },
                { timestamp: 200, emotion: 'not-an-emotion', confidence: 0.9 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        const sum = Object.values(result.emotions.distribution).reduce((a, b) => a + b, 0);
        expect(sum).toBe(100);
    });

    it('discards null and non-object entries in the sample array', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1',
                visitor_id: 'v1',
                page_url: '/',
                emotion_samples: JSON.stringify([
                    null,
                    'joy',
                    42,
                    { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                ]),
            }],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
    });

    it('discards samples with a non-finite timestamp', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: Infinity, emotion: 'anger', confidence: 0.9 },
                { timestamp: 'soon' as unknown as number, emotion: 'fear', confidence: 0.9 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
        expect(result.emotions.dominantEmotion).toBe('joy');
    });

    it('discards samples whose confidence is not a usable number', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.8 },
                { timestamp: 100, emotion: 'fear', confidence: NaN },
                { timestamp: 200, emotion: 'anger', confidence: 'high' as unknown as number },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
        expect(result.emotions.avgConfidence).toBe(0.8);
    });
});

// ─── Distribution & aggregate stats ──────────────────────────────────

describe('getTrackingEmotionData — distribution', () => {
    it('expresses the distribution as percentages of all samples', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 100, emotion: 'joy', confidence: 0.9 },
                { timestamp: 200, emotion: 'joy', confidence: 0.9 },
                { timestamp: 300, emotion: 'sadness', confidence: 0.5 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.distribution.joy).toBe(75);
        expect(result.emotions.distribution.sadness).toBe(25);
        expect(result.emotions.distribution.anger).toBe(0);
    });

    it('rounds percentages to two decimals, like Eye Tracking', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.5 },
                { timestamp: 100, emotion: 'sadness', confidence: 0.5 },
                { timestamp: 200, emotion: 'anger', confidence: 0.5 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.distribution.joy).toBe(33.33);
    });

    it('aggregates counts across sessions', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }]),
                sessionRow('s2', [
                    { timestamp: 0, emotion: 'fear', confidence: 0.6 },
                    { timestamp: 100, emotion: 'fear', confidence: 0.6 },
                ]),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.totalSessions).toBe(2);
        expect(result.emotions.totalSamples).toBe(3);
        expect(result.emotions.dominantEmotion).toBe('fear');
    });

    it('averages confidence across every sample, rounded to two decimals', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 100, emotion: 'joy', confidence: 0.6 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.avgConfidence).toBe(0.75);
    });
});

// ─── Per-session summaries ───────────────────────────────────────────

describe('getTrackingEmotionData — per-session summaries', () => {
    it('reports each session dominant emotion independently of the aggregate', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [
                    { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                    { timestamp: 100, emotion: 'joy', confidence: 0.9 },
                ]),
                sessionRow('s2', [{ timestamp: 0, emotion: 'anger', confidence: 0.8 }]),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.perSession).toHaveLength(2);
        expect(result.perSession[0].dominantEmotion).toBe('joy');
        expect(result.perSession[1].dominantEmotion).toBe('anger');
        expect(result.emotions.dominantEmotion).toBe('joy');
    });

    it('picks the most frequent emotion within a session, not the first seen', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'neutral', confidence: 0.9 },
                { timestamp: 100, emotion: 'joy', confidence: 0.5 },
                { timestamp: 200, emotion: 'joy', confidence: 0.5 },
                { timestamp: 300, emotion: 'joy', confidence: 0.5 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.perSession[0].dominantEmotion).toBe('joy');
    });

    it('carries visitor, page and sample count through', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow(
                's1',
                [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }, { timestamp: 100, emotion: 'joy', confidence: 0.9 }],
                { visitor_id: 'v-42', page_url: 'https://example.com/checkout' },
            )],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.perSession[0]).toMatchObject({
            sessionId: 's1',
            visitorId: 'v-42',
            pageUrl: 'https://example.com/checkout',
            sampleCount: 2,
        });
    });
});

// ─── Timeline bucketing (same rule as Eye Tracking) ─────────────────

describe('getTrackingEmotionData — timeline', () => {
    it('groups samples into fixed one-second buckets keyed in milliseconds', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 400, emotion: 'joy', confidence: 0.7 },
                { timestamp: 1200, emotion: 'anger', confidence: 0.8 },
                { timestamp: 2500, emotion: 'fear', confidence: 0.6 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline.map(t => t.timestamp)).toEqual([0, 1000, 2000]);
    });

    it('takes the most frequent emotion of each bucket and averages its confidence', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.3 },
                { timestamp: 200, emotion: 'anger', confidence: 0.95 },
                { timestamp: 400, emotion: 'joy', confidence: 0.5 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline).toHaveLength(1);
        expect(result.emotions.timeline[0].emotion).toBe('joy');
        expect(result.emotions.timeline[0].confidence).toBeCloseTo(0.583, 3);
    });

    it('averages the action units of each bucket', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 0.8, AU12: 1 } },
                { timestamp: 50, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 0.4, AU12: 0.6 } },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline[0].actionUnits.AU6).toBeCloseTo(0.6);
        expect(result.emotions.timeline[0].actionUnits.AU12).toBeCloseTo(0.8);
    });

    it('keeps sessions recorded before action units existed, with empty units', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline[0].actionUnits).toEqual({});
    });

    it('emits one valence/arousal entry per timeline bucket', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9 },
                { timestamp: 1100, emotion: 'joy', confidence: 0.9 },
                { timestamp: 2200, emotion: 'joy', confidence: 0.9 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline.map(t => t.timestamp / 1000)).toEqual(result.valenceArousal.map(v => v.timestampS));
    });

    it('orders buckets by time even when sessions arrive unsorted', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [
                    { timestamp: 2400, emotion: 'fear', confidence: 0.9 },
                    { timestamp: 100, emotion: 'joy', confidence: 0.9 },
                ]),
                sessionRow('s2', [{ timestamp: 1300, emotion: 'anger', confidence: 0.9 }]),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline.map(t => t.timestamp)).toEqual([0, 1000, 2000]);
        expect(result.emotions.timeline.map(t => t.emotion)).toEqual(['joy', 'anger', 'fear']);
    });

    it('starts a new bucket at exactly one second', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 999, emotion: 'joy', confidence: 0.9 },
                { timestamp: 1000, emotion: 'anger', confidence: 0.9 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline.map(t => t.emotion)).toEqual(['joy', 'anger']);
    });

    it('merges samples from different sessions by relative time', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [{ timestamp: 100, emotion: 'joy', confidence: 0.9 }]),
                sessionRow('s2', [{ timestamp: 200, emotion: 'joy', confidence: 0.8 }]),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.timeline).toHaveLength(1);
        expect(result.emotions.timeline[0].timestamp).toBe(0);
    });
});

// ─── Participants and micro-expressions (same rules as Eye Tracking) ─

describe('getTrackingEmotionData — participants and micro-expressions', () => {
    it('reports one participant per visitor, merging the pages they visited', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                sessionRow('s1', [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }], { visitor_id: 'v1' }),
                sessionRow('s2', [{ timestamp: 0, emotion: 'joy', confidence: 0.9 }, { timestamp: 50, emotion: 'anger', confidence: 0.9 }], { visitor_id: 'v1' }),
                sessionRow('s3', [{ timestamp: 0, emotion: 'fear', confidence: 0.9 }], { visitor_id: 'v2' }),
            ],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.perParticipant).toEqual([
            { participantId: 'v1', dominantEmotion: 'joy', sampleCount: 3, distribution: expect.objectContaining({ joy: 66.67, anger: 33.33 }) },
            { participantId: 'v2', dominantEmotion: 'fear', sampleCount: 1, distribution: expect.objectContaining({ fear: 100 }) },
        ]);
    });

    it('detects a 250 ms flash of another emotion as a micro-expression of that visitor', async () => {
        const neutral = (timestamp: number) => ({ timestamp, emotion: 'neutral', confidence: 0.9 });
        const samples = [
            ...Array.from({ length: 20 }, (_, i) => neutral(i * 50)),
            ...Array.from({ length: 6 }, (_, i) => ({ timestamp: 1000 + i * 50, emotion: 'disgust', confidence: 0.7 })),
            ...Array.from({ length: 20 }, (_, i) => neutral(1300 + i * 50)),
        ];
        mockQuery.mockResolvedValueOnce({ rows: [sessionRow('s1', samples, { visitor_id: 'v9' })] });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.microExpressions).toMatchObject({ total: 1, microCount: 1, byEmotion: { disgust: 1 } });
        expect(result.emotions.microExpressions?.events[0]).toMatchObject({ participantId: 'v9', emotion: 'disgust', durationMs: 250, startTimestamp: 1000 });
    });

    it('drops samples whose action units are not numbers', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 'high' } },
                { timestamp: 50, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 0.5 } },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.emotions.totalSamples).toBe(1);
    });
});

// ─── Valence / Arousal ───────────────────────────────────────────────

describe('getTrackingEmotionData — valence & arousal', () => {
    it('places joy in the positive-valence, positive-arousal quadrant', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'joy', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeGreaterThan(0);
        expect(result.valenceArousal[0].arousal).toBeGreaterThan(0);
    });

    it('places sadness in the negative-valence, negative-arousal quadrant', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'sadness', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeLessThan(0);
        expect(result.valenceArousal[0].arousal).toBeLessThan(0);
    });

    it('places anger in the negative-valence, high-arousal quadrant', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'anger', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeLessThan(0);
        expect(result.valenceArousal[0].arousal).toBeGreaterThan(0);
    });

    it('places surprise at positive valence with the highest arousal', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'surprise', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeGreaterThan(0);
        expect(result.valenceArousal[0].arousal).toBeGreaterThan(0.7);
    });

    it('places fear at strongly negative valence with high arousal', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'fear', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeLessThan(-0.5);
        expect(result.valenceArousal[0].arousal).toBeGreaterThan(0);
    });

    it('places disgust at negative valence with mild arousal', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'disgust', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeLessThan(-0.5);
        expect(result.valenceArousal[0].arousal).toBeGreaterThan(0);
        expect(result.valenceArousal[0].arousal).toBeLessThan(0.5);
    });

    it('puts neutral at the origin', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'neutral', confidence: 0.9 }])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0]).toMatchObject({ valence: 0, arousal: 0 });
    });

    it('weights the average by confidence, not by sample count', async () => {
        // One strongly-detected joy against one barely-detected sadness should
        // land positive; an unweighted mean would sit near zero.
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0.95 },
                { timestamp: 100, emotion: 'sadness', confidence: 0.05 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].valence).toBeGreaterThan(0.5);
    });

    it('scales arousal by confidence rather than dividing by it', async () => {
        // Two samples of equal emotion but unequal confidence must average to
        // that emotion's arousal — dividing by confidence would blow past it.
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'surprise', confidence: 0.2 },
                { timestamp: 100, emotion: 'surprise', confidence: 0.4 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0].arousal).toBeCloseTo(0.8, 2);
    });

    it('lets the higher-confidence emotion dominate a mixed bucket', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'fear', confidence: 0.1 },
                { timestamp: 100, emotion: 'joy', confidence: 0.9 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        // Weighted: (0.8*0.9 + -0.8*0.1) / 1.0 = 0.64
        expect(result.valenceArousal[0].valence).toBeCloseTo(0.64, 2);
    });

    it('rounds to two decimals in every bucket, not only the last one', async () => {
        // Buckets closed mid-stream go through a separate push than the final
        // bucket, so the rounding there needs its own assertion.
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'fear', confidence: 0.1 },
                { timestamp: 200, emotion: 'joy', confidence: 0.9 },
                { timestamp: 1500, emotion: 'neutral', confidence: 0.5 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal).toHaveLength(2);
        // First (mid-stream) bucket: (0.8*0.9 + -0.8*0.1) / 1.0 = 0.64
        expect(result.valenceArousal[0].valence).toBe(0.64);
        // (0.5*0.9 + 0.6*0.1) / 1.0 = 0.51
        expect(result.valenceArousal[0].arousal).toBe(0.51);
    });

    it('keeps valence and arousal inside the circumplex bounds', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'fear', confidence: 1 },
                { timestamp: 100, emotion: 'anger', confidence: 1 },
                { timestamp: 200, emotion: 'joy', confidence: 1 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        for (const point of result.valenceArousal) {
            expect(point.valence).toBeGreaterThanOrEqual(-1);
            expect(point.valence).toBeLessThanOrEqual(1);
            expect(point.arousal).toBeGreaterThanOrEqual(-1);
            expect(point.arousal).toBeLessThanOrEqual(1);
        }
    });

    it('falls back to the origin when every sample has zero confidence', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [
                { timestamp: 0, emotion: 'joy', confidence: 0 },
                { timestamp: 100, emotion: 'anger', confidence: 0 },
            ])],
        });

        const result = await getTrackingEmotionData('r1');

        expect(result.valenceArousal[0]).toMatchObject({ valence: 0, arousal: 0 });
    });
});

// ─── Expression-weighted V/A (v0.91+ samples with expressions vector) ──

/** Build a session row with expression vectors (new format). */
function sessionRowWithExpressions(
    id: string,
    samples: Array<{
        timestamp: number;
        emotion: string;
        confidence: number;
        expressions: Record<string, number>;
    }>,
) {
    return {
        id,
        visitor_id: `visitor-${id}`,
        page_url: 'https://example.com/',
        emotion_samples: JSON.stringify(samples),
    };
}

describe('getTrackingEmotionData — expression-weighted V/A', () => {
    it('uses expression probabilities for continuous V/A when available', async () => {
        // 60% joy + 30% neutral + 10% surprise → V/A should be intermediate, not fixed at joy's point
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRowWithExpressions('s1', [{
                timestamp: 0, emotion: 'joy', confidence: 0.6,
                expressions: { joy: 0.6, neutral: 0.3, surprise: 0.1 },
            }])],
        });

        const result = await getTrackingEmotionData('r1');
        const va = result.valenceArousal[0];

        // Weighted: V = (0.8*0.6 + 0*0.3 + 0.2*0.1) / 1.0 = 0.50
        // A = (0.5*0.6 + 0*0.3 + 0.8*0.1) / 1.0 = 0.38
        expect(va.valence).toBeGreaterThan(0);
        expect(va.valence).toBeLessThan(0.8); // NOT at joy's fixed point
        expect(va.arousal).toBeGreaterThan(0);
    });

    it('falls back to dominant-emotion lookup when expressions is absent', async () => {
        // Pre-v0.91 data without expressions field
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRow('s1', [{ timestamp: 0, emotion: 'joy', confidence: 1 }])],
        });

        const result = await getTrackingEmotionData('r1');

        // Same as before: joy fixed at V=0.8, A=0.5
        expect(result.valenceArousal[0].valence).toBe(0.8);
        expect(result.valenceArousal[0].arousal).toBe(0.5);
    });

    it('mixed expressions produce intermediate V/A (not jumping between 7 points)', async () => {
        // 50% joy + 50% sadness → should land near origin, not at either extreme
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRowWithExpressions('s1', [{
                timestamp: 0, emotion: 'joy', confidence: 0.5,
                expressions: { joy: 0.5, sadness: 0.5 },
            }])],
        });

        const result = await getTrackingEmotionData('r1');
        const va = result.valenceArousal[0];

        // V = (0.8*0.5 + -0.6*0.5) / 1.0 = 0.10
        // A = (0.5*0.5 + -0.4*0.5) / 1.0 = 0.05
        expect(va.valence).toBeCloseTo(0.1, 1);
        expect(va.arousal).toBeCloseTo(0.05, 1);
    });

    it('ignores zero-probability emotions in expressions', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [sessionRowWithExpressions('s1', [{
                timestamp: 0, emotion: 'anger', confidence: 1,
                expressions: { anger: 1, joy: 0, neutral: 0, sadness: 0, surprise: 0, fear: 0, disgust: 0 },
            }])],
        });

        const result = await getTrackingEmotionData('r1');

        // Pure anger: V=-0.7, A=0.7 (same as lookup since only anger has weight)
        expect(result.valenceArousal[0].valence).toBe(-0.7);
        expect(result.valenceArousal[0].arousal).toBe(0.7);
    });

    it('handles mixed old and new format samples in same bucket', async () => {
        // One old-format + one new-format in the same second
        const samples = [
            { timestamp: 0, emotion: 'joy', confidence: 0.8 },
            { timestamp: 200, emotion: 'neutral', confidence: 0.5, expressions: { neutral: 0.5, joy: 0.3, sadness: 0.2 } },
        ];
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1', visitor_id: 'v1', page_url: 'https://example.com/',
                emotion_samples: JSON.stringify(samples),
            }],
        });

        const result = await getTrackingEmotionData('r1');
        expect(result.valenceArousal).toHaveLength(1);
        expect(Number.isFinite(result.valenceArousal[0].valence)).toBe(true);
        expect(Number.isFinite(result.valenceArousal[0].arousal)).toBe(true);
    });
});
