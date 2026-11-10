import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';
import { loadCachedStimulusImage } from '../../../utils/stimulusImageCache';
import {
  accumulateZoneDwell,
  getReplayDurationMs,
  resolveGazeFocus,
  sortFixationsByTime,
  type ReplayZone,
} from './gazeReplay';
import { drawGazeReplayFrame } from './drawGazeReplayFrame';
import { ZoneDwellList } from './ZoneDwellList';

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
const MAX_CANVAS_WIDTH = 1280;
const VIDEO_FORMATS = [
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
  { mimeType: 'video/mp4', extension: 'mp4' },
];

const findSupportedVideoFormat = () =>
  typeof MediaRecorder === 'undefined'
    ? undefined
    : VIDEO_FORMATS.find(format => MediaRecorder.isTypeSupported(format.mimeType));

const rankParticipantsByFixationCount = (fixations: EyeTrackingStimulus['fixations']): string[] => {
  const counts = new Map<string, number>();
  for (const fixation of fixations) counts.set(fixation.participantId, (counts.get(fixation.participantId) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([participantId]) => participantId);
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface GazeReplayPanelProps {
  readonly imageUrl: string;
  readonly fixations: EyeTrackingStimulus['fixations'];
  readonly gazeTimeline: NonNullable<EyeTrackingStimulus['gazeTimeline']>;
  readonly zones: readonly ReplayZone[];
}

export function GazeReplayPanel({ imageUrl, fixations, gazeTimeline, zones }: GazeReplayPanelProps) {
  const participantIds = useMemo(() => rankParticipantsByFixationCount(fixations), [fixations]);
  const [chosenParticipantId, setChosenParticipantId] = useState<string | null>(null);
  const participantId = chosenParticipantId && participantIds.includes(chosenParticipantId) ? chosenParticipantId : participantIds[0];
  const replayFixations = useMemo(
    () => sortFixationsByTime(fixations.filter(fixation => fixation.participantId === participantId)),
    [fixations, participantId],
  );
  const replayGazeSamples = useMemo(
    () => gazeTimeline.filter(sample => sample.participantId === participantId).sort((a, b) => a.t - b.t),
    [gazeTimeline, participantId],
  );
  const durationMs = Math.max(getReplayDurationMs(replayFixations), replayGazeSamples.at(-1)?.t ?? 0);

  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const videoFormat = useMemo(() => findSupportedVideoFormat(), []);

  useEffect(() => {
    let isCancelled = false;
    setImage(null);
    setImageError(null);
    loadCachedStimulusImage(imageUrl)
      .then(loaded => { if (!isCancelled) setImage(loaded); })
      .catch((error: Error) => { if (!isCancelled) setImageError(error.message); });
    return () => { isCancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    setTimeMs(0);
    setIsPlaying(false);
  }, [participantId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const scale = Math.min(1, MAX_CANVAS_WIDTH / image.naturalWidth);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawGazeReplayFrame(ctx, { image, fixations: replayFixations, gazeSamples: replayGazeSamples, zones, timeMs });
  }, [image, replayFixations, replayGazeSamples, zones, timeMs]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId = 0;
    let lastFrameAt = performance.now();
    const advance = (now: number) => {
      const elapsedMs = (now - lastFrameAt) * speed;
      lastFrameAt = now;
      setTimeMs(previous => Math.min(durationMs, previous + elapsedMs));
      frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, speed, durationMs]);

  useEffect(() => {
    if (isPlaying && timeMs >= durationMs) setIsPlaying(false);
  }, [isPlaying, timeMs, durationMs]);

  useEffect(() => {
    if (isRecording && !isPlaying) recorderRef.current?.stop();
  }, [isRecording, isPlaying]);

  const togglePlayback = useCallback(() => {
    if (!isPlaying && timeMs >= durationMs) setTimeMs(0);
    setIsPlaying(previous => !previous);
  }, [isPlaying, timeMs, durationMs]);

  const restart = useCallback(() => {
    setIsPlaying(false);
    setTimeMs(0);
  }, []);

  const exportVideo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoFormat) return;
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: videoFormat.mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      downloadBlob(new Blob(chunks, { type: videoFormat.mimeType }), `gaze-replay-${participantId}.${videoFormat.extension}`);
      recorderRef.current = null;
      setIsRecording(false);
    };
    recorderRef.current = recorder;
    setTimeMs(0);
    setIsRecording(true);
    setIsPlaying(true);
    recorder.start();
  }, [videoFormat, participantId]);

  if (participantIds.length === 0) {
    return (
      <div className="rounded-lg bg-gray-100 border border-gray-200 h-64 flex items-center justify-center">
        <p className="text-sm text-gray-400">No hay fijaciones para reproducir</p>
      </div>
    );
  }

  const activeZoneId = resolveGazeFocus(replayFixations, replayGazeSamples, zones, timeMs).zone?.id ?? null;
  const dwellByZone = accumulateZoneDwell(replayFixations, zones, timeMs);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-gray-500">Participante</label>
        <div className="w-44">
          <CustomSelect
            value={participantId}
            onChange={value => setChosenParticipantId(value)}
            options={participantIds.map(id => ({ value: id, label: id }))}
            disabled={isRecording}
          />
        </div>
        <span className="text-xs text-gray-400">
          {replayFixations.length} fijaciones · {(durationMs / 1000).toFixed(1)} s · {replayGazeSamples.length > 0 ? 'mirada continua' : 'solo fijaciones (sesión sin mirada continua)'}
        </span>
      </div>

      <div className="relative rounded-lg overflow-hidden border bg-gray-100">
        <canvas ref={canvasRef} className="block w-full h-auto" />
        {!image && !imageError && <div className="absolute inset-0 animate-pulse bg-gray-200" />}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-500">{imageError}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!image || isRecording}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          title={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={isRecording}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-50"
          title="Reiniciar"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={10}
          value={timeMs}
          disabled={isRecording}
          onChange={event => setTimeMs(Number(event.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="w-24 flex-shrink-0 text-right font-mono text-xs text-gray-500">
          {(timeMs / 1000).toFixed(1)} / {(durationMs / 1000).toFixed(1)} s
        </span>
        <div className="flex gap-1">
          {PLAYBACK_SPEEDS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              disabled={isRecording}
              className={`text-xs px-2 py-1 rounded-md border ${speed === option ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-gray-200 text-slate-500 hover:bg-gray-50'}`}
            >
              {option}×
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportVideo}
          disabled={!image || !videoFormat || isRecording}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-gray-200 bg-white text-slate-600 hover:bg-gray-50 disabled:opacity-50"
          title={videoFormat ? 'Graba el replay completo y lo descarga' : 'Este navegador no puede grabar video'}
        >
          <Download className="h-3.5 w-3.5" />
          {isRecording ? 'Grabando…' : 'Exportar video'}
        </button>
      </div>

      <ZoneDwellList zones={zones} dwellByZone={dwellByZone} activeZoneId={activeZoneId} />
    </div>
  );
}
