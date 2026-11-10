import {
  countStartedFixations,
  findActiveFixationIndex,
  findZoneAt,
  type ReplayFixation,
  type ReplayZone,
} from './gazeReplay';

export interface GazeReplayFrame {
  readonly image: CanvasImageSource;
  readonly fixations: readonly ReplayFixation[];
  readonly zones: readonly ReplayZone[];
  readonly timeMs: number;
}

const ACCENT = '#006AFF';
const ACTIVE_FIXATION = '#EF4444';
const FIXATION_GROWTH_MS = 300;

const describeGazeState = (fixation: ReplayFixation | null, zone: ReplayZone | null): string => {
  if (!fixation) return 'Sin fijación';
  return zone?.label ?? 'Fuera de zonas';
};

export const drawGazeReplayFrame = (ctx: CanvasRenderingContext2D, frame: GazeReplayFrame): void => {
  const { width, height } = ctx.canvas;
  const unit = Math.min(width, height) / 100;
  const toPx = (fixation: ReplayFixation) => ({ px: (fixation.x / 100) * width, py: (fixation.y / 100) * height });

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(frame.image, 0, 0, width, height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.fillRect(0, 0, width, height);

  const activeIndex = findActiveFixationIndex(frame.fixations, frame.timeMs);
  const activeFixation = activeIndex >= 0 ? frame.fixations[activeIndex] : null;
  const activeZone = activeFixation ? findZoneAt(frame.zones, activeFixation.x, activeFixation.y) : null;

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

  const hudText = `${(frame.timeMs / 1000).toFixed(1)} s · ${describeGazeState(activeFixation, activeZone)}`;
  const hudFontSize = Math.max(13, unit * 3);
  ctx.font = `600 ${hudFontSize}px Inter, system-ui, sans-serif`;
  const hudPadding = hudFontSize * 0.5;
  const hudWidth = ctx.measureText(hudText).width + hudPadding * 2;
  const hudY = height - hudFontSize - hudPadding * 3;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.fillRect(hudPadding, hudY, hudWidth, hudFontSize + hudPadding * 2);
  ctx.fillStyle = activeFixation ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(hudText, hudPadding * 2, hudY + hudPadding);
};
