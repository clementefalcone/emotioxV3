import type { EkmanEmotion } from '../../../services/analytics.service';
import joyAvatar from '../../../assets/emotion-avatars/alegria.webp';
import angerAvatar from '../../../assets/emotion-avatars/ira.webp';
import fearAvatar from '../../../assets/emotion-avatars/miedo.webp';
import surpriseAvatar from '../../../assets/emotion-avatars/sorpresa.webp';
import sadnessAvatar from '../../../assets/emotion-avatars/tristeza.webp';
import { EMOTION_LABELS } from './shared';

interface ActionUnitAvatar {
  readonly emotion: EkmanEmotion;
  readonly src: string;
}

const JOY: ActionUnitAvatar = { emotion: 'joy', src: joyAvatar };
const ANGER: ActionUnitAvatar = { emotion: 'anger', src: angerAvatar };
const FEAR: ActionUnitAvatar = { emotion: 'fear', src: fearAvatar };
const SURPRISE: ActionUnitAvatar = { emotion: 'surprise', src: surpriseAvatar };
const SADNESS: ActionUnitAvatar = { emotion: 'sadness', src: sadnessAvatar };

const ACTION_UNIT_AVATARS: Record<string, ActionUnitAvatar> = {
  AU1: SADNESS,
  AU2: SURPRISE,
  AU4: ANGER,
  AU6: JOY,
  AU12: JOY,
  AU15: SADNESS,
  AU20: FEAR,
  AU25: FEAR,
  AU26: SURPRISE,
};

export const ActionUnitFace = ({ au, label }: { au: string; label: string }) => {
  const avatar = ACTION_UNIT_AVATARS[au];
  if (!avatar) return null;
  return (
    <figure className="flex flex-col items-center gap-1">
      <img src={avatar.src} alt={`${au} ${label}`} width={150} height={190} className="h-[190px] w-[150px] rounded-lg object-cover object-top" />
      <figcaption className="text-[11px] text-slate-500">Típico de {EMOTION_LABELS[avatar.emotion]}</figcaption>
    </figure>
  );
};
