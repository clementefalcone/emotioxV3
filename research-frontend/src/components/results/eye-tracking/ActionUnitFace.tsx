import type { EkmanEmotion } from '../../../services/analytics.service';
import { EMOTION_AVATARS } from './emotionAvatars';
import { EMOTION_LABELS } from './shared';

const ACTION_UNIT_EMOTIONS: Record<string, EkmanEmotion> = {
  AU1: 'sadness',
  AU2: 'surprise',
  AU4: 'anger',
  AU6: 'joy',
  AU12: 'joy',
  AU15: 'sadness',
  AU20: 'fear',
  AU25: 'fear',
  AU26: 'surprise',
};

export const ActionUnitFace = ({ au, label }: { au: string; label: string }) => {
  const emotion = ACTION_UNIT_EMOTIONS[au];
  if (!emotion) return null;
  return (
    <figure className="flex flex-col items-center gap-1">
      <img src={EMOTION_AVATARS[emotion]} alt={`${au} ${label}`} width={150} height={190} className="h-[190px] w-[150px] rounded-lg object-cover object-top" />
      <figcaption className="text-[11px] text-slate-500">Típico de {EMOTION_LABELS[emotion]}</figcaption>
    </figure>
  );
};
