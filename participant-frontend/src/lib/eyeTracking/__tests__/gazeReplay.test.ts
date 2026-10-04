/**
 * Golden-file replay test — real MediaPipe landmarks from a recorded session.
 *
 * Uses landmarks extracted from docs/gaze-capture.webm via FaceLandmarker.
 * Ground truth: docs/ground-truth.json (9 calibration points + 12 evaluation points).
 *
 * Tests the full pipeline with real-world data without needing a browser or webcam.
 */
import { describe, it, expect } from 'vitest';
import { extractGazeFeatures } from '../featureExtraction';
import { RidgeRegression } from '../ridgeRegression';
import { GAZE_FEATURE_DIMENSION, LANDMARK_INDICES } from '../constants';
import { extractActionUnits, classifyEmotion } from '../facsClassifier';

import replayData from './fixtures/replayLandmarks.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ReplayFrame {
  label: string;
  phase: 'calibration' | 'evaluation';
  targetX: number;
  targetY: number;
  frameNo: number;
  timestampMs: number;
  landmarks: Record<string, { x: number; y: number; z: number }>;
  facialMatrix?: number[][];
  zone?: string;
}

const frames = replayData as ReplayFrame[];
const calFrames = frames.filter(f => f.phase === 'calibration');
const evalFrames = frames.filter(f => f.phase === 'evaluation');

/**
 * Expand sparse landmark dict (21 named points) into a 478-length array
 * for extractGazeFeatures compatibility.
 */
function expandToFullLandmarks(sparse: Record<string, { x: number; y: number; z: number }>): Array<{ x: number; y: number; z: number }> {
  const full = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  const nameToIndex: Record<string, number> = {
    ...LANDMARK_INDICES,
    leftInnerBrow: 107,
    rightInnerBrow: 336,
    leftMidBrow: 105,
    rightMidBrow: 334,
    mouthLeft: 61,
    mouthRight: 291,
    mouthUpperLipTop: 0,
    mouthLowerLipBottom: 17,
    chinBottom: 152,
    noseBottom: 2,
  };

  for (const [name, coords] of Object.entries(sparse)) {
    const idx = nameToIndex[name];
    if (idx !== undefined) {
      full[idx] = coords;
    }
  }
  return full;
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

describe('replay fixture sanity', () => {
  it('has 9 calibration frames', () => {
    expect(calFrames).toHaveLength(9);
  });

  it('has 12 evaluation frames', () => {
    expect(evalFrames).toHaveLength(12);
  });

  it('all frames have 21 landmark points', () => {
    for (const f of frames) {
      expect(Object.keys(f.landmarks)).toHaveLength(21);
    }
  });

  it('all landmarks have finite x, y, z', () => {
    for (const f of frames) {
      for (const [name, lm] of Object.entries(f.landmarks)) {
        expect(Number.isFinite(lm.x), `${f.label}.${name}.x`).toBe(true);
        expect(Number.isFinite(lm.y), `${f.label}.${name}.y`).toBe(true);
        expect(Number.isFinite(lm.z), `${f.label}.${name}.z`).toBe(true);
      }
    }
  });

  it('calibration targets cover the 9-point grid', () => {
    const targets = calFrames.map(f => `${f.targetX},${f.targetY}`);
    expect(targets).toContain('0.1,0.1');
    expect(targets).toContain('0.5,0.5');
    expect(targets).toContain('0.9,0.9');
  });
});

// ---------------------------------------------------------------------------
// Feature extraction from real landmarks
// ---------------------------------------------------------------------------

describe('feature extraction from real landmarks', () => {
  it('all calibration frames produce valid 20-dim feature vectors', () => {
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined);
      expect(features, `${f.label} should produce features`).not.toBeNull();
      expect(features!.length).toBe(GAZE_FEATURE_DIMENSION);
      for (let i = 0; i < features!.length; i++) {
        expect(Number.isFinite(features![i]), `${f.label} feature[${i}]`).toBe(true);
      }
    }
  });

  it('all evaluation frames produce valid feature vectors', () => {
    for (const f of evalFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined);
      expect(features, `${f.label}`).not.toBeNull();
      expect(features!.length).toBe(GAZE_FEATURE_DIMENSION);
    }
  });

  it('iris displacement varies across different gaze targets', () => {
    const featuresByTarget: Map<string, number[]> = new Map();
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      featuresByTarget.set(f.label, features);
    }

    // Left target (0.1, 0.5) vs right target (0.9, 0.5): avgRx should differ
    const left = featuresByTarget.get('cal-4')!;
    const right = featuresByTarget.get('cal-6')!;
    // features[0] = avgRx
    expect(left[0]).not.toBeCloseTo(right[0], 2);
  });
});

