import { useState, useMemo } from 'react';
import { HeatmapRenderer } from '../cognitive-task/components/HeatmapRenderer';
import { CustomSelect } from '../../ui/CustomSelect';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { LATER_FIXATION_WEIGHT, selectFirstLookPoints } from './firstLook';

export const FirstLookOverlay = ({
  imageUrl,
  fixations,
  excludedParticipants,
}: {
  imageUrl: string;
  fixations: EyeTrackingStimulus['fixations'];
  excludedParticipants?: Set<string>;
}) => {
  const [count, setCount] = useState(1);

  const includedFixations = useMemo(
    () => excludedParticipants?.size ? fixations.filter(f => !excludedParticipants.has(f.participantId)) : fixations,
    [fixations, excludedParticipants],
  );

  const heatmapData = useMemo(() => selectFirstLookPoints(includedFixations, count), [includedFixations, count]);

  const participantCount = useMemo(
    () => new Set(includedFixations.map(f => f.participantId)).size,
    [includedFixations],
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-gray-500">Show first</label>
        <div className="w-36">
          <CustomSelect
            options={[1, 2, 3, 5, 10].map(n => ({ value: String(n), label: `${n} fixation${n > 1 ? 's' : ''}` }))}
            value={String(count)}
            onChange={v => setCount(Number(v))}
          />
        </div>
        <span className="text-xs text-gray-400">
          per participant &middot; {participantCount} participants &middot; {heatmapData.length} points
        </span>
      </div>
      {count > 1 && (
        <p className="text-[11px] text-gray-400 mb-2">
          La 1ra fijación de cada participante pesa 100%; de la 2da en adelante, {Math.round(LATER_FIXATION_WEIGHT * 100)}%. Las zonas rojas marcan dónde cayó la primera mirada.
        </p>
      )}
      <HeatmapRenderer
        imageUrl={imageUrl}
        data={heatmapData}
        coordSystem="percent"
        visualProfile="gaze"
        className="w-full h-full"
        canvasClassName="w-full h-full block object-contain"
      />
    </div>
  );
};
