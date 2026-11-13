import { CURVE_AXIS_WIDTH_PX, type ParticipantFacePresence } from './emotionCurve';

interface FacePresenceBarsProps {
  readonly presence: readonly ParticipantFacePresence[];
  readonly domainMs: readonly [number, number];
  readonly markerMs: number | null;
}

const toPercent = (timeMs: number, domainMs: readonly [number, number]): number =>
  Math.min(100, Math.max(0, ((timeMs - domainMs[0]) / (domainMs[1] - domainMs[0])) * 100));

export function FacePresenceBars({ presence, domainMs, markerMs }: FacePresenceBarsProps) {
  return (
    <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto" style={{ paddingLeft: CURVE_AXIS_WIDTH_PX, paddingRight: CURVE_AXIS_WIDTH_PX }}>
      {presence.map(({ participantId, segments }) => (
        <div key={participantId} className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-[10px] text-gray-400" title={participantId}>{participantId}</span>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200">
            {segments.map(segment => {
              const left = toPercent(segment.startMs, domainMs);
              const right = toPercent(segment.endMs, domainMs);
              if (right <= left && (segment.endMs < domainMs[0] || segment.startMs > domainMs[1])) return null;
              return (
                <span
                  key={segment.startMs}
                  className="absolute inset-y-0 rounded-full bg-pink-600"
                  style={{ left: `${left}%`, width: `max(2px, ${right - left}%)` }}
                />
              );
            })}
            {markerMs !== null && markerMs >= domainMs[0] && markerMs <= domainMs[1] && (
              <span className="absolute inset-y-0 w-px bg-[#006AFF]" style={{ left: `${toPercent(markerMs, domainMs)}%` }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
