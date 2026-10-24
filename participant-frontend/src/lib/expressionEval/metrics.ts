import type { ActionUnitValues } from './blendshapeActionUnits';
import type { ActionUnitId, ExpressionIntensity, ProtocolStep } from './protocol';

export interface EngineSample {
  tMs: number;
  values: ActionUnitValues | null;
}

export interface RecordedSegment extends ProtocolStep {
  startMs: number;
  endMs: number;
}

export interface ActionUnitReport {
  unit: ActionUnitId;
  neutralMean: number | null;
  neutralSd: number | null;
  responseByIntensity: Record<ExpressionIntensity, number | null>;
  signalToNoiseAtMaximum: number | null;
  monotonicRate: number | null;
  specificityAtMaximum: number | null;
  headPoseFalseActivation: number | null;
  retestDifference: number | null;
  saturationRate: number | null;
}

export interface EngineReport {
  sampleCount: number;
  faceFoundRate: number;
  units: ActionUnitReport[];
}

export const ONSET_SKIP_MS = 1000;
export const OFFSET_SKIP_MS = 200;
const INTENSITIES: readonly ExpressionIntensity[] = ['suave', 'medio', 'maximo'];

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: readonly number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}

function segmentValues(samples: readonly EngineSample[], segment: RecordedSegment, unit: ActionUnitId): number[] {
  const from = segment.startMs + (segment.kind === 'neutral' ? 0 : ONSET_SKIP_MS);
  const to = segment.endMs - OFFSET_SKIP_MS;
  return samples
    .filter(sample => sample.tMs >= from && sample.tMs <= to)
    .map(sample => sample.values?.[unit])
    .filter((value): value is number => typeof value === 'number');
}

function reportActionUnit(samples: readonly EngineSample[], segments: readonly RecordedSegment[], unit: ActionUnitId): ActionUnitReport {
  const neutral = segments.filter(segment => segment.kind === 'neutral').flatMap(segment => segmentValues(samples, segment, unit));
  const neutralMean = mean(neutral);
  const neutralSd = standardDeviation(neutral);
  const responseOf = (segment: RecordedSegment | undefined) => {
    if (!segment) return null;
    const segmentMean = mean(segmentValues(samples, segment, unit));
    return segmentMean === null || neutralMean === null ? null : segmentMean - neutralMean;
  };
  const responses = (selected: readonly RecordedSegment[]) =>
    selected.map(responseOf).filter((value): value is number => value !== null);

  const expressionSegments = segments.filter(segment => segment.kind === 'expression');
  const targeting = expressionSegments.filter(segment => segment.targetActionUnits.includes(unit));
  const notTargetingAtMaximum = expressionSegments.filter(segment => !segment.targetActionUnits.includes(unit) && segment.intensity === 'maximo');
  const responseByIntensity = Object.fromEntries(
    INTENSITIES.map(intensity => [intensity, mean(responses(targeting.filter(segment => segment.intensity === intensity)))]),
  ) as Record<ExpressionIntensity, number | null>;

  const ladders = [...new Set(targeting.map(segment => `${segment.label}|${segment.round}`))].map(key =>
    INTENSITIES.map(intensity => responseOf(targeting.find(segment => `${segment.label}|${segment.round}` === key && segment.intensity === intensity))),
  );
  const completeLadders = ladders.filter((ladder): ladder is number[] => ladder.every(value => value !== null));
  const step = neutralSd ?? 0;
  const monotonicRate = completeLadders.length
    ? completeLadders.filter(([soft, medium, maximum]) => soft + step < medium && medium + step < maximum).length / completeLadders.length
    : null;

  const offTargetResponses = responses(notTargetingAtMaximum);
  const headPoseResponses = responses(segments.filter(segment => segment.kind === 'head-pose'));
  const retestPairs = targeting
    .filter(segment => segment.round === 1)
    .map(first => [first, targeting.find(second => second.round === 2 && second.label === first.label && second.intensity === first.intensity)] as const)
    .map(([first, second]) => [responseOf(first), responseOf(second)])
    .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
  const allValues = samples.map(sample => sample.values?.[unit]).filter((value): value is number => typeof value === 'number');

  return {
    unit,
    neutralMean,
    neutralSd,
    responseByIntensity,
    signalToNoiseAtMaximum: ratio(responseByIntensity.maximo, neutralSd),
    monotonicRate,
    specificityAtMaximum: offTargetResponses.length ? ratio(responseByIntensity.maximo, Math.max(...offTargetResponses)) : null,
    headPoseFalseActivation: headPoseResponses.length ? ratio(Math.max(...headPoseResponses), neutralSd) : null,
    retestDifference: mean(retestPairs.map(([first, second]) => Math.abs(first - second))),
    saturationRate: allValues.length ? allValues.filter(value => value >= 0.99).length / allValues.length : null,
  };
}

export function reportEngine(samples: readonly EngineSample[], segments: readonly RecordedSegment[], units: readonly ActionUnitId[]): EngineReport {
  return {
    sampleCount: samples.length,
    faceFoundRate: samples.length ? samples.filter(sample => sample.values !== null).length / samples.length : 0,
    units: units.map(unit => reportActionUnit(samples, segments, unit)),
  };
}
