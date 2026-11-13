import { useState, useMemo, useEffect } from 'react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';
import { buildScanpathConnections } from './scanpathConnections';

/** Color gradient from cool (first) to warm (last) fixation */
const SCANPATH_GRADIENT = [
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#D946EF', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B',
];

const getScanpathColor = (index: number, total: number): string => {
  const t = total <= 1 ? 0 : index / (total - 1);
  const ci = Math.min(Math.floor(t * (SCANPATH_GRADIENT.length - 1)), SCANPATH_GRADIENT.length - 1);
  return SCANPATH_GRADIENT[ci];
};

export const ScanpathOverlay = ({
  imageUrl,
  fixations,
}: {
  imageUrl: string;
  fixations: EyeTrackingStimulus['fixations'];
}) => {
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all');
  const [showConnections, setShowConnections] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Load image natural dimensions for correct viewBox (cleanup on URL change)
  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    return () => { img.onload = null; img.src = ''; };
  }, [imageUrl]);

  const participantIds = useMemo(() => {
    const ids = new Set(fixations.map(f => f.participantId));
    return Array.from(ids);
  }, [fixations]);

  const rawVisible = useMemo(() => {
    const filtered = selectedParticipant === 'all'
      ? fixations
      : fixations.filter(f => f.participantId === selectedParticipant);
    return [...filtered].sort((a, b) => a.timestamp - b.timestamp);
  }, [fixations, selectedParticipant]);

  // Use image natural dimensions for viewBox
  const vw = naturalSize?.w ?? 0;
  const vh = naturalSize?.h ?? 0;

  // Fixations from backend are in percentage (0-100) or viewport pixels (legacy).
  // Convert to image pixel coords for the SVG viewBox.
  const visibleFixations = useMemo(() => {
    if (!vw || !vh || rawVisible.length === 0) return rawVisible;
    const maxX = Math.max(...rawVisible.map(f => f.x));
    const maxY = Math.max(...rawVisible.map(f => f.y));
    // Percentage coords (0-100): scale to image dimensions
    if (maxX <= 100 && maxY <= 100) {
      return rawVisible.map(f => ({ ...f, x: (f.x / 100) * vw, y: (f.y / 100) * vh }));
    }
    // Viewport pixels (legacy): scale proportionally to image
    if (maxX > vw * 1.1 || maxY > vh * 1.1) {
      const scaleX = vw / (maxX * 1.05);
      const scaleY = vh / (maxY * 1.05);
      return rawVisible.map(f => ({ ...f, x: f.x * scaleX, y: f.y * scaleY }));
    }
    return rawVisible;
  }, [rawVisible, vw, vh]);

  const connections = useMemo(() => buildScanpathConnections(visibleFixations), [visibleFixations]);

  const maxDur = useMemo(
    () => Math.max(...visibleFixations.map(f => f.duration), 1),
    [visibleFixations]
  );

  return (
    <div>
      {/* Participant selector */}
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-gray-500">Participant:</label>
        <div className="w-40">
          <CustomSelect
            value={selectedParticipant}
            onChange={(v) => setSelectedParticipant(v)}
            options={[
              { value: 'all', label: `All (${participantIds.length})` },
              ...participantIds.map(pid => ({ value: pid, label: pid })),
            ]}
          />
        </div>
        <span className="text-xs text-gray-400">{visibleFixations.length} fixations</span>
        <div role="group" aria-label="Conexiones del recorrido" className="ml-auto flex rounded-full border border-gray-200 p-0.5 text-xs">
          {[false, true].map(isConnected => (
            <button
              key={String(isConnected)}
              type="button"
              aria-pressed={showConnections === isConnected}
              onClick={() => setShowConnections(isConnected)}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${showConnections === isConnected ? 'bg-[#006AFF] text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {isConnected ? 'Con conexiones' : 'Sin conexiones'}
            </button>
          ))}
        </div>
      </div>

      {/* Image with scanpath overlay */}
      <div className="rounded-lg overflow-hidden border bg-gray-100">
        <div className="relative w-full">
          <img src={imageUrl} alt="Stimulus" className="block w-full object-contain" draggable={false} />
          {vw > 0 && vh > 0 && <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${vw} ${vh}`}
            preserveAspectRatio="xMidYMid meet"
          >
          {/* Connection lines */}
          {showConnections && connections.map(({ fromIndex, toIndex }) => {
            const prev = visibleFixations[fromIndex];
            const fix = visibleFixations[toIndex];
            return (
              <line
                key={`line-${toIndex}`}
                x1={prev.x}
                y1={prev.y}
                x2={fix.x}
                y2={fix.y}
                stroke={getScanpathColor(toIndex, visibleFixations.length)}
                strokeWidth={Math.max(vw * 0.002, 1)}
                strokeOpacity={0.6}
              />
            );
          })}
          {/* Fixation circles */}
          {visibleFixations.map((fix, i) => {
            const color = getScanpathColor(i, visibleFixations.length);
            const minR = vw * 0.005;
            const maxR = vw * 0.025;
            const r = minR + (fix.duration / maxDur) * (maxR - minR);
            return (
              <g key={`fix-${i}`}>
                <circle cx={fix.x} cy={fix.y} r={r} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={Math.max(vw * 0.001, 0.5)} />
                <text
                  x={fix.x}
                  y={fix.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(vw * 0.012, 8)}
                  fontWeight={600}
                  fill="white"
                  stroke={color}
                  strokeWidth={Math.max(vw * 0.002, 0.5)}
                  paintOrder="stroke"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SCANPATH_GRADIENT[0] }} />
          <span className="text-[10px] text-gray-500">First fixation</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SCANPATH_GRADIENT[SCANPATH_GRADIENT.length - 1] }} />
          <span className="text-[10px] text-gray-500">Last fixation</span>
        </div>
        <span className="text-[10px] text-gray-400">Circle size = duration</span>
      </div>
    </div>
  );
};
