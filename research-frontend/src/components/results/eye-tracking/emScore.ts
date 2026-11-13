import type { EkmanEmotion } from '../../../services/analytics.service';

export const computeEmScore = (distribution: Record<EkmanEmotion, number>): number => {
  const comfort = distribution.joy;
  const curiosity = distribution.surprise;
  const engagement = distribution.sadness;
  const worry = distribution.fear;
  const ethical = distribution.disgust;
  return 2 * (comfort + curiosity) + 1.5 * engagement - worry - 2 * ethical;
};
