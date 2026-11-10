import { describe, expect, it } from 'vitest';
import {
  accumulateZoneDwell,
  buildGridZones,
  countStartedFixations,
  findActiveFixationIndex,
  findGazeSampleAt,
  findZoneAt,
  getReplayDurationMs,
  resolveGazeFocus,
  selectRecentGazeSamples,
  sortFixationsByTime,
} from '../gazeReplay';

const shelfZones = [
  { id: 'a', label: 'A', x: 0, y: 0, width: 50, height: 100 },
  { id: 'b', label: 'B', x: 50, y: 0, width: 50, height: 100 },
  { id: 'logo', label: 'Logo', x: 55, y: 10, width: 10, height: 10 },
];

const fixations = sortFixationsByTime([
  { x: 70, y: 50, timestamp: 1000, duration: 200 },
  { x: 20, y: 50, timestamp: 100, duration: 300 },
  { x: 60, y: 15, timestamp: 600, duration: 100 },
]);

describe('gazeReplay', () => {
  it('builds a 3x3 grid matching the backend zoneMass ids', () => {
    const grid = buildGridZones();
    expect(grid.map(zone => zone.id)).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2', 'r2c0', 'r2c1', 'r2c2']);
    expect(findZoneAt(grid, 90, 90)?.id).toBe('r2c2');
  });

  it('prefers the smallest zone when zones overlap', () => {
    expect(findZoneAt(shelfZones, 60, 15)?.id).toBe('logo');
    expect(findZoneAt(shelfZones, 60, 80)?.id).toBe('b');
  });

  it('finds the fixation under the playhead and reports gaps as -1', () => {
    expect(findActiveFixationIndex(fixations, 250)).toBe(0);
    expect(findActiveFixationIndex(fixations, 500)).toBe(-1);
    expect(countStartedFixations(fixations, 650)).toBe(2);
    expect(getReplayDurationMs(fixations)).toBe(1200);
  });

  it('follows the raw gaze sample when the session recorded one, and reports tracking loss', () => {
    const samples = [
      { x: 20, y: 50, t: 100 },
      { x: 70, y: 50, t: 500 },
    ];
    expect(resolveGazeFocus(fixations, samples, shelfZones, 520)).toMatchObject({ fixationIndex: -1, zone: { id: 'b' }, stateLabel: 'B' });
    expect(resolveGazeFocus(fixations, samples, shelfZones, 300)).toMatchObject({ gazeSample: null, zone: null, stateLabel: 'Sin mirada registrada' });
    expect(selectRecentGazeSamples(samples, 520, 300)).toEqual([{ x: 70, y: 50, t: 500 }]);
  });

  it('falls back to fixations when the session has no raw gaze', () => {
    expect(resolveGazeFocus(fixations, [], shelfZones, 250)).toMatchObject({ fixationIndex: 0, zone: { id: 'a' }, stateLabel: 'A' });
    expect(resolveGazeFocus(fixations, [], shelfZones, 500).stateLabel).toBe('Sin fijación');
    expect(findGazeSampleAt([], 100)).toBeNull();
  });

  it('accumulates dwell per zone up to the playhead, counting the fixation in progress partially', () => {
    const dwell = accumulateZoneDwell(fixations, shelfZones, 1100);
    expect(dwell.get('a')).toEqual({ dwellMs: 300, firstEntryMs: 100 });
    expect(dwell.get('logo')).toEqual({ dwellMs: 100, firstEntryMs: 600 });
    expect(dwell.get('b')).toEqual({ dwellMs: 100, firstEntryMs: 1000 });
  });
});
