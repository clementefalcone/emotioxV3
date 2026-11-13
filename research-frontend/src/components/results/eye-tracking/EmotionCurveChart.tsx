import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { CURVE_AXIS_WIDTH_PX, formatClock, SERIES_COLORS, type EmotionCurvePoint, type EmotionSeries } from './emotionCurve';

const VALENCE_AROUSAL_SERIES: readonly EmotionSeries[] = ['valence', 'arousal'];

const formatPercentTick = (value: number): string => `${value}%`;

const toChartRow = (point: EmotionCurvePoint): Record<string, number | null> => ({
  timeMs: point.timeMs,
  ...Object.fromEntries(Object.keys(SERIES_COLORS).map(series => {
    const value = point.values?.[series as EmotionSeries];
    if (value === undefined) return [series, null];
    return [series, VALENCE_AROUSAL_SERIES.includes(series as EmotionSeries) ? value : value * 100];
  })),
});

interface TooltipEntry {
  readonly dataKey?: string | number;
  readonly value?: number | string | null;
}

interface CurveTooltipProps {
  readonly active?: boolean;
  readonly label?: number | string;
  readonly payload?: readonly TooltipEntry[];
  readonly seriesLabels: Record<EmotionSeries, string>;
}

function CurveTooltip({ active, label, payload, seriesLabels }: CurveTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="mb-0.5 font-semibold text-slate-700">{formatClock(Number(label))}</p>
      {payload.filter(entry => typeof entry.value === 'number').map(entry => {
        const series = entry.dataKey as EmotionSeries;
        const value = entry.value as number;
        const text = VALENCE_AROUSAL_SERIES.includes(series) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : `${Math.round(value)}%`;
        return <p key={series} style={{ color: SERIES_COLORS[series] }}>{seriesLabels[series]}: {text}</p>;
      })}
    </div>
  );
}

interface EmotionCurveChartProps {
  readonly points: readonly EmotionCurvePoint[];
  readonly visibleSeries: readonly EmotionSeries[];
  readonly seriesLabels: Record<EmotionSeries, string>;
  readonly domainMs: readonly [number, number];
  readonly markerMs: number | null;
  readonly onMark: (timeMs: number) => void;
}

const isEmotionSeries = (series: EmotionSeries): series is EkmanEmotion => !VALENCE_AROUSAL_SERIES.includes(series);

export function EmotionCurveChart({ points, visibleSeries, seriesLabels, domainMs, markerMs, onMark }: EmotionCurveChartProps) {
  const rows = points.filter(point => point.timeMs >= domainMs[0] && point.timeMs <= domainMs[1]).map(toChartRow);
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          onClick={state => { if (state.activeLabel !== undefined) onMark(Number(state.activeLabel)); }}
          className="cursor-crosshair"
        >
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="timeMs" type="number" domain={[domainMs[0], domainMs[1]]} allowDataOverflow tickFormatter={formatClock} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <YAxis yAxisId="valenceArousal" width={CURVE_AXIS_WIDTH_PX} domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <YAxis yAxisId="emotion" orientation="right" width={CURVE_AXIS_WIDTH_PX} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={formatPercentTick} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <Tooltip content={<CurveTooltip seriesLabels={seriesLabels} />} isAnimationActive={false} />
          {markerMs !== null && <ReferenceLine yAxisId="emotion" x={markerMs} stroke="#006AFF" strokeWidth={1.5} />}
          {visibleSeries.map(series => (
            <Line
              key={series}
              yAxisId={isEmotionSeries(series) ? 'emotion' : 'valenceArousal'}
              dataKey={series}
              stroke={SERIES_COLORS[series]}
              strokeWidth={isEmotionSeries(series) ? 1.5 : 2}
              strokeDasharray={series === 'arousal' ? '4 3' : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
