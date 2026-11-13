import { useMemo, useState } from 'react';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { CustomSelect } from '../../ui/CustomSelect';
import { useEmotionVocabulary } from './emotionScenario';
import { EmotionCurveChart } from './EmotionCurveChart';
import { FacePresenceBars } from './FacePresenceBars';
import { countZoneOccupancy, type ParticipantTrack, type ReplayZone } from './gazeReplay';
import {
  buildEmotionCurve,
  buildFacePresence,
  ALL_CURVE_SERIES,
  CURVE_EMOTIONS,
  findLeadingEmotion,
  formatClock,
  VALENCE_AROUSAL_COLORS,
  type EmotionCurvePoint,
  type EmotionSeries,
  type ParticipantEmotionSample,
} from './emotionCurve';

const CURVE_BUCKET_MS = 250;
const FACE_GAP_MS = 500;
const LEADING_WINDOW_MS = 2000;
const ALL_PARTICIPANTS = 'all';
const DEFAULT_VISIBLE_SERIES: readonly EmotionSeries[] = ALL_CURVE_SERIES.filter(series => series !== 'neutral');
const ZOOM_OPTIONS: readonly { label: string; windowMs: number | null }[] = [
  { label: '10 s', windowMs: 10_000 },
  { label: '30 s', windowMs: 30_000 },
  { label: '2 min', windowMs: 120_000 },
  { label: 'Todo', windowMs: null },
];


const isEmotion = (series: EmotionSeries): series is EkmanEmotion => series !== 'valence' && series !== 'arousal';

const clampWindowStart = (startMs: number, windowMs: number, totalMs: number): number =>
  Math.min(Math.max(0, startMs), Math.max(0, totalMs - windowMs));

interface SeriesChipProps {
  readonly label: string;
  readonly color?: string;
  readonly isActive: boolean;
  readonly onClick: () => void;
}

function SeriesChip({ label, color, isActive, onClick }: SeriesChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${isActive ? 'border-slate-300 bg-white text-slate-700' : 'border-gray-200 bg-gray-50 text-gray-400'}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isActive ? color : '#d1d5db' }} />}
      {label}
    </button>
  );
}

function LeadingEmotionNote({ points, emotions, markerMs }: { readonly points: readonly EmotionCurvePoint[]; readonly emotions: readonly EkmanEmotion[]; readonly markerMs: number }) {
  const { labels } = useEmotionVocabulary();
  if (emotions.length === 0) return <p className="text-xs text-gray-400">Activa al menos una emoción para ver cuál predomina.</p>;
  const leading = findLeadingEmotion(points, emotions, markerMs, LEADING_WINDOW_MS);
  if (!leading) return <p className="text-xs text-gray-400">Sin rostro detectado en los 2 segundos previos a {formatClock(markerMs)}.</p>;
  if (Math.round(leading.share * 100) === 0) {
    return <p className="text-xs text-gray-400">Ninguna de las emociones visibles aparece en los 2 segundos previos a {formatClock(markerMs)}.</p>;
  }
  const lead = leading.gapToNext === null
    ? `con un promedio de ${Math.round(leading.share * 100)}%`
    : `con una distancia de ${Math.round(leading.gapToNext * 100)}% de la siguiente más cercana`;
  return (
    <p className="border-l-2 border-pink-600 pl-2 text-xs text-slate-600">
      <span className="font-semibold">Observación:</span> {labels[leading.emotion]} predomina en los 2 segundos previos a {formatClock(markerMs)}, {lead}.
    </p>
  );
}

function GazeAtMarker({ tracks, zones, markerMs }: { readonly tracks: readonly ParticipantTrack[]; readonly zones: readonly ReplayZone[]; readonly markerMs: number }) {
  const occupancy = countZoneOccupancy(tracks, zones, markerMs);
  const watchedZones = zones.filter(zone => (occupancy.get(zone.id) ?? 0) > 0).sort((a, b) => (occupancy.get(b.id) ?? 0) - (occupancy.get(a.id) ?? 0));
  return (
    <p className="text-xs text-slate-600">
      <span className="font-semibold">Mirada en {formatClock(markerMs)}:</span>{' '}
      {watchedZones.length === 0
        ? <span className="text-gray-400">sin mirada registrada en ninguna zona</span>
        : watchedZones.map(zone => `${zone.label} (${occupancy.get(zone.id)})`).join(' · ')}
    </p>
  );
}

export interface EmotionCurveTimelineProps {
  readonly samples: readonly ParticipantEmotionSample[];
  readonly tracks: readonly ParticipantTrack[];
  readonly zones: readonly ReplayZone[];
  readonly markerMs?: number | null;
  readonly onMark?: (timeMs: number) => void;
}

