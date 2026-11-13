import type { EkmanEmotion } from '../../../services/analytics.service';
import joyAvatar from '../../../assets/emotion-avatars/alegria.webp';
import disgustAvatar from '../../../assets/emotion-avatars/asco.webp';
import angerAvatar from '../../../assets/emotion-avatars/ira.webp';
import fearAvatar from '../../../assets/emotion-avatars/miedo.webp';
import neutralAvatar from '../../../assets/emotion-avatars/neutral.webp';
import surpriseAvatar from '../../../assets/emotion-avatars/sorpresa.webp';
import sadnessAvatar from '../../../assets/emotion-avatars/tristeza.webp';

export const EMOTION_AVATARS: Record<EkmanEmotion, string> = {
  joy: joyAvatar,
  disgust: disgustAvatar,
  anger: angerAvatar,
  fear: fearAvatar,
  neutral: neutralAvatar,
  surprise: surpriseAvatar,
  sadness: sadnessAvatar,
};
