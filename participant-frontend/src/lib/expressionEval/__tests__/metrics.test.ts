import { describe, it, expect } from 'vitest';
import { buildExpressionProtocol, type ActionUnitId } from '../protocol';
import { reportEngine, type EngineSample, type RecordedSegment } from '../metrics';
import type { ActionUnitValues } from '../blendshapeActionUnits';

const UNITS: ActionUnitId[] = ['AU12', 'AU20'];
const LEVEL = { suave: 0.2, medio: 0.5, maximo: 0.9 } as const;

function recordSegments(): RecordedSegment[] {
  let clock = 0;
  return buildExpressionProtocol().map(step => {
    const segment = { ...step, startMs: clock, endMs: clock + step.durationMs };
    clock = segment.endMs;
    return segment;
  });
}

const SEGMENTS = recordSegments();

function simulate(valuesFor: (segment: RecordedSegment, unit: ActionUnitId) => number, faceFound = () => true): EngineSample[] {
  const samples: EngineSample[] = [];
  for (let tMs = 0; tMs < (SEGMENTS.at(-1)?.endMs ?? 0); tMs += 50) {
    const segment = SEGMENTS.find(candidate => tMs >= candidate.startMs && tMs < candidate.endMs);
    if (!segment) continue;
    const noise = 0.01 * Math.sin(tMs / 37);
    const values: ActionUnitValues = Object.fromEntries(UNITS.map(unit => [unit, Math.max(0, valuesFor(segment, unit) + noise)]));
    samples.push({ tMs, values: faceFound() ? values : null });
  }
  return samples;
}

const targetLevel = (segment: RecordedSegment, unit: ActionUnitId) =>
  segment.kind === 'expression' && segment.intensity && segment.targetActionUnits.includes(unit) ? LEVEL[segment.intensity] : 0.02;

describe('reportEngine', () => {
  it('scores an engine that follows the cues: rising response, high signal, specific, repeatable', () => {
    const smile = reportEngine(simulate(targetLevel), SEGMENTS, UNITS).units[0];

    expect(smile.responseByIntensity.suave).toBeCloseTo(0.18, 1);
    expect(smile.responseByIntensity.maximo).toBeCloseTo(0.88, 1);
    expect(smile.monotonicRate).toBe(1);
    expect(smile.signalToNoiseAtMaximum).toBeGreaterThan(50);
    expect(smile.specificityAtMaximum).toBeGreaterThan(10);
    expect(smile.retestDifference).toBeLessThan(0.01);
    expect(smile.saturationRate).toBe(0);
  });

  it('flags a unit that also moves with another expression as not specific', () => {
    const leaking = (segment: RecordedSegment, unit: ActionUnitId) =>
      unit === 'AU20' && segment.label === 'smile' && segment.intensity === 'maximo' ? 0.9 : targetLevel(segment, unit);

    const lipStretch = reportEngine(simulate(leaking), SEGMENTS, UNITS).units[1];

    expect(lipStretch.specificityAtMaximum).toBeLessThanOrEqual(1);
  });

  it('flags a unit pinned at 1 as saturated and not graded by intensity', () => {
    const pinned = (segment: RecordedSegment, unit: ActionUnitId) =>
      segment.kind === 'expression' && segment.targetActionUnits.includes(unit) ? 1 : 0.02;

    const smile = reportEngine(simulate(pinned), SEGMENTS, UNITS).units[0];

    expect(smile.saturationRate).toBeGreaterThan(0);
    expect(smile.monotonicRate).toBe(0);
  });

  it('measures false activation when the head turns with a neutral face', () => {
    const headSensitive = (segment: RecordedSegment, unit: ActionUnitId) =>
      segment.kind === 'head-pose' && unit === 'AU12' ? 0.4 : targetLevel(segment, unit);

    const smile = reportEngine(simulate(headSensitive), SEGMENTS, UNITS).units[0];

    expect(smile.headPoseFalseActivation).toBeGreaterThan(20);
  });

  it('reports how often the engine found a face', () => {
    let call = 0;
    const report = reportEngine(simulate(targetLevel, () => call++ % 4 !== 0), SEGMENTS, UNITS);

    expect(report.faceFoundRate).toBeCloseTo(0.75, 2);
  });
});