// ---------------------------------------------------------------------------
// Ridge regression replay: calibrate + evaluate
// ---------------------------------------------------------------------------

describe('Ridge regression replay pipeline', () => {
  // Virtual screen: 1920x1080
  const W = 1920;
  const H = 1080;

  it('calibration + prediction produces finite screen coordinates', () => {
    const ridge = new RidgeRegression();

    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined);
      if (!features) continue;
      ridge.addSample(features, [f.targetX * W, f.targetY * H]);
    }

    expect(ridge.sampleCount).toBe(9);
    ridge.train(10);
    expect(ridge.isReady()).toBe(true);

    for (const f of evalFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined);
      if (!features) continue;
      const [px, py] = ridge.predict(features);
      expect(Number.isFinite(px), `${f.label} px`).toBe(true);
      expect(Number.isFinite(py), `${f.label} py`).toBe(true);
    }
  });

  it('LOOCV error is computed and positive', () => {
    const ridge = new RidgeRegression();
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      ridge.addSample(features, [f.targetX * W, f.targetY * H]);
    }
    ridge.train(10);
    expect(ridge.cvRmsePx).not.toBeNull();
    expect(ridge.cvRmsePx!).toBeGreaterThan(0);
  });

  it('diagnostics have 9 calibration point groups', () => {
    const ridge = new RidgeRegression();
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      ridge.addSample(features, [f.targetX * W, f.targetY * H]);
    }
    ridge.train(10);
    expect(ridge.diagnostics).not.toBeNull();
    expect(ridge.diagnostics!.perPoint.length).toBe(9);
    expect(ridge.diagnostics!.totalSamples).toBe(9);
  });

  it('predictions stay within screen bounds (with margin)', () => {
    const ridge = new RidgeRegression();
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      ridge.addSample(features, [f.targetX * W, f.targetY * H]);
    }
    ridge.train(10);

    for (const f of evalFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      const [px, py] = ridge.predict(features);
      // Allow 50% margin outside screen (webcam gaze can overshoot)
      expect(px).toBeGreaterThan(-W * 0.5);
      expect(px).toBeLessThan(W * 1.5);
      expect(py).toBeGreaterThan(-H * 0.5);
      expect(py).toBeLessThan(H * 1.5);
    }
  });

  it('center eval point predicts near center of screen', () => {
    const ridge = new RidgeRegression();
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const features = extractGazeFeatures(landmarks, undefined)!;
      ridge.addSample(features, [f.targetX * W, f.targetY * H]);
    }
    ridge.train(10);

    const center = evalFrames.find(f => f.label === 'eval-center')!;
    const landmarks = expandToFullLandmarks(center.landmarks);
    const features = extractGazeFeatures(landmarks, undefined)!;
    const [px, py] = ridge.predict(features);

    // Center target = (960, 540). Allow 400px error for webcam-grade tracking.
    expect(Math.abs(px - W / 2)).toBeLessThan(400);
    expect(Math.abs(py - H / 2)).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// FACS emotion from real landmarks
// ---------------------------------------------------------------------------

describe('FACS emotion from real landmarks', () => {
  it('all frames produce valid Action Units', () => {
    for (const f of frames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const aus = extractActionUnits(landmarks);
      expect(aus, `${f.label} should produce AUs`).not.toBeNull();
      for (const [key, val] of Object.entries(aus!)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
        expect(Number.isFinite(val), `${f.label} ${key}`).toBe(true);
      }
    }
  });

  it('emotion classification produces valid Ekman labels', () => {
    const validEmotions = ['joy', 'sadness', 'surprise', 'anger', 'disgust', 'fear', 'neutral'];
    for (const f of frames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const aus = extractActionUnits(landmarks)!;
      const { emotion, confidence } = classifyEmotion(aus);
      expect(validEmotions).toContain(emotion);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('all frames produce consistent emotion across re-runs (deterministic)', () => {
    // Same landmarks → same emotion every time (no randomness in classifier)
    for (const f of calFrames) {
      const landmarks = expandToFullLandmarks(f.landmarks);
      const aus1 = extractActionUnits(landmarks)!;
      const aus2 = extractActionUnits(landmarks)!;
      const r1 = classifyEmotion(aus1);
      const r2 = classifyEmotion(aus2);
      expect(r1.emotion).toBe(r2.emotion);
      expect(r1.confidence).toBe(r2.confidence);
    }
  });
});
