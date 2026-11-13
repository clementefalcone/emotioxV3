import { createContext, useContext } from 'react';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { EMOTION_COLORS, EMOTION_LABELS, type EmotionColor } from './shared';

export type EmotionScenario = 'ux' | 'fmcg';
export type EmotionPresence = 'active' | 'secondary';

export interface EmotionMeaning {
  readonly name: string;
  readonly description: string;
  readonly isPositive: boolean;
}

export interface EmotionVocabulary {
  readonly labels: Record<EkmanEmotion, string>;
  readonly colors: Record<EkmanEmotion, EmotionColor>;
  readonly meanings: Partial<Record<EkmanEmotion, EmotionMeaning>>;
}

const ACTIVE_THRESHOLD_PERCENT = 3;
const SECONDARY_THRESHOLD_PERCENT = 2;

export const EMOTION_PRESENCE_THRESHOLD_PERCENT = ACTIVE_THRESHOLD_PERCENT;

export const classifyEmotionPresence = (percent: number): EmotionPresence | null => {
  if (percent > ACTIVE_THRESHOLD_PERCENT) return 'active';
  if (percent >= SECONDARY_THRESHOLD_PERCENT) return 'secondary';
  return null;
};

export const EMOTION_VOCABULARIES: Record<EmotionScenario, EmotionVocabulary> = {
  ux: { labels: EMOTION_LABELS, colors: EMOTION_COLORS, meanings: {} },
  fmcg: {
    labels: { ...EMOTION_LABELS, joy: 'Comfort', surprise: 'Curiosity', sadness: 'Engagement', fear: 'Worry', disgust: 'Ethical' },
    colors: {
      ...EMOTION_COLORS,
      joy: { bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-600', hex: '#16a34a' },
      surprise: { bg: 'bg-yellow-50', text: 'text-yellow-700', bar: 'bg-yellow-400', hex: '#facc15' },
      sadness: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', bar: 'bg-fuchsia-600', hex: '#c026d3' },
      fear: { bg: 'bg-violet-50', text: 'text-violet-700', bar: 'bg-violet-300', hex: '#c4b5fd' },
      disgust: { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500', hex: '#f97316' },
    },
    meanings: {
      joy: {
        name: 'Comodidad y/o Nostalgia',
        description: 'Agrado, calma y confianza: «me siento bien con esto». Cuanto más alta, más premium se percibe.',
        isPositive: true,
      },
      surprise: {
        name: 'Curiosidad o Interés',
        description: '«Esto me intriga, quiero saber más». Capta atención, pero es volátil y dura poco.',
        isPositive: true,
      },
      sadness: {
        name: 'Compromiso',
        description: 'Atención profunda e inmersión en el empaque. Muy intensa puede ser «wow»; más calmada es ideal para calidad premium.',
        isPositive: true,
      },
      fear: {
        name: 'Dudas o Preocupación',
        description: 'Dudas y desconfianza: «¿será bueno de verdad?».',
        isPositive: false,
      },
      disgust: {
        name: 'Disonancia y/o Valores en conflicto',
        description: '«No me convence éticamente», por ejemplo si parece artificial o poco natural.',
        isPositive: false,
      },
    },
  },
};

export const EmotionVocabularyContext = createContext(EMOTION_VOCABULARIES.ux);

export const useEmotionVocabulary = (): EmotionVocabulary => useContext(EmotionVocabularyContext);
