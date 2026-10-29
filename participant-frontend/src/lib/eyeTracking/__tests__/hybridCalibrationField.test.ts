import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hybridApplyCalibrationField,
  hybridCalibrationRmsePx,
  hybridResidualsFromTrainedPoints,
  computeMicroRecalibResidual,
  computePointErrors,
  detectDeficientPoints,
  recalibratePartial,
  hybridCalibrationConfidenceWeightUv,
  HYBRID_CALIBRATION_FIELD_STRENGTH,
  MICRO_RECALIB_MAX_DRIFT_PX,
  MICRO_RECALIB_WEIGHT,
  DEFICIENT_POINT_FACTOR,
  HYBRID_CALIB_CONFIDENCE_K,
  type HybridCalibrationResidual,
} from '../hybridCalibrationField';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rect = {
  left: 100, top: 100, right: 900, bottom: 700,
  width: 800, height: 600,
  x: 100, y: 100, toJSON: () => ({}),
} as DOMRect;

const zeroRect = {
  left: 0, top: 0, right: 0, bottom: 0,
  width: 0, height: 0,
  x: 0, y: 0, toJSON: () => ({}),
} as DOMRect;

const makeSample = (u: number, v: number, dx: number, dy: number): HybridCalibrationResidual =>
  ({ u, v, dx, dy });

