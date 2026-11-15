import { useState, useMemo } from 'react';
import { HeatmapRenderer } from '../cognitive-task/components/HeatmapRenderer';
import { CustomSelect } from '../../ui/CustomSelect';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { LATER_FIXATION_WEIGHT, selectFirstFixations, selectFirstLookPoints } from './firstLook';

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

  const firstFixations = useMemo(() => selectFirstFixations(includedFixations), [includedFixations]);
  const participantCount = firstFixations.length;

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
      <div className="relative">
        <HeatmapRenderer
          imageUrl={imageUrl}
          data={heatmapData}
          coordSystem="percent"
          visualProfile="gaze"
          className="w-full h-full"
          canvasClassName="w-full h-full block object-contain"
        />
        {firstFixations.map(fixation => (
          <span
            key={fixation.participantId}
            title={`1ra fijación · ${fixation.participantId}`}
            data-testid="first-fixation-marker"
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fuchsia-600 shadow"
            style={{ left: `${fixation.x}%`, top: `${fixation.y}%` }}
          />
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
        <span className="h-2.5 w-2.5 rounded-full border border-white bg-fuchsia-600" />
        1ra fijación de cada participante
      </p>
    </div>
  );
};
