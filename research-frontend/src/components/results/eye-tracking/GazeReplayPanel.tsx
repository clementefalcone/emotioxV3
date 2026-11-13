import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';
import type { HeatmapSettings } from './HeatmapSettingsModal';
import { loadCachedStimulusImage } from '../../../utils/stimulusImageCache';
import {
  accumulateGroupZoneDwell,
  accumulateZoneDwell,
  buildParticipantTracks,
  collectHeatPoints,
  countZoneOccupancy,
  getTrackDurationMs,
  resolveGazeFocus,
  type ParticipantTrack,
  type ReplayZone,
} from './gazeReplay';
import { drawGazeReplayFrame, drawGroupReplayFrame, drawHeatmapReplayFrame, getParticipantColor } from './drawGazeReplayFrame';
import { ZoneDwellList, type ZoneDwellRow } from './ZoneDwellList';
import { WebcamRecordingPlayer } from './WebcamRecordingPlayer';

const ALL_PARTICIPANTS = '__all__';
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
const ACCUMULATED_HEAT = 0;
const HEAT_WINDOWS_MS = [1000, 3000, 5000];

type ReplayView = 'path' | 'heatmap';

const REPLAY_VIEW_OPTIONS: readonly { value: ReplayView; label: string }[] = [
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'path', label: 'Recorrido' },
];
const HEAT_WINDOW_OPTIONS = [
  { value: ACCUMULATED_HEAT, label: 'Acumulado' },
  ...HEAT_WINDOWS_MS.map(windowMs => ({ value: windowMs, label: `Últimos ${windowMs / 1000} s` })),
];
const SPEED_OPTIONS = PLAYBACK_SPEEDS.map(speed => ({ value: speed, label: `${speed}×` }));
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

const formatSeconds = (timeMs: number): string => `${(timeMs / 1000).toFixed(1)} s`;

const buildParticipantRows = (track: ParticipantTrack, zones: readonly ReplayZone[], timeMs: number): ZoneDwellRow[] => {
  const activeZoneId = resolveGazeFocus(track.fixations, track.samples, zones, timeMs).zone?.id;
  const dwellByZone = accumulateZoneDwell(track.fixations, zones, timeMs);
  return zones.map(zone => {
    const dwell = dwellByZone.get(zone.id);
    const firstEntryMs = dwell?.firstEntryMs ?? null;
    return {
      zoneId: zone.id,
      label: zone.label,
      dwellMs: dwell?.dwellMs ?? 0,
      detail: firstEntryMs === null ? 'sin mirar' : `entra a ${formatSeconds(firstEntryMs)}`,
      isActive: zone.id === activeZoneId,
    };
  });
};

const buildGroupRows = (tracks: readonly ParticipantTrack[], zones: readonly ReplayZone[], timeMs: number): ZoneDwellRow[] => {
  const occupancy = countZoneOccupancy(tracks, zones, timeMs);
  const dwellByZone = accumulateGroupZoneDwell(tracks, zones, timeMs);
  return zones.map(zone => {
    const viewersNow = occupancy.get(zone.id) ?? 0;
    return {
      zoneId: zone.id,
      label: zone.label,
      dwellMs: dwellByZone.get(zone.id)?.averageDwellMs ?? 0,
      detail: `${dwellByZone.get(zone.id)?.viewerCount ?? 0} de ${tracks.length} miraron${viewersNow > 0 ? ` · ${viewersNow} ahora` : ''}`,
      isActive: viewersNow > 0,
    };
  });
};

