/**
 * Ridge regression for mapping gaze features to screen coordinates.
 * Pure matrix algebra — no external dependencies.
 *
 * Supports:
 *   - Z-score feature normalization (always on)
 *   - Optional Random Fourier Features (RFF) for approximate RBF kernel ridge
 *   - Leave-one-point-out cross-validation
 *   - Axis stretch for output calibration
 */

type Matrix = number[][];
type Vector = number[];

/** Gauss-Jordan inversion for small matrices */
function invert(m: Matrix): Matrix {
  const n = m.length;
  const aug: Matrix = m.map((row, i) => {
    const iRow = new Array(n).fill(0);
    iRow[i] = 1;
    return [...row, ...iRow];
  });

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Matrix is singular and cannot be inverted');
    }

    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map(row => row.slice(n));
}

function multiplyMV(m: Matrix, v: Vector): Vector {
  return m.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
}

const DEGENERATE_PRED_SPAN_PX = 1e-4;

interface AxisStretch {
  readonly predMin: number;
  readonly predMax: number;
  readonly targMin: number;
  readonly targMax: number;
}

function applyAxisStretch(raw: number, axis: AxisStretch): number {
  const predSpan = axis.predMax - axis.predMin;
  const targSpan = axis.targMax - axis.targMin;
  if (targSpan <= 0) return raw;
  if (predSpan <= DEGENERATE_PRED_SPAN_PX) {
    return (axis.targMin + axis.targMax) / 2;
  }
  return axis.targMin + ((raw - axis.predMin) / predSpan) * targSpan;
}

// ---------------------------------------------------------------------------
// Random Fourier Features (Rahimi & Recht 2007)
// Approximates RBF kernel k(x,y) = exp(-||x-y||²/(2σ²)) using:
//   z(x) = √(2/D) × cos(Wx + b)
// where W ~ N(0, 1/σ²), b ~ Uniform(0, 2π)
// ---------------------------------------------------------------------------

/** Seeded PRNG (xorshift32) for reproducible RFF projections. */
function createSeededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xFFFFFFFF;
  };
}

/** Box-Muller: two uniform → one standard normal. */
function gaussianFromRng(rng: () => number): number {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface RffConfig {
  /** Number of random projections. Default 128. */
  D?: number;
  /** RBF bandwidth σ. 'auto' = median pairwise distance (recommended). Default 'auto'. */
  sigma?: number | 'auto';
  /** Random seed for reproducibility. Default 42. */
  seed?: number;
}

interface RffState {
  W: Matrix;       // D × inputDim random weight matrix
  b: Vector;       // D random biases
  scale: number;   // √(2/D)
}

function buildRffState(inputDim: number, D: number, sigma: number, seed: number): RffState {
  const rng = createSeededRng(seed);
  const invSigma = 1 / sigma;
  const W: Matrix = [];
  const b: Vector = [];
  for (let i = 0; i < D; i++) {
    const row: number[] = [];
    for (let j = 0; j < inputDim; j++) {
      row.push(gaussianFromRng(rng) * invSigma);
    }
    W.push(row);
    b.push(rng() * 2 * Math.PI);
  }
  return { W, b, scale: Math.sqrt(2 / D) };
}

/** Transform feature vector via RFF: z(x) = √(2/D) × cos(Wx + b). */
function applyRff(x: Vector, rff: RffState): Vector {
  const out: Vector = [];
  for (let i = 0; i < rff.W.length; i++) {
    let dot = 0;
    for (let j = 0; j < x.length; j++) dot += rff.W[i][j] * x[j];
    out.push(rff.scale * Math.cos(dot + rff.b[i]));
  }
  return out;
}

/** Median of pairwise L2 distances (subsample if >200 rows). */
function medianPairwiseDistance(rows: Matrix): number {
  const n = Math.min(rows.length, 200);
  const dists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < rows[i].length; k++) {
        const d = rows[i][k] - rows[j][k];
        sum += d * d;
      }
      dists.push(Math.sqrt(sum));
    }
  }
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)] || 1;
}

// ---------------------------------------------------------------------------
// Core solver — shared by train() and LOOCV
// ---------------------------------------------------------------------------

interface Gram {
  xtx: Matrix;
  xtyx: Vector;
  xtyy: Vector;
}

