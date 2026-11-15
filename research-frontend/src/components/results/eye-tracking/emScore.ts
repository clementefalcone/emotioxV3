import type { EkmanEmotion } from '../../../services/analytics.service';

export const computeEmScore = (meanIntensity: Record<EkmanEmotion, number>): number => {
  const comfort = meanIntensity.joy;
  const curiosity = meanIntensity.surprise;
  const engagement = meanIntensity.sadness;
  const worry = meanIntensity.fear;
  const ethical = meanIntensity.disgust;
  const anger = meanIntensity.anger;
  return 2 * (comfort + curiosity) + 1.5 * engagement - (worry + anger) - 2 * ethical;
};
