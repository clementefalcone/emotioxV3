import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** FACS Action Units detected per frame. Values are intensity [0–1]. */
export interface ActionUnits {
  /** Inner brow raiser */
  AU1: number;
  /** Outer brow raiser */
  AU2: number;
  /** Brow lowerer */
  AU4: number;
  /** Cheek raiser */
  AU6: number;
  /** Lip corner puller */
  AU12: number;
  /** Lip corner depressor */
  AU15: number;
  /** Lip stretcher */
  AU20: number;
  /** Lips part */
  AU25: number;
  /** Jaw drop */
  AU26: number;
}

/** Single emotion sample collected during viewing. */
export interface EmotionSample {
  /** Milliseconds from viewing start */
  timestamp: number;
  /** Dominant emotion label */
  emotion: EkmanEmotion;
  /** Classification confidence [0–1] */
  confidence: number;
  /** Underlying Action Unit intensities */
  actionUnits: ActionUnits;
}

/** Ekman basic emotions + neutral */
export type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

// ---------------------------------------------------------------------------
// MediaPipe 468 landmark indices — FACS-relevant points
// ---------------------------------------------------------------------------

const FACE_LANDMARKS = {
  // Eyebrows
  leftInnerBrow: 107,
  leftMidBrow: 105,
  leftOuterBrow: 229,
  rightInnerBrow: 336,
  rightMidBrow: 334,
  rightOuterBrow: 449,

  // Eyes
  leftEyeInner: 133,
  leftEyeOuter: 33,
  leftEyeTop: 159,
  leftEyeBottom: 145,
  leftEyeUpperLid1: 160,
  leftEyeUpperLid2: 161,
  leftEyeLowerLid1: 163,
  leftEyeLowerLid2: 144,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  rightEyeUpperLid1: 387,
  rightEyeUpperLid2: 388,
  rightEyeLowerLid1: 390,
  rightEyeLowerLid2: 373,

  // Nose
  noseTip: 1,
  noseBottom: 2,
  noseLeft: 122,
  noseRight: 351,

  // Mouth
  mouthLeft: 61,
  mouthRight: 291,
  mouthUpperLipTop: 0,
  mouthUpperLipBottom: 13,
  mouthLowerLipTop: 14,
  mouthLowerLipBottom: 17,
  mouthCenterUpper: 308,
  mouthCenterLower: 17,

  // Chin/Jaw
  chinBottom: 152,
  jawLeft: 234,
  jawRight: 454,
} as const;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two landmarks (in normalized space). */
function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Check if all required landmarks have finite coordinates. */
function hasFiniteCoords(landmarks: NormalizedLandmark[], indices: number[]): boolean {
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return false;
  }
  return true;
}

/** Reference distance (used for normalization). Eye-to-eye distance is stable. */
function refDist(landmarks: NormalizedLandmark[]): number {
  const leftEye = landmarks[FACE_LANDMARKS.leftEyeInner];
  const rightEye = landmarks[FACE_LANDMARKS.rightEyeInner];
  return dist(leftEye, rightEye) || 1e-5;
}

// ---------------------------------------------------------------------------
// Action Unit extraction
// ---------------------------------------------------------------------------

/**
 * Extract FACS Action Units from MediaPipe 468 landmarks.
 * All AU intensities are normalized to [0, 1].
 *
 * Reference: "FACS Investigator's Guide" — Ekman & Friesen
 * AU thresholds are calibrated on neutral baseline proportions.
 */