function addToGram(gram: Gram, row: Vector, yx: number, yy: number, sign: 1 | -1): void {
  for (let i = 0; i < row.length; i++) {
    const weighted = row[i] * sign;
    const xtxRow = gram.xtx[i];
    for (let j = 0; j < row.length; j++) xtxRow[j] += weighted * row[j];
    gram.xtyx[i] += weighted * yx;
    gram.xtyy[i] += weighted * yy;
  }
}

function buildGram(X: Matrix, yx: Vector, yy: Vector): Gram {
  const n = X[0].length;
  const gram: Gram = {
    xtx: Array.from({ length: n }, () => new Array(n).fill(0)),
    xtyx: new Array(n).fill(0),
    xtyy: new Array(n).fill(0),
  };
  X.forEach((row, i) => addToGram(gram, row, yx[i], yy[i], 1));
  return gram;
}

function cloneGram(gram: Gram): Gram {
  return { xtx: gram.xtx.map(row => [...row]), xtyx: [...gram.xtyx], xtyy: [...gram.xtyy] };
}

function solveGram(gram: Gram, lambda: number): { weightsX: Vector; weightsY: Vector } {
  const regularized = gram.xtx.map((row, i) => row.map((value, j) => (i === j ? value + lambda : value)));
  const inverse = invert(regularized);
  return { weightsX: multiplyMV(inverse, gram.xtyx), weightsY: multiplyMV(inverse, gram.xtyy) };
}

interface FoldError {
  sumSq: number;
  count: number;
}

// ---------------------------------------------------------------------------
// RidgeRegression
// ---------------------------------------------------------------------------

export interface RidgeOptions {
  /** Enable Random Fourier Features (approximate RBF kernel). Default false. */
  rff?: RffConfig | false;
}

export class RidgeRegression {
  private samplesX: number[][] = [];
  private samplesYx: number[] = [];
  private samplesYy: number[] = [];
  /** Target screen coords per sample — for LOOCV grouping. */
  private sampleTargets: [number, number][] = [];
  private weightsX: Vector | null = null;
  private weightsY: Vector | null = null;
  private stretchX: AxisStretch | null = null;
  private stretchY: AxisStretch | null = null;
  private featureMean: Vector | null = null;
  private featureStd: Vector | null = null;
  private rffState: RffState | null = null;
  private readonly rffConfig: RffConfig | false;

  /** LOOCV RMSE after last train(). Null if not computed. */
  cvRmsePx: number | null = null;

  /** Per-calibration-point diagnostics from last train(). */
  diagnostics: {
    perPoint: Array<{
      targetX: number;
      targetY: number;
      predX: number;
      predY: number;
      residualX: number;
      residualY: number;
      errorPx: number;
      sampleCount: number;
      cvErrorPx: number | null;
    }>;
    featureStats: Array<{
      index: number;
      mean: number;
      std: number;
      weight_x: number;
      weight_y: number;
      /** |weight| × std — how much this feature moves the output. */
      sensitivity_x: number;
      sensitivity_y: number;
    }>;
    biasX: number;
    biasY: number;
    totalSamples: number;
  } | null = null;

  constructor(options?: RidgeOptions) {
    this.rffConfig = options?.rff ?? false;
  }

  addSample(features: number[], target: [number, number]): void {
    this.samplesX.push([...features, 1]);
    this.samplesYx.push(target[0]);
    this.samplesYy.push(target[1]);
    this.sampleTargets.push(target);
  }

  // -- Normalization --

  private computeNormalization(): void {
    const m = this.samplesX.length;
    if (m < 2) return;
    const n = this.samplesX[0].length;
    const mean = new Array(n).fill(0);
    for (const row of this.samplesX) {
      for (let j = 0; j < n; j++) mean[j] += row[j];
    }
    for (let j = 0; j < n; j++) mean[j] /= m;

    const std = new Array(n).fill(0);
    for (const row of this.samplesX) {
      for (let j = 0; j < n; j++) {
        const d = row[j] - mean[j];
        std[j] += d * d;
      }
    }
    for (let j = 0; j < n; j++) std[j] = Math.sqrt(std[j] / m);

    mean[n - 1] = 0;
    std[n - 1] = 1;
    for (let j = 0; j < n; j++) {
      if (std[j] < 1e-10) std[j] = 1;
    }

    this.featureMean = mean;
    this.featureStd = std;
  }

  private normalize(row: Vector): Vector {
    if (!this.featureMean || !this.featureStd) return row;
    return row.map((v, i) => (v - this.featureMean![i]) / this.featureStd![i]);
  }