// ---------------------------------------------------------------------------
// Setup: mock window dimensions
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('window', {
    ...globalThis.window,
    innerWidth: 1920,
    innerHeight: 1080,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('hybridCalibrationField constants', () => {
  it('HYBRID_CALIBRATION_FIELD_STRENGTH = 0.85', () => {
    expect(HYBRID_CALIBRATION_FIELD_STRENGTH).toBe(0.85);
  });
  it('MICRO_RECALIB_MAX_DRIFT_PX = 250', () => {
    expect(MICRO_RECALIB_MAX_DRIFT_PX).toBe(250);
  });
  it('MICRO_RECALIB_WEIGHT = 0.85', () => {
    expect(MICRO_RECALIB_WEIGHT).toBe(0.85);
  });
  it('DEFICIENT_POINT_FACTOR = 1.5', () => {
    expect(DEFICIENT_POINT_FACTOR).toBe(1.5);
  });
  it('HYBRID_CALIB_CONFIDENCE_K = 14', () => {
    expect(HYBRID_CALIB_CONFIDENCE_K).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// hybridApplyCalibrationField
// ---------------------------------------------------------------------------

describe('hybridApplyCalibrationField', () => {
  it('empty samples returns input unchanged', () => {
    const result = hybridApplyCalibrationField(500, 400, rect, [], 0.85);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it('zero strength returns input unchanged', () => {
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(500, 400, rect, samples, 0);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it('zero-size rect returns input unchanged', () => {
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(500, 400, zeroRect, samples, 0.85);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it('point far outside image (u < -0.02) returns unchanged', () => {
    // rect: left=100, width=800. For u < -0.02: x < 100 + (-0.02)*800 = 84
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(80, 400, rect, samples, 0.85);
    expect(result).toEqual({ x: 80, y: 400 });
  });

  it('point far outside image (u > 1.02) returns unchanged', () => {
    // u > 1.02: x > 100 + 1.02*800 = 916
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(920, 400, rect, samples, 0.85);
    expect(result).toEqual({ x: 920, y: 400 });
  });

  it('point far outside image (v < -0.02) returns unchanged', () => {
    // v < -0.02: y < 100 + (-0.02)*600 = 88
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(500, 85, rect, samples, 0.85);
    expect(result).toEqual({ x: 500, y: 85 });
  });

  it('single residual — correction biased toward that residual', () => {
    const samples = [makeSample(0.5, 0.5, 20, 30)];
    const result = hybridApplyCalibrationField(500, 400, rect, samples, 1.0);
    // With a single sample, IDW reduces to just that sample's correction
    // dx = 20*1.0 = 20, dy = 30*1.0 = 30
    expect(result.x).toBeCloseTo(520, 0);
    expect(result.y).toBeCloseTo(430, 0);
  });

  it('multiple residuals — closer one has more influence (IDW)', () => {
    // Point at u=0.25, v=0.5 in the rect => x=300, y=400
    const sampleNear = makeSample(0.25, 0.5, 10, 0); // close to query point
    const sampleFar = makeSample(0.9, 0.9, -50, -50); // far from query point
    const result = hybridApplyCalibrationField(300, 400, rect, [sampleNear, sampleFar], 1.0);
    // Near sample dx=10 should dominate over far sample dx=-50
    expect(result.x).toBeGreaterThan(300); // net correction positive (toward near sample's dx)
  });

  it('result clamped to [0, windowWidth] x [0, windowHeight]', () => {
    // Large negative correction to push x below 0
    const samples = [makeSample(0.5, 0.5, -3000, -3000)];
    const result = hybridApplyCalibrationField(500, 400, rect, samples, 1.0);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('result clamped to upper bounds', () => {
    const samples = [makeSample(0.5, 0.5, 5000, 5000)];
    const result = hybridApplyCalibrationField(500, 400, rect, samples, 1.0);
    expect(result.x).toBe(1920);
    expect(result.y).toBe(1080);
  });

  it('negative strength returns input unchanged', () => {
    const samples = [makeSample(0.5, 0.5, 10, 10)];
    const result = hybridApplyCalibrationField(500, 400, rect, samples, -0.5);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it('strength scales the correction', () => {
    const samples = [makeSample(0.5, 0.5, 20, 0)];
    const fullStrength = hybridApplyCalibrationField(500, 400, rect, samples, 1.0);
    const halfStrength = hybridApplyCalibrationField(500, 400, rect, samples, 0.5);
    // Half strength should give ~half the correction
    const fullDx = fullStrength.x - 500;
    const halfDx = halfStrength.x - 500;
    expect(halfDx).toBeCloseTo(fullDx * 0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// hybridCalibrationRmsePx
// ---------------------------------------------------------------------------

describe('hybridCalibrationRmsePx', () => {
  it('empty returns 0', () => {
    expect(hybridCalibrationRmsePx([])).toBe(0);
  });

  it('single residual returns magnitude', () => {
    const s = makeSample(0, 0, 3, 4);
    // sqrt((3^2+4^2)/1) = sqrt(25) = 5
    expect(hybridCalibrationRmsePx([s])).toBe(5);
  });

  it('multiple residuals — correct RMSE formula', () => {
    const s1 = makeSample(0, 0, 3, 4);  // 25
    const s2 = makeSample(0, 0, 5, 12); // 169
    // sqrt((25+169)/2) = sqrt(97) = 9.8489...
    expect(hybridCalibrationRmsePx([s1, s2])).toBeCloseTo(Math.sqrt(97), 10);
  });

  it('all-zero residuals returns 0', () => {
    const samples = [makeSample(0, 0, 0, 0), makeSample(0.5, 0.5, 0, 0)];
    expect(hybridCalibrationRmsePx(samples)).toBe(0);
  });

  it('symmetric positive/negative dx,dy gives same result', () => {
    const a = [makeSample(0, 0, 3, 4)];
    const b = [makeSample(0, 0, -3, -4)];
    expect(hybridCalibrationRmsePx(a)).toBe(hybridCalibrationRmsePx(b));
  });
});

// ---------------------------------------------------------------------------
// computeMicroRecalibResidual
// ---------------------------------------------------------------------------

describe('computeMicroRecalibResidual', () => {
  it('small drift returns weighted residual placed in viewport coords like the calibration residuals', () => {
    // Target at u=0.5, v=0.5 => targetX = 100 + 0.5*800 = 500, targetY = 100 + 0.5*600 = 400
    // Gaze at (490, 395) => dx = 500-490 = 10, dy = 400-395 = 5
    // dist = sqrt(125) ~ 11.18 < 250
    const result = computeMicroRecalibResidual(0.5, 0.5, 490, 395, rect);
    expect(result).not.toBeNull();
    expect(result!.u).toBeCloseTo(500 / window.innerWidth, 10);
    expect(result!.v).toBeCloseTo(400 / window.innerHeight, 10);
    expect(result!.dx).toBeCloseTo(10 * MICRO_RECALIB_WEIGHT, 10);
    expect(result!.dy).toBeCloseTo(5 * MICRO_RECALIB_WEIGHT, 10);
  });

  it('drift > MICRO_RECALIB_MAX_DRIFT_PX returns null', () => {
    // Target at (500, 400), gaze far away at (100, 100)
    // dx = 400, dy = 300 => dist = 500 > 250
    const result = computeMicroRecalibResidual(0.5, 0.5, 100, 100, rect);
    expect(result).toBeNull();
  });

  it('drift exactly at MAX returns non-null', () => {
    // Target at u=0.5,v=0.5 => (500,400)
    // Need dist = 250 exactly. dx=250, dy=0 => gaze at (250,400)
    const result = computeMicroRecalibResidual(0.5, 0.5, 250, 400, rect);
    expect(result).not.toBeNull();
    expect(result!.dx).toBeCloseTo(250 * MICRO_RECALIB_WEIGHT, 5);
    expect(result!.dy).toBe(0);
  });

  it('zero drift returns zero residual', () => {
    const result = computeMicroRecalibResidual(0.5, 0.5, 500, 400, rect);
    expect(result).not.toBeNull();
    expect(result!.dx).toBe(0);
    expect(result!.dy).toBe(0);
  });

  it('corner target position works', () => {
    // u=0, v=0 => targetX = 100, targetY = 100
    const result = computeMicroRecalibResidual(0, 0, 95, 95, rect);
    expect(result).not.toBeNull();
    expect(result!.dx).toBeCloseTo(5 * MICRO_RECALIB_WEIGHT, 10);
    expect(result!.dy).toBeCloseTo(5 * MICRO_RECALIB_WEIGHT, 10);
  });
});

// ---------------------------------------------------------------------------
// computePointErrors
// ---------------------------------------------------------------------------

describe('computePointErrors', () => {
  it('empty returns empty', () => {
    expect(computePointErrors([])).toEqual([]);
  });

  it('computes magnitude for each residual', () => {
    const residuals = [
      makeSample(0, 0, 3, 4),   // 5
      makeSample(0, 0, 5, 12),  // 13
      makeSample(0, 0, 0, 0),   // 0
    ];
    const errors = computePointErrors(residuals);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toEqual({ index: 0, errorPx: 5 });
    expect(errors[1]).toEqual({ index: 1, errorPx: 13 });
    expect(errors[2]).toEqual({ index: 2, errorPx: 0 });
  });
});

// ---------------------------------------------------------------------------
// detectDeficientPoints
// ---------------------------------------------------------------------------

describe('detectDeficientPoints', () => {
  it('fewer than 3 residuals returns empty', () => {
    expect(detectDeficientPoints([])).toEqual([]);
    expect(detectDeficientPoints([makeSample(0, 0, 10, 10)])).toEqual([]);
    expect(detectDeficientPoints([
      makeSample(0, 0, 1, 0),
      makeSample(0, 0, 100, 0),
    ])).toEqual([]);
  });

  it('all similar errors returns empty (none > median * 1.5)', () => {
    const residuals = [
      makeSample(0, 0, 5, 0),   // error = 5
      makeSample(0, 0, 6, 0),   // error = 6
      makeSample(0, 0, 5.5, 0), // error = 5.5
    ];
    // median = 5.5, threshold = 5.5 * 1.5 = 8.25
    // max error is 6, which is < 8.25 => no deficient
    expect(detectDeficientPoints(residuals)).toEqual([]);
  });

  it('one outlier returns its index', () => {
    const residuals = [
      makeSample(0, 0, 3, 0),  // 3
      makeSample(0, 0, 4, 0),  // 4
      makeSample(0, 0, 5, 0),  // 5
      makeSample(0, 0, 50, 0), // 50 — outlier
    ];
    // sorted errors: [3, 4, 5, 50], median = (4+5)/2 = 4.5
    // threshold = 4.5 * 1.5 = 6.75
    // only index 3 (error=50) > 6.75
    const deficient = detectDeficientPoints(residuals);
    expect(deficient).toEqual([3]);
  });

  it('multiple outliers returned', () => {
    const residuals = [
      makeSample(0, 0, 2, 0),  // 2
      makeSample(0, 0, 3, 0),  // 3
      makeSample(0, 0, 50, 0), // 50
      makeSample(0, 0, 60, 0), // 60
      makeSample(0, 0, 2.5, 0), // 2.5
    ];
    // sorted: [2, 2.5, 3, 50, 60], median = 3
    // threshold = 3 * 1.5 = 4.5
    // indices 2 (50) and 3 (60) are deficient
    const deficient = detectDeficientPoints(residuals);
    expect(deficient).toContain(2);
    expect(deficient).toContain(3);
    expect(deficient).toHaveLength(2);
  });

  it('custom factor works', () => {
    const residuals = [
      makeSample(0, 0, 3, 0),  // 3
      makeSample(0, 0, 4, 0),  // 4
      makeSample(0, 0, 5, 0),  // 5
      makeSample(0, 0, 10, 0), // 10
    ];
    // median = (4+5)/2 = 4.5
    // factor=1.0 => threshold = 4.5 => indices 2 (5>4.5) and 3 (10>4.5)
    const deficient = detectDeficientPoints(residuals, 1.0);
    expect(deficient).toContain(2);
    expect(deficient).toContain(3);

    // factor=3.0 => threshold = 13.5 => none deficient
    const none = detectDeficientPoints(residuals, 3.0);
    expect(none).toEqual([]);
  });

  it('odd number of points — median is middle value', () => {
    const residuals = [
      makeSample(0, 0, 2, 0),  // 2
      makeSample(0, 0, 3, 0),  // 3
      makeSample(0, 0, 20, 0), // 20
    ];
    // sorted: [2, 3, 20], median = 3
    // threshold = 3 * 1.5 = 4.5 => index 2 (error=20)
    expect(detectDeficientPoints(residuals)).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// recalibratePartial
// ---------------------------------------------------------------------------

describe('recalibratePartial', () => {
  it('no deficient indices returns copy of original', () => {
    const original = [
      makeSample(0, 0, 3, 4),
      makeSample(0.5, 0.5, 5, 12),
    ];
    const result = recalibratePartial(original, [], []);
    expect(result).toEqual(original);
    expect(result).not.toBe(original); // new array
  });

  it('replaces specific indices, rest unchanged', () => {
    const original = [
      makeSample(0, 0, 3, 4),
      makeSample(0.25, 0.25, 10, 10),
      makeSample(0.5, 0.5, 5, 12),
      makeSample(0.75, 0.75, 2, 1),
    ];
    const replacement = [makeSample(0.25, 0.25, 1, 1)];
    const result = recalibratePartial(original, replacement, [1]);

    expect(result[0]).toEqual(original[0]); // unchanged
    expect(result[1]).toEqual(replacement[0]); // replaced
    expect(result[2]).toEqual(original[2]); // unchanged
    expect(result[3]).toEqual(original[3]); // unchanged
  });

  it('replaces multiple indices', () => {
    const original = [
      makeSample(0, 0, 100, 100),
      makeSample(0.5, 0, 2, 2),
      makeSample(1, 0, 200, 200),
    ];
    const replacements = [
      makeSample(0, 0, 1, 1),
      makeSample(1, 0, 3, 3),
    ];
    const result = recalibratePartial(original, replacements, [0, 2]);
    expect(result[0]).toEqual(replacements[0]);
    expect(result[1]).toEqual(original[1]);
    expect(result[2]).toEqual(replacements[1]);
  });

  it('out-of-range deficient index is harmless (no match)', () => {
    const original = [makeSample(0, 0, 1, 1)];
    const result = recalibratePartial(original, [makeSample(0, 0, 99, 99)], [5]);
    expect(result).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// hybridCalibrationConfidenceWeightUv
// ---------------------------------------------------------------------------

describe('hybridCalibrationConfidenceWeightUv', () => {
  it('empty samples returns 1', () => {
    expect(hybridCalibrationConfidenceWeightUv(0.5, 0.5, [])).toBe(1);
  });

  it('at exact sample position returns high weight close to 1', () => {
    const samples = [makeSample(0.5, 0.5, 0, 0)];
    const w = hybridCalibrationConfidenceWeightUv(0.5, 0.5, samples);
    // 1 / (1 + 14 * 0 + eps~0) => very close to 1
    // Actually minD2 = 0, so w = 1/(1 + 14*0) = 1
    expect(w).toBeCloseTo(1, 5);
  });

  it('far from all samples returns low weight', () => {
    const samples = [makeSample(0, 0, 0, 0)];
    // u=1, v=1 => minD2 = 1+1 = 2 => w = 1/(1+14*2) = 1/29
    const w = hybridCalibrationConfidenceWeightUv(1, 1, samples);
    expect(w).toBeCloseTo(1 / 29, 5);
    expect(w).toBeLessThan(0.1);
  });

  it('closer to sample gives higher weight', () => {
    const samples = [makeSample(0.5, 0.5, 0, 0)];
    const wClose = hybridCalibrationConfidenceWeightUv(0.51, 0.51, samples);
    const wFar = hybridCalibrationConfidenceWeightUv(0.9, 0.9, samples);
    expect(wClose).toBeGreaterThan(wFar);
  });

  it('custom k scales the falloff', () => {
    const samples = [makeSample(0.5, 0.5, 0, 0)];
    // At (0.6, 0.6): minD2 = 0.01 + 0.01 = 0.02
    const wDefaultK = hybridCalibrationConfidenceWeightUv(0.6, 0.6, samples);
    const wHighK = hybridCalibrationConfidenceWeightUv(0.6, 0.6, samples, 100);
    // Higher k => faster falloff => lower weight
    expect(wHighK).toBeLessThan(wDefaultK);
  });

  it('k=0 always returns 1 regardless of distance', () => {
    const samples = [makeSample(0, 0, 0, 0)];
    // w = 1/(1 + 0 * d2) = 1
    expect(hybridCalibrationConfidenceWeightUv(1, 1, samples, 0)).toBeCloseTo(1, 10);
  });

  it('multiple samples — uses minimum distance', () => {
    const samples = [
      makeSample(0, 0, 0, 0),  // far from (0.8, 0.8)
      makeSample(0.8, 0.8, 0, 0), // close to (0.8, 0.8)
    ];
    const w = hybridCalibrationConfidenceWeightUv(0.8, 0.8, samples);
    // minD2 ~ 0 (from second sample) => w ~ 1
    expect(w).toBeCloseTo(1, 3);
  });

  it('exact formula verification', () => {
    const samples = [makeSample(0.3, 0.4, 0, 0)];
    // At (0.5, 0.6): du=0.2, dv=0.2 => minD2 = 0.04+0.04 = 0.08
    // w = 1/(1 + 14 * 0.08) = 1/(1+1.12) = 1/2.12
    const w = hybridCalibrationConfidenceWeightUv(0.5, 0.6, samples);
    expect(w).toBeCloseTo(1 / 2.12, 4);
  });
});

describe('hybridResidualsFromTrainedPoints', () => {
  it('places each point on the calibration area and stores target minus trained prediction', () => {
    const residuals = hybridResidualsFromTrainedPoints(
      [{ targetX: 500, targetY: 400, predX: 470, predY: 440 }],
      rect,
    );
    expect(residuals).toEqual([{ u: 0.5, v: 0.5, dx: 30, dy: -40 }]);
    expect(hybridCalibrationRmsePx(residuals)).toBe(50);
  });
});
