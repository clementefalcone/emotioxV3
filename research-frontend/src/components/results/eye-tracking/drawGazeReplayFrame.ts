import {
  countStartedFixations,
  resolveGazeFocus,
  selectRecentGazeSamples,
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
}

const ACCENT = '#006AFF';
const ACTIVE_FIXATION = '#EF4444';
const FIXATION_GROWTH_MS = 300;
const GAZE_TRAIL_MS = 500;

export const drawGazeReplayFrame = (ctx: CanvasRenderingContext2D, frame: GazeReplayFrame): void => {
  const { width, height } = ctx.canvas;
  const unit = Math.min(width, height) / 100;
  const toPx = (point: { x: number; y: number }) => ({ px: (point.x / 100) * width, py: (point.y / 100) * height });

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(frame.image, 0, 0, width, height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.fillRect(0, 0, width, height);

  const focus = resolveGazeFocus(frame.fixations, frame.gazeSamples, frame.zones, frame.timeMs);
  const activeIndex = focus.fixationIndex;
  const activeFixation = activeIndex >= 0 ? frame.fixations[activeIndex] : null;
  const activeZone = focus.zone;

  ctx.font = `600 ${Math.max(11, unit * 2.2)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const zone of frame.zones) {
    const zx = (zone.x / 100) * width;
    const zy = (zone.y / 100) * height;
    const zw = (zone.width / 100) * width;
    const zh = (zone.height / 100) * height;
    const isActive = zone.id === activeZone?.id;
    if (isActive) {
      ctx.fillStyle = 'rgba(0, 106, 255, 0.22)';
      ctx.fillRect(zx, zy, zw, zh);
    }
    ctx.setLineDash(isActive ? [] : [unit * 1.2, unit * 0.8]);
    ctx.strokeStyle = isActive ? ACCENT : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = isActive ? Math.max(2, unit * 0.5) : Math.max(1, unit * 0.2);
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.fillStyle = isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(zone.label, zx + unit, zy + unit);
  }
  ctx.setLineDash([]);

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
  const hudText = `${(frame.timeMs / 1000).toFixed(1)} s · ${focus.stateLabel}${fixationTag}`;
  const hudFontSize = Math.max(13, unit * 3);
  ctx.font = `600 ${hudFontSize}px Inter, system-ui, sans-serif`;
  const hudPadding = hudFontSize * 0.5;
  const hudWidth = ctx.measureText(hudText).width + hudPadding * 2;
  const hudY = height - hudFontSize - hudPadding * 3;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.fillRect(hudPadding, hudY, hudWidth, hudFontSize + hudPadding * 2);
  ctx.fillStyle = activeZone ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(hudText, hudPadding * 2, hudY + hudPadding);
};
