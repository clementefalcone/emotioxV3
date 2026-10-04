/**
 * Gauntlet integration tests — end-to-end pipeline verification.
 * Tests the full chain: gaze samples → fixation detection → zone classification →
 * heatmap accumulation → gap filling → calibration → emotion classification.
 *
 * These catch cross-module contract violations that unit tests miss.
 */
import { describe, it, expect } from 'vitest';
import { detectFixationsIDT } from '../fixationDetector';
import { OneEuroFilter1D } from '../oneEuroFilter';
import { expandGazeWithMinimumJerkGapFill } from '../gazeGapFill';
import { hybridPointToZone, hybridPointToSoftZoneWeights, hybridModeZoneFromHistory, HYBRID_AOI_GRID } from '../hybridZoneGrid';
import {
  hybridApplyCalibrationField,
  hybridCalibrationRmsePx,
  detectDeficientPoints,
  recalibratePartial,
  type HybridCalibrationResidual,
} from '../hybridCalibrationField';
import { classifyEmotion, aggregateEmotionTimeline, type ActionUnits, type EmotionSample } from '../facsClassifier';
import { RidgeRegression } from '../ridgeRegression';
import { ProbabilisticHeatmap } from '../attention/probabilisticHeatmap';
import { fitCalibrationEllipses, computeFrameUncertainty, type CalibrationSample } from '../attention/uncertaintyEstimator';

const rect = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 } as DOMRect;

describe('Pipeline: filter → fixation → zone', () => {
  it('raw gaze samples filtered and classified into zones produce valid zone history', () => {
    const filterX = new OneEuroFilter1D(0.6, 0.007, 1.0);
    const filterY = new OneEuroFilter1D(0.6, 0.007, 1.0);

    const rawSamples = [
      { x: 500, y: 350, t: 0 },
      { x: 502, y: 348, t: 33 },
      { x: 498, y: 352, t: 66 },
      { x: 501, y: 349, t: 100 },
      { x: 503, y: 351, t: 133 },
      { x: 499, y: 350, t: 166 },
      { x: 500, y: 350, t: 200 },
    ];

    const filtered = rawSamples.map(s => ({
      x: filterX.filter(s.x, s.t / 1000),
      y: filterY.filter(s.y, s.t / 1000),
      t: s.t,
    }));

    // Filtered samples should have reduced jitter
    const rawVarianceX = rawSamples.reduce((sum, s) => sum + (s.x - 500) ** 2, 0) / rawSamples.length;
    const filtVarianceX = filtered.reduce((sum, s) => sum + (s.x - 500) ** 2, 0) / filtered.length;
    expect(filtVarianceX).toBeLessThanOrEqual(rawVarianceX);

    // Fixation detection on filtered samples
    const fixations = detectFixationsIDT(filtered, 70, 120);
    expect(fixations).toHaveLength(1);
    expect(fixations[0].duration).toBe(200);

    // Zone classification — fixation center should land in center zone
    const zone = hybridPointToZone(fixations[0].x, fixations[0].y, rect);
    expect(zone).toBe('r1c1');
  });

  it('zone voting stabilizes noisy classifications', () => {
    // Simulating jittery gaze near zone border r0c1/r1c1
    const borderY = rect.top + rect.height / 3; // boundary between row 0 and row 1
    const zones: (string | null)[] = [];

    for (let i = 0; i < 12; i++) {
      const jitter = (i % 3 === 0) ? -15 : 10;
      const zone = hybridPointToZone(rect.left + rect.width / 2, borderY + jitter, rect);
      zones.push(zone);
    }

    // Mode voting should stabilize to one zone
    const voted = hybridModeZoneFromHistory(zones, null);
    expect(voted).not.toBeNull();
    expect(HYBRID_AOI_GRID.some(z => z.id === voted)).toBe(true);
  });
});

