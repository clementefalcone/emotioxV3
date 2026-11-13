/* eslint-disable react-refresh/only-export-components -- shared constants + small components co-located */
import { Crosshair, Users } from 'lucide-react';
import type { EyeTrackingAOI, EkmanEmotion } from '../../../services/analytics.service';
import { resolveMediaUrl } from '../../../services/media.service';
import { AoiThumbnail } from '../../research/AoiThumbnail';

export type ViewMode = 'heatmap' | 'density' | 'image' | 'emotions' | 'prediction' | 'video' | 'scanpath' | 'firstlook' | 'transparency' | 'sequence' | 'comparison' | 'replay';

/** Resolve stimulusUrl: may be a clean URL or a JSON array string from the backend. */
export const resolveStimulusUrl = (raw: string): string => {
  let url = raw;
  if (raw && raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        url = parsed[0].url || parsed[0].s3Key || '';
      }
    } catch { /* not JSON */ }
  }
  return resolveMediaUrl(url);
};

export interface EmotionColor {
  readonly bg: string;
  readonly text: string;
  readonly bar: string;
  readonly hex: string;
}

export const EMOTION_COLORS: Record<EkmanEmotion, EmotionColor> = {
  joy:      { bg: 'bg-green-50',  text: 'text-green-700',  bar: 'bg-green-400',  hex: '#22c55e' },
  surprise: { bg: 'bg-amber-50',  text: 'text-amber-700',  bar: 'bg-amber-400',  hex: '#f59e0b' },
  neutral:  { bg: 'bg-gray-50',   text: 'text-gray-600',   bar: 'bg-gray-400',   hex: '#9ca3af' },
  fear:     { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-400', hex: '#a855f7' },
  sadness:  { bg: 'bg-blue-50',   text: 'text-blue-700',   bar: 'bg-blue-400',   hex: '#3b82f6' },
  anger:    { bg: 'bg-red-50',    text: 'text-red-700',    bar: 'bg-red-400',    hex: '#ef4444' },
  disgust:  { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-400', hex: '#f97316' },
};

export const EMOTION_LABELS: Record<EkmanEmotion, string> = {
  joy: 'Joy', sadness: 'Sadness', surprise: 'Surprise',
  anger: 'Anger', disgust: 'Disgust', fear: 'Fear', neutral: 'Neutral',
};

export const MetricBadge = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) => (
  <div className="text-center">
    <div className="flex items-center justify-center gap-1.5 text-gray-400 mb-1">
      {icon}
      <span className="text-xs">{label}</span>
    </div>
    <p className="text-lg font-semibold text-gray-900">{value}</p>
  </div>
);

export const ViewModeTab = ({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) => (
  <button
    onClick={onClick}
    className={`
      px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors
      ${active
        ? 'bg-blue-100 text-blue-700 font-medium'
        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }
    `}
  >
    {label}
  </button>
);

export const AOI_METRIC_HELP = {
  dwell: '% del tiempo total de mirada que cayó en esta zona. Entre todas las zonas suman cerca de 100%.',
  fixations: 'Cuántas veces la mirada se detuvo en esta zona, sumando a todos los participantes.',
  duration: 'Cuánto dura en promedio cada fijación en esta zona.',
  viewers: 'Cuántos participantes miraron esta zona al menos una vez.',
  firstLook: 'Tiempo promedio desde el inicio hasta que cada participante mira esta zona por primera vez. Menos tiempo = capta la atención antes.',
  noticed: '% de participantes que miraron esta zona.',
  emotion: 'Emoción más frecuente mientras los participantes miraban esta zona.',
} as const;

type AOIRowData = Pick<EyeTrackingAOI, 'label' | 'dwellTimePercent' | 'fixationCount' | 'avgDuration' | 'participantCount' | 'avgTTFF' | 'noticeRate' | 'dominantEmotion'>
  & Partial<Pick<EyeTrackingAOI, 'x' | 'y' | 'width' | 'height'>>;

export const AOIRow = ({ aoi, index, stimulusUrl, subtitle }: { aoi: AOIRowData; index: number; stimulusUrl?: string; subtitle?: string }) => (
  <div className="flex items-center gap-4 p-3 bg-white border rounded-lg">
    {/* Thumbnail: cropped preview of the AOI region */}
    {stimulusUrl && aoi.x !== undefined && aoi.y !== undefined && aoi.width !== undefined && aoi.height !== undefined && (
      <div className="w-16 h-12 rounded overflow-hidden flex-shrink-0 border bg-gray-50">
        <AoiThumbnail
          imageUrl={stimulusUrl}
          aoi={{ x: aoi.x, y: aoi.y, width: aoi.width, height: aoi.height }}
          alt={`AOI ${index + 1}`}
        />
      </div>
    )}

    {/* Label + index */}
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-gray-900 truncate">
        {aoi.label || `Area of Interest (AOI)`}
      </p>
      <p className="text-xs text-gray-400">{subtitle ?? `#${index + 1}`}</p>
    </div>

    {/* Stats */}
    <div className="flex items-center gap-6 text-sm">
      <div className="text-center">
        <p className="font-semibold text-blue-600">{aoi.dwellTimePercent}%</p>
        <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.dwell}>Tiempo de mirada</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          <Crosshair className="h-3.5 w-3.5 inline-block mr-0.5 -mt-0.5" />
          {aoi.fixationCount}
        </p>
        <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.fixations}>Fijaciones</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          {aoi.avgDuration > 0 ? `${(aoi.avgDuration / 1000).toFixed(1)}s` : '—'}
        </p>
        <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.duration}>Duración media</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          <Users className="h-3.5 w-3.5 inline-block mr-0.5 -mt-0.5" />
          {aoi.participantCount}
        </p>
        <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.viewers}>Participantes</p>
      </div>
      {aoi.avgTTFF != null && aoi.avgTTFF > 0 && (
        <div className="text-center">
          <p className="font-semibold text-purple-600">
            {aoi.avgTTFF < 1000 ? `${aoi.avgTTFF}ms` : `${(aoi.avgTTFF / 1000).toFixed(1)}s`}
          </p>
          <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.firstLook}>Primera mirada</p>
        </div>
      )}
      {aoi.noticeRate != null && (
        <div className="text-center">
          <p className="font-semibold text-green-600">{aoi.noticeRate}%</p>
          <p className="text-xs text-gray-400 cursor-help" title={AOI_METRIC_HELP.noticed}>Notada</p>
        </div>
      )}
      {aoi.dominantEmotion && aoi.dominantEmotion !== 'neutral' && (
        <div className="text-center">
          <p className={`text-xs font-semibold px-2 py-0.5 rounded ${EMOTION_COLORS[aoi.dominantEmotion]?.bg || 'bg-gray-50'} ${EMOTION_COLORS[aoi.dominantEmotion]?.text || 'text-gray-600'}`}>
            {EMOTION_LABELS[aoi.dominantEmotion] || aoi.dominantEmotion}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 cursor-help" title={AOI_METRIC_HELP.emotion}>Emoción</p>
        </div>
      )}
    </div>
  </div>
);
