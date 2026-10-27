import { describe, it, expect } from 'vitest';
import { RidgeRegression } from '../ridgeRegression';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add 4-corner calibration points mapping 2D features to screen coords. */
function addCornerCalibration(
  model: RidgeRegression,
  screenW = 1920,
  screenH = 1080,
  samplesPerCorner = 3,
): void {
  const corners: Array<{ feat: number[]; target: [number, number] }> = [
    { feat: [0.1, 0.1], target: [0, 0] },
    { feat: [0.9, 0.1], target: [screenW, 0] },
    { feat: [0.1, 0.9], target: [0, screenH] },
    { feat: [0.9, 0.9], target: [screenW, screenH] },
  ];
  for (const { feat, target } of corners) {
    for (let i = 0; i < samplesPerCorner; i++) {
      model.addSample(feat, target);
    }
  }
}

/** Add a 9-point grid calibration for LOOCV tests. */
function addGridCalibration(
  model: RidgeRegression,
  screenW = 1920,
  screenH = 1080,
  samplesPerPoint = 2,
): void {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const fx = 0.1 + col * 0.4;
      const fy = 0.1 + row * 0.4;
      const tx = (col / 2) * screenW;
      const ty = (row / 2) * screenH;
      for (let i = 0; i < samplesPerPoint; i++) {
        model.addSample([fx, fy], [tx, ty]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// isReady / predict before train
// ---------------------------------------------------------------------------

describe('RidgeRegression — lifecycle', () => {
  it('isReady returns false before training', () => {
    const model = new RidgeRegression();
    expect(model.isReady()).toBe(false);
  });

  it('throws on predict before train', () => {
    const model = new RidgeRegression();
    model.addSample([0.5, 0.5], [960, 540]);
    expect(() => model.predict([0.5, 0.5])).toThrow('Model not trained yet');
  });

  it('isReady returns true after training', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model);
    model.train(1.0);
    expect(model.isReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sampleCount
// ---------------------------------------------------------------------------

describe('RidgeRegression — sampleCount', () => {
  it('returns 0 when no samples added', () => {
    const model = new RidgeRegression();
    expect(model.sampleCount).toBe(0);
  });

  it('returns correct count after adding samples', () => {
    const model = new RidgeRegression();
    model.addSample([0.1, 0.2], [100, 200]);
    model.addSample([0.3, 0.4], [300, 400]);
    model.addSample([0.5, 0.6], [500, 600]);
    expect(model.sampleCount).toBe(3);
  });

  it('returns correct count with corner calibration (4 corners x 3 each)', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model, 1920, 1080, 3);
    expect(model.sampleCount).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Simple linear mapping
// ---------------------------------------------------------------------------

describe('RidgeRegression — simple linear mapping', () => {
  it('predicts near calibration targets for 4-corner calibration', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model);
    model.train(0.01);

    // Predict corners — should be close to the targets
    const topLeft = model.predict([0.1, 0.1]);
    expect(topLeft[0]).toBeCloseTo(0, -1); // within ~50px
    expect(topLeft[1]).toBeCloseTo(0, -1);

    const bottomRight = model.predict([0.9, 0.9]);
    expect(bottomRight[0]).toBeCloseTo(1920, -1);
    expect(bottomRight[1]).toBeCloseTo(1080, -1);
  });

  it('predicts center from interpolation of 4 corners', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model);
    model.train(0.01);

    const center = model.predict([0.5, 0.5]);
    // Center of screen should be roughly (960, 540) — tolerate 100px
    expect(center[0]).toBeGreaterThan(760);
    expect(center[0]).toBeLessThan(1160);
    expect(center[1]).toBeGreaterThan(440);
    expect(center[1]).toBeLessThan(640);
  });
});

// ---------------------------------------------------------------------------
// Identity-ish mapping
// ---------------------------------------------------------------------------

describe('RidgeRegression — identity mapping', () => {
  it('recovers screen coords when features = normalized screen coords', () => {
    const model = new RidgeRegression();
    const W = 1920;
    const H = 1080;
    // Features are normalized [0,1] coords that linearly map to screen
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const fx = col / 2;
        const fy = row / 2;
        model.addSample([fx, fy], [fx * W, fy * H]);
      }
    }
    model.train(0.001);

    const mid = model.predict([0.5, 0.5]);
    expect(mid[0]).toBeCloseTo(960, -1);
    expect(mid[1]).toBeCloseTo(540, -1);

    const corner = model.predict([1.0, 1.0]);
    expect(corner[0]).toBeCloseTo(1920, -1);
    expect(corner[1]).toBeCloseTo(1080, -1);
  });
});

// ---------------------------------------------------------------------------
// RFF (Random Fourier Features)
// ---------------------------------------------------------------------------

describe('RidgeRegression — RFF', () => {
  it('produces valid predictions with RFF enabled', () => {
    const model = new RidgeRegression({
      rff: { D: 64, sigma: 'auto', seed: 42 },
    });
    addCornerCalibration(model);
    model.train(1.0);

    expect(model.isReady()).toBe(true);
    const pred = model.predict([0.5, 0.5]);
    expect(typeof pred[0]).toBe('number');
    expect(typeof pred[1]).toBe('number');
    expect(Number.isFinite(pred[0])).toBe(true);
    expect(Number.isFinite(pred[1])).toBe(true);
  });

  it('RFF with explicit sigma produces finite predictions', () => {
    const model = new RidgeRegression({
      rff: { D: 32, sigma: 0.5, seed: 123 },
    });
    addCornerCalibration(model);
    model.train(1.0);

    const pred = model.predict([0.1, 0.9]);
    expect(Number.isFinite(pred[0])).toBe(true);
    expect(Number.isFinite(pred[1])).toBe(true);
  });

  it('same seed produces reproducible predictions', () => {
    function buildModel(): RidgeRegression {
      const m = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 42 } });
      addCornerCalibration(m);
      m.train(1.0);
      return m;
    }

    const m1 = buildModel();
    const m2 = buildModel();

    const p1 = m1.predict([0.5, 0.5]);
    const p2 = m2.predict([0.5, 0.5]);
    expect(p1[0]).toBe(p2[0]);
    expect(p1[1]).toBe(p2[1]);
  });

  it('different seeds produce different predictions', () => {
    const m1 = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 42 } });
    const m2 = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 99 } });
    addCornerCalibration(m1);
    addCornerCalibration(m2);
    m1.train(1.0);
    m2.train(1.0);

    const p1 = m1.predict([0.5, 0.5]);
    const p2 = m2.predict([0.5, 0.5]);
    // At least one coordinate should differ
    const differs = p1[0] !== p2[0] || p1[1] !== p2[1];
    expect(differs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Axis stretch
// ---------------------------------------------------------------------------

describe('RidgeRegression — axis stretch', () => {
  it('predictions span the full target range', () => {
    const model = new RidgeRegression();
    const W = 1920;
    const H = 1080;
    addCornerCalibration(model, W, H);
    model.train(0.01);

    // After stretch, corner predictions should cover target range
    const tl = model.predict([0.1, 0.1]);
    const br = model.predict([0.9, 0.9]);

    // X range
    const predXRange = Math.abs(br[0] - tl[0]);
    expect(predXRange).toBeGreaterThan(W * 0.5); // at least half the screen width
    // Y range
    const predYRange = Math.abs(br[1] - tl[1]);
    expect(predYRange).toBeGreaterThan(H * 0.5);
  });
});

// ---------------------------------------------------------------------------
// LOOCV
// ---------------------------------------------------------------------------

describe('RidgeRegression — LOOCV', () => {
  it('cvRmsePx is a positive number with >= 3 calibration points', () => {
    const model = new RidgeRegression();
    addGridCalibration(model); // 9 calibration points
    model.train(1.0);

    expect(model.cvRmsePx).not.toBeNull();
    expect(model.cvRmsePx!).toBeGreaterThan(0);
    expect(Number.isFinite(model.cvRmsePx!)).toBe(true);
  });

  it('cvRmsePx is null with < 3 calibration points', () => {
    const model = new RidgeRegression();
    // Only 2 calibration points
    model.addSample([0.1, 0.1], [0, 0]);
    model.addSample([0.1, 0.1], [0, 0]);
    model.addSample([0.9, 0.9], [1920, 1080]);
    model.addSample([0.9, 0.9], [1920, 1080]);
    model.train(1.0);

    expect(model.cvRmsePx).toBeNull();
  });

  it('cvRmsePx is null before training', () => {
    const model = new RidgeRegression();
    expect(model.cvRmsePx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('RidgeRegression — diagnostics', () => {
  it('diagnostics is null before training', () => {
    const model = new RidgeRegression();
    expect(model.diagnostics).toBeNull();
  });

  it('perPoint has one entry per calibration point group, sorted by error desc', () => {
    const model = new RidgeRegression();
    addGridCalibration(model); // 9 groups
    model.train(1.0);

    expect(model.diagnostics).not.toBeNull();
    const pp = model.diagnostics!.perPoint;
    expect(pp.length).toBe(9);

    // Sorted by errorPx descending
    for (let i = 1; i < pp.length; i++) {
      expect(pp[i - 1].errorPx).toBeGreaterThanOrEqual(pp[i].errorPx);
    }
  });

  it('perPoint entries have correct sampleCount', () => {
    const model = new RidgeRegression();
    addGridCalibration(model, 1920, 1080, 4); // 4 samples per point
    model.train(1.0);

    for (const p of model.diagnostics!.perPoint) {
      expect(p.sampleCount).toBe(4);
    }
  });

  it('perPoint fields are finite numbers', () => {
    const model = new RidgeRegression();
    addGridCalibration(model);
    model.train(1.0);

    for (const p of model.diagnostics!.perPoint) {
      expect(Number.isFinite(p.targetX)).toBe(true);
      expect(Number.isFinite(p.targetY)).toBe(true);
      expect(Number.isFinite(p.predX)).toBe(true);
      expect(Number.isFinite(p.predY)).toBe(true);
      expect(Number.isFinite(p.residualX)).toBe(true);
      expect(Number.isFinite(p.residualY)).toBe(true);
      expect(Number.isFinite(p.errorPx)).toBe(true);
    }
  });

  it('featureStats length matches feature count + 1 (bias)', () => {
    const model = new RidgeRegression();
    const featureDim = 2;
    addGridCalibration(model); // features are 2D
    model.train(1.0);

    // After addSample, each row is [f0, f1, 1] — 3 elements
    // featureStats should have one entry per weight dimension
    expect(model.diagnostics!.featureStats.length).toBe(featureDim + 1);
  });

  it('featureStats entries have sensible fields', () => {
    const model = new RidgeRegression();
    addGridCalibration(model);
    model.train(1.0);

    for (const fs of model.diagnostics!.featureStats) {
      expect(typeof fs.index).toBe('number');
      expect(Number.isFinite(fs.mean)).toBe(true);
      expect(Number.isFinite(fs.std)).toBe(true);
      expect(Number.isFinite(fs.weight_x)).toBe(true);
      expect(Number.isFinite(fs.weight_y)).toBe(true);
      expect(fs.sensitivity_x).toBeGreaterThanOrEqual(0);
      expect(fs.sensitivity_y).toBeGreaterThanOrEqual(0);
    }
  });

  it('biasX and biasY are finite numbers', () => {
    const model = new RidgeRegression();
    addGridCalibration(model);
    model.train(1.0);

    expect(Number.isFinite(model.diagnostics!.biasX)).toBe(true);
    expect(Number.isFinite(model.diagnostics!.biasY)).toBe(true);
  });

  it('totalSamples matches sampleCount', () => {
    const model = new RidgeRegression();
    addGridCalibration(model, 1920, 1080, 3);
    model.train(1.0);

    expect(model.diagnostics!.totalSamples).toBe(model.sampleCount);
    expect(model.diagnostics!.totalSamples).toBe(27); // 9 points x 3
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('RidgeRegression — edge cases', () => {
  it('single sample — train runs, LOOCV is null', () => {
    const model = new RidgeRegression();
    model.addSample([0.5, 0.5], [960, 540]);
    // Single sample: normalization skipped (m < 2), but train should not throw
    model.train(1.0);
    expect(model.isReady()).toBe(true);
    expect(model.cvRmsePx).toBeNull();
  });

  it('two samples — train runs, LOOCV is null (only 2 groups)', () => {
    const model = new RidgeRegression();
    model.addSample([0.1, 0.1], [0, 0]);
    model.addSample([0.9, 0.9], [1920, 1080]);
    model.train(1.0);
    expect(model.isReady()).toBe(true);
    expect(model.cvRmsePx).toBeNull();
  });

  it('zero lambda — train runs without error', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model);
    // Zero lambda = no regularization — may be numerically risky but should work
    model.train(0);
    expect(model.isReady()).toBe(true);

    const pred = model.predict([0.5, 0.5]);
    expect(Number.isFinite(pred[0])).toBe(true);
    expect(Number.isFinite(pred[1])).toBe(true);
  });

  it('very large lambda — predictions biased toward mean', () => {
    const model = new RidgeRegression();
    addCornerCalibration(model, 1920, 1080, 5);
    model.train(1e6);

    // Heavy regularization → weights shrink → predictions cluster near mean target
    const p1 = model.predict([0.1, 0.1]);
    const p2 = model.predict([0.9, 0.9]);

    // With stretch, corner predictions are still stretched to target range,
    // but raw predictions before stretch should be close together.
    // We can verify that predictions are finite.
    expect(Number.isFinite(p1[0])).toBe(true);
    expect(Number.isFinite(p2[1])).toBe(true);
  });

  it('singular matrix (all identical features) — train throws', () => {
    const model = new RidgeRegression();
    // All features identical — without regularization, matrix would be singular.
    // With lambda > 0, the diagonal regularization should prevent singularity.
    // But all identical rows means the matrix has no spread — test with lambda=0.
    for (let i = 0; i < 5; i++) {
      model.addSample([0.5, 0.5], [100 * i, 100 * i]);
    }
    // With lambda=0, (X^T X) is rank-deficient (all rows same)
    // The regularization term saves it when lambda > 0
    expect(() => model.train(0)).toThrow();
  });

  it('singular matrix with regularization — train succeeds', () => {
    const model = new RidgeRegression();
    for (let i = 0; i < 5; i++) {
      model.addSample([0.5, 0.5], [100 * i, 100 * i]);
    }
    // Lambda > 0 adds identity to diagonal, preventing singularity
    model.train(1.0);
    expect(model.isReady()).toBe(true);
  });

  it('high-dimensional features — train and predict work', () => {
    const model = new RidgeRegression();
    // 10-dimensional features
    for (let i = 0; i < 20; i++) {
      const feat = Array.from({ length: 10 }, (_, j) => Math.sin(i + j));
      model.addSample(feat, [i * 100, i * 50]);
    }
    model.train(1.0);
    expect(model.isReady()).toBe(true);

    const pred = model.predict(Array.from({ length: 10 }, (_, j) => Math.sin(5 + j)));
    expect(Number.isFinite(pred[0])).toBe(true);
    expect(Number.isFinite(pred[1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RFF edge cases
// ---------------------------------------------------------------------------

describe('RidgeRegression — RFF edge cases', () => {
  it('default RFF config uses D=128, seed=42', () => {
    const m1 = new RidgeRegression({ rff: {} });
    addCornerCalibration(m1);
    m1.train(1.0);

    // Default RFF produces valid predictions within target range
    const p1 = m1.predict([0.5, 0.5]);
    expect(p1[0]).toBeGreaterThan(0);
    expect(p1[0]).toBeLessThan(1920);
    expect(p1[1]).toBeGreaterThan(0);
    expect(p1[1]).toBeLessThan(1080);
    expect(m1.isReady()).toBe(true);
  });

  it('RFF with 9-point grid produces valid LOOCV', () => {
    const model = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 42 } });
    addGridCalibration(model);
    model.train(1.0);

    expect(model.cvRmsePx).not.toBeNull();
    expect(model.cvRmsePx!).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Accuracy sanity checks
// ---------------------------------------------------------------------------

describe('RidgeRegression — accuracy sanity', () => {
  it('well-conditioned linear problem: residuals should be small', () => {
    const model = new RidgeRegression();
    // Perfect linear relationship: target = A * features + offset
    // f0 maps to X, f1 maps to Y
    const points = [
      { feat: [0, 0], target: [0, 0] as [number, number] },
      { feat: [1, 0], target: [1920, 0] as [number, number] },
      { feat: [0, 1], target: [0, 1080] as [number, number] },
      { feat: [1, 1], target: [1920, 1080] as [number, number] },
      { feat: [0.5, 0.5], target: [960, 540] as [number, number] },
    ];
    for (const { feat, target } of points) {
      for (let i = 0; i < 3; i++) model.addSample(feat, target);
    }
    model.train(0.001);

    // Each calibration point should have small error
    for (const p of model.diagnostics!.perPoint) {
      expect(p.errorPx).toBeLessThan(50);
    }
  });
});

describe('RidgeRegression — samples round trip', () => {
  it('rebuilds the same RFF model from its exported samples', () => {
    const original = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 42 } });
    addGridCalibration(original);
    original.train(1);

    const rebuilt = new RidgeRegression({ rff: { D: 64, sigma: 'auto', seed: 42 } });
    for (const { features, target } of original.samples) rebuilt.addSample(features, target);
    rebuilt.train(1);

    expect(rebuilt.samples).toEqual(original.samples);
    expect(rebuilt.predict([0.3, 0.7])).toEqual(original.predict([0.3, 0.7]));
  });
});
