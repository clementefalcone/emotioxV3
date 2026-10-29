/**
 * Post-calibración: campo de corrección en viewport a partir de residuos en los puntos de calibración
 * (objetivo − mirada estimada). Interpolación IDW en coordenadas normalizadas de la imagen.
 * Complementa BlazeGaze sin sustituir su calibrate() interno.
 */

/** Residuo en un punto de calibración (u,v en 0..1 sobre el rect del estímulo). */
export interface HybridCalibrationResidual {
    readonly u: number;
    readonly v: number;
    readonly dx: number;
    readonly dy: number;
}

/** Mezcla 0..1 del campo sobre la mirada corregida. BlazeGaze adapt() corrects partially; IDW complements. */
export const HYBRID_CALIBRATION_FIELD_STRENGTH = 0.85;

/**
 * Aplica corrección interpolada por distancia inversa a la mirada en coords de viewport.
 * @param x - Client X
 * @param y - Client Y
 * @param rect - Bounding rect del estímulo
 * @param samples - Residuos de calibración (p. ej. 4 en modo cuadrantes)
 * @param strength - Típicamente HYBRID_CALIBRATION_FIELD_STRENGTH
 * @returns Punto corregido en viewport
 */
export function hybridApplyCalibrationField(
    x: number,
    y: number,
    rect: DOMRect,
    samples: readonly HybridCalibrationResidual[],
    strength: number,
): { x: number; y: number } {
    if (samples.length === 0 || strength <= 0) {
        return { x, y };
    }
    const wImg = rect.width;
    const hImg = rect.height;
    if (wImg <= 0 || hImg <= 0) {
        return { x, y };
    }
    const u = (x - rect.left) / wImg;
    const v = (y - rect.top) / hImg;
    if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) {
        return { x, y };
    }

    const eps = 1e-5;
    let wSum = 0;
    let dxSum = 0;
    let dySum = 0;
    for (const s of samples) {
        const du = u - s.u;
        const dv = v - s.v;
        const w = 1 / (du * du + dv * dv + eps);
        wSum += w;
        dxSum += w * s.dx;
        dySum += w * s.dy;
    }
    if (wSum <= 0) {
        return { x, y };
    }
    const dx = (dxSum / wSum) * strength;
    const dy = (dySum / wSum) * strength;
    return {
        x: Math.max(0, Math.min(window.innerWidth, x + dx)),
        y: Math.max(0, Math.min(window.innerHeight, y + dy)),
    };
}

/**
 * RMSE of calibration residuals in viewport pixels (spread of |target − gaze| at each point).
 * @param samples - Residuals from hybrid calibration clicks
 * @returns 0 if empty
 */
export function hybridCalibrationRmsePx(samples: readonly HybridCalibrationResidual[]): number {
    if (samples.length === 0) return 0;
    let sumSq = 0;
    for (const s of samples) {
        sumSq += s.dx * s.dx + s.dy * s.dy;
    }
    return Math.sqrt(sumSq / samples.length);
}

interface TrainedCalibrationPoint {
    readonly targetX: number;
    readonly targetY: number;
    readonly predX: number;
    readonly predY: number;
}

export function hybridResidualsFromTrainedPoints(
    points: readonly TrainedCalibrationPoint[],
    rect: DOMRect,
): HybridCalibrationResidual[] {
    return points.map(point => ({
        u: (point.targetX - rect.left) / rect.width,
        v: (point.targetY - rect.top) / rect.height,
        dx: point.targetX - point.predX,
        dy: point.targetY - point.predY,
    }));
}

// ── Micro-recalibration (drift correction during viewing) ───────────────

/** Interval between micro-recalibration probes (ms). */
export const MICRO_RECALIB_INTERVAL_MS = 15_000;

/** Duration to display the micro-dot and sample gaze (ms). */
export const MICRO_RECALIB_SAMPLE_DURATION_MS = 600;

/** Number of gaze samples to average during a micro-recalibration probe. */
export const MICRO_RECALIB_SAMPLE_COUNT = 8;

/** Max drift (px) to apply. Corrections larger than this are noise, not drift. */
export const MICRO_RECALIB_MAX_DRIFT_PX = 250;

/** Weight of micro-recalibration residuals relative to initial calibration (0..1). */
export const MICRO_RECALIB_WEIGHT = 0.85;

/**
 * Candidate positions for micro-recalibration dots (% of stimulus).
 * Placed near edges/corners where drift is most visible but content is sparse.
 */
export const MICRO_RECALIB_POSITIONS: readonly [number, number][] = [
    [5, 5],    [50, 5],   [95, 5],
    [5, 50],              [95, 50],
    [5, 95],   [50, 95],  [95, 95],
];

