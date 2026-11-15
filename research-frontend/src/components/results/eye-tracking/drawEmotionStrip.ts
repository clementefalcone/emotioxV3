import type { EkmanEmotion } from '../../../services/analytics.service';
import type { EmotionCurvePoint } from './emotionCurve';

export interface EmotionStripSeries {
  readonly emotion: EkmanEmotion;
  readonly label: string;
  readonly color: string;
}

export interface EmotionStripFrame {
  readonly points: readonly EmotionCurvePoint[];
  readonly series: readonly EmotionStripSeries[];
  readonly durationMs: number;
  readonly timeMs: number;
  readonly top: number;
  readonly height: number;
}

const STRIP_PADDING_RATIO = 0.06;
const FUTURE_ALPHA = 0.18;

export const resolveStripMaxShare = (points: readonly EmotionCurvePoint[], series: readonly EmotionStripSeries[]): number => {
  const peak = Math.max(0, ...points.flatMap(point => (point.values ? series.map(item => point.values?.[item.emotion] ?? 0) : [])));
  return peak > 0 ? Math.min(1, Math.ceil(peak * 20) / 20) : 1;
};

export const readSharesAt = (points: readonly EmotionCurvePoint[], timeMs: number): EmotionCurvePoint['values'] => {
  const reached = points.filter(point => point.timeMs <= timeMs && point.values);
  return reached.length > 0 ? reached[reached.length - 1].values : null;
};

export const drawEmotionStrip = (ctx: CanvasRenderingContext2D, frame: EmotionStripFrame): void => {
  const { width } = ctx.canvas;
  const padding = Math.round(frame.height * STRIP_PADDING_RATIO);
  const fontSize = Math.max(11, Math.round(frame.height * 0.07));
  const legendHeight = fontSize + padding;
  const plotTop = frame.top + padding + legendHeight;
  const plotHeight = frame.height - legendHeight - padding * 2;
  const plotLeft = padding;
  const plotWidth = width - padding * 2;
  const maxShare = resolveStripMaxShare(frame.points, frame.series);
  const toX = (timeMs: number) => plotLeft + (frame.durationMs > 0 ? Math.min(1, timeMs / frame.durationMs) : 0) * plotWidth;
  const toY = (share: number) => plotTop + plotHeight - (Math.min(share, maxShare) / maxShare) * plotHeight;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, frame.top, width, frame.height);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop + plotHeight + 0.5);
  ctx.lineTo(plotLeft + plotWidth, plotTop + plotHeight + 0.5);
  ctx.stroke();

  const currentShares = readSharesAt(frame.points, frame.timeMs);
  ctx.font = `500 ${Math.round(fontSize * 0.8)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(`escala 0–${Math.round(maxShare * 100)}%`, plotLeft + plotWidth, frame.top + padding);
  ctx.textAlign = 'left';
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  let legendX = plotLeft;
  for (const item of frame.series) {
    const text = `${item.label} ${Math.round((currentShares?.[item.emotion] ?? 0) * 100)}%`;
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, frame.top + padding + fontSize * 0.25, fontSize * 0.6, fontSize * 0.6);
    ctx.fillStyle = '#334155';
    ctx.fillText(text, legendX + fontSize * 0.85, frame.top + padding);
    legendX += ctx.measureText(text).width + fontSize * 2;
  }

  ctx.lineWidth = Math.max(1.5, frame.height * 0.012);
  for (const item of frame.series) {
    for (const isPast of [false, true]) {
      ctx.globalAlpha = isPast ? 1 : FUTURE_ALPHA;
      ctx.strokeStyle = item.color;
      ctx.beginPath();
      let isDrawing = false;
      for (const point of frame.points) {
        if (isPast && point.timeMs > frame.timeMs) break;
        if (!point.values) {
          isDrawing = false;
          continue;
        }
        const x = toX(point.timeMs);
        const y = toY(point.values[item.emotion]);
        if (isDrawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        isDrawing = true;
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const playheadX = toX(frame.timeMs);
  ctx.strokeStyle = '#006AFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, plotTop);
  ctx.lineTo(playheadX, plotTop + plotHeight);
  ctx.stroke();
};