  // -- Feature transform (normalize → optional RFF) --

  /** Full transform pipeline: normalize, then optional RFF. */
  private transform(row: Vector): Vector {
    const normed = this.normalize(row);
    if (this.rffState) {
      // RFF replaces the normalized vector with cos projections + bias
      return [...applyRff(normed, this.rffState), 1];
    }
    return normed;
  }

  // -- Train --

  train(lambda = 1.0): void {
    this.computeNormalization();

    // Build RFF state if configured
    if (this.rffConfig) {
      const normedRows = this.samplesX.map(row => this.normalize(row));
      const sigma = this.rffConfig.sigma === 'auto' || this.rffConfig.sigma === undefined
        ? medianPairwiseDistance(normedRows)
        : this.rffConfig.sigma;
      const D = this.rffConfig.D ?? 128;
      const seed = this.rffConfig.seed ?? 42;
      // Input dim = normed row length (features + bias)
      this.rffState = buildRffState(normedRows[0].length, D, Math.max(sigma, 1e-6), seed);
    }

    const X: Matrix = this.samplesX.map(row => this.transform(row));
    const gram = buildGram(X, this.samplesYx, this.samplesYy);
    const { weightsX, weightsY } = solveGram(gram, lambda);
    this.weightsX = weightsX;
    this.weightsY = weightsY;

    this.stretchX = null;
    this.stretchY = null;
    this.computeCalibrationStretch();

    const groups = this.groupByTarget();
    const foldErrors = this.computeFoldErrors(X, gram, groups, lambda);
    this.cvRmsePx = groups.size < 3 ? null : this.pooledRmse(foldErrors);
    this.computeDiagnostics(foldErrors);
  }