/**
 * Compute a drift-correction residual from a micro-recalibration probe.
 * @param targetU - Known target position in stimulus coords (0..1)
 * @param targetV - Known target position in stimulus coords (0..1)
 * @param avgGazeX - Average gaze X (viewport px) during probe
 * @param avgGazeY - Average gaze Y (viewport px) during probe
 * @param rect - Stimulus bounding rect
 * @returns Residual in viewport coords (like the calibration residuals), or null if drift too large (noise)
 */
export function computeMicroRecalibResidual(
    targetU: number,
    targetV: number,
    avgGazeX: number,
    avgGazeY: number,
    rect: DOMRect,
): HybridCalibrationResidual | null {
    const targetX = rect.left + targetU * rect.width;
    const targetY = rect.top + targetV * rect.height;
    const dx = targetX - avgGazeX;
    const dy = targetY - avgGazeY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MICRO_RECALIB_MAX_DRIFT_PX) return null; // noise, not drift
    return {
        u: targetX / window.innerWidth,
        v: targetY / window.innerHeight,
        dx: dx * MICRO_RECALIB_WEIGHT,
        dy: dy * MICRO_RECALIB_WEIGHT,
    };
}

// ── Partial recalibration ─────────────────────────────────────────────────

/** Points with error > median × this factor are deficient. */
export const DEFICIENT_POINT_FACTOR = 1.5;

export interface PointError {
  readonly index: number;
  readonly errorPx: number;
}

/**
 * Compute per-point error from residuals (magnitude of dx,dy vector).
 */
export function computePointErrors(
  residuals: readonly HybridCalibrationResidual[],
): PointError[] {
  return residuals.map((r, index) => ({
    index,
    errorPx: Math.sqrt(r.dx * r.dx + r.dy * r.dy),
  }));
}

/**
 * Identify deficient calibration points — those with error > median × DEFICIENT_POINT_FACTOR.
 * Returns indices into the residuals array.
 *
 * @returns Empty array when all points are acceptable or when fewer than 3 residuals
 *          (can't compute meaningful median with fewer).
 */
export function detectDeficientPoints(
  residuals: readonly HybridCalibrationResidual[],
  factor = DEFICIENT_POINT_FACTOR,
): number[] {
  const errors = computePointErrors(residuals);
  // Need at least 3 points for a meaningful median comparison
  const canCompute = errors.length >= 3;
  return canCompute ? findDeficient(errors, factor) : [];
}

const findDeficient = (errors: PointError[], factor: number): number[] => {
  const sorted = errors.map((e) => e.errorPx).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const threshold = median * factor;
  return errors
    .filter((e) => e.errorPx > threshold)
    .map((e) => e.index);
};

/**
 * Replace residuals at deficient indices with new measurements.
 * Non-deficient residuals are preserved as-is.
 *
 * @param original   — full residual array from initial calibration
 * @param newPartial — new residuals for deficient points (same length as deficientIndices)
 * @param deficientIndices — indices to replace
 * @returns New residual array with deficient points replaced
 */
export function recalibratePartial(
  original: readonly HybridCalibrationResidual[],
  newPartial: readonly HybridCalibrationResidual[],
  deficientIndices: readonly number[],
): HybridCalibrationResidual[] {
  const deficientSet = new Set(deficientIndices);
  let partialIdx = 0;

  return original.map((residual, i) => {
    const isDeficient = deficientSet.has(i);
    return isDeficient && partialIdx < newPartial.length
      ? newPartial[partialIdx++]
      : residual;
  });
}

/** Higher = confidence falls off faster with distance from nearest calibration anchor in UV space. */
export const HYBRID_CALIB_CONFIDENCE_K = 14;

/**
 * Confidence in [0,1] from proximity to calibration samples in normalized image coordinates.
 * Far from all anchors → lower weight for soft heatmap aggregation.
 * @param u - Horizontal position in 0..1 on stimulus rect
 * @param v - Vertical position in 0..1 on stimulus rect
 * @param samples - Calibration residuals (uses their u,v as anchors)
 * @param k - Squared-distance scale; default HYBRID_CALIB_CONFIDENCE_K
 */
export function hybridCalibrationConfidenceWeightUv(
    u: number,
    v: number,
    samples: readonly HybridCalibrationResidual[],
    k: number = HYBRID_CALIB_CONFIDENCE_K,
): number {
    if (samples.length === 0) return 1;
    let minD2 = Infinity;
    for (const s of samples) {
        const du = u - s.u;
        const dv = v - s.v;
        minD2 = Math.min(minD2, du * du + dv * dv);
    }
    return 1 / (1 + k * minD2);
}