interface SegmentedOptionsProps<T extends string | number> {
  readonly options: readonly { value: T; label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled: boolean;
}

function SegmentedOptions<T extends string | number>({ options, value, onChange, disabled }: SegmentedOptionsProps<T>) {
  return (
    <div className="flex gap-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={disabled}
          className={`text-xs px-2 py-1 rounded-md border ${value === option.value ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-gray-200 text-slate-500 hover:bg-gray-50'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const downloadBlob =(blob: Blob, fileName: string): void => {
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
  readonly webcamRecordings: ReadonlyMap<string, { url: string; offsetMs: number }>;
  readonly heatmapSettings: HeatmapSettings;
  readonly heatmapControls: ReactNode;
}

export function GazeReplayPanel({ imageUrl, fixations, gazeTimeline, zones, webcamRecordings, heatmapSettings, heatmapControls }: GazeReplayPanelProps) {
  const tracks = useMemo(() => buildParticipantTracks(fixations, gazeTimeline), [fixations, gazeTimeline]);
  const [chosenParticipantId, setChosenParticipantId] = useState<string | null>(null);
  const isAllParticipants = chosenParticipantId === ALL_PARTICIPANTS;
  const selectedTrack = tracks.find(track => track.participantId === chosenParticipantId) ?? tracks[0];
  const participantId = isAllParticipants ? ALL_PARTICIPANTS : selectedTrack?.participantId;
  const durationMs = isAllParticipants
    ? Math.max(0, ...tracks.map(getTrackDurationMs))
    : selectedTrack ? getTrackDurationMs(selectedTrack) : 0;

  const visibleTracks = useMemo(
    () => (isAllParticipants ? tracks : selectedTrack ? [selectedTrack] : []),
    [isAllParticipants, tracks, selectedTrack],
  );
  const heatIntensityPointCount = visibleTracks.reduce((count, track) => count + track.fixations.length, 0);
  const [view, setView] = useState<ReplayView>('heatmap');
  const [heatWindowMs, setHeatWindowMs] = useState(ACCUMULATED_HEAT);

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
    if (view === 'heatmap') {
      const windowMs = heatWindowMs === ACCUMULATED_HEAT ? null : heatWindowMs;
      const timingLabel = windowMs === null ? 'acumulado' : `últimos ${formatSeconds(windowMs)}`;
      drawHeatmapReplayFrame(ctx, {
        image,
        points: collectHeatPoints(visibleTracks, timeMs, windowMs),
        intensityPointCount: heatIntensityPointCount,
        settings: heatmapSettings,
        zones,
        hudText: `${formatSeconds(timeMs)} · ${timingLabel}`,
      });
    } else if (isAllParticipants) {
      drawGroupReplayFrame(ctx, { image, tracks, zones, timeMs });
    } else if (selectedTrack) {
      drawGazeReplayFrame(ctx, { image, fixations: selectedTrack.fixations, gazeSamples: selectedTrack.samples, zones, timeMs });
    }
  }, [image, view, heatWindowMs, visibleTracks, heatIntensityPointCount, heatmapSettings, isAllParticipants, tracks, selectedTrack, zones, timeMs]);

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
      const viewName = view === 'heatmap' ? `heatmap-${heatWindowMs === ACCUMULATED_HEAT ? 'acumulado' : `${heatWindowMs / 1000}s`}` : 'replay';
      downloadBlob(new Blob(chunks, { type: videoFormat.mimeType }), `gaze-${viewName}-${isAllParticipants ? 'todos' : participantId}.${videoFormat.extension}`);
      recorderRef.current = null;
      setIsRecording(false);
    };
    recorderRef.current = recorder;
    setTimeMs(0);
    setIsRecording(true);
    setIsPlaying(true);
    recorder.start();
  }, [videoFormat, participantId, isAllParticipants, view, heatWindowMs]);

  if (!selectedTrack) {
    return (
      <div className="rounded-lg bg-gray-100 border border-gray-200 h-64 flex items-center justify-center">
        <p className="text-sm text-gray-400">No hay fijaciones para reproducir</p>
      </div>
    );
  }

  const webcamRecording = isAllParticipants ? undefined : webcamRecordings.get(selectedTrack.participantId);
  const zoneRows = isAllParticipants ? buildGroupRows(tracks, zones, timeMs) : buildParticipantRows(selectedTrack, zones, timeMs);
  const tracksWithGaze = tracks.filter(track => track.samples.length > 0).length;
  const summary = isAllParticipants
    ? `${tracks.length} participantes · ${formatSeconds(durationMs)} · ${tracksWithGaze} con mirada continua`
    : `${selectedTrack.fixations.length} fijaciones · ${formatSeconds(durationMs)} · ${selectedTrack.samples.length > 0 ? 'mirada continua' : 'solo fijaciones (sesión sin mirada continua)'}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-gray-500">Participante</label>
        <div className="w-44">
          <CustomSelect
            value={participantId}
            onChange={value => setChosenParticipantId(value)}
            options={[
              { value: ALL_PARTICIPANTS, label: `Todos (${tracks.length})` },
              ...tracks.map(track => ({ value: track.participantId, label: track.participantId })),
            ]}
            disabled={isRecording}
          />
        </div>
        <SegmentedOptions options={REPLAY_VIEW_OPTIONS} value={view} onChange={setView} disabled={isRecording} />
        {view === 'heatmap' && (
          <SegmentedOptions options={HEAT_WINDOW_OPTIONS} value={heatWindowMs} onChange={setHeatWindowMs} disabled={isRecording} />
        )}
        <span className="text-xs text-gray-400">{summary}</span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="relative flex-[2] rounded-lg overflow-hidden border bg-gray-100">
          <canvas ref={canvasRef} className="block w-full h-auto" />
          {!image && !imageError && <div className="absolute inset-0 animate-pulse bg-gray-200" />}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-gray-500">{imageError}</p>
            </div>
          )}
        </div>
        {webcamRecording && (
          <div className="flex-1">
            <WebcamRecordingPlayer url={webcamRecording.url} offsetMs={webcamRecording.offsetMs} timeMs={timeMs} isPlaying={isPlaying} speed={speed} />
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
        <SegmentedOptions options={SPEED_OPTIONS} value={speed} onChange={setSpeed} disabled={isRecording} />
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

      {view === 'heatmap' && heatmapControls}

      {isAllParticipants && view === 'path' && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {tracks.map((track, index) => (
            <span key={track.participantId} className="flex items-center gap-1 text-[11px] text-gray-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getParticipantColor(index) }} />
              {track.participantId}
            </span>
          ))}
        </div>
      )}

      <ZoneDwellList
        title={isAllParticipants ? 'Tiempo de fijación promedio por zona hasta este momento' : 'Tiempo de fijación por zona hasta este momento'}
        rows={zoneRows}
      />
    </div>
  );
}
