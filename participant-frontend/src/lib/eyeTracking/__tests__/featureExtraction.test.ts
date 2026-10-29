import { describe, it, expect } from 'vitest';
import { extractGazeFeatures, averageFeatureVectors } from '../featureExtraction';
import { EYE_LOOK_BLENDSHAPES, GAZE_FEATURE_DIMENSION, LANDMARK_INDICES } from '../constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Lm = { x: number; y: number; z: number; visibility?: number };

const eyeLook = (scores: Partial<Record<(typeof EYE_LOOK_BLENDSHAPES)[number], number>> = {}) =>
  EYE_LOOK_BLENDSHAPES.map((categoryName, index) => ({ categoryName, score: scores[categoryName] ?? 0, index, displayName: '' }));

function makeLandmarks(count: number): Lm[] {
  return Array.from({ length: count }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

function withIrisAndEyes(landmarks: Lm[], opts: {
  leftIris?: Partial<Lm>;
  rightIris?: Partial<Lm>;
  leftEyeInner?: Partial<Lm>;
  leftEyeOuter?: Partial<Lm>;
  leftEyeTop?: Partial<Lm>;
  leftEyeBottom?: Partial<Lm>;
  rightEyeInner?: Partial<Lm>;
  rightEyeOuter?: Partial<Lm>;
  rightEyeTop?: Partial<Lm>;
  rightEyeBottom?: Partial<Lm>;
  noseTip?: Partial<Lm>;
} = {}): Lm[] {
  const lm = [...landmarks];
  const set = (idx: number, val: Partial<Lm>) => {
    lm[idx] = { ...lm[idx], ...val };
  };

  // Default: eyes spread apart horizontally, iris centered in each eye
  set(LANDMARK_INDICES.leftEyeInner, { x: 0.38, y: 0.45, ...opts.leftEyeInner });
  set(LANDMARK_INDICES.leftEyeOuter, { x: 0.28, y: 0.45, ...opts.leftEyeOuter });
  set(LANDMARK_INDICES.leftEyeTop, { x: 0.33, y: 0.43, ...opts.leftEyeTop });
  set(LANDMARK_INDICES.leftEyeBottom, { x: 0.33, y: 0.47, ...opts.leftEyeBottom });
  set(LANDMARK_INDICES.rightEyeInner, { x: 0.62, y: 0.45, ...opts.rightEyeInner });
  set(LANDMARK_INDICES.rightEyeOuter, { x: 0.72, y: 0.45, ...opts.rightEyeOuter });
  set(LANDMARK_INDICES.rightEyeTop, { x: 0.67, y: 0.43, ...opts.rightEyeTop });
  set(LANDMARK_INDICES.rightEyeBottom, { x: 0.67, y: 0.47, ...opts.rightEyeBottom });
  set(LANDMARK_INDICES.leftIrisCenter, { x: 0.33, y: 0.45, ...opts.leftIris });
  set(LANDMARK_INDICES.rightIrisCenter, { x: 0.67, y: 0.45, ...opts.rightIris });
  set(LANDMARK_INDICES.noseTip, { x: 0.5, y: 0.55, ...opts.noseTip });

  return lm;
}

// ---------------------------------------------------------------------------
// extractGazeFeatures
// ---------------------------------------------------------------------------

describe('extractGazeFeatures', () => {
  it('returns null when landmarks array is too short', () => {
    const short = makeLandmarks(400); // need at least 474
    expect(extractGazeFeatures(short, undefined, eyeLook())).toBeNull();
  });

  it('returns null when iris landmarks have NaN coords', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { x: NaN, y: 0.5 },
    });
    expect(extractGazeFeatures(lm, undefined, eyeLook())).toBeNull();
  });

  it('returns null when iris landmarks have Infinity coords', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      rightIris: { x: Infinity, y: 0.5 },
    });
    expect(extractGazeFeatures(lm, undefined, eyeLook())).toBeNull();
  });

  it('returns null when IPD is degenerate (eyes at same position)', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftEyeInner: { x: 0.5, y: 0.5 },
      leftEyeOuter: { x: 0.5, y: 0.5 },
      rightEyeInner: { x: 0.5, y: 0.5 },
      rightEyeOuter: { x: 0.5, y: 0.5 },
    });
    expect(extractGazeFeatures(lm, undefined, eyeLook())).toBeNull();
  });

  it('returns null without the eyeLook blendshapes', () => {
    const lm = withIrisAndEyes(makeLandmarks(478));
    expect(extractGazeFeatures(lm, undefined, undefined)).toBeNull();
    expect(extractGazeFeatures(lm, undefined, eyeLook().slice(1))).toBeNull();
  });

  it('appends the eyeLook scores after head pose, in EYE_LOOK_BLENDSHAPES order', () => {
    const lm = withIrisAndEyes(makeLandmarks(478));
    const features = extractGazeFeatures(lm, undefined, eyeLook({ eyeLookUpLeft: 0.7, eyeLookDownRight: 0.2, eyeLookOutRight: 0.4 }))!;
    expect(features.slice(20)).toEqual([0.7, 0, 0, 0.2, 0, 0, 0, 0.4]);
  });

  it('returns feature vector of length GAZE_FEATURE_DIMENSION (28)', () => {
    const lm = withIrisAndEyes(makeLandmarks(478));
    const features = extractGazeFeatures(lm, undefined, eyeLook());
    expect(features).not.toBeNull();
    expect(features!.length).toBe(GAZE_FEATURE_DIMENSION);
    expect(features!.length).toBe(28);
  });

  it('all features are finite numbers', () => {
    const lm = withIrisAndEyes(makeLandmarks(478));
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    for (let i = 0; i < features.length; i++) {
      expect(Number.isFinite(features[i])).toBe(true);
    }
  });

  it('centered iris produces near-zero gaze displacement', () => {
    // Iris at eye center → avgRx ≈ 0, avgRy ≈ 0
    const lm = withIrisAndEyes(makeLandmarks(478));
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    // features[0] = avgRx, features[1] = avgRy
    expect(Math.abs(features[0])).toBeLessThan(0.01);
    expect(Math.abs(features[1])).toBeLessThan(0.01);
  });

  it('iris displaced right produces positive avgRx', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { x: 0.36 },  // shifted right from center 0.33
      rightIris: { x: 0.70 }, // shifted right from center 0.67
    });
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    expect(features[0]).toBeGreaterThan(0); // avgRx positive = right gaze
  });

  it('iris displaced left produces negative avgRx', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { x: 0.30 },  // shifted left
      rightIris: { x: 0.64 }, // shifted left
    });
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    expect(features[0]).toBeLessThan(0); // avgRx negative = left gaze
  });

  it('iris displaced down produces positive avgRy', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { y: 0.48 },  // below eye center
      rightIris: { y: 0.48 },
    });
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    expect(features[1]).toBeGreaterThan(0); // avgRy positive = down gaze
  });

  it('vergence captures asymmetric iris displacement', () => {
    // Left eye looks right, right eye looks left → convergence
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { x: 0.36 },  // right of center
      rightIris: { x: 0.64 }, // left of center
    });
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    // features[6] = vergX = lrx - rrx
    const vergX = features[6];
    expect(vergX).not.toBe(0);
  });

  it('fallback head pose uses identity rotation + nose translation', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      noseTip: { x: 0.6, y: 0.4 },
    });
    const features = extractGazeFeatures(lm, null, eyeLook())!;
    // features[8..16] = rotation (identity = [1,0,0,0,1,0,0,0,1])
    expect(features[8]).toBe(1);  // R[0,0]
    expect(features[9]).toBe(0);  // R[0,1]
    expect(features[12]).toBe(1); // R[1,1]
    // features[17] = tx = noseTip.x - 0.5 = 0.1
    expect(features[17]).toBeCloseTo(0.1, 5);
    // features[18] = ty = noseTip.y - 0.5 = -0.1
    expect(features[18]).toBeCloseTo(-0.1, 5);
    // features[19] = tz = 0
    expect(features[19]).toBe(0);
  });

  it('per-eye features are separate (features[2..5])', () => {
    const lm = withIrisAndEyes(makeLandmarks(478), {
      leftIris: { x: 0.35 },   // slightly right
      rightIris: { x: 0.67 },  // centered
    });
    const features = extractGazeFeatures(lm, undefined, eyeLook())!;
    // features[2] = lrx, features[4] = rrx — should differ
    expect(features[2]).not.toBeCloseTo(features[4], 3);
  });
});

