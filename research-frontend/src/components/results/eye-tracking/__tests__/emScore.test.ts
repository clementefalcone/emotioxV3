import { describe, expect, it } from 'vitest';
import type { EkmanEmotion } from '../../../../services/analytics.service';
import { computeEmScore } from '../emScore';

const distributionOf = (values: Partial<Record<EkmanEmotion, number>>): Record<EkmanEmotion, number> =>
  ({ joy: 0, surprise: 0, sadness: 0, fear: 0, disgust: 0, anger: 0, neutral: 0, ...values });

describe('computeEmScore', () => {
  it('applies the FMCG weights: comfort and curiosity x2, engagement x1.5, worry -1, ethical -2', () => {
    expect(computeEmScore(distributionOf({ joy: 10, surprise: 5, sadness: 4, fear: 3, disgust: 2 }))).toBeCloseTo(30 + 6 - 3 - 4);
  });

  it('does not penalise neutral or anger, which the formula does not include', () => {
    expect(computeEmScore(distributionOf({ neutral: 93.5, anger: 4, joy: 2.5 }))).toBeCloseTo(5);
  });
});