export function extractActionUnits(landmarks: NormalizedLandmark[]): ActionUnits | null {
  // Required landmarks for AU computation
  const requiredIndices = [
    FACE_LANDMARKS.leftInnerBrow, FACE_LANDMARKS.leftMidBrow, FACE_LANDMARKS.leftOuterBrow,
    FACE_LANDMARKS.rightInnerBrow, FACE_LANDMARKS.rightMidBrow, FACE_LANDMARKS.rightOuterBrow,
    FACE_LANDMARKS.leftEyeInner, FACE_LANDMARKS.leftEyeOuter,
    FACE_LANDMARKS.leftEyeTop, FACE_LANDMARKS.leftEyeBottom,
    FACE_LANDMARKS.rightEyeInner, FACE_LANDMARKS.rightEyeOuter,
    FACE_LANDMARKS.rightEyeTop, FACE_LANDMARKS.rightEyeBottom,
    FACE_LANDMARKS.noseTip, FACE_LANDMARKS.noseBottom,
    FACE_LANDMARKS.mouthLeft, FACE_LANDMARKS.mouthRight,
    FACE_LANDMARKS.mouthUpperLipTop, FACE_LANDMARKS.mouthUpperLipBottom,
    FACE_LANDMARKS.mouthLowerLipTop, FACE_LANDMARKS.mouthLowerLipBottom,
    FACE_LANDMARKS.chinBottom,
  ];

  if (!hasFiniteCoords(landmarks, requiredIndices)) return null;

  const rd = refDist(landmarks);

  // --- AU1 + AU2: Brow raiser (inner + outer) ---
  // Distance from brow to eye increases when brows raise
  const leftInnerBrow = landmarks[FACE_LANDMARKS.leftInnerBrow];
  const leftOuterBrow = landmarks[FACE_LANDMARKS.leftOuterBrow];
  const leftEyeTop = landmarks[FACE_LANDMARKS.leftEyeTop];
  const leftEyeBottom = landmarks[FACE_LANDMARKS.leftEyeBottom];
  const rightInnerBrow = landmarks[FACE_LANDMARKS.rightInnerBrow];
  const rightOuterBrow = landmarks[FACE_LANDMARKS.rightOuterBrow];
  const rightEyeTop = landmarks[FACE_LANDMARKS.rightEyeTop];
  const rightEyeBottom = landmarks[FACE_LANDMARKS.rightEyeBottom];

  // Vertical brow-to-eye distance (normalized)
  const leftBrowEyeDistL = dist(leftInnerBrow, leftEyeTop) / rd;
  const rightBrowEyeDistL = dist(rightInnerBrow, rightEyeTop) / rd;
  const leftBrowEyeDistR = dist(leftOuterBrow, leftEyeTop) / rd;
  const rightBrowEyeDistR = dist(rightOuterBrow, rightEyeTop) / rd;

  // Baseline: ~0.35 (neutral). Above 0.42 = AU1/AU2 active
  const neutralBrowEyeDist = 0.35;
  const au1Intensity = clamp(
    ((leftBrowEyeDistL + rightBrowEyeDistL) / 2 - neutralBrowEyeDist) / 0.15,
  );
  const au2Intensity = clamp(
    ((leftBrowEyeDistR + rightBrowEyeDistR) / 2 - neutralBrowEyeDist) / 0.15,
  );

  // --- AU4: Brow lowerer ---
  // Brows move closer to eyes + inner brows converge
  const leftMidBrow = landmarks[FACE_LANDMARKS.leftMidBrow];
  const rightMidBrow = landmarks[FACE_LANDMARKS.rightMidBrow];
  const browConvergence = dist(leftMidBrow, rightMidBrow) / rd;

  // Neutral brow convergence ~0.75. Below 0.65 = AU4
  const neutralConvergence = 0.75;
  const au4Intensity = clamp(
    (neutralConvergence - browConvergence) / 0.15,
  );

  // --- AU6: Cheek raiser ---
  // Lower eyelid rises, cheek pushes up
  const eyeHeightL = dist(leftEyeTop, leftEyeBottom) / rd;
  const eyeHeightR = dist(rightEyeTop, rightEyeBottom) / rd;
  // AU6: eye aperture decreases slightly + cheek raises
  // Use reduced eye height as proxy (squinting)
  const neutralEyeHeight = 0.12;
  const au6Intensity = clamp(
    (neutralEyeHeight - (eyeHeightL + eyeHeightR) / 2) / 0.06,
  );

  // --- AU12: Lip corner puller (smile) ---
  // Mouth width increases, lip corners move laterally
  const mouthLeft = landmarks[FACE_LANDMARKS.mouthLeft];
  const mouthRight = landmarks[FACE_LANDMARKS.mouthRight];
  const mouthWidth = dist(mouthLeft, mouthRight) / rd;

  const mouthUpperTop = landmarks[FACE_LANDMARKS.mouthUpperLipTop];
  const mouthLowerBottom = landmarks[FACE_LANDMARKS.mouthLowerLipBottom];
  const mouthHeight = dist(mouthUpperTop, mouthLowerBottom) / rd;

  // Neutral mouth width ~0.50. AU12 activates above 0.58
  const neutralMouthWidth = 0.50;
  const au12Intensity = clamp((mouthWidth - neutralMouthWidth) / 0.20);

  // --- AU15: Lip corner depressor ---
  // Lip corners pulled down (sad mouth)
  const mouthCenterLower = landmarks[FACE_LANDMARKS.mouthCenterLower];
  const chinBottom = landmarks[FACE_LANDMARKS.chinBottom];

  // Distance from mouth center to chin increases when lips are pulled down
  const mouthChinDist = dist(mouthCenterLower, chinBottom) / rd;
  const neutralMouthChin = 0.55;
  const au15Intensity = clamp((mouthChinDist - neutralMouthChin) / 0.15);

  // --- AU20: Lip stretcher ---
  // Mouth opens horizontally, lips stretch
  const au20Intensity = clamp(
    (mouthWidth - neutralMouthWidth) / 0.25, // weaker threshold than AU12
  );

  // --- AU25: Lips part ---
  // Mouth opens (vertical gap)
  const neutralMouthHeight = 0.03;
  const au25Intensity = clamp((mouthHeight - neutralMouthHeight) / 0.08);

  // --- AU26: Jaw drop ---
  // Jaw lowers, chin moves down
  const noseBottom = landmarks[FACE_LANDMARKS.noseBottom];
  const noseChinDist = dist(noseBottom, chinBottom) / rd;
  const neutralNoseChin = 0.90;
  const au26Intensity = clamp((noseChinDist - neutralNoseChin) / 0.20);

  return {
    AU1: au1Intensity,
    AU2: au2Intensity,
    AU4: au4Intensity,
    AU6: au6Intensity,
    AU12: au12Intensity,
    AU15: au15Intensity,
    AU20: au20Intensity,
    AU25: au25Intensity,
    AU26: au26Intensity,
  };
}

