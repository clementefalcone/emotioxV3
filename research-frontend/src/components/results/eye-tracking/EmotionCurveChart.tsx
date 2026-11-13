import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EkmanEmotion } from '../../../services/analytics.service';
import { ALL_CURVE_SERIES, CURVE_AXIS_WIDTH_PX, fitEmotionAxisMax, formatClock, type EmotionCurvePoint, type EmotionSeries } from './emotionCurve';

const VALENCE_AROUSAL_SERIES: readonly EmotionSeries[] = ['valence', 'arousal'];

const formatPercentTick = (value: number): string => `${value}%`;

const toChartRow = (point: EmotionCurvePoint): Record<string, number | null> => ({
  timeMs: point.timeMs,
  ...Object.fromEntries(ALL_CURVE_SERIES.map(series => {
    const value = point.values?.[series];
    if (value === undefined) return [series, null];
    return [series, VALENCE_AROUSAL_SERIES.includes(series) ? value : value * 100];
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
  readonly seriesColors: Record<EmotionSeries, string>;
}

function CurveTooltip({ active, label, payload, seriesLabels, seriesColors }: CurveTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="mb-0.5 font-semibold text-slate-700">{formatClock(Number(label))}</p>
      {payload.filter(entry => typeof entry.value === 'number').map(entry => {
        const series = entry.dataKey as EmotionSeries;
        const value = entry.value as number;
        const text = VALENCE_AROUSAL_SERIES.includes(series) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : `${Math.round(value)}%`;
        return <p key={series} style={{ color: seriesColors[series] }}>{seriesLabels[series]}: {text}</p>;
      })}
    </div>
  );
}

interface EmotionCurveChartProps {
  readonly points: readonly EmotionCurvePoint[];
  readonly visibleSeries: readonly EmotionSeries[];
  readonly seriesLabels: Record<EmotionSeries, string>;
  readonly seriesColors: Record<EmotionSeries, string>;
  readonly domainMs: readonly [number, number];
  readonly markerMs: number | null;
  readonly onMark: (timeMs: number) => void;
}

const isEmotionSeries = (series: EmotionSeries): series is EkmanEmotion => !VALENCE_AROUSAL_SERIES.includes(series);

export function EmotionCurveChart({ points, visibleSeries, seriesLabels, seriesColors, domainMs, markerMs, onMark }: EmotionCurveChartProps) {
  const rows = points.filter(point => point.timeMs >= domainMs[0] && point.timeMs <= domainMs[1]).map(toChartRow);
  const visibleEmotions = visibleSeries.filter(isEmotionSeries);
  const emotionAxisMax = fitEmotionAxisMax(Math.max(0, ...rows.flatMap(row => visibleEmotions.map(emotion => row[emotion] ?? 0))));
  const emotionAxisTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(emotionAxisMax * fraction * 10) / 10);
  return (
    <div className="h-56 w-full [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
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
          <YAxis yAxisId="emotion" orientation="right" width={CURVE_AXIS_WIDTH_PX} domain={[0, emotionAxisMax]} ticks={emotionAxisTicks} tickFormatter={formatPercentTick} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <Tooltip content={<CurveTooltip seriesLabels={seriesLabels} seriesColors={seriesColors} />} isAnimationActive={false} />
          {markerMs !== null && <ReferenceLine yAxisId="emotion" x={markerMs} stroke="#006AFF" strokeWidth={1.5} />}
          {visibleSeries.map(series => (
            <Line
              key={series}
              yAxisId={isEmotionSeries(series) ? 'emotion' : 'valenceArousal'}
              dataKey={series}
              stroke={seriesColors[series]}
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