export function EmotionCurveTimeline({ samples, tracks, zones, markerMs: controlledMarkerMs, onMark }: EmotionCurveTimelineProps) {
  const { labels, colors } = useEmotionVocabulary();
  const seriesLabels: Record<EmotionSeries, string> = { ...labels, valence: 'Valencia', arousal: 'Arousal' };
  const seriesColors = {
    ...VALENCE_AROUSAL_COLORS,
    ...Object.fromEntries(CURVE_EMOTIONS.map(emotion => [emotion, colors[emotion].hex])),
  } as Record<EmotionSeries, string>;
  const [participantId, setParticipantId] = useState(ALL_PARTICIPANTS);
  const [visibleSeries, setVisibleSeries] = useState<readonly EmotionSeries[]>(DEFAULT_VISIBLE_SERIES);
  const [zoomWindowMs, setZoomWindowMs] = useState<number | null>(null);
  const [windowStartMs, setWindowStartMs] = useState(0);
  const [ownMarkerMs, setOwnMarkerMs] = useState<number | null>(null);
  const markerMs = controlledMarkerMs === undefined ? ownMarkerMs : controlledMarkerMs;
  const setMarkerMs = onMark ?? setOwnMarkerMs;

  const participantIds = useMemo(() => [...new Set(samples.map(sample => sample.participantId))], [samples]);
  const shownSamples = useMemo(
    () => (participantId === ALL_PARTICIPANTS ? samples : samples.filter(sample => sample.participantId === participantId)),
    [samples, participantId],
  );
  const points = useMemo(() => buildEmotionCurve(shownSamples, CURVE_BUCKET_MS), [shownSamples]);
  const presence = useMemo(() => buildFacePresence(shownSamples, FACE_GAP_MS), [shownSamples]);
  const shownTracks = participantId === ALL_PARTICIPANTS ? tracks : tracks.filter(track => track.participantId === participantId);

  if (points.length === 0) return null;

  const totalMs = points.length * CURVE_BUCKET_MS;
  const isZoomed = zoomWindowMs !== null && zoomWindowMs < totalMs;
  const startMs = isZoomed ? clampWindowStart(windowStartMs, zoomWindowMs, totalMs) : 0;
  const domainMs: [number, number] = [startMs, isZoomed ? startMs + zoomWindowMs : totalMs];
  const shownEmotions = visibleSeries.filter(isEmotion);
  const noteMarkerMs = markerMs ?? points[points.length - 1].timeMs;

  const toggleSeries = (series: EmotionSeries) =>
    setVisibleSeries(previous => (previous.includes(series) ? previous.filter(item => item !== series) : [...previous, series]));
  const chooseZoom = (windowMs: number | null) => {
    setZoomWindowMs(windowMs);
    if (windowMs !== null) setWindowStartMs((markerMs ?? 0) - windowMs / 2);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-700">Emociones en el tiempo</h4>
          <p className="text-xs text-gray-400">Emociones en % (eje derecho) y Valencia/Arousal de -1 a +1 (eje izquierdo). Pincha la curva para fijar la marca.</p>
        </div>
        {participantIds.length > 1 && (
          <CustomSelect
            value={participantId}
            onChange={setParticipantId}
            options={[
              { value: ALL_PARTICIPANTS, label: `Todos (${participantIds.length})` },
              ...participantIds.map(id => ({ value: id, label: id })),
            ]}
            className="w-48"
          />
        )}
      </div>

      <LeadingEmotionNote points={points} emotions={shownEmotions} markerMs={noteMarkerMs} />

      <div className="flex flex-wrap gap-1.5">
        <SeriesChip
          label={visibleSeries.length > 0 ? 'Ocultar todo' : 'Mostrar todo'}
          isActive
          onClick={() => setVisibleSeries(visibleSeries.length > 0 ? [] : ALL_CURVE_SERIES)}
        />
        {ALL_CURVE_SERIES.map(series => (
          <SeriesChip key={series} label={seriesLabels[series]} color={seriesColors[series]} isActive={visibleSeries.includes(series)} onClick={() => toggleSeries(series)} />
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        Zoom
        {ZOOM_OPTIONS.map(option => (
          <SeriesChip key={option.label} label={option.label} isActive={zoomWindowMs === option.windowMs} onClick={() => chooseZoom(option.windowMs)} />
        ))}
      </div>

      <EmotionCurveChart
        points={points}
        visibleSeries={visibleSeries}
        seriesLabels={seriesLabels}
        seriesColors={seriesColors}
        domainMs={domainMs}
        markerMs={markerMs}
        onMark={setMarkerMs}
      />

      {isZoomed && (
        <input
          type="range"
          min={0}
          max={totalMs - zoomWindowMs}
          step={CURVE_BUCKET_MS}
          value={startMs}
          onChange={event => setWindowStartMs(Number(event.target.value))}
          className="w-full accent-blue-600"
          aria-label="Desplazar ventana de tiempo"
        />
      )}

      {markerMs !== null && <GazeAtMarker tracks={shownTracks} zones={zones} markerMs={markerMs} />}

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-gray-400">Rosa: rostro detectado, alimenta la curva. Gris: sin rostro detectado.</p>
        <FacePresenceBars presence={presence} domainMs={domainMs} markerMs={markerMs} />
      </div>
    </div>
  );
}
