import { createContext, useContext } from 'react';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { EMOTION_LABELS } from './shared';

export type EmotionScenario = 'ux' | 'fmcg';

export const SCENARIO_EMOTION_LABELS: Record<EmotionScenario, Record<EkmanEmotion, string>> = {
  ux: EMOTION_LABELS,
  fmcg: { ...EMOTION_LABELS, joy: 'Comfort', surprise: 'Curiosity', sadness: 'Engagement', fear: 'Worry', disgust: 'Ethical' },
};

export const EmotionLabelsContext = createContext(SCENARIO_EMOTION_LABELS.ux);

export const useEmotionLabels = (): Record<EkmanEmotion, string> => useContext(EmotionLabelsContext);
