import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';
import { drawGazeHeat, GAZE_DEFAULT_EXPOSURE, GAZE_DEFAULT_SPREAD } from '../cognitive-task/components/paintHeatmap';
import { EmotionCurveTimeline, type EmotionCurveTimelineProps } from './EmotionCurveTimeline';
import { alignSamplesToVideo } from './emotionCurve';

type OverlayMode = 'dots' | 'heatmap';

export const VideoGazePlayer = ({
  videoUrl,
  gazeTimeline,
  curve,
}: {
  videoUrl: string;
  gazeTimeline: NonNullable<EyeTrackingStimulus['gazeTimeline']>;
  curve?: EmotionCurveTimelineProps;
}) => {
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatCanvasRef = useRef<HTMLCanvasElement>(null);
  const [currentGazePoints, setCurrentGazePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all');
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('heatmap');
  const [videoMs, setVideoMs] = useState(0);
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

  const videoEmotionSamples = useMemo(() => {
    if (!curve) return [];
    const samples = selectedParticipant === 'all' ? curve.samples : curve.samples.filter(sample => sample.participantId === selectedParticipant);
    return alignSamplesToVideo(samples, gazeTimeline);
  }, [curve, selectedParticipant, gazeTimeline]);

  useEffect(() => {
    const video = videoPlayerRef.current;
    if (!video) return;
    const syncVideoMs = () => setVideoMs(Math.round(video.currentTime * 1000));
    video.addEventListener('timeupdate', syncVideoMs);
    video.addEventListener('seeked', syncVideoMs);
    return () => {
      video.removeEventListener('timeupdate', syncVideoMs);
      video.removeEventListener('seeked', syncVideoMs);
    };
  }, []);

  const seekVideo = useCallback((timeMs: number) => {
    if (videoPlayerRef.current) videoPlayerRef.current.currentTime = timeMs / 1000;
  }, []);

  // Pre-sort timeline by videoTime for faster binary search
  const sortedTimeline = useRef(filteredTimeline);
  useEffect(() => {
    sortedTimeline.current = [...filteredTimeline]
      .filter(p => p.videoTime != null)
      .sort((a, b) => (a.videoTime ?? 0) - (b.videoTime ?? 0));
  }, [filteredTimeline]);

  /** Find gaze points within a time window around current video time */
  const findVisiblePoints = useCallback((vt: number) => {
    const windowS = overlayMode === 'heatmap' ? 1 : 0.25;
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
    drawGazeHeat(
      canvas,
      points.map(p => [(p.x / 100) * w, (p.y / 100) * h, 1]),
      { spread: GAZE_DEFAULT_SPREAD, exposure: GAZE_DEFAULT_EXPOSURE },
    );
  }, []);

  useEffect(() => {
    const video = videoPlayerRef.current;
    if (!video) return;

    const drawGazeFrame = () => {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const visible = findVisiblePoints(video.currentTime);
      if (overlayMode === 'dots') {
        setCurrentGazePoints(visible);
      } else {
        renderHeatmap(visible, rect.width, rect.height);
      }
    };

    const updateGaze = () => {
      if (!video || video.paused) { rafRef.current = 0; return; }

      const now = performance.now();
      // Throttle to ~15fps (67ms)
      if (now - lastUpdateRef.current < 67) {
        rafRef.current = requestAnimationFrame(updateGaze);
        return;
      }
      lastUpdateRef.current = now;
      drawGazeFrame();
      rafRef.current = requestAnimationFrame(updateGaze);
    };

    const onPlay = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(updateGaze);
    };
    const onPause = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
    const onSeeked = () => {
      if (video.paused) drawGazeFrame();
    };
    if (video.paused) drawGazeFrame();

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
      {curve && videoEmotionSamples.length > 0 && (
        <div className="mt-4">
          <EmotionCurveTimeline samples={videoEmotionSamples} tracks={curve.tracks} zones={curve.zones} markerMs={videoMs} onMark={seekVideo} />
        </div>
      )}
    </div>
  );
};
