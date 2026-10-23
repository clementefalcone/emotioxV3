import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import simpleheat from 'simpleheat';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';

type OverlayMode = 'dots' | 'heatmap';

/** Warm gradient matching HeatmapRenderer — green->yellow->red */
const WARM_GRADIENT: Record<number, string> = {
  0.20: '#00ff00', 0.40: '#88ff00', 0.55: '#ffff00',
  0.72: '#ff8800', 0.88: '#ff0000', 1.0: '#ff0000',
};

export const VideoGazePlayer = ({
  videoUrl,
  gazeTimeline,
}: {
  videoUrl: string;
  gazeTimeline: NonNullable<EyeTrackingStimulus['gazeTimeline']>;
}) => {
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatCanvasRef = useRef<HTMLCanvasElement>(null);
  const [currentGazePoints, setCurrentGazePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all');
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('heatmap');
  const rafRef = useRef(0);
  const lastUpdateRef = useRef(0);

  const participantIds = useMemo(() => {
    const ids = new Set(gazeTimeline.map(p => p.participantId));
    return Array.from(ids);
  }, [gazeTimeline]);

  const filteredTimeline = useMemo(() => {
    if (selectedParticipant === 'all') return gazeTimeline;
    return gazeTimeline.filter(p => p.participantId === selectedParticipant);
  }, [gazeTimeline, selectedParticipant]);

  // Pre-sort timeline by videoTime for faster binary search
  const sortedTimeline = useRef(filteredTimeline);
  useEffect(() => {
    sortedTimeline.current = [...filteredTimeline]
      .filter(p => p.videoTime != null)
      .sort((a, b) => (a.videoTime ?? 0) - (b.videoTime ?? 0));
  }, [filteredTimeline]);

  /** Find gaze points within a time window around current video time */
  const findVisiblePoints = useCallback((vt: number) => {
    // ponytail: wider window for heatmap (1s accumulation), narrow for dots (250ms)
    const windowS = overlayMode === 'heatmap' ? 0.5 : 0.25;
    const timeline = sortedTimeline.current;

    // Binary search for window start
    let lo = 0;
    let hi = timeline.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((timeline[mid].videoTime ?? 0) < vt - windowS) lo = mid + 1;
      else hi = mid;
    }

    const visible: Array<{ x: number; y: number }> = [];
    for (let i = lo; i < timeline.length; i++) {
      const pvt = timeline[i].videoTime ?? 0;
      if (pvt > vt + windowS) break;
      const { x, y } = timeline[i];
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
        visible.push({ x, y });
      }
    }
    return visible;
  }, [overlayMode]);

  /** Render heatmap on offscreen canvas */
  const renderHeatmap = useCallback((points: Array<{ x: number; y: number }>, w: number, h: number) => {
    const canvas = heatCanvasRef.current;
    if (!canvas || w <= 0 || h <= 0) return;

    canvas.width = w;
    canvas.height = h;

    if (points.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, w, h);
      return;
    }

    const heat = simpleheat(canvas);
    const r = Math.max(15, Math.round(Math.min(w, h) * 0.06));
    heat.radius(r, r * 0.6);
    heat.gradient(WARM_GRADIENT);

    // Convert %-based coords to pixel coords, each point weight=1
    const heatData: Array<[number, number, number]> = points.map(p => [
      (p.x / 100) * w,
      (p.y / 100) * h,
      1,
    ]);
    heat.data(heatData);
    heat.max(Math.max(3, Math.ceil(heatData.length * 0.15)));
    heat.draw(0.05);
  }, []);

  useEffect(() => {
    const video = videoPlayerRef.current;
    if (!video) return;

    const updateGaze = () => {
      if (!video || video.paused) { rafRef.current = 0; return; }

      const now = performance.now();
      // Throttle to ~15fps (67ms)
      if (now - lastUpdateRef.current < 67) {
        rafRef.current = requestAnimationFrame(updateGaze);
        return;
      }
      lastUpdateRef.current = now;

      const vt = video.currentTime;
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        rafRef.current = requestAnimationFrame(updateGaze);
        return;
      }

      const visible = findVisiblePoints(vt);

      if (overlayMode === 'dots') {
        setCurrentGazePoints(visible);
      } else {
        renderHeatmap(visible, rect.width, rect.height);
      }

      rafRef.current = requestAnimationFrame(updateGaze);
    };

    const onPlay = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(updateGaze);
    };
    const onPause = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
    const onSeeked = () => {
      if (video.paused) updateGaze();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
  }, [findVisiblePoints, overlayMode, renderHeatmap]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        {participantIds.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Participant:</label>
            <div className="w-40">
              <CustomSelect
                value={selectedParticipant}
                onChange={(v) => setSelectedParticipant(v)}
                options={[
                  { value: 'all', label: `All (${participantIds.length})` },
                  ...participantIds.map(id => ({ value: id, label: id })),
                ]}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setOverlayMode('dots')}
            className={`text-xs px-2.5 py-1 rounded-l-md border transition-colors ${
              overlayMode === 'dots'
                ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                : 'bg-white border-gray-200 text-slate-500 hover:bg-gray-50'
            }`}
          >
            Dots
          </button>
          <button
            onClick={() => setOverlayMode('heatmap')}
            className={`text-xs px-2.5 py-1 rounded-r-md border-y border-r transition-colors ${
              overlayMode === 'heatmap'
                ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                : 'bg-white border-gray-200 text-slate-500 hover:bg-gray-50'
            }`}
          >
            Heatmap
          </button>
        </div>
      </div>
      <div ref={containerRef} className="relative rounded-lg overflow-hidden border bg-gray-100 w-fit mx-auto">
        <video
          ref={videoPlayerRef}
          src={videoUrl}
          controls
          className="w-full h-full object-contain block"
          playsInline
        />
        {/* Dots overlay */}
        {overlayMode === 'dots' && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            {currentGazePoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r="1.2"
                fill="rgba(59, 130, 246, 0.5)"
                stroke="rgba(59, 130, 246, 0.8)"
                strokeWidth="0.3"
              />
            ))}
          </svg>
        )}
        {/* Heatmap overlay */}
        {overlayMode === 'heatmap' && (
          <canvas
            ref={heatCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none opacity-60"
          />
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">
        {filteredTimeline.length.toLocaleString()} gaze points synced to video timeline
        {selectedParticipant !== 'all' && ` (filtered from ${gazeTimeline.length.toLocaleString()})`}
      </p>
    </div>
  );
};
