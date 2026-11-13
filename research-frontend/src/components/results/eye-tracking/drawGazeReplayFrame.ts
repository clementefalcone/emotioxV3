import { paintHeatmap } from '../cognitive-task/components/paintHeatmap';
import type { HeatmapSettings } from './HeatmapSettingsModal';
import {
  countStartedFixations,
  countZoneOccupancy,
  findTrackPoint,
  resolveGazeFocus,
  selectRecentGazeSamples,
  type HeatPoint,
  type ParticipantTrack,
  type ReplayFixation,
  type ReplayGazeSample,
  type ReplayZone,
} from './gazeReplay';

export interface GazeReplayFrame {
  readonly image: CanvasImageSource;
  readonly fixations: readonly ReplayFixation[];
  readonly gazeSamples: readonly ReplayGazeSample[];
  readonly zones: readonly ReplayZone[];
  readonly timeMs: number;
  readonly participantLabel: string;
}

export interface GroupReplayFrame {
  readonly image: CanvasImageSource;
  readonly tracks: readonly ParticipantTrack[];
  readonly zones: readonly ReplayZone[];
  readonly timeMs: number;
}

export interface HeatmapReplayFrame {
  readonly image: CanvasImageSource;
  readonly points: readonly HeatPoint[];
  readonly intensityPointCount: number;
  readonly settings: Pick<HeatmapSettings, 'opacity' | 'blur' | 'threshold' | 'darkOverlay'>;
  readonly zones: readonly ReplayZone[];
  readonly hudText: string;
}

interface ZoneStyle {
  readonly fillAlpha: number;
  readonly isActive: boolean;
  readonly suffix: string;
}

interface CanvasFrame {
  readonly width: number;
  readonly height: number;
  readonly unit: number;
  readonly toPx: (point: { x: number; y: number }) => { px: number; py: number };
}

const ACCENT = '#006AFF';
const ACTIVE_FIXATION = '#EF4444';
const FIXATION_GROWTH_MS = 300;
const GAZE_TRAIL_MS = 500;

export const getParticipantColor = (index: number): string => `hsl(${(index * 137.5) % 360}, 85%, 55%)`;

const drawStimulus = (ctx: CanvasRenderingContext2D, image: CanvasImageSource): CanvasFrame => {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    unit: Math.min(width, height) / 100,
    toPx: point => ({ px: (point.x / 100) * width, py: (point.y / 100) * height }),
  };
};

const drawBackground = (ctx: CanvasRenderingContext2D, image: CanvasImageSource): CanvasFrame => {
  const canvas = drawStimulus(ctx, image);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
};

