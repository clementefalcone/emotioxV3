/**
 * GazePredictor — common interface for gaze mapping strategies.
 *
 * Any predictor must:
 *   1. Accept calibration samples (features/crops → screen coords)
 *   2. Train/fit from those samples
 *   3. Predict screen coords from new input
 *
 * Implementations:
 *   - RidgeGazePredictor: linear ridge on engineered features (current baseline)
 *   - OnnxGazePredictor: appearance-based CNN via onnxruntime-web (planned)
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** Input to the predictor — features or image crops depending on implementation. */
export interface GazePredictorInput {
  /** Engineered feature vector (for Ridge). */
  features?: number[];
  /** Left eye crop as ImageData (for ONNX appearance model). */
  leftEyeCrop?: ImageData;
  /** Right eye crop as ImageData (for ONNX appearance model). */
  rightEyeCrop?: ImageData;
  /** Face crop as ImageData (for ONNX appearance model). */
  faceCrop?: ImageData;
  /** Head pose angles in degrees [pitch, yaw, roll]. */
  headPose?: [number, number, number];
  /** Face grid: binary mask indicating face position in frame (for iTracker-style). */
  faceGrid?: number[];
}

export interface GazePredictor {
  /** Unique identifier for this predictor type. */
  readonly name: string;

  /** Add one calibration sample: input observed when user looked at target. */
  addCalibrationSample(input: GazePredictorInput, target: [number, number]): void;

  /** Fit the model from collected calibration samples. May be async (ONNX fine-tuning). */
  train(): Promise<void>;

  /** Predict screen coordinates from current input. Returns [x, y] in viewport px. */
  predict(input: GazePredictorInput): [number, number];

  /** Whether the model is trained and ready for prediction. */
  isReady(): boolean;

  /** Number of calibration samples collected. */
  readonly sampleCount: number;

  /** LOOCV RMSE from last train(), if available. */
  readonly cvRmsePx: number | null;

  /** Per-point diagnostics from last train(), if available. */
  readonly diagnostics: unknown;
}

// ---------------------------------------------------------------------------
// Ridge adapter
// ---------------------------------------------------------------------------

import { RidgeRegression, type RidgeOptions } from './ridgeRegression';
import { DEFAULT_RIDGE_LAMBDA } from './constants';

/**
 * Ridge regression predictor — wraps RidgeRegression with GazePredictor interface.
 * Uses engineered features (iris ratios + head pose) from extractGazeFeatures.
 */
export class RidgeGazePredictor implements GazePredictor {
  readonly name = 'Ridge';
  private readonly ridge: RidgeRegression;
  private readonly lambda: number;

  constructor(lambda = DEFAULT_RIDGE_LAMBDA, options?: RidgeOptions) {
    this.ridge = new RidgeRegression(options);
    this.lambda = lambda;
  }

  addCalibrationSample(input: GazePredictorInput, target: [number, number]): void {
    if (!input.features) return;
    this.ridge.addSample(input.features, target);
  }

  async train(): Promise<void> {
    this.ridge.train(this.lambda);
  }

  predict(input: GazePredictorInput): [number, number] {
    if (!input.features) return [0, 0];
    return this.ridge.predict(input.features);
  }

  isReady(): boolean {
    return this.ridge.isReady();
  }

  get sampleCount(): number {
    return this.ridge.sampleCount;
  }

  get cvRmsePx(): number | null {
    return this.ridge.cvRmsePx;
  }

  get diagnostics(): unknown {
    return this.ridge.diagnostics;
  }

  get calibrationSamples(): Array<{ features: number[]; target: [number, number] }> {
    return this.ridge.samples;
  }
}
