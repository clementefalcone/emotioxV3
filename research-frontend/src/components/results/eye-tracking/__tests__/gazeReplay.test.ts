import { describe, expect, it } from 'vitest';
import {
  accumulateGroupZoneDwell,
  accumulateZoneDwell,
  buildGridZones,
  buildParticipantTracks,
  collectHeatPoints,
  countZoneOccupancy,
  findTrackPoint,
  getTrackDurationMs,
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

  it('replays every participant on the shared stimulus-onset clock', () => {
    const tracks = buildParticipantTracks(
      [
        { participantId: 'p1', x: 20, y: 50, timestamp: 100, duration: 300 },
        { participantId: 'p2', x: 70, y: 50, timestamp: 200, duration: 400 },
        { participantId: 'p2', x: 20, y: 50, timestamp: 700, duration: 100 },
      ],
      [],
    );
    expect(tracks.map(track => track.participantId)).toEqual(['p2', 'p1']);
    expect(getTrackDurationMs(tracks[0])).toBe(800);

    const occupancy = countZoneOccupancy(tracks, shelfZones, 250);
    expect(occupancy.get('a')).toBe(1);
    expect(occupancy.get('b')).toBe(1);

    const dwell = accumulateGroupZoneDwell(tracks, shelfZones, 1000);
    expect(dwell.get('a')).toEqual({ averageDwellMs: 200, viewerCount: 2, firstEntryMs: 100 });
    expect(dwell.get('b')).toEqual({ averageDwellMs: 200, viewerCount: 1, firstEntryMs: 200 });
    expect(dwell.get('logo')).toEqual({ averageDwellMs: 0, viewerCount: 0, firstEntryMs: null });
  });

  it('places a participant by raw gaze when available, else by the fixation under the playhead', () => {
    const fixationOnly = { fixations: [{ x: 10, y: 10, timestamp: 0, duration: 100 }], samples: [] };
    expect(findTrackPoint(fixationOnly, 50)).toMatchObject({ x: 10, y: 10 });
    expect(findTrackPoint(fixationOnly, 150)).toBeNull();
    const withGaze = { ...fixationOnly, samples: [{ x: 90, y: 90, t: 40 }] };
    expect(findTrackPoint(withGaze, 50)).toEqual({ x: 90, y: 90, t: 40 });
  });

  it('accumulates dwell per zone up to the playhead, counting the fixation in progress partially', () => {
    const dwell = accumulateZoneDwell(fixations, shelfZones, 1100);
    expect(dwell.get('a')).toEqual({ dwellMs: 300, firstEntryMs: 100 });
    expect(dwell.get('logo')).toEqual({ dwellMs: 100, firstEntryMs: 600 });
    expect(dwell.get('b')).toEqual({ dwellMs: 100, firstEntryMs: 1000 });
  });

  it('heats each fixation by the milliseconds watched up to the playhead, across every track', () => {
    const tracks = [{ participantId: 'p1', fixations, samples: [] }, { participantId: 'p2', fixations: [{ x: 5, y: 5, timestamp: 0, duration: 1000 }], samples: [] }];
    expect(collectHeatPoints(tracks, 1100, null)).toEqual([
      { x: 20, y: 50, value: 300 },
      { x: 60, y: 15, value: 100 },
      { x: 70, y: 50, value: 100 },
      { x: 5, y: 5, value: 1000 },
    ]);
  });

  it('keeps only the gaze inside the moving window', () => {
    const tracks = [{ participantId: 'p1', fixations, samples: [] }];
    expect(collectHeatPoints(tracks, 1100, 500)).toEqual([
      { x: 60, y: 15, value: 100 },
      { x: 70, y: 50, value: 100 },
    ]);
    expect(collectHeatPoints(tracks, 50, 500)).toEqual([]);
  });

  it('weakens heat from imprecise gaze', () => {
    const tracks = [{ participantId: 'p1', fixations: [{ x: 5, y: 5, timestamp: 0, duration: 1000, uncertainty: { x: 5, y: 5 } }], samples: [] }];
    expect(collectHeatPoints(tracks, 1000, null)[0].value).toBeCloseTo(500);
  });
});
