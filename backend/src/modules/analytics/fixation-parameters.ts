export interface FixationParameters {
  windowStartMs: number;
  windowEndMs: number | null;
  minDurationMs: number;
  maxDurationMs: number | null;
  maxDispersionPercent: number | null;
  mergeRangePercent: number;
}

export interface RecordedFixation {
  x: number;
  y: number;
  duration: number;
  timestamp?: number;
}

interface GazePoint {
  x: number;
  y: number;
  t: number;
}

const MAX_SAMPLE_GAP_MS = 300;

const PARAMETER_LIMITS = {
  windowStartS: [0, 3600],
  windowEndS: [0, 3600],
  minDurationMs: [0, 5000],
  maxDurationMs: [0, 60000],
  maxDispersionPercent: [0.1, 100],
  mergeRangePercent: [0, 100],
} as const;

type ParameterName = keyof typeof PARAMETER_LIMITS;

export class InvalidFixationParameterError extends Error {
  constructor(readonly parameter: ParameterName, readonly received: string) {
    super(`Invalid fixation parameter "${parameter}": "${received}" must be a number between ${PARAMETER_LIMITS[parameter][0]} and ${PARAMETER_LIMITS[parameter][1]}`);
  }
}

const readNumber = (query: Record<string, string | undefined>, name: ParameterName): number | null => {
  const raw = query[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  const [min, max] = PARAMETER_LIMITS[name];
  if (!Number.isFinite(value) || value < min || value > max) throw new InvalidFixationParameterError(name, raw);
  return value;
};

export const readFixationParameters = (query: Record<string, string | undefined>): FixationParameters | undefined => {
  if (!(Object.keys(PARAMETER_LIMITS) as ParameterName[]).some(name => query[name] !== undefined && query[name] !== '')) return undefined;
  const windowEndS = readNumber(query, 'windowEndS');
  return {
    windowStartMs: (readNumber(query, 'windowStartS') ?? 0) * 1000,
    windowEndMs: windowEndS === null ? null : windowEndS * 1000,
    minDurationMs: readNumber(query, 'minDurationMs') ?? 0,
    maxDurationMs: readNumber(query, 'maxDurationMs'),
    maxDispersionPercent: readNumber(query, 'maxDispersionPercent'),
    mergeRangePercent: readNumber(query, 'mergeRangePercent') ?? 0,
  };
};

export const detectFixationsIdt = (samples: readonly GazePoint[], maxDispersion: number, minDurationMs: number): RecordedFixation[] => {
  const fixations: RecordedFixation[] = [];
  let start = 0;
  while (start < samples.length - 1) {
    let end = start;
    let minX = samples[start].x, maxX = minX, minY = samples[start].y, maxY = minY;
    while (end + 1 < samples.length && samples[end + 1].t - samples[end].t <= MAX_SAMPLE_GAP_MS) {
      const next = samples[end + 1];
      const spread = (Math.max(maxX, next.x) - Math.min(minX, next.x)) + (Math.max(maxY, next.y) - Math.min(minY, next.y));
      if (spread > maxDispersion) break;
      minX = Math.min(minX, next.x); maxX = Math.max(maxX, next.x);
      minY = Math.min(minY, next.y); maxY = Math.max(maxY, next.y);
      end++;
    }
    const duration = samples[end].t - samples[start].t;
    if (end === start || duration < minDurationMs) {
      start++;
      continue;
    }
    const group = samples.slice(start, end + 1);
    fixations.push({
      x: group.reduce((sum, point) => sum + point.x, 0) / group.length,
      y: group.reduce((sum, point) => sum + point.y, 0) / group.length,
      duration: Math.round(duration),
      timestamp: Math.round(samples[start].t),
    });
    start = end + 1;
  }
  return fixations;
};

export const mergeNearbyFixations = (fixations: readonly RecordedFixation[], rangePercent: number): RecordedFixation[] =>
  fixations.reduce<RecordedFixation[]>((merged, fixation) => {
    const previous = merged[merged.length - 1];
    if (!previous || Math.hypot(fixation.x - previous.x, fixation.y - previous.y) > rangePercent) return [...merged, fixation];
    const duration = previous.duration + fixation.duration;
    merged[merged.length - 1] = {
      x: (previous.x * previous.duration + fixation.x * fixation.duration) / duration,
      y: (previous.y * previous.duration + fixation.y * fixation.duration) / duration,
      duration,
      timestamp: previous.timestamp,
    };
    return merged;
  }, []);

const readGazeTimeline = (response: Record<string, unknown>): GazePoint[] | null => {
  if (response.gazeTimelineUnit !== 'stimulus-percent' || response.fixationUnit !== 'stimulus-percent' || !Array.isArray(response.gazeTimeline)) return null;
  const points = (response.gazeTimeline as GazePoint[]).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.t));
  return points.length >= 2 ? points.sort((a, b) => a.t - b.t) : null;
};

export const applyFixationParameters = (response: Record<string, unknown>, recorded: readonly RecordedFixation[], parameters: FixationParameters): RecordedFixation[] => {
  const gazeTimeline = parameters.maxDispersionPercent === null ? null : readGazeTimeline(response);
  const source = gazeTimeline && parameters.maxDispersionPercent !== null
    ? detectFixationsIdt(gazeTimeline, parameters.maxDispersionPercent, parameters.minDurationMs)
    : recorded;
  const inWindow = source.filter(fixation => {
    const elapsedMs = fixation.timestamp ?? 0;
    return elapsedMs >= parameters.windowStartMs && (parameters.windowEndMs === null || elapsedMs <= parameters.windowEndMs);
  });
  const merged = parameters.mergeRangePercent > 0 ? mergeNearbyFixations(inWindow, parameters.mergeRangePercent) : inWindow;
  return merged.filter(fixation => fixation.duration >= parameters.minDurationMs && (parameters.maxDurationMs === null || fixation.duration <= parameters.maxDurationMs));
};