  private groupByTarget(): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < this.sampleTargets.length; i++) {
      const [tx, ty] = this.sampleTargets[i];
      const key = `${Math.round(tx / 10) * 10},${Math.round(ty / 10) * 10}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    return groups;
  }

  private computeFoldErrors(X: Matrix, gram: Gram, groups: Map<string, number[]>, lambda: number): Map<string, FoldError> {
    const foldErrors = new Map<string, FoldError>();
    for (const [key, heldOutIndices] of groups) {
      if (X.length - heldOutIndices.length < 2) continue;
      const trainGram = cloneGram(gram);
      for (const idx of heldOutIndices) addToGram(trainGram, X[idx], this.samplesYx[idx], this.samplesYy[idx], -1);
      let weights: { weightsX: Vector; weightsY: Vector };
      try {
        weights = solveGram(trainGram, lambda);
      } catch {
        continue;
      }
      let sumSq = 0;
      for (const idx of heldOutIndices) {
        const dx = multiplyMV([weights.weightsX], X[idx])[0] - this.samplesYx[idx];
        const dy = multiplyMV([weights.weightsY], X[idx])[0] - this.samplesYy[idx];
        sumSq += dx * dx + dy * dy;
      }
      foldErrors.set(key, { sumSq, count: heldOutIndices.length });
    }
    return foldErrors;
  }

  private pooledRmse(foldErrors: Map<string, FoldError>): number | null {
    let sumSq = 0;
    let count = 0;
    for (const fold of foldErrors.values()) {
      sumSq += fold.sumSq;
      count += fold.count;
    }
    return count > 0 ? Math.sqrt(sumSq / count) : null;
  }

  // -- Diagnostics --

  private computeDiagnostics(foldErrors: Map<string, FoldError>): void {
    if (!this.weightsX || !this.weightsY || !this.featureMean || !this.featureStd) {
      this.diagnostics = null;
      return;
    }

    const groups = this.groupByTarget();
    const perPoint: NonNullable<typeof this.diagnostics>['perPoint'] = [];

    for (const [, indices] of groups) {
      const tx = this.samplesYx[indices[0]];
      const ty = this.samplesYy[indices[0]];
      let sumPx = 0, sumPy = 0;
      for (const idx of indices) {
        const [px, py] = this.predictLinearFromRow(this.samplesX[idx]);
        const stretched = this.stretchX && this.stretchY
          ? [applyAxisStretch(px, this.stretchX), applyAxisStretch(py, this.stretchY)]
          : [px, py];
        sumPx += stretched[0];
        sumPy += stretched[1];
      }
      const predX = sumPx / indices.length;
      const predY = sumPy / indices.length;
      const residualX = predX - tx;
      const residualY = predY - ty;
      const key = `${Math.round(tx / 10) * 10},${Math.round(ty / 10) * 10}`;

      perPoint.push({
        targetX: tx,
        targetY: ty,
        predX,
        predY,
        residualX,
        residualY,
        errorPx: Math.sqrt(residualX * residualX + residualY * residualY),
        sampleCount: indices.length,
        cvErrorPx: foldErrors.has(key) ? Math.sqrt(foldErrors.get(key)!.sumSq / foldErrors.get(key)!.count) : null,
      });
    }

    // Sort by error descending
    perPoint.sort((a, b) => b.errorPx - a.errorPx);

    // Feature stats + weights
    const n = this.weightsX.length;
    const featureStats: NonNullable<typeof this.diagnostics>['featureStats'] = [];
    for (let i = 0; i < n; i++) {
      const mean = this.featureMean[i];
      const std = this.featureStd[i];
      const wx = this.weightsX[i];
      const wy = this.weightsY[i];
      featureStats.push({
        index: i,
        mean,
        std,
        weight_x: wx,
        weight_y: wy,
        sensitivity_x: Math.abs(wx) * std,
        sensitivity_y: Math.abs(wy) * std,
      });
    }

    // Global bias (mean prediction vs mean target)
    const meanTargetX = this.samplesYx.reduce((s, v) => s + v, 0) / this.samplesYx.length;
    const meanTargetY = this.samplesYy.reduce((s, v) => s + v, 0) / this.samplesYy.length;
    const meanPredX = perPoint.reduce((s, p) => s + p.predX * p.sampleCount, 0) /
      perPoint.reduce((s, p) => s + p.sampleCount, 0);
    const meanPredY = perPoint.reduce((s, p) => s + p.predY * p.sampleCount, 0) /
      perPoint.reduce((s, p) => s + p.sampleCount, 0);

    this.diagnostics = {
      perPoint,
      featureStats,
      biasX: meanPredX - meanTargetX,
      biasY: meanPredY - meanTargetY,
      totalSamples: this.samplesX.length,
    };
  }

  // -- Predict --

  private predictLinearFromRow(featureRow: Vector): [number, number] {
    if (!this.weightsX || !this.weightsY) {
      throw new Error('Model not trained yet');
    }
    const transformed = this.transform(featureRow);
    const x = multiplyMV([this.weightsX], transformed)[0];
    const y = multiplyMV([this.weightsY], transformed)[0];
    return [x, y];
  }

  private computeCalibrationStretch(): void {
    if (!this.weightsX || !this.weightsY || this.samplesX.length === 0) return;

    const rawXs: number[] = [];
    const rawYs: number[] = [];
    for (const row of this.samplesX) {
      const [rx, ry] = this.predictLinearFromRow(row);
      rawXs.push(rx);
      rawYs.push(ry);
    }

    const predMinX = Math.min(...rawXs);
    const predMaxX = Math.max(...rawXs);
    const predMinY = Math.min(...rawYs);
    const predMaxY = Math.max(...rawYs);

    const targMinX = Math.min(...this.samplesYx);
    const targMaxX = Math.max(...this.samplesYx);
    const targMinY = Math.min(...this.samplesYy);
    const targMaxY = Math.max(...this.samplesYy);

    this.stretchX = { predMin: predMinX, predMax: predMaxX, targMin: targMinX, targMax: targMaxX };
    this.stretchY = { predMin: predMinY, predMax: predMaxY, targMin: targMinY, targMax: targMaxY };
  }

  predict(features: number[]): [number, number] {
    if (!this.weightsX || !this.weightsY) {
      throw new Error('Model not trained yet');
    }
    const f = this.transform([...features, 1]);
    const rawX = multiplyMV([this.weightsX], f)[0];
    const rawY = multiplyMV([this.weightsY], f)[0];

    if (this.stretchX && this.stretchY) {
      return [
        applyAxisStretch(rawX, this.stretchX),
        applyAxisStretch(rawY, this.stretchY),
      ];
    }
    return [rawX, rawY];
  }

  isReady(): boolean {
    return this.weightsX !== null && this.weightsY !== null;
  }

  get sampleCount(): number {
    return this.samplesX.length;
  }

  get samples(): Array<{ features: number[]; target: [number, number] }> {
    return this.samplesX.map((row, i) => ({ features: row.slice(0, -1), target: this.sampleTargets[i] }));
  }
}
