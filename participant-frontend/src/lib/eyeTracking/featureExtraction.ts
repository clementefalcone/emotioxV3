import type { Category, Matrix, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { EYE_LOOK_BLENDSHAPES, GAZE_FEATURE_DIMENSION, LANDMARK_INDICES } from './constants';
import { parseFacialTransformationMatrix } from './headPose';

/** Normalized eye box span below this is treated as degenerate (extreme pose or bad frame). */
const MIN_EYE_AXIS_SPAN = 1e-5;

const IRIS_VISIBILITY_INDICES: readonly number[] = [
  LANDMARK_INDICES.leftIrisCenter,
  LANDMARK_INDICES.rightIrisCenter,
  LANDMARK_INDICES.leftEyeInner,
  LANDMARK_INDICES.leftEyeOuter,
  LANDMARK_INDICES.leftEyeTop,
  LANDMARK_INDICES.leftEyeBottom,
  LANDMARK_INDICES.rightEyeInner,
  LANDMARK_INDICES.rightEyeOuter,
  LANDMARK_INDICES.rightEyeTop,
  LANDMARK_INDICES.rightEyeBottom,
];

/**
 * True when iris + eye contour points exist with finite coords. Visibility is ignored: MediaPipe often sets visibility to 0 on webcams while x/y are still usable.
 * @param landmarks - One face's normalized landmarks
 * @returns Whether all required indices are present
 */
function irisLandmarksHaveFiniteCoords(landmarks: NormalizedLandmark[]): boolean {
  for (const i of IRIS_VISIBILITY_INDICES) {
    const lm = landmarks[i];
    if (lm === undefined || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
      return false;
    }
  }
  return true;
}

/**
 * Approximate head pose when MediaPipe omits or invalidates the 4x4 facial matrix (identity rotation + nose-centered translation).
 * @param landmarks - One face's normalized landmarks
 * @returns Rotation (9) and translation (3) compatible with ridge features
 */
function buildFallbackHeadPose(landmarks: NormalizedLandmark[]): {
  rotationRowMajor: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  translation: [number, number, number];
} {
  const nose = landmarks[LANDMARK_INDICES.noseTip];
  const tx = nose ? nose.x - 0.5 : 0;
  const ty = nose ? nose.y - 0.5 : 0;
  const tz = 0;
  return {
    rotationRowMajor: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    translation: [tx, ty, tz],
  };
}

/**
 * Builds the gaze feature vector: iris-in-eye ratios, head pose from facial transform, and MediaPipe eyeLook blendshapes.
 * Head pose uses the 4x4 matrix from MediaPipe (explicit rotation + translation) so the ridge mapper can separate gaze from head motion.
 * @param landmarks - Normalized landmarks for one face
 * @param facialMatrix - Optional 4x4 from `facialTransformationMatrixes[0]`; if missing or invalid, a nose-based fallback is used
 * @param blendshapes - `faceBlendshapes[0].categories`; required, the eyeLook scores carry the vertical gaze signal
 * @returns Fixed-length feature vector, or null if geometry, visibility or blendshapes are unusable
 */
export function extractGazeFeatures(
  landmarks: NormalizedLandmark[],
  facialMatrix: Matrix | undefined | null,
  blendshapes: Category[] | undefined,
): number[] | null {
  const {
    leftIrisCenter: LI,
    rightIrisCenter: RI,
    leftEyeInner,
    leftEyeOuter,
    leftEyeTop,
    leftEyeBottom,
    rightEyeInner,
    rightEyeOuter,
    rightEyeTop,
    rightEyeBottom,
  } = LANDMARK_INDICES;

  if (landmarks.length < RI + 1) {
    return null;
  }

  if (!irisLandmarksHaveFiniteCoords(landmarks)) {
    return null;
  }

  const scoreByName = new Map((blendshapes ?? []).map((category) => [category.categoryName, category.score]));
  const eyeLook = EYE_LOOK_BLENDSHAPES.map((name) => scoreByName.get(name));
  if (eyeLook.some((score) => score === undefined)) {
    return null;
  }

  let head = facialMatrix ? parseFacialTransformationMatrix(facialMatrix) : null;
  if (!head) {
    head = buildFallbackHeadPose(landmarks);
  }

  const leftIris = landmarks[LI];
  const rightIris = landmarks[RI];
  const leftInner = landmarks[leftEyeInner];
  const leftOuter = landmarks[leftEyeOuter];
  const leftTop = landmarks[leftEyeTop];
  const leftBottom = landmarks[leftEyeBottom];
  const rightInner = landmarks[rightEyeInner];
  const rightOuter = landmarks[rightEyeOuter];
  const rightTop = landmarks[rightEyeTop];
  const rightBottom = landmarks[rightEyeBottom];

  // Eye center = midpoint of inner and outer corners
  const leftCenterX = (leftInner.x + leftOuter.x) / 2;
  const leftCenterY = (leftTop.y + leftBottom.y) / 2;
  const rightCenterX = (rightInner.x + rightOuter.x) / 2;
  const rightCenterY = (rightTop.y + rightBottom.y) / 2;

  // Inter-pupilar distance as stable normalization scale (changes little vs eye aperture)
  const ipd = Math.sqrt(
    (rightCenterX - leftCenterX) ** 2 + (rightCenterY - leftCenterY) ** 2,
  );

  if (ipd < MIN_EYE_AXIS_SPAN) {
    return null;
  }

  // Iris displacement from eye center, normalized by IPD.
  // Centered around 0 (gaze straight ahead), range ~[-0.15, +0.15].
  // Using IPD instead of per-eye width eliminates:
  //   - Eyelid aperture contamination in Y
  //   - Perspective asymmetry between near/far eye
  const lrx = (leftIris.x - leftCenterX) / ipd;
  const lry = (leftIris.y - leftCenterY) / ipd;
  const rrx = (rightIris.x - rightCenterX) / ipd;
  const rry = (rightIris.y - rightCenterY) / ipd;

  const avgRx = (lrx + rrx) / 2;
  const avgRy = (lry + rry) / 2;

  // Vergence: difference between left and right iris displacement.
  // Captures depth-dependent eye convergence that a single average misses.
  const vergX = lrx - rrx;
  const vergY = lry - rry;

  const [tx, ty, tz] = head.translation;
  const R = head.rotationRowMajor;

  const out: number[] = [
    // Gaze direction (IPD-normalized, centered at 0)
    avgRx,        // horizontal gaze: negative = left, positive = right
    avgRy,        // vertical gaze: negative = up, positive = down
    // Per-eye iris displacement (for asymmetric gaze / head turn)
    lrx, lry,
    rrx, rry,
    // Vergence (convergence signal — useful for near/far targets)
    vergX, vergY,
    // Head pose (rotation matrix — 9 values)
    ...R,
    // Head position (translation — distance/position)
    tx, ty, tz,
    // MediaPipe eyeLook blendshapes (vertical gaze signal)
    ...(eyeLook as number[]),
  ];

  // 8 iris/vergence + 9 rotation + 3 translation + 8 eyeLook = 28
  if (out.length !== GAZE_FEATURE_DIMENSION) {
    return null;
  }

  return out;
}

/**
 * Element-wise average of multiple feature vectors (same length).
 * @param featureSets - Non-empty list of same-length vectors
 * @returns Averaged vector
 */
export function averageFeatureVectors(featureSets: number[][]): number[] {
  const n = featureSets[0].length;
  const avg = new Array(n).fill(0);
  for (const f of featureSets) {
    for (let i = 0; i < n; i++) avg[i] += f[i];
  }
  const count = featureSets.length;
  for (let i = 0; i < n; i++) avg[i] /= count;
  return avg;
}
