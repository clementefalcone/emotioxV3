import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { EMOTION_AVATARS } from './emotionAvatars';
import { useEmotionLabels } from './emotionLabels';
import { EMOTION_COLORS } from './shared';

const TOOLTIP_WIDTH_PX = 170;
const TOOLTIP_HEIGHT_PX = 230;
const TOOLTIP_GAP_PX = 8;

const placeTooltip = (rect: DOMRect): { top: number; left: number } => {
  const fitsRight = rect.right + TOOLTIP_GAP_PX + TOOLTIP_WIDTH_PX <= window.innerWidth;
  const top = rect.top + rect.height / 2 - TOOLTIP_HEIGHT_PX / 2;
  return {
    left: fitsRight ? rect.right + TOOLTIP_GAP_PX : rect.left - TOOLTIP_GAP_PX - TOOLTIP_WIDTH_PX,
    top: Math.min(Math.max(TOOLTIP_GAP_PX, top), window.innerHeight - TOOLTIP_HEIGHT_PX - TOOLTIP_GAP_PX),
  };
};

interface EmotionAvatarBadgeProps {
  readonly emotion: EkmanEmotion;
  readonly className: string;
  readonly children: ReactNode;
}

export function EmotionAvatarBadge({ emotion, className, children }: EmotionAvatarBadgeProps) {
  const badgeRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const colors = EMOTION_COLORS[emotion];
  const labels = useEmotionLabels();
  return (
    <>
      <span
        ref={badgeRef}
        className={`cursor-help ${colors.bg} ${colors.text} ${className}`}
        onMouseEnter={() => badgeRef.current && setPosition(placeTooltip(badgeRef.current.getBoundingClientRect()))}
        onMouseLeave={() => setPosition(null)}
      >
        {children}
      </span>
      {position && createPortal(
        <figure
          role="tooltip"
          className="fixed z-[9999] flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg pointer-events-none"
          style={{ top: position.top, left: position.left, width: TOOLTIP_WIDTH_PX }}
        >
          <img src={EMOTION_AVATARS[emotion]} alt={labels[emotion]} width={150} height={190} className="h-[190px] w-[150px] rounded-md object-cover object-top" />
          <figcaption className={`text-[11px] font-medium ${colors.text}`}>{labels[emotion]}</figcaption>
        </figure>,
        document.body,
      )}
    </>
  );
}
