import { describe, expect, it } from 'vitest';
import {
  applyFixationParameters,
  detectFixationsIdt,
  InvalidFixationParameterError,
  mergeNearbyFixations,
  readFixationParameters,
  type FixationParameters,
} from '../fixation-parameters';

const steadyGaze = (x: number, y: number, fromMs: number, toMs: number) =>
  Array.from({ length: Math.floor((toMs - fromMs) / 50) + 1 }, (_, index) => ({ x, y, t: fromMs + index * 50 }));

const DEFAULTS: FixationParameters = { windowStartMs: 0, windowEndMs: null, minDurationMs: 0, maxDurationMs: null, maxDispersionPercent: null, mergeRangePercent: 0 };

describe('detectFixationsIdt', () => {
  it('splits gaze into one fixation per steady spot and drops spots shorter than the minimum duration', () => {
    const samples = [...steadyGaze(10, 10, 0, 400), ...steadyGaze(60, 60, 450, 500), ...steadyGaze(80, 20, 550, 1000)];

    const fixations = detectFixationsIdt(samples, 3, 120);

    expect(fixations.map(fixation => [fixation.x, fixation.y, fixation.duration, fixation.timestamp])).toEqual([[10, 10, 400, 0], [80, 20, 450, 550]]);
  });

  it('keeps a wider spot as a single fixation when the dispersion allows it', () => {
    const samples = [...steadyGaze(10, 10, 0, 200), ...steadyGaze(14, 10, 250, 450)];

    expect(detectFixationsIdt(samples, 3, 120)).toHaveLength(2);
    expect(detectFixationsIdt(samples, 6, 120)).toHaveLength(1);
  });
});

describe('mergeNearbyFixations', () => {
  it('joins consecutive fixations inside the merge range into one, weighted by duration', () => {
    const merged = mergeNearbyFixations([{ x: 10, y: 10, duration: 300, timestamp: 0 }, { x: 12, y: 10, duration: 100, timestamp: 350 }, { x: 50, y: 50, duration: 200, timestamp: 500 }], 5);

    expect(merged).toEqual([{ x: 10.5, y: 10, duration: 400, timestamp: 0 }, { x: 50, y: 50, duration: 200, timestamp: 500 }]);
  });
});

describe('applyFixationParameters', () => {
  const recorded = [{ x: 10, y: 10, duration: 100, timestamp: 0 }, { x: 40, y: 40, duration: 600, timestamp: 2000 }, { x: 70, y: 70, duration: 3000, timestamp: 5000 }];

  it('keeps only the recorded fixations inside the analysis window and the duration range', () => {
    const kept = applyFixationParameters({}, recorded, { ...DEFAULTS, windowEndMs: 4000, minDurationMs: 200 });

    expect(kept).toEqual([recorded[1]]);
  });

  it('re-detects fixations from the raw gaze when a dispersion is given', () => {
    const response = { fixationUnit: 'stimulus-percent', gazeTimelineUnit: 'stimulus-percent', gazeTimeline: steadyGaze(30, 30, 0, 500) };

    const kept = applyFixationParameters(response, recorded, { ...DEFAULTS, maxDispersionPercent: 2, minDurationMs: 100 });

    expect(kept).toEqual([{ x: 30, y: 30, duration: 500, timestamp: 0 }]);
  });

  it('falls back to the recorded fixations when the response has no raw gaze', () => {
    expect(applyFixationParameters({}, recorded, { ...DEFAULTS, maxDispersionPercent: 2 })).toEqual(recorded);
  });
});

describe('readFixationParameters', () => {
  it('returns nothing when no parameter is sent, so the recorded fixations stay untouched', () => {
    expect(readFixationParameters({ stageId: 's-1' })).toBeUndefined();
  });

  it('converts the analysis window from seconds to milliseconds', () => {
    expect(readFixationParameters({ windowStartS: '1', windowEndS: '4.5' })).toEqual({ ...DEFAULTS, windowStartMs: 1000, windowEndMs: 4500 });
  });

  it('rejects a value out of range naming the parameter', () => {
    expect(() => readFixationParameters({ maxDispersionPercent: 'abc' })).toThrow(InvalidFixationParameterError);
    expect(() => readFixationParameters({ minDurationMs: '-5' })).toThrow('minDurationMs');
  });
});
