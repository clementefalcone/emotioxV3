/**
 * Eye tracking stack: Google MediaPipe Tasks Vision (Face Landmarker) + ridge regression for gaze.
 * Keep MEDIAPIPE_TASKS_VISION_VERSION in sync with `dependencies["@mediapipe/tasks-vision"]` in package.json.
 */
export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.32';

/** Face Landmarker model (float16) from Google-hosted bucket */
export const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * WASM bundle for Vision tasks — pinned to the same major/minor/patch as the npm package.
 */
export function getVisionTasksWasmBaseUrl(): string {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
}

/** 9 calibration points as viewport percentages (x%, y%) */
export const DEFAULT_CALIBRATION_POINTS: [number, number][] = [
  [10, 10],
  [50, 10],
  [90, 10],
  [10, 50],
  [50, 50],
  [90, 50],
  [10, 90],
  [50, 90],
  [90, 90],
];

/**
 * Pixels reserved at top of viewport when mapping calibration % to Y (research lab header bar).
 * Participant app uses 0 so the full viewport height is used.
 */
export const CALIBRATION_VIEWPORT_TOP_INSET_PX = 0;

/**
 * Maps calibration percentages (0–100) to screen pixel targets for ridge regression.
 * Y uses the band below {@link CALIBRATION_VIEWPORT_TOP_INSET_PX}.
 * @param pctX - Horizontal percentage of viewport width
 * @param pctY - Vertical percentage of usable height below top inset
 * @returns Screen coordinates in CSS pixels
 */
export function calibrationPercentToScreenTarget(pctX: number, pctY: number): [number, number] {
  const inset = CALIBRATION_VIEWPORT_TOP_INSET_PX;
  const screenX = (pctX / 100) * window.innerWidth;
  const screenY = inset + (pctY / 100) * (window.innerHeight - inset);
  return [screenX, screenY];
}

/**
 * Clamps a viewport click to valid CSS pixel coordinates for ridge targets and gaze overlay.
 * @param clientX - Pointer X from a mouse/touch event
 * @param clientY - Pointer Y from a mouse/touch event
 * @returns Clamped [x, y]
 */
export function clampViewportClientCoords(clientX: number, clientY: number): [number, number] {
  return [
    Math.max(0, Math.min(window.innerWidth, clientX)),
    Math.max(0, Math.min(window.innerHeight, clientY)),
  ];
}

export const DEFAULT_FRAMES_PER_POINT = 15;
export const DEFAULT_CAPTURE_INTERVAL_MS = 40;

/**
 * Minimum MediaPipe landmark visibility [0–1] per point. Webcams and side lighting often score below 0.35 on some eye points.
 */
export const MIN_IRIS_LANDMARK_VISIBILITY = 0.18;

/**
 * How many of the iris + eye-contour points must meet {@link MIN_IRIS_LANDMARK_VISIBILITY} (rest can be weaker/occluded).
 */
export const MIN_IRIS_LANDMARK_PASS_COUNT = 9;

/**
 * Stricter floor for the two iris center landmarks (468, 473); ratios depend on them.
 * Kept low so side lighting / webcams still pass when coords are stable.
 */
export const MIN_IRIS_CENTER_VISIBILITY = 0.08;

/**
 * MediaPipe gaze-direction blendshapes appended to the features, in this order.
 * They carry the vertical gaze signal that iris-vs-eyelid ratios lose (the lids follow the eye).
 */
export const EYE_LOOK_BLENDSHAPES = [
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
] as const;

/**
 * Length of the numeric vector returned by `extractGazeFeatures` (before ridge bias term).
 * 28 = 8 iris/vergence (IPD-normalized) + 9 rotation + 3 translation + 8 eyeLook blendshapes.
 */
export const GAZE_FEATURE_DIMENSION = 28;

/**
 * Ridge regularization strength. With z-score normalized features (unit variance),
 * higher λ = smoother weights = less jitter, at cost of slightly higher bias.
 * λ=1 gave the lowest leave-one-point-out error on a replayed 13-point session (172 px vs 238 px at λ=10).
 */
export const DEFAULT_RIDGE_LAMBDA = 1;

/** MediaPipe Face Landmarker landmark indices used for gaze features */
export const LANDMARK_INDICES = {
  leftIrisCenter: 468,
  rightIrisCenter: 473,
  leftEyeInner: 133,
  leftEyeOuter: 33,
  leftEyeTop: 159,
  leftEyeBottom: 145,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  noseTip: 1,
} as const;
