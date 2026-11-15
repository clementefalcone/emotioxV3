import { describe, expect, it } from 'vitest';
import { readSharesAt, resolveStripMaxShare, type EmotionStripSeries } from '../drawEmotionStrip';
import type { EmotionCurvePoint, EmotionSeriesValues } from '../emotionCurve';

const values = (overrides: Partial<EmotionSeriesValues>): EmotionSeriesValues =>
  ({ joy: 0, surprise: 0, anger: 0, fear: 0, disgust: 0, sadness: 0, neutral: 0, valence: 0, arousal: 0, ...overrides });

const POINTS: EmotionCurvePoint[] = [
  { timeMs: 0, participantCount: 1, values: values({ joy: 0.1, neutral: 0.9 }) },
  { timeMs: 250, participantCount: 0, values: null },
  { timeMs: 500, participantCount: 1, values: values({ joy: 0.32, neutral: 0.68 }) },
];

const JOY_ONLY: EmotionStripSeries[] = [{ emotion: 'joy', label: 'Joy', color: '#16a34a' }];

describe('resolveStripMaxShare', () => {
  it('fits the axis to the highest shown emotion, rounded up to 5%, so small variations stay visible', () => {
    expect(resolveStripMaxShare(POINTS, JOY_ONLY)).toBeCloseTo(0.35);
  });

  it('falls back to the full scale when no shown emotion appears', () => {
    expect(resolveStripMaxShare(POINTS, [{ emotion: 'anger', label: 'Anger', color: '#000' }])).toBe(1);
  });
});

describe('readSharesAt', () => {
  it('keeps the last measured emotions while the face is not detected', () => {
    expect(readSharesAt(POINTS, 300)?.joy).toBe(0.1);
    expect(readSharesAt(POINTS, 600)?.joy).toBe(0.32);
  });
});