const drawZones = (
  ctx: CanvasRenderingContext2D,
  canvas: CanvasFrame,
  zones: readonly ReplayZone[],
  styleZone: (zone: ReplayZone) => ZoneStyle,
): void => {
  const { width, height, unit } = canvas;
  ctx.font = `600 ${Math.max(11, unit * 2.2)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const zone of zones) {
    const zx = (zone.x / 100) * width;
    const zy = (zone.y / 100) * height;
    const zw = (zone.width / 100) * width;
    const zh = (zone.height / 100) * height;
    const style = styleZone(zone);
    if (style.fillAlpha > 0) {
      ctx.fillStyle = `rgba(0, 106, 255, ${style.fillAlpha})`;
      ctx.fillRect(zx, zy, zw, zh);
    }
    ctx.setLineDash(style.isActive ? [] : [unit * 1.2, unit * 0.8]);
    ctx.strokeStyle = style.isActive ? ACCENT : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = style.isActive ? Math.max(2, unit * 0.5) : Math.max(1, unit * 0.2);
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.fillStyle = style.isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(`${zone.label}${style.suffix}`, zx + unit, zy + unit);
  }
  ctx.setLineDash([]);
};

const drawHud = (ctx: CanvasRenderingContext2D, canvas: CanvasFrame, text: string, isHighlighted: boolean): void => {
  const fontSize = Math.max(13, canvas.unit * 3);
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const padding = fontSize * 0.5;
  const hudY = canvas.height - fontSize - padding * 3;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.fillRect(padding, hudY, ctx.measureText(text).width + padding * 2, fontSize + padding * 2);
  ctx.fillStyle = isHighlighted ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(text, padding * 2, hudY + padding);
};

const formatSeconds = (timeMs: number): string => `${(timeMs / 1000).toFixed(1)} s`;

const heatLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

const resolveHeatLayer = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
  const layer = heatLayers.get(canvas) ?? document.createElement('canvas');
  heatLayers.set(canvas, layer);
  return layer;
};

export const drawHeatmapReplayFrame = (ctx: CanvasRenderingContext2D, frame: HeatmapReplayFrame): void => {
  const canvas = drawStimulus(ctx, frame.image);
  paintHeatmap(ctx, resolveHeatLayer(ctx.canvas), {
    data: frame.points,
    opacity: frame.settings.opacity,
    blur: frame.settings.blur,
    threshold: frame.settings.threshold,
    darkOverlay: frame.settings.darkOverlay,
    granularity: 'precise',
    visualProfile: 'precise',
    coordSystem: 'percent',
    intensityPointCount: frame.intensityPointCount,
  });
  drawZones(ctx, canvas, frame.zones, () => ({ fillAlpha: 0, isActive: false, suffix: '' }));
  drawHud(ctx, canvas, frame.hudText, frame.points.length > 0);
};

export const drawGazeReplayFrame = (ctx: CanvasRenderingContext2D, frame: GazeReplayFrame): void => {
  const canvas = drawBackground(ctx, frame.image);
  const { unit, toPx } = canvas;
  const focus = resolveGazeFocus(frame.fixations, frame.gazeSamples, frame.zones, frame.timeMs);
  const activeIndex = focus.fixationIndex;
  const activeFixation = activeIndex >= 0 ? frame.fixations[activeIndex] : null;

  drawZones(ctx, canvas, frame.zones, zone => {
    const isActive = zone.id === focus.zone?.id;
    return { fillAlpha: isActive ? 0.22 : 0, isActive, suffix: '' };
  });

  const startedCount = countStartedFixations(frame.fixations, frame.timeMs);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = Math.max(1.5, unit * 0.3);
  for (let i = 1; i < startedCount; i++) {
    const from = toPx(frame.fixations[i - 1]);
    const to = toPx(frame.fixations[i]);
    ctx.beginPath();
    ctx.moveTo(from.px, from.py);
    ctx.lineTo(to.px, to.py);
    ctx.stroke();
  }

  const baseRadius = Math.max(4, unit * 1.2);
  for (let i = 0; i < startedCount; i++) {
    if (i === activeIndex) continue;
    const { px, py } = toPx(frame.fixations[i]);
    ctx.beginPath();
    ctx.arc(px, py, baseRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
  }

  if (activeFixation) {
    const { px, py } = toPx(activeFixation);
    const growth = Math.min(2.5, 1 + (frame.timeMs - activeFixation.timestamp) / FIXATION_GROWTH_MS);
    ctx.beginPath();
    ctx.arc(px, py, baseRadius * growth, 0, Math.PI * 2);
    ctx.fillStyle = ACTIVE_FIXATION;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, unit * 0.4);
    ctx.stroke();
  }

  const trail = selectRecentGazeSamples(frame.gazeSamples, frame.timeMs, GAZE_TRAIL_MS);
  trail.forEach((sample, index) => {
    const { px, py } = toPx(sample);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, unit * 0.6), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 106, 255, ${0.15 + (0.5 * (index + 1)) / trail.length})`;
    ctx.fill();
  });
  if (focus.gazeSample) {
    const { px, py } = toPx(focus.gazeSample);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(5, unit * 1.4), 0, Math.PI * 2);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(2, unit * 0.5);
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1, unit * 0.2);
    ctx.stroke();
  }

  const fixationTag = activeFixation && frame.gazeSamples.length > 0 ? ' · fijando' : '';
  drawHud(ctx, canvas, `${frame.participantLabel} · ${formatSeconds(frame.timeMs)} · ${focus.stateLabel}${fixationTag}`, focus.zone !== null);
};

export const drawGroupReplayFrame = (ctx: CanvasRenderingContext2D, frame: GroupReplayFrame): void => {
  const canvas = drawBackground(ctx, frame.image);
  const { unit, toPx } = canvas;
  const occupancy = countZoneOccupancy(frame.tracks, frame.zones, frame.timeMs);
  const participantCount = Math.max(1, frame.tracks.length);

  drawZones(ctx, canvas, frame.zones, zone => {
    const viewers = occupancy.get(zone.id) ?? 0;
    return { fillAlpha: (viewers / participantCount) * 0.55, isActive: viewers > 0, suffix: viewers > 0 ? ` · ${viewers}` : '' };
  });

  const radius = Math.max(5, unit * 1.3);
  let lookingCount = 0;
  frame.tracks.forEach((track, index) => {
    const point = findTrackPoint(track, frame.timeMs);
    if (!point) return;
    lookingCount++;
    const { px, py } = toPx(point);
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = getParticipantColor(index);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.5, unit * 0.3);
    ctx.stroke();
  });

  drawHud(ctx, canvas, `${formatSeconds(frame.timeMs)} · ${lookingCount} de ${frame.tracks.length} participantes con mirada`, lookingCount > 0);
};