// ---------------------------------------------------------------------------
// AU → Emotion mapping (Ekman + neutral)
// ---------------------------------------------------------------------------

/**
 * Maps Action Unit intensities to Ekman emotions.
 * Based on established FACS emotion combinations:
 * - Joy: AU6 + AU12
 * - Sadness: AU1 + AU4 + AU15
 * - Surprise: AU1 + AU2 + AU5 + AU26
 * - Anger: AU4 + AU5 + AU7 + AU23
 * - Disgust: AU9 + AU15 + AU16
 * - Fear: AU1 + AU2 + AU4 + AU5 + AU20
 *
 * We use available AUs and best-fit approximation.
 */
export function classifyEmotion(
  aus: ActionUnits,
): { emotion: EkmanEmotion; confidence: number } {
  const { AU1, AU2, AU4, AU6, AU12, AU15, AU20, AU25, AU26 } = aus;

  // Score each emotion from AU combinations (weighted sum)
  const scores: Record<EkmanEmotion, number> = {
    joy: AU6 * 0.6 + AU12 * 0.4,
    sadness: AU1 * 0.2 + AU4 * 0.3 + AU15 * 0.5,
    surprise: AU1 * 0.25 + AU2 * 0.25 + AU25 * 0.2 + AU26 * 0.3,
    anger: AU4 * 0.6 + AU20 * 0.2 + AU25 * 0.2,
    disgust: AU15 * 0.5 + AU20 * 0.3 + AU4 * 0.2,
    fear: AU1 * 0.2 + AU2 * 0.15 + AU4 * 0.35 + AU20 * 0.2 + AU25 * 0.1,
    neutral: 0,
  };

  // Neutral baseline: all AUs low → neutral wins
  const maxAU = Math.max(AU1, AU2, AU4, AU6, AU12, AU15, AU20, AU25, AU26);
  scores.neutral = maxAU < 0.15 ? 1.0 - maxAU : 0.1;

  // Find dominant emotion
  let bestEmotion: EkmanEmotion = 'neutral';
  let bestScore = scores.neutral;
  for (const [emotion, score] of Object.entries(scores) as [EkmanEmotion, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestEmotion = emotion;
    }
  }

  // Confidence = margin over second best, normalized
  const allScores = Object.values(scores);
  const sorted = [...allScores].sort((a, b) => b - a);
  const margin = sorted.length > 1 ? sorted[0] - sorted[1] : 1;
  const confidence = clamp(bestScore * (0.5 + margin * 0.5));

  return { emotion: bestEmotion, confidence };
}

