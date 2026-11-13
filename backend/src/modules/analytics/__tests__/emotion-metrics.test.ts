import { describe, expect, it } from 'vitest';
import { computeMeanIntensity } from '../emotion-metrics';

describe('computeMeanIntensity', () => {
  it('averages every emotion probability over the exposure, as a percentage', () => {
    const intensity = computeMeanIntensity([
      { timestamp: 0, emotion: 'neutral', confidence: 0.9, expressions: { neutral: 0.9, sadness: 0.06, joy: 0.04 } },
      { timestamp: 50, emotion: 'neutral', confidence: 0.8, expressions: { neutral: 0.8, sadness: 0.14, joy: 0.06 } },
    ]);

    expect(intensity).toEqual({ neutral: 85, sadness: 10, joy: 5, surprise: 0, anger: 0, disgust: 0, fear: 0 });
  });

  it('counts the dominant emotion as fully present for responses recorded without probabilities', () => {
    const intensity = computeMeanIntensity([
      { timestamp: 0, emotion: 'joy', confidence: 0.7 },
      { timestamp: 50, emotion: 'fear', confidence: 0.6 },
    ]);

    expect(intensity).toMatchObject({ joy: 50, fear: 50, neutral: 0 });
  });
});
