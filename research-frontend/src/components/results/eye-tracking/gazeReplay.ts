export interface ReplayFixation {
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
  readonly duration: number;
}

export interface ReplayZone {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ZoneDwell {
  readonly dwellMs: number;
  readonly firstEntryMs: number | null;
}

const GRID_ROW_LABELS = ['Arriba', 'Centro', 'Abajo'];
const GRID_COLUMN_LABELS = ['izquierda', 'centro', 'derecha'];

export const buildGridZones = (): ReplayZone[] =>
  GRID_ROW_LABELS.flatMap((rowLabel, row) =>
    GRID_COLUMN_LABELS.map((columnLabel, column) => ({
      id: `r${row}c${column}`,
      label: `${rowLabel} ${columnLabel}`,
      x: (column * 100) / 3,
      y: (row * 100) / 3,
      width: 100 / 3,
      height: 100 / 3,
    })),
  );

export const findZoneAt = (zones: readonly ReplayZone[], x: number, y: number): ReplayZone | null => {
  const containing = zones.filter(zone =>
    x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height,
  );
  if (containing.length === 0) return null;
  return containing.reduce((smallest, zone) =>
    zone.width * zone.height < smallest.width * smallest.height ? zone : smallest,
  );
};

export const sortFixationsByTime = <T extends ReplayFixation>(fixations: readonly T[]): T[] =>
  [...fixations].sort((a, b) => a.timestamp - b.timestamp);

export const getReplayDurationMs = (fixations: readonly ReplayFixation[]): number =>
  fixations.reduce((end, fixation) => Math.max(end, fixation.timestamp + fixation.duration), 0);

export const findActiveFixationIndex = (sortedFixations: readonly ReplayFixation[], timeMs: number): number =>
  sortedFixations.findIndex(fixation => timeMs >= fixation.timestamp && timeMs < fixation.timestamp + fixation.duration);

export const countStartedFixations = (sortedFixations: readonly ReplayFixation[], timeMs: number): number =>
  sortedFixations.filter(fixation => fixation.timestamp <= timeMs).length;

export const accumulateZoneDwell = (
  sortedFixations: readonly ReplayFixation[],
  zones: readonly ReplayZone[],
  timeMs: number,
): Map<string, ZoneDwell> => {
  const dwellByZone = new Map<string, ZoneDwell>(zones.map(zone => [zone.id, { dwellMs: 0, firstEntryMs: null }]));
  for (const fixation of sortedFixations) {
    if (fixation.timestamp > timeMs) break;
    const zone = findZoneAt(zones, fixation.x, fixation.y);
    if (!zone) continue;
    const previous = dwellByZone.get(zone.id) ?? { dwellMs: 0, firstEntryMs: null };
    const elapsedMs = Math.min(fixation.duration, timeMs - fixation.timestamp);
    dwellByZone.set(zone.id, {
      dwellMs: previous.dwellMs + elapsedMs,
      firstEntryMs: previous.firstEntryMs ?? fixation.timestamp,
    });
  }
  return dwellByZone;
};