// ---------------------------------------------------------------------------
// High-level API
// ---------------------------------------------------------------------------

/**
 * Extract Action Units and classify emotion from a single frame's landmarks.
 * @param landmarks - MediaPipe 468 landmarks for one face
 * @param timestamp - Milliseconds from viewing start
 * @returns Emotion sample or null if landmarks are invalid
 */
export function extractEmotionFromFrame(
  landmarks: NormalizedLandmark[],
  timestamp: number,
): EmotionSample | null {
  const aus = extractActionUnits(landmarks);
  if (!aus) return null;

  const { emotion, confidence } = classifyEmotion(aus);

  return {
    timestamp,
    emotion,
    confidence,
    actionUnits: aus,
  };
}

// ---------------------------------------------------------------------------
// Aggregation utilities (for backend/frontend)
// ---------------------------------------------------------------------------

/** Compute dominant emotion and distribution from a timeline of samples. */
export function aggregateEmotionTimeline(samples: EmotionSample[]) {
  if (samples.length === 0) {
    return {
      dominantEmotion: 'neutral' as EkmanEmotion,
      distribution: {} as Record<EkmanEmotion, number>,
      avgConfidence: 0,
    };
  }

  const counts: Record<EkmanEmotion, number> = {
    joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0,
  };
  let totalConfidence = 0;

  for (const s of samples) {
    counts[s.emotion]++;
    totalConfidence += s.confidence;
  }

  const total = samples.length;
  const distribution = {} as Record<EkmanEmotion, number>;
  for (const [emotion, count] of Object.entries(counts)) {
    distribution[emotion as EkmanEmotion] = Math.round((count / total) * 10000) / 100;
  }

  const dominantEmotion = Object.entries(counts).reduce(
    (best, [emotion, count]) => (count > best.count ? { emotion: emotion as EkmanEmotion, count } : best),
    { emotion: 'neutral' as EkmanEmotion, count: 0 },
  ).emotion;

  return {
    dominantEmotion,
    distribution,
    avgConfidence: totalConfidence / total,
  };
}

/**
 * Build a downsampled timeline (reduces 50ms samples to ~1s buckets for display).
 */
