import { describe, it, expect } from 'vitest';
import { computeAoiMetrics, softAoiWeight } from '../aoi-metrics';

describe('computeAoiMetrics', () => {
  const left = { x: 0, y: 0, width: 50, height: 100 };
  const right = { x: 50, y: 0, width: 50, height: 100 };
  const fixation = (x: number) => ({ participantId: 'p1', x, y: 50, duration: 100, timestamp: x });
  const dwellOf = (rect: typeof left, fixations: ReturnType<typeof fixation>[], allRects = [left, right]) =>
    computeAoiMetrics({ fixations, rectFor: () => rect, allRectsFor: () => allRects, emotionsByParticipant: new Map() }).dwellTimePercent;

  it('never lets the AOI shares of the same gaze add up to more than 100%', () => {
    const fixations = [fixation(10), fixation(48), fixation(52), fixation(90)];
    expect(dwellOf(left, fixations) + dwellOf(right, fixations)).toBeLessThanOrEqual(100);
  });

  it('splits a fixation that lies inside two overlapping AOIs', () => {
    const nested = { x: 0, y: 0, width: 30, height: 100 };
    expect(dwellOf(nested, [fixation(10)], [left, nested])).toBe(50);
  });

  it('still counts the whole fixation when no other AOI is near', () => {
    expect(dwellOf(left, [fixation(10)])).toBe(100);
  });

  it('keeps counting the participant as having noticed the AOI when the fixation is shared', () => {
    const nested = { x: 0, y: 0, width: 30, height: 100 };
    const metrics = computeAoiMetrics({ fixations: [fixation(10)], rectFor: () => nested, allRectsFor: () => [left, nested], emotionsByParticipant: new Map() });
    expect(metrics.noticeRate).toBe(100);
  });
});

describe('softAoiWeight', () => {
  const column = { x: 40, y: 0, width: 20, height: 100 };

  it('counts a fixation inside the AOI fully', () => {
    expect(softAoiWeight(50, 50, column)).toBe(1);
  });

  it('does not give a tall shelf column the gaze of a column two places away', () => {
    expect(softAoiWeight(90, 50, column)).toBeLessThan(0.01);
  });

  it('keeps a small margin next to the edge for gaze error', () => {
    expect(softAoiWeight(62, 50, column)).toBeGreaterThan(0.9);
  });

  it('scales the margin of each axis by the AOI size on that axis', () => {
    const wide = { x: 0, y: 40, width: 100, height: 20 };
    expect(softAoiWeight(50, 90, wide)).toBeLessThan(0.01);
    expect(softAoiWeight(50, 62, wide)).toBeGreaterThan(0.9);
  });
});
