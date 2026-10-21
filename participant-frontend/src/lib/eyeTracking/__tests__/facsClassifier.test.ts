import { describe, it, expect } from 'vitest';
import {
  classifyEmotion,
  aggregateEmotionTimeline,
  downsampleEmotionTimeline,
  createActionUnitEstimator,
  extractActionUnits,
  extractEmotionFromFrame,
} from '../facsClassifier';
import type { ActionUnits, EmotionSample, EkmanEmotion } from '../facsClassifier';
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

function makeSample(
  emotion: EkmanEmotion,
  timestamp: number,
  confidence = 0.8,
  auOverrides: Partial<ActionUnits> = {},
): EmotionSample {
  return {
    timestamp,
    emotion,
    confidence,
    actionUnits: makeAUs(auOverrides),
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
// aggregateEmotionTimeline
// ---------------------------------------------------------------------------

describe('aggregateEmotionTimeline', () => {
  it('empty array returns neutral dominant, empty distribution, 0 confidence', () => {
    const result = aggregateEmotionTimeline([]);
    expect(result.dominantEmotion).toBe('neutral');
    expect(result.distribution).toEqual({});
    expect(result.avgConfidence).toBe(0);
  });

  it('all same emotion returns that emotion as dominant with 100% distribution', () => {
    const samples = [
      makeSample('joy', 0, 0.9),
      makeSample('joy', 100, 0.85),
      makeSample('joy', 200, 0.88),
    ];
    const result = aggregateEmotionTimeline(samples);
    expect(result.dominantEmotion).toBe('joy');
    expect(result.distribution.joy).toBe(100);
    // Other emotions should be 0%
    expect(result.distribution.neutral).toBe(0);
  });

  it('mixed emotions produce correct percentages', () => {
    const samples = [
      makeSample('joy', 0),
      makeSample('joy', 100),
      makeSample('joy', 200),
      makeSample('sadness', 300),
      makeSample('sadness', 400),
    ];
    const result = aggregateEmotionTimeline(samples);
    expect(result.dominantEmotion).toBe('joy');
    expect(result.distribution.joy).toBe(60); // 3/5 * 100
    expect(result.distribution.sadness).toBe(40); // 2/5 * 100
  });

  it('avgConfidence is computed correctly', () => {
    const samples = [
      makeSample('joy', 0, 0.6),
      makeSample('joy', 100, 0.8),
      makeSample('sadness', 200, 1.0),
    ];
    const result = aggregateEmotionTimeline(samples);
    expect(result.avgConfidence).toBeCloseTo(0.8, 5); // (0.6+0.8+1.0)/3
  });

  it('distribution values sum to approximately 100', () => {
    const samples = [
      makeSample('joy', 0),
      makeSample('sadness', 100),
      makeSample('surprise', 200),
      makeSample('anger', 300),
      makeSample('neutral', 400),
      makeSample('neutral', 500),
      makeSample('neutral', 600),
    ];
    const result = aggregateEmotionTimeline(samples);
    const sum = Object.values(result.distribution).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 0);
  });
});

// ---------------------------------------------------------------------------
// downsampleEmotionTimeline
// ---------------------------------------------------------------------------

describe('downsampleEmotionTimeline', () => {
  it('empty array returns empty', () => {
    expect(downsampleEmotionTimeline([])).toEqual([]);
  });

  it('all samples in one bucket returns one output sample', () => {
    const samples = [
      makeSample('joy', 100, 0.7),
      makeSample('joy', 200, 0.9),
      makeSample('sadness', 300, 0.8),
    ];
    const result = downsampleEmotionTimeline(samples, 1000);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(0); // floor(100/1000)*1000 = 0
  });

  it('samples across 3 buckets produce 3 output samples', () => {
    const samples = [
      makeSample('joy', 0, 0.8),
      makeSample('joy', 500, 0.8),
      makeSample('sadness', 1000, 0.9),
      makeSample('sadness', 1500, 0.9),
      makeSample('surprise', 2000, 0.7),
    ];
    const result = downsampleEmotionTimeline(samples, 1000);
    expect(result).toHaveLength(3);
    expect(result[0].timestamp).toBe(0);
    expect(result[1].timestamp).toBe(1000);
    expect(result[2].timestamp).toBe(2000);
  });

  it('dominant emotion per bucket is computed correctly', () => {
    const samples = [
      makeSample('joy', 0),
      makeSample('joy', 100),
      makeSample('sadness', 200),
      // bucket 1000
      makeSample('sadness', 1000),
      makeSample('sadness', 1100),
      makeSample('joy', 1200),
    ];
    const result = downsampleEmotionTimeline(samples, 1000);
    expect(result[0].emotion).toBe('joy');     // 2 joy vs 1 sadness
    expect(result[1].emotion).toBe('sadness');  // 2 sadness vs 1 joy
  });

  it('AU averaging works within a bucket', () => {
    const samples: EmotionSample[] = [
      makeSample('joy', 0, 0.8, { AU6: 0.6 }),
      makeSample('joy', 100, 0.8, { AU6: 0.8 }),
    ];
    const result = downsampleEmotionTimeline(samples, 1000);
    expect(result[0].actionUnits.AU6).toBeCloseTo(0.7, 5); // (0.6+0.8)/2
  });

  it('confidence averaging works within a bucket', () => {
    const samples = [
      makeSample('joy', 0, 0.6),
      makeSample('joy', 100, 1.0),
    ];
    const result = downsampleEmotionTimeline(samples, 1000);
    expect(result[0].confidence).toBeCloseTo(0.8, 5);
  });

  it('uses default 1000ms bucket size', () => {
    const samples = [
      makeSample('joy', 0),
      makeSample('joy', 999),
      makeSample('sadness', 1000),
    ];
    const result = downsampleEmotionTimeline(samples);
    expect(result).toHaveLength(2);
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

// ---------------------------------------------------------------------------
// extractEmotionFromFrame
// ---------------------------------------------------------------------------

describe('extractEmotionFromFrame', () => {
  it('invalid landmarks returns null', () => {
    const landmarks = makeLandmarks({
      133: { x: NaN, y: 0.5 },
    });
    expect(extractEmotionFromFrame(landmarks, 1000)).toBeNull();
  });

  it('valid landmarks returns EmotionSample with correct timestamp', () => {
    const landmarks = makeLandmarks({
      133: { x: 0.35, y: 0.4 },
      362: { x: 0.65, y: 0.4 },
    });
    const result = extractEmotionFromFrame(landmarks, 4200);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(4200);
    expect(result!.emotion).toBeDefined();
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
    expect(result!.actionUnits).toBeDefined();
  });

  it('returned sample has valid EkmanEmotion value', () => {
    const validEmotions: EkmanEmotion[] = ['joy', 'sadness', 'surprise', 'anger', 'disgust', 'fear', 'neutral'];
    const landmarks = makeLandmarks({
      133: { x: 0.35, y: 0.4 },
      362: { x: 0.65, y: 0.4 },
    });
    const result = extractEmotionFromFrame(landmarks, 0);
    expect(result).not.toBeNull();
    expect(validEmotions).toContain(result!.emotion);
  });

  it('short landmark array returns null', () => {
    const short: NormalizedLandmark[] = [];
    expect(extractEmotionFromFrame(short, 0)).toBeNull();
  });
});