export function downsampleEmotionTimeline(
  samples: EmotionSample[],
  bucketMs: number = 1000,
): EmotionSample[] {
  if (samples.length === 0) return [];

  const buckets = new Map<number, EmotionSample[]>();
  for (const s of samples) {
    const bucketKey = Math.floor(s.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey)!.push(s);
  }

  const result: EmotionSample[] = [];
  for (const [timestamp, bucketSamples] of buckets.entries()) {
    // Dominant emotion in bucket
    const counts: Record<string, number> = {};
    for (const s of bucketSamples) {
      counts[s.emotion] = (counts[s.emotion] || 0) + 1;
    }
    const dominantEmotion = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as EkmanEmotion;
    const avgConfidence = bucketSamples.reduce((sum, s) => sum + s.confidence, 0) / bucketSamples.length;
    const avgAUs: ActionUnits = {
      AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU20: 0, AU25: 0, AU26: 0,
    };
    for (const s of bucketSamples) {
      for (const key of Object.keys(avgAUs) as (keyof ActionUnits)[]) {
        avgAUs[key] += s.actionUnits[key];
      }
    }
    for (const key of Object.keys(avgAUs) as (keyof ActionUnits)[]) {
      avgAUs[key] /= bucketSamples.length;
    }

    result.push({
      timestamp,
      emotion: dominantEmotion,
      confidence: avgConfidence,
      actionUnits: avgAUs,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// face-api.js 68-landmark AU extraction
// ---------------------------------------------------------------------------

interface Point2D {
  x: number;
  y: number;
}

interface FaceMeasures {
  innerBrowHeight: number;
  outerBrowHeight: number;
  browGap: number;
  eyeOpening: number;
  mouthWidth: number;
  cornerLift: number;
  lipGap: number;
  jawDrop: number;
}

interface ActionUnitRule {
  measure: keyof FaceMeasures;
  direction: 1 | -1;
  fullScale: number;
}

const ACTION_UNIT_BASELINE_SAMPLES = 10;

const ACTION_UNIT_RULES: Record<keyof ActionUnits, ActionUnitRule> = {
  AU1: { measure: 'innerBrowHeight', direction: 1, fullScale: 0.15 },
  AU2: { measure: 'outerBrowHeight', direction: 1, fullScale: 0.15 },
  AU4: { measure: 'browGap', direction: -1, fullScale: 0.10 },
  AU6: { measure: 'eyeOpening', direction: -1, fullScale: 0.06 },
  AU12: { measure: 'cornerLift', direction: 1, fullScale: 0.15 },
  AU15: { measure: 'cornerLift', direction: -1, fullScale: 0.10 },
  AU20: { measure: 'mouthWidth', direction: 1, fullScale: 0.25 },
  AU25: { measure: 'lipGap', direction: 1, fullScale: 0.15 },
  AU26: { measure: 'jawDrop', direction: 1, fullScale: 0.30 },
};

function measureFace68(points: Point2D[]): FaceMeasures | null {
  if (!points || points.length < 68) return null;
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  const reference = distance(39, 42);
  if (reference <= 0) return null;
  const meanY = (...indices: number[]) => indices.reduce((sum, index) => sum + points[index].y, 0) / indices.length;
  return {
    innerBrowHeight: (distance(21, 39) + distance(22, 42)) / 2 / reference,
    outerBrowHeight: (distance(17, 36) + distance(26, 45)) / 2 / reference,
    browGap: distance(21, 22) / reference,
    eyeOpening: (distance(37, 41) + distance(38, 40) + distance(43, 47) + distance(44, 46)) / 4 / reference,
    mouthWidth: distance(48, 54) / reference,
    cornerLift: (meanY(62, 66) - meanY(48, 54)) / reference,
    lipGap: distance(62, 66) / reference,
    jawDrop: distance(33, 8) / reference,
  };
}

function medianMeasures(samples: readonly FaceMeasures[]): FaceMeasures {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const keys = Object.keys(samples[0]) as (keyof FaceMeasures)[];
  return Object.fromEntries(keys.map(key => [key, median(samples.map(sample => sample[key]))])) as unknown as FaceMeasures;
}

export function createActionUnitEstimator(): (points: Point2D[]) => ActionUnits | null {
  const baselineSamples: FaceMeasures[] = [];
  return points => {
    const measures = measureFace68(points);
    if (!measures) return null;
    if (baselineSamples.length < ACTION_UNIT_BASELINE_SAMPLES) baselineSamples.push(measures);
    const baseline = medianMeasures(baselineSamples);
    const units = Object.fromEntries(
      Object.entries(ACTION_UNIT_RULES).map(([unit, rule]) => [
        unit,
        clamp(rule.direction * (measures[rule.measure] - baseline[rule.measure]) / rule.fullScale),
      ]),
    ) as unknown as ActionUnits;
    return { ...units, AU20: units.AU20 * (1 - units.AU12) };
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
