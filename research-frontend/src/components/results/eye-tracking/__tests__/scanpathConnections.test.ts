import { describe, expect, it } from 'vitest';
import { buildScanpathConnections } from '../scanpathConnections';

describe('buildScanpathConnections', () => {
  it('links each participant to their own previous fixation even when time-sorted paths interleave', () => {
    const fixations = [{ participantId: 'p1' }, { participantId: 'p2' }, { participantId: 'p1' }, { participantId: 'p2' }, { participantId: 'p2' }];
    expect(buildScanpathConnections(fixations)).toEqual([
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 3, toIndex: 4 },
    ]);
  });
});