describe('Pipeline: calibration → correction → fixation', () => {
  it('calibration field correction improves accuracy', () => {
    // Simulate systematic drift: gaze reads 20px right, 10px down
    const residuals: HybridCalibrationResidual[] = [
      { u: 0.25, v: 0.25, dx: -20, dy: -10 },
      { u: 0.75, v: 0.25, dx: -20, dy: -10 },
      { u: 0.25, v: 0.75, dx: -20, dy: -10 },
      { u: 0.75, v: 0.75, dx: -20, dy: -10 },
    ];

    // Raw gaze at image center (should be 500, 350 viewport)
    const rawX = 500 + 20; // drifted 20px right
    const rawY = 350 + 10; // drifted 10px down

    const corrected = hybridApplyCalibrationField(rawX, rawY, rect, residuals, 0.85);

    // Correction should move point closer to true position (500, 350)
    const rawError = Math.sqrt((rawX - 500) ** 2 + (rawY - 350) ** 2);
    const corrError = Math.sqrt((corrected.x - 500) ** 2 + (corrected.y - 350) ** 2);
    expect(corrError).toBeLessThan(rawError);
  });

  it('deficient point detection + partial recalibration improves RMSE', () => {
    const residuals: HybridCalibrationResidual[] = [
      { u: 0.25, v: 0.25, dx: 5, dy: 3 },   // good
      { u: 0.75, v: 0.25, dx: 4, dy: 2 },   // good
      { u: 0.25, v: 0.75, dx: 50, dy: 40 }, // bad — outlier
      { u: 0.75, v: 0.75, dx: 3, dy: 5 },   // good
    ];

    const deficient = detectDeficientPoints(residuals);
    expect(deficient).toContain(2); // index 2 is the outlier

    // Partial recalibration with improved residual
    const newPartial: HybridCalibrationResidual[] = [
      { u: 0.25, v: 0.75, dx: 6, dy: 4 },
    ];
    const improved = recalibratePartial(residuals, newPartial, deficient);

    const rmseBefore = hybridCalibrationRmsePx(residuals);
    const rmseAfter = hybridCalibrationRmsePx(improved);
    expect(rmseAfter).toBeLessThan(rmseBefore);
  });
});

describe('Pipeline: gap fill → heatmap accumulation', () => {
  it('gap-filled gaze produces smooth heatmap without gaps', () => {
    const rawPoints = [
      { x: 400, y: 300, t: 0 },
      { x: 400, y: 300, t: 50 },
      // 200ms gap here
      { x: 400, y: 300, t: 250 },
      { x: 400, y: 300, t: 300 },
    ];

    const filled = expandGazeWithMinimumJerkGapFill(rawPoints);
    expect(filled.length).toBeGreaterThan(rawPoints.length);

    const synthetic = filled.filter(s => s.interpolated);
    expect(synthetic.length).toBeGreaterThan(0);

    // All synthetic points should be in the valid coordinate range
    for (const s of synthetic) {
      expect(s.x).toBeGreaterThanOrEqual(400);
      expect(s.x).toBeLessThanOrEqual(400);
      expect(s.y).toBeGreaterThanOrEqual(300);
      expect(s.y).toBeLessThanOrEqual(300);
    }
  });

  it('heatmap from gap-filled gaze has higher total duration than raw', () => {
    const heatmapRaw = new ProbabilisticHeatmap(800, 600, 8);
    const heatmapFilled = new ProbabilisticHeatmap(800, 600, 8);

    const sigma = 80;
    const inv = 1 / (sigma * sigma);
    const unc = { sigma1: sigma, sigma2: sigma, theta: 0, a: inv, b: 0, c: inv };

    const rawPoints = [
      { x: 400, y: 300, t: 0 },
      { x: 400, y: 300, t: 50 },
      { x: 400, y: 300, t: 250 }, // 200ms gap
      { x: 400, y: 300, t: 300 },
    ];

    // Raw: 4 frames at ~50ms
    for (let i = 0; i < rawPoints.length; i++) {
      heatmapRaw.addSample(rawPoints[i].x, rawPoints[i].y, unc, 0.05);
    }

    // Filled: more frames from gap interpolation
    const filled = expandGazeWithMinimumJerkGapFill(rawPoints);
    for (let i = 0; i < filled.length; i++) {
      heatmapFilled.addSample(filled[i].x, filled[i].y, unc, 0.05);
    }

    expect(heatmapFilled.totalDurationS).toBeGreaterThan(heatmapRaw.totalDurationS);
  });
});

