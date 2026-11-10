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

export interface ReplayGazeSample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

export interface GazeFocus {
  readonly fixationIndex: number;
  readonly gazeSample: ReplayGazeSample | null;
  readonly zone: ReplayZone | null;
  readonly stateLabel: string;
}

const GAZE_SAMPLE_STALE_MS = 150;

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

export const findGazeSampleAt = (sortedSamples: readonly ReplayGazeSample[], timeMs: number): ReplayGazeSample | null => {
  let latest: ReplayGazeSample | null = null;
  for (const sample of sortedSamples) {
    if (sample.t > timeMs) break;
    latest = sample;
  }
  return latest && timeMs - latest.t <= GAZE_SAMPLE_STALE_MS ? latest : null;
};

export const selectRecentGazeSamples = (
  sortedSamples: readonly ReplayGazeSample[],
  timeMs: number,
  windowMs: number,
): ReplayGazeSample[] => sortedSamples.filter(sample => sample.t <= timeMs && sample.t > timeMs - windowMs);

export const resolveGazeFocus = (
  sortedFixations: readonly ReplayFixation[],
  sortedSamples: readonly ReplayGazeSample[],
  zones: readonly ReplayZone[],
  timeMs: number,
): GazeFocus => {
  const fixationIndex = findActiveFixationIndex(sortedFixations, timeMs);
  const gazeSample = findGazeSampleAt(sortedSamples, timeMs);
  const focusPoint = findTrackPoint({ fixations: sortedFixations, samples: sortedSamples }, timeMs);
  const zone = focusPoint ? findZoneAt(zones, focusPoint.x, focusPoint.y) : null;
  const idleLabel = sortedSamples.length > 0 ? 'Sin mirada registrada' : 'Sin fijación';
  return { fixationIndex, gazeSample, zone, stateLabel: focusPoint ? zone?.label ?? 'Fuera de zonas' : idleLabel };
};

export interface ParticipantTrack {
  readonly participantId: string;
  readonly fixations: readonly ReplayFixation[];
  readonly samples: readonly ReplayGazeSample[];
}

export interface GroupZoneDwell {
  readonly averageDwellMs: number;
  readonly viewerCount: number;
  readonly firstEntryMs: number | null;
}

const groupByParticipant = <T extends { participantId: string }>(items: readonly T[]): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.participantId, [...(groups.get(item.participantId) ?? []), item]);
  return groups;
};

export const buildParticipantTracks = (
  fixations: readonly (ReplayFixation & { participantId: string })[],
  samples: readonly (ReplayGazeSample & { participantId: string })[],
): ParticipantTrack[] => {
  const fixationsByParticipant = groupByParticipant(fixations);
  const samplesByParticipant = groupByParticipant(samples);
  const participantIds = new Set([...fixationsByParticipant.keys(), ...samplesByParticipant.keys()]);
  return [...participantIds]
    .map(participantId => ({
      participantId,
      fixations: sortFixationsByTime(fixationsByParticipant.get(participantId) ?? []),
      samples: [...(samplesByParticipant.get(participantId) ?? [])].sort((a, b) => a.t - b.t),
    }))
    .sort((a, b) => b.fixations.length - a.fixations.length);
};

export const getTrackDurationMs = (track: Pick<ParticipantTrack, 'fixations' | 'samples'>): number =>
  Math.max(getReplayDurationMs(track.fixations), track.samples.at(-1)?.t ?? 0);

export const findTrackPoint = (
  track: Pick<ParticipantTrack, 'fixations' | 'samples'>,
  timeMs: number,
): { x: number; y: number } | null => {
  if (track.samples.length > 0) return findGazeSampleAt(track.samples, timeMs);
  return track.fixations[findActiveFixationIndex(track.fixations, timeMs)] ?? null;
};

export const countZoneOccupancy = (
  tracks: readonly ParticipantTrack[],
  zones: readonly ReplayZone[],
  timeMs: number,
): Map<string, number> => {
  const occupancy = new Map<string, number>(zones.map(zone => [zone.id, 0]));
  for (const track of tracks) {
    const point = findTrackPoint(track, timeMs);
    const zone = point ? findZoneAt(zones, point.x, point.y) : null;
    if (zone) occupancy.set(zone.id, (occupancy.get(zone.id) ?? 0) + 1);
  }
  return occupancy;
};

export const accumulateGroupZoneDwell = (
  tracks: readonly ParticipantTrack[],
  zones: readonly ReplayZone[],
  timeMs: number,
): Map<string, GroupZoneDwell> => {
  const dwellByTrack = tracks.map(track => accumulateZoneDwell(track.fixations, zones, timeMs));
  return new Map(zones.map(zone => {
    const dwells = dwellByTrack.map(byZone => byZone.get(zone.id)).filter(dwell => dwell?.firstEntryMs != null) as ZoneDwell[];
    const totalDwellMs = dwells.reduce((sum, dwell) => sum + dwell.dwellMs, 0);
    return [zone.id, {
      averageDwellMs: tracks.length > 0 ? totalDwellMs / tracks.length : 0,
      viewerCount: dwells.length,
      firstEntryMs: dwells.length > 0 ? Math.min(...dwells.map(dwell => dwell.firstEntryMs as number)) : null,
    }];
  }));
};

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
