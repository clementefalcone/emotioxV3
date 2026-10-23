/**
 * Eye Tracking Preview Modal
 *
 * Shows a visual preview of the Eye Tracking experience:
 * stimulus display (stand_alone or shelf), AOIs overlay, config summary.
 * Not interactive — demonstrates what the participant will see.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Eye, Clock, Grid3X3, Crosshair, Play, RotateCcw } from 'lucide-react';
import { resolveMediaUrl } from '../../services/media.service';
import { buildShelfColumns } from '../../utils/shelfLayout';

interface StimulusItem {
  url?: string;
  s3Key?: string;
  name?: string;
}

interface AOI {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EyeTrackingPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  stimuli: StimulusItem[];
  aois: AOI[];
  displayMode: 'stand_alone' | 'shelf';
  primingTimeS: number;
  shelfCount: number;
  itemsPerShelf: number;
  shelfRepetitions: number;
  taskInstructions: string;
  emotionRecognition: boolean;
  attentionPrediction: boolean;
}

type Phase = 'intro' | 'calibration' | 'viewing' | 'done';

export const EyeTrackingPreviewModal = ({
  isOpen,
  onClose,
  stimuli,
  aois,
  displayMode,
  primingTimeS,
  shelfCount,
  itemsPerShelf,
  shelfRepetitions,
  taskInstructions,
  emotionRecognition,
  attentionPrediction,
}: EyeTrackingPreviewModalProps) => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(primingTimeS);
  const [showAois, setShowAois] = useState(true);

  const resolvedUrls = stimuli
    .map(s => resolveMediaUrl(s.url || s.s3Key || ''))
    .filter(Boolean);

  const isVideo = resolvedUrls.length === 1 && /\.(mp4|webm|ogg)$/i.test(resolvedUrls[0]);
  const isShelf = displayMode === 'shelf' && resolvedUrls.length > 1;
  const shelfColumnUrls = buildShelfColumns(resolvedUrls, itemsPerShelf, shelfRepetitions);

  const reset = useCallback(() => {
    setPhase('intro');
    setCountdown(primingTimeS);
  }, [primingTimeS]);

  // Countdown during viewing phase
  useEffect(() => {
    if (phase !== 'viewing') return;
    if (countdown <= 0) { setPhase('done'); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">Eye Tracking Preview</h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              phase === 'viewing' ? 'bg-green-100 text-green-700'
                : phase === 'calibration' ? 'bg-amber-100 text-amber-700'
                : phase === 'done' ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}>{phase}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Intro phase */}
          {phase === 'intro' && (
            <div className="flex flex-col items-center gap-6 py-8">
              <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {taskInstructions || 'Observe the stimulus carefully'}
                </h3>
                <p className="text-sm text-gray-500">
                  The participant will see a calibration screen, then the stimulus for {primingTimeS}s.
                </p>
              </div>

              {/* Config summary */}
              <div className="flex flex-wrap gap-3 justify-center">
                <ConfigChip icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={`${primingTimeS}s`} />
                <ConfigChip icon={<Grid3X3 className="h-3.5 w-3.5" />} label="Mode" value={isShelf ? `Shelf ${shelfCount}x${itemsPerShelf}` : 'Stand Alone'} />
                <ConfigChip icon={<Eye className="h-3.5 w-3.5" />} label="Stimuli" value={`${resolvedUrls.length} ${isVideo ? 'video' : 'image'}${resolvedUrls.length !== 1 ? 's' : ''}`} />
                {emotionRecognition && <ConfigChip icon={<Crosshair className="h-3.5 w-3.5" />} label="Emotion" value="On" />}
                {attentionPrediction && <ConfigChip icon={<Crosshair className="h-3.5 w-3.5" />} label="Prediction" value="On" />}
              </div>

              <button
                onClick={() => setPhase('calibration')}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                <Play className="h-4 w-4" />
                Start Preview
              </button>
            </div>
          )}

          {/* Calibration phase (simulated) */}
          {phase === 'calibration' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="relative w-full max-w-2xl aspect-[4/3] bg-slate-900 rounded-lg flex items-center justify-center">
                {/* Simulated calibration dots */}
                {[[15, 15], [50, 12], [85, 15], [50, 50], [15, 85], [50, 88], [85, 85]].map(([x, y], i) => (
                  <div
                    key={i}
                    className="absolute w-3 h-3 rounded-full bg-green-400/40"
                    style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                  />
                ))}
                <div className="absolute w-4 h-4 rounded-full bg-green-400 animate-pulse shadow-lg ring-4 ring-green-400/30"
                  style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                />
                <p className="absolute bottom-4 text-white/60 text-xs">
                  13-point calibration (simulated)
                </p>
              </div>
              <button
                onClick={() => { setCountdown(primingTimeS); setPhase('viewing'); }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Skip to stimulus →
              </button>
            </div>
          )}

          {/* Viewing phase */}
          {phase === 'viewing' && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500">Time remaining:</span>
                <span className="font-mono font-semibold text-blue-600 text-lg">{countdown}s</span>
                <label className="flex items-center gap-1.5 ml-4 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAois}
                    onChange={e => setShowAois(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 h-3.5 w-3.5"
                  />
                  Show AOIs
                </label>
              </div>

              <div className="relative w-full max-w-2xl rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                {isShelf ? (
                  /* Shelf grid */
                  <div
                    className="grid gap-1 p-2"
                    style={{
                      gridTemplateColumns: `repeat(${itemsPerShelf}, 1fr)`,
                      gridTemplateRows: `repeat(${shelfCount}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: shelfCount * itemsPerShelf }, (_, i) => {
                      const col = i % itemsPerShelf;
                      const url = shelfColumnUrls[col];
                      return (
                        <div key={i} className="aspect-square rounded border border-gray-200 bg-white overflow-hidden flex items-center justify-center">
                          {url ? (
                            <img src={url} alt={`Item ${col + 1}`} className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-gray-300 text-xs">{col + 1}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : isVideo ? (
                  /* Video stimulus */
                  <video
                    src={resolvedUrls[0]}
                    className="w-full max-h-[50vh] object-contain"
                    autoPlay muted loop playsInline
                  />
                ) : resolvedUrls[0] ? (
                  /* Single image */
                  <img
                    src={resolvedUrls[0]}
                    alt="Stimulus"
                    className="w-full max-h-[50vh] object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                    No stimulus uploaded
                  </div>
                )}

                {/* AOI overlay */}
                {showAois && aois.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none">
                    {aois.map(aoi => (
                      <div
                        key={aoi.id}
                        className="absolute border-2 border-blue-500/60 bg-blue-500/10"
                        style={{
                          left: `${aoi.x}%`,
                          top: `${aoi.y}%`,
                          width: `${aoi.width}%`,
                          height: `${aoi.height}%`,
                        }}
                      >
                        <span className="absolute -top-5 left-0 text-[10px] font-medium text-blue-600 bg-white/90 px-1 rounded">
                          {aoi.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Done phase */}
          {phase === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Preview complete</h3>
                <p className="text-sm text-gray-500">
                  This is what the participant will experience.
                  {aois.length > 0 && ` ${aois.length} AOI${aois.length !== 1 ? 's' : ''} configured.`}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Replay
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function ConfigChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
      <span className="text-gray-400">{icon}</span>
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}