describe('Pipeline: Ridge regression → uncertainty → heatmap', () => {
  it('calibration residuals produce valid uncertainty ellipses for heatmap', () => {
    // Train a simple ridge model
    const ridge = new RidgeRegression();
    const corners: [number, number][] = [[0, 0], [960, 0], [0, 540], [960, 540]];
    const features = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
    for (let i = 0; i < 4; i++) {
      ridge.addSample(features[i], corners[i]);
    }
    ridge.train(1.0);

    // Generate calibration residuals
    const residuals: CalibrationSample[] = features.map((f, i) => {
      const pred = ridge.predict(f);
      return { u: f[0], v: f[1], dx: pred[0] - corners[i][0], dy: pred[1] - corners[i][1] };
    });

    // Fit uncertainty ellipses
    const ellipses = fitCalibrationEllipses(residuals);
    expect(ellipses.length).toBeGreaterThan(0);

    // Compute frame uncertainty at center
    const unc = computeFrameUncertainty(
      { gazeX: 480, gazeY: 270, rect: { left: 0, top: 0, width: 960, height: 540 }, velocity: 0, yaw: 0, pitch: 0, ear: 0.3 },
      ellipses,
    );

    expect(unc.sigma1).toBeGreaterThan(0);
    expect(unc.sigma2).toBeGreaterThan(0);
    expect(unc.a).toBeGreaterThan(0);
    expect(unc.c).toBeGreaterThan(0);

    // Use uncertainty in heatmap
    const heatmap = new ProbabilisticHeatmap(960, 540, 16);
    heatmap.addSample(480, 270, unc, 0.033);
    expect(heatmap.totalDurationS).toBeCloseTo(0.033, 3);

    const grid = heatmap.getNormalizedGrid();
    const maxVal = Math.max(...Array.from(grid));
    expect(maxVal).toBeCloseTo(1.0, 1);
  });
});

describe('Pipeline: emotion classification → aggregation', () => {
  it('a viewing session with varied emotions aggregates correctly', () => {
    // Simulate 5 seconds of viewing: 2s happy, 1s surprised, 2s neutral
    const samples: EmotionSample[] = [];
    const happyAUs: ActionUnits = { AU1: 0, AU2: 0, AU4: 0, AU6: 0.8, AU12: 0.9, AU15: 0, AU20: 0, AU25: 0.3, AU26: 0 };
    const surpriseAUs: ActionUnits = { AU1: 0.7, AU2: 0.7, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU20: 0, AU25: 0.6, AU26: 0.8 };
    const neutralAUs: ActionUnits = { AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU20: 0, AU25: 0, AU26: 0 };

    // 2s happy (40 frames at 50ms)
    for (let i = 0; i < 40; i++) {
      const { emotion, confidence } = classifyEmotion(happyAUs);
      samples.push({ timestamp: i * 50, emotion, confidence, actionUnits: happyAUs });
    }
    // 1s surprised (20 frames)
    for (let i = 0; i < 20; i++) {
      const { emotion, confidence } = classifyEmotion(surpriseAUs);
      samples.push({ timestamp: 2000 + i * 50, emotion, confidence, actionUnits: surpriseAUs });
    }
    // 2s neutral (40 frames)
    for (let i = 0; i < 40; i++) {
      const { emotion, confidence } = classifyEmotion(neutralAUs);
      samples.push({ timestamp: 3000 + i * 50, emotion, confidence, actionUnits: neutralAUs });
    }

    const agg = aggregateEmotionTimeline(samples);

    expect(agg.dominantEmotion).toBe('joy');
    // Joy should be ~40%, neutral ~40%, surprise ~20%
    expect(agg.distribution.joy).toBeGreaterThan(35);
    expect(agg.distribution.neutral).toBeGreaterThan(35);
    expect(agg.distribution.surprise).toBeGreaterThan(15);
    expect(agg.avgConfidence).toBeGreaterThan(0);
  });
});

describe('Pipeline: soft zone weights → heatmap AOI', () => {
  it('zone weights and heatmap AOI metrics are consistent', () => {
    // Gaze at center of image
    const gazeX = rect.left + rect.width / 2;
    const gazeY = rect.top + rect.height / 2;

    const weights = hybridPointToSoftZoneWeights(gazeX, gazeY, rect);
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
    expect(totalWeight).toBeCloseTo(1.0, 2);

    // Center zone should have one of the highest weights
    const sortedWeights = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    expect(sortedWeights[0][1]).toBeGreaterThan(0);

    // Zone from hard classification should be consistent — in top 2
    const hardZone = hybridPointToZone(gazeX, gazeY, rect);
    const topZoneIds = sortedWeights.slice(0, 2).map(([z]) => z);
    expect(topZoneIds).toContain(hardZone);
  });
});