// ---------------------------------------------------------------------------
// averageFeatureVectors
// ---------------------------------------------------------------------------

describe('averageFeatureVectors', () => {
  it('single vector returns itself', () => {
    const v = [1, 2, 3, 4, 5];
    const avg = averageFeatureVectors([v]);
    expect(avg).toEqual([1, 2, 3, 4, 5]);
  });

  it('averages two vectors element-wise', () => {
    const a = [2, 4, 6];
    const b = [4, 8, 12];
    expect(averageFeatureVectors([a, b])).toEqual([3, 6, 9]);
  });

  it('averages three vectors correctly', () => {
    const a = [3, 0, 9];
    const b = [6, 3, 0];
    const c = [0, 6, 3];
    expect(averageFeatureVectors([a, b, c])).toEqual([3, 3, 4]);
  });

  it('preserves sign (negative values)', () => {
    const a = [-2, 4];
    const b = [2, -4];
    expect(averageFeatureVectors([a, b])).toEqual([0, 0]);
  });

  it('handles GAZE_FEATURE_DIMENSION-element feature vectors', () => {
    const v1 = Array.from({ length: GAZE_FEATURE_DIMENSION }, (_, i) => i);
    const v2 = Array.from({ length: GAZE_FEATURE_DIMENSION }, (_, i) => i * 2);
    const avg = averageFeatureVectors([v1, v2]);
    expect(avg.length).toBe(GAZE_FEATURE_DIMENSION);
    expect(avg[0]).toBe(0);    // (0+0)/2
    expect(avg[10]).toBe(15);  // (10+20)/2
    expect(avg[19]).toBe(28.5); // (19+38)/2
  });
});
