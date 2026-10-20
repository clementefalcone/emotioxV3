/**
 * Eye-tracking library layer for the participant app.
 *
 * - **Detection**: `@mediapipe/tasks-vision` Face Landmarker (browser WASM).
 * - **Gaze mapping**: `RidgeRegression` on engineered features (iris-in-eye, head pose from 4x4 matrix, polynomials, iris×translation crosses).
 * - **Hybrid lab grid** (`hybridZoneGrid`): BlazeGaze 2×2 quadrants on stimulus image for `/eye-tracking-hybrid`.
 *   `EyeTrackingRenderer` uses the same hybrid IDW calibration (`hybridCalibrationField`) for survey fixations. Ridge/MediaPipe utilities remain for experiments.
 */

export {
  MEDIAPIPE_TASKS_VISION_VERSION,
  FACE_LANDMARKER_MODEL_URL,
  getVisionTasksWasmBaseUrl,
  DEFAULT_CALIBRATION_POINTS,
  CALIBRATION_VIEWPORT_TOP_INSET_PX,
  calibrationPercentToScreenTarget,
  clampViewportClientCoords,
  DEFAULT_FRAMES_PER_POINT,
  DEFAULT_CAPTURE_INTERVAL_MS,
  MIN_IRIS_LANDMARK_VISIBILITY,
  MIN_IRIS_LANDMARK_PASS_COUNT,
  MIN_IRIS_CENTER_VISIBILITY,
  GAZE_FEATURE_DIMENSION,
  DEFAULT_RIDGE_LAMBDA,
  LANDMARK_INDICES,
} from './constants';

export type { NormalizedLandmark } from './types';

export { extractGazeFeatures, averageFeatureVectors } from './featureExtraction';

export { parseFacialTransformationMatrix } from './headPose';

export { RidgeRegression } from './ridgeRegression';

export { OneEuroFilter1D } from './oneEuroFilter';

export { createFaceLandmarker } from './faceLandmarker';

export {
    HYBRID_CALIBRATION_FIELD_STRENGTH,
    HYBRID_CALIB_CONFIDENCE_K,
    hybridApplyCalibrationField,
    hybridCalibrationRmsePx,
    hybridResidualsFromTrainedPoints,
    hybridCalibrationConfidenceWeightUv,
    MICRO_RECALIB_INTERVAL_MS,
    MICRO_RECALIB_SAMPLE_DURATION_MS,
    MICRO_RECALIB_SAMPLE_COUNT,
    MICRO_RECALIB_POSITIONS,
    computeMicroRecalibResidual,
} from './hybridCalibrationField';

export type { HybridCalibrationResidual } from './hybridCalibrationField';

export {
  HYBRID_GRID_SIZE,
  HYBRID_AOI_GRID,
  HYBRID_NOISE_THRESHOLD_PCT,
  HYBRID_EDGE_STRETCH_X,
  HYBRID_EDGE_STRETCH_Y,
  HYBRID_LEFT_HALF_VERTICAL_STRETCH_MULT,
  HYBRID_EDGE_LEFT_HALF_FACTOR,
  HYBRID_EDGE_RIGHT_HALF_FACTOR,
  HYBRID_EDGE_TOP_OUTER_FACTOR,
  HYBRID_EDGE_BOTTOM_OUTER_FACTOR,
  HYBRID_ZONE_ROW_BIAS,
  HYBRID_ZONE_COL_BIAS,
  HYBRID_ZONE_VOTE_HISTORY,
  HYBRID_ZONE_VOTE_LEAD_MIN,
  HYBRID_ZONE_SAMPLE_MS,
  HYBRID_FIXATION_DWELL_MS,
  HYBRID_IMAGE_CALIBRATION_POINTS,
  hybridImagePercentToBlazeNorm,
    hybridStretchFromCenter01,
    hybridStretchFromCenter01MiddleSoft,
    hybridViewportToStretched01,
    hybridPointToZone,
    hybridPointToSoftZoneWeights,
    hybridModeZoneFromHistory,
    hybridHeatColor,
} from './hybridZoneGrid';

export type { HybridZoneMeta } from './hybridZoneGrid';

export {
    HYBRID_GAP_FILL_MAX_MS,
    HYBRID_GAP_FILL_STEP_MS,
    HYBRID_GAP_FILL_MIN_SEGMENT_MS,
    HYBRID_GAP_FILL_SYNTHETIC_WEIGHT,
    hybridMinimumJerkPositive01,
    expandGazeWithMinimumJerkGapFill,
} from './gazeGapFill';

export type { HybridGazeSample } from './gazeGapFill';

export {
    BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS,
    BLAZE_GAZE_CAPTURE_SHORT_EDGE_WARN_PX,
    isBlazeGazeCaptureResolutionLow,
} from './blazeCameraConstraints';

export {
    IDT_DEFAULT_DISPERSION_THRESHOLD_PX,
    IDT_DEFAULT_MIN_DURATION_MS,
    IDT_MAX_SAMPLE_GAP_MS,
    detectFixationsIDT,
    mapFixationsToImageCoords,
} from './fixationDetector';

export type { GazeSample, DetectedFixation } from './fixationDetector';

export {
  extractActionUnits,
  extractActionUnitsFrom68,
  classifyEmotion,
  extractEmotionFromFrame,
  aggregateEmotionTimeline,
  downsampleEmotionTimeline,
} from './facsClassifier';

export type {
  ActionUnits,
  EmotionSample,
  EkmanEmotion,
} from './facsClassifier';

export { detectMicroExpressions } from './microExpressionDetector';
export type { MicroExpression } from './microExpressionDetector';

export { RuntimeQualityMonitor } from './runtimeQualityMonitor';
export type { RuntimeQualityCallbacks, RuntimeQualityConfig } from './runtimeQualityMonitor';

export {
    detectDeviceType,
    getProfileForDevice,
    getProfileFromUA,
    getCurrentDeviceProfile,
} from './deviceProfile';
export type { DeviceType, DeviceProfile } from './deviceProfile';
