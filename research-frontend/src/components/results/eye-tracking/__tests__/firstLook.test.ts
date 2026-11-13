import { describe, expect, it } from 'vitest';
import { LATER_FIXATION_WEIGHT, selectFirstLookPoints } from '../firstLook';

const fixation = (participantId: string, timestamp: number, x: number) =>
  ({ participantId, timestamp, x, y: 50, duration: 100 }) as Parameters<typeof selectFirstLookPoints>[0][number];

describe('selectFirstLookPoints', () => {
  it('keeps the first N fixations per participant and fades every one after the first', () => {
    const points = selectFirstLookPoints([fixation('p1', 300, 3), fixation('p1', 100, 1), fixation('p1', 200, 2), fixation('p2', 50, 9)], 2);
    expect(points).toEqual([
      { x: 1, y: 50, value: 100 },
      { x: 2, y: 50, value: 100 * LATER_FIXATION_WEIGHT },
      { x: 9, y: 50, value: 100 },
    ]);
  });
});
