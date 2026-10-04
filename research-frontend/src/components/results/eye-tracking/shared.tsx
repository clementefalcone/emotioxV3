/* eslint-disable react-refresh/only-export-components -- shared constants + small components co-located */
import { Crosshair, Users } from 'lucide-react';
import type { EyeTrackingAOI, EkmanEmotion } from '../../../services/analytics.service';
import { resolveMediaUrl } from '../../../services/media.service';

export type ViewMode = 'heatmap' | 'density' | 'image' | 'emotions' | 'prediction' | 'video' | 'scanpath' | 'firstlook' | 'transparency' | 'sequence' | 'comparison';

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

export const EMOTION_COLORS: Record<EkmanEmotion, { bg: string; text: string; bar: string }> = {
  joy:      { bg: 'bg-green-50',  text: 'text-green-700',  bar: 'bg-green-400' },
  surprise: { bg: 'bg-amber-50',  text: 'text-amber-700',  bar: 'bg-amber-400' },
  neutral:  { bg: 'bg-gray-50',   text: 'text-gray-600',   bar: 'bg-gray-400' },
  fear:     { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-400' },
  sadness:  { bg: 'bg-blue-50',   text: 'text-blue-700',   bar: 'bg-blue-400' },
  anger:    { bg: 'bg-red-50',    text: 'text-red-700',    bar: 'bg-red-400' },
  disgust:  { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-400' },
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

export const AOIRow = ({ aoi, index, stimulusUrl }: { aoi: EyeTrackingAOI; index: number; stimulusUrl: string }) => (
  <div className="flex items-center gap-4 p-3 bg-white border rounded-lg">
    {/* Thumbnail: cropped preview of the AOI region */}
    {stimulusUrl && (
      <div className="w-16 h-12 rounded overflow-hidden flex-shrink-0 border bg-gray-50">
        <img
          src={stimulusUrl}
          alt={`AOI ${index + 1}`}
          className="w-full h-full"
          style={{
            objectFit: 'cover',
            objectPosition: `${aoi.x + aoi.width / 2}% ${aoi.y + aoi.height / 2}%`,
          }}
        />
      </div>
    )}

    {/* Label + index */}
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-gray-900 truncate">
        {aoi.label || `Area of Interest (AOI)`}
      </p>
      <p className="text-xs text-gray-400">#{index + 1}</p>
    </div>

    {/* Stats */}
    <div className="flex items-center gap-6 text-sm">
      <div className="text-center">
        <p className="font-semibold text-blue-600">{aoi.dwellTimePercent}%</p>
        <p className="text-xs text-gray-400">Dwell</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          <Crosshair className="h-3.5 w-3.5 inline-block mr-0.5 -mt-0.5" />
          {aoi.fixationCount}
        </p>
        <p className="text-xs text-gray-400">Fixations</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          {aoi.avgDuration > 0 ? `${(aoi.avgDuration / 1000).toFixed(1)}s` : '—'}
        </p>
        <p className="text-xs text-gray-400">Duration</p>
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700">
          <Users className="h-3.5 w-3.5 inline-block mr-0.5 -mt-0.5" />
          {aoi.participantCount}
        </p>
        <p className="text-xs text-gray-400">Viewers</p>
      </div>
      {aoi.avgTTFF != null && aoi.avgTTFF > 0 && (
        <div className="text-center">
          <p className="font-semibold text-purple-600">
            {aoi.avgTTFF < 1000 ? `${aoi.avgTTFF}ms` : `${(aoi.avgTTFF / 1000).toFixed(1)}s`}
          </p>
          <p className="text-xs text-gray-400">TTFF</p>
        </div>
      )}
      {aoi.noticeRate != null && (
        <div className="text-center">
          <p className="font-semibold text-green-600">{aoi.noticeRate}%</p>
          <p className="text-xs text-gray-400">Noticed</p>
        </div>
      )}
      {aoi.dominantEmotion && aoi.dominantEmotion !== 'neutral' && (
        <div className="text-center">
          <p className={`text-xs font-semibold px-2 py-0.5 rounded ${EMOTION_COLORS[aoi.dominantEmotion]?.bg || 'bg-gray-50'} ${EMOTION_COLORS[aoi.dominantEmotion]?.text || 'text-gray-600'}`}>
            {EMOTION_LABELS[aoi.dominantEmotion] || aoi.dominantEmotion}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Emotion</p>
        </div>
      )}
    </div>
  </div>
);
