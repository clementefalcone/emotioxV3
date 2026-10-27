/**
 * Gauntlet tests for Website Tracking gaze logic.
 *
 * Pure functions — no DOM, no MediaPipe, no camera.
 * Cursor = primary attention signal. Iris = validation/enrichment.
 */
import { describe, it, expect } from 'vitest';
import {
  estimateAttentionState,
  gazeMatchesCursorArea,
  computeAttentionScore,
  type GazeDirection,
  type AttentionState,
} from '../tracking-gaze-logic';

// ---------------------------------------------------------------------------
// estimateAttentionState
// ---------------------------------------------------------------------------

describe('estimateAttentionState', () => {
  it('iris visible + head forward → engaged', () => {
    expect(estimateAttentionState(true, 0, 0)).toBe('engaged');
  });

  it('iris visible + slight head turn → engaged', () => {
    expect(estimateAttentionState(true, 10, 5)).toBe('engaged');
  });

  it('iris visible + large yaw → distracted', () => {
    expect(estimateAttentionState(true, 35, 0)).toBe('distracted');
  });

  it('iris visible + large pitch → distracted', () => {
    expect(estimateAttentionState(true, 0, 35)).toBe('distracted');
  });

  it('iris not visible → away', () => {
    expect(estimateAttentionState(false, 0, 0)).toBe('away');
  });

  it('iris not visible + any head pose → away', () => {
    expect(estimateAttentionState(false, 10, 10)).toBe('away');
  });

  it('negative yaw/pitch uses absolute values', () => {
    expect(estimateAttentionState(true, -35, 0)).toBe('distracted');
    expect(estimateAttentionState(true, 0, -35)).toBe('distracted');
  });

  it('borderline yaw (25°) → engaged (threshold is 30)', () => {
    expect(estimateAttentionState(true, 25, 0)).toBe('engaged');
  });

  it('exactly at threshold (30°) → engaged (> not >=)', () => {
    expect(estimateAttentionState(true, 30, 0)).toBe('engaged');
  });

  it('one degree over threshold (31°) → distracted', () => {
    expect(estimateAttentionState(true, 31, 0)).toBe('distracted');
  });

  it('pitch exactly at threshold (30°) → engaged', () => {
    expect(estimateAttentionState(true, 0, 30)).toBe('engaged');
  });

  it('pitch one degree over (31°) → distracted', () => {
    expect(estimateAttentionState(true, 0, 31)).toBe('distracted');
  });
});

// ---------------------------------------------------------------------------
// gazeMatchesCursorArea
// ---------------------------------------------------------------------------

describe('gazeMatchesCursorArea', () => {
  it('cursor in center + gaze center → match', () => {
    const match = gazeMatchesCursorArea(
      { horizontal: 'center', vertical: 'center' },
      500, 400,   // cursor near center
      1000, 800,  // viewport
    );
    expect(match).toBe(true);
  });

  it('cursor in top-left + gaze top-left → match', () => {
    const match = gazeMatchesCursorArea(
      { horizontal: 'left', vertical: 'up' },
      100, 50,
      1000, 800,
    );
    expect(match).toBe(true);
  });

  it('cursor in top-left + gaze bottom-right → no match', () => {
    const match = gazeMatchesCursorArea(
      { horizontal: 'right', vertical: 'down' },
      100, 50,
      1000, 800,
    );
    expect(match).toBe(false);
  });

  it('cursor center + gaze left → no match', () => {
    const match = gazeMatchesCursorArea(
      { horizontal: 'left', vertical: 'center' },
      500, 400,
      1000, 800,
    );
    expect(match).toBe(false);
  });

  it('gaze center matches any cursor position (center is permissive)', () => {
    // Center gaze = looking at screen generally = matches most positions
    const match = gazeMatchesCursorArea(
      { horizontal: 'center', vertical: 'center' },
      100, 50,
      1000, 800,
    );
    expect(match).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeAttentionScore
// ---------------------------------------------------------------------------

describe('computeAttentionScore', () => {
  it('engaged + gaze matches cursor → score 1.0', () => {
    expect(computeAttentionScore('engaged', true)).toBe(1.0);
  });

  it('engaged + gaze does not match cursor → score 0.7 (looking at screen but elsewhere)', () => {
    expect(computeAttentionScore('engaged', false)).toBe(0.7);
  });

  it('distracted → score 0.3 regardless of cursor match', () => {
    expect(computeAttentionScore('distracted', true)).toBe(0.3);
    expect(computeAttentionScore('distracted', false)).toBe(0.3);
  });

  it('away → score 0', () => {
    expect(computeAttentionScore('away', true)).toBe(0);
    expect(computeAttentionScore('away', false)).toBe(0);
  });

  it('all scores in [0, 1]', () => {
    const states: AttentionState[] = ['engaged', 'distracted', 'away'];
    for (const state of states) {
      for (const match of [true, false]) {
        const score = computeAttentionScore(state, match);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

