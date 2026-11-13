import { describe, it, expect } from 'vitest';
import {
  classifyEmotion,
  createActionUnitEstimator,
  extractActionUnits,
} from '../facsClassifier';
import type { ActionUnits } from '../facsClassifier';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAUs(overrides: Partial<ActionUnits> = {}): ActionUnits {
  return {
    AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0,
    AU15: 0, AU20: 0, AU25: 0, AU26: 0,
    ...overrides,
  };
}

/**
 * Generate a 478-length MediaPipe landmark array with default positions.
 * All points default to (0.5, 0.5, 0) — a neutral center.
 * Override specific indices via the `overrides` map.
 */
function makeLandmarks(
  overrides: Record<number, { x: number; y: number; z?: number }> = {},
  length = 478,
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  for (const [idx, coords] of Object.entries(overrides)) {
    landmarks[Number(idx)] = { x: coords.x, y: coords.y, z: coords.z ?? 0, visibility: 1 };
  }
  return landmarks;
}

// ---------------------------------------------------------------------------
// classifyEmotion
// ---------------------------------------------------------------------------

describe('classifyEmotion', () => {
  it('all AUs zero returns neutral with high confidence', () => {
    const result = classifyEmotion(makeAUs());
    expect(result.emotion).toBe('neutral');
    // maxAU = 0, so neutral score = 1.0 - 0 = 1.0
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('all AUs very low (< 0.15) returns neutral', () => {
    const result = classifyEmotion(makeAUs({
      AU1: 0.1, AU2: 0.05, AU4: 0.12, AU6: 0.08,
      AU12: 0.03, AU15: 0.07, AU20: 0.04, AU25: 0.09, AU26: 0.02,
    }));
    expect(result.emotion).toBe('neutral');
  });

  it('AU6 high + AU12 high returns joy', () => {
    const result = classifyEmotion(makeAUs({ AU6: 0.9, AU12: 0.9 }));
    expect(result.emotion).toBe('joy');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('AU1 + AU4 + AU15 high returns sadness', () => {
    const result = classifyEmotion(makeAUs({ AU1: 0.8, AU4: 0.7, AU15: 0.9 }));
    expect(result.emotion).toBe('sadness');
  });

  it('AU1 + AU2 + AU25 + AU26 high returns surprise', () => {
    const result = classifyEmotion(makeAUs({ AU1: 0.9, AU2: 0.9, AU25: 0.8, AU26: 0.9 }));
    expect(result.emotion).toBe('surprise');
  });

  it('AU4 high alone returns anger', () => {
    const result = classifyEmotion(makeAUs({ AU4: 0.95 }));
    expect(result.emotion).toBe('anger');
  });

  it('AU15 + AU20 + AU4 returns disgust', () => {
    const result = classifyEmotion(makeAUs({ AU15: 0.9, AU20: 0.8, AU4: 0.3 }));
    expect(result.emotion).toBe('disgust');
  });

  it('AU1 + AU2 + AU4 + AU20 returns fear', () => {
    const result = classifyEmotion(makeAUs({ AU1: 0.8, AU2: 0.7, AU4: 0.9, AU20: 0.8 }));
    expect(result.emotion).toBe('fear');
  });

  it('clear winner has higher confidence than ambiguous case', () => {
    // Clear joy
    const clear = classifyEmotion(makeAUs({ AU6: 1.0, AU12: 1.0 }));
    // Ambiguous: multiple AUs moderate
    const ambiguous = classifyEmotion(makeAUs({
      AU6: 0.4, AU12: 0.4, AU4: 0.4, AU15: 0.4, AU1: 0.4,
    }));
    expect(clear.confidence).toBeGreaterThan(ambiguous.confidence);
  });

  it('confidence is always in [0, 1]', () => {
    const extremes = [
      makeAUs({ AU6: 1, AU12: 1 }),
      makeAUs({ AU4: 1 }),
      makeAUs(),
      makeAUs({ AU1: 0.5, AU2: 0.5, AU4: 0.5, AU6: 0.5, AU12: 0.5, AU15: 0.5, AU20: 0.5, AU25: 0.5, AU26: 0.5 }),
    ];
    for (const aus of extremes) {
      const { confidence } = classifyEmotion(aus);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// createActionUnitEstimator (face-api.js 68 landmarks)
// ---------------------------------------------------------------------------

type Face68 = { x: number; y: number }[];

const NEUTRAL_FACE: Record<number, [number, number]> = {
  17: [52, 80], 26: [148, 80], 21: [88, 85], 22: [112, 85],
  36: [55, 100], 39: [85, 100], 42: [115, 100], 45: [145, 100],
  37: [65, 97.3], 38: [75, 97.3], 41: [65, 102.7], 40: [75, 102.7],
  43: [125, 97.3], 44: [135, 97.3], 47: [125, 102.7], 46: [135, 102.7],
  33: [100, 125], 48: [81, 150], 54: [119, 150], 62: [100, 150], 66: [100, 150.6], 8: [100, 173],
};

function makeFace(moves: Record<number, [number, number]> = {}): Face68 {
  const points = Array.from({ length: 68 }, () => ({ x: 100, y: 120 }));
  for (const [index, [x, y]] of Object.entries(NEUTRAL_FACE)) points[Number(index)] = { x, y };
  for (const [index, [dx, dy]] of Object.entries(moves)) {
    points[Number(index)] = { x: points[Number(index)].x + dx, y: points[Number(index)].y + dy };
  }
  return points;
}

function estimatorAfterNeutralBaseline() {
  const estimate = createActionUnitEstimator();
  for (let frame = 0; frame < 10; frame++) estimate(makeFace({ 48: [0, (frame % 3) * 0.1] }));
  return estimate;
}

describe('createActionUnitEstimator', () => {
  it('returns null for fewer than 68 points', () => {
    expect(createActionUnitEstimator()(makeFace().slice(0, 67))).toBeNull();
  });

  it('reads a resting face with real proportions as no activation', () => {
    const units = estimatorAfterNeutralBaseline()(makeFace())!;
    for (const value of Object.values(units)) expect(value).toBeLessThan(0.05);
  });

  it.each<[string, Record<number, [number, number]>, keyof ActionUnits]>([
    ['raised inner brows', { 21: [0, -4.5], 22: [0, -4.5] }, 'AU1'],
    ['raised outer brows', { 17: [0, -4.5], 26: [0, -4.5] }, 'AU2'],
    ['brows pulled together', { 21: [3, 0], 22: [-3, 0] }, 'AU4'],
    ['narrowed eyes', { 37: [0, 1], 38: [0, 1], 43: [0, 1], 44: [0, 1], 41: [0, -0.8], 40: [0, -0.8], 47: [0, -0.8], 46: [0, -0.8] }, 'AU6'],
    ['lip corners pulled up', { 48: [-3, -4.5], 54: [3, -4.5] }, 'AU12'],
    ['lip corners pulled down', { 48: [0, 3], 54: [0, 3] }, 'AU15'],
    ['lips stretched sideways', { 48: [-4, 0], 54: [4, 0] }, 'AU20'],
    ['lips parted', { 66: [0, 4.5] }, 'AU25'],
    ['jaw dropped', { 66: [0, 9], 8: [0, 9] }, 'AU26'],
  ])('%s activates %s', (_, moves, unit) => {
    expect(estimatorAfterNeutralBaseline()(makeFace(moves))![unit]).toBeGreaterThan(0.9);
  });

  it('keeps a smile apart from the opposite and from a plain stretch', () => {
    const smile = estimatorAfterNeutralBaseline()(makeFace({ 48: [-3, -4.5], 54: [3, -4.5] }))!;
    expect(smile.AU15).toBe(0);
    expect(smile.AU20).toBeLessThan(0.05);
  });

  it('starts a fresh baseline for each estimator', () => {
    const smiling = makeFace({ 48: [-3, -4.5], 54: [3, -4.5] });
    expect(createActionUnitEstimator()(smiling)!.AU12).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// extractActionUnits (MediaPipe 468)
// ---------------------------------------------------------------------------

describe('extractActionUnits', () => {
  it('landmarks with NaN coordinates returns null', () => {
    const landmarks = makeLandmarks({
      133: { x: NaN, y: 0.5 }, // leftEyeInner
    });
    expect(extractActionUnits(landmarks)).toBeNull();
  });

  it('landmarks with Infinity returns null', () => {
    const landmarks = makeLandmarks({
      362: { x: Infinity, y: 0.5 }, // rightEyeInner
    });
    expect(extractActionUnits(landmarks)).toBeNull();
  });

  it('short array (missing required landmarks) returns null', () => {
    const short = Array.from({ length: 10 }, () => ({
      x: 0.5, y: 0.5, z: 0, visibility: 1,
    })) as NormalizedLandmark[];
    expect(extractActionUnits(short)).toBeNull();
  });

  it('valid landmarks returns ActionUnits with all values in [0, 1]', () => {
    // Set the two eye inner corners apart for a non-zero refDist
    const landmarks = makeLandmarks({
      133: { x: 0.35, y: 0.4 },  // leftEyeInner
      362: { x: 0.65, y: 0.4 },  // rightEyeInner
    });
    const result = extractActionUnits(landmarks);
    expect(result).not.toBeNull();
    const auKeys: (keyof ActionUnits)[] = ['AU1', 'AU2', 'AU4', 'AU6', 'AU12', 'AU15', 'AU20', 'AU25', 'AU26'];
    for (const key of auKeys) {
      expect(result![key]).toBeGreaterThanOrEqual(0);
      expect(result![key]).toBeLessThanOrEqual(1);
    }
  });

  it('returns all 9 AU keys', () => {
    const landmarks = makeLandmarks({
      133: { x: 0.35, y: 0.4 },
      362: { x: 0.65, y: 0.4 },
    });
    const result = extractActionUnits(landmarks);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(
      ['AU1', 'AU12', 'AU15', 'AU2', 'AU20', 'AU25', 'AU26', 'AU4', 'AU6'],
    );
  });
});
