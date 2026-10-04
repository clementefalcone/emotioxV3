import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../config/database', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../config/local-storage', () => ({
  getMediaUrl: vi.fn((key: string) => `/api/media/${key}`),
}));

import { getEyeTrackingResults, getBenchmarkResults } from '../eye-tracking.analytics';
import pool from '../../../config/database';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a module config with eye tracking components. */
function buildETConfig(opts: {
  stimulusUrl?: string;
  stimulusS3Key?: string;
  modality?: string;
  shelfCheckbox?: boolean;
  aois?: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>;
  emotionRecognition?: boolean;
  taskDescription?: string;
  predictionHeatmap?: Array<{ x: number; y: number; value: number }>;
  predictionProcessedAt?: string;
} = {}) {
  const stimulusValue = opts.stimulusS3Key
    ? [{ s3Key: opts.stimulusS3Key }]
    : [{ url: opts.stimulusUrl || '/img.png' }];

  const components: any[] = [
    { id: 'stimuli', type: 'file-upload', value: JSON.stringify(stimulusValue) },
    { id: 'display-mode', value: opts.modality || 'stand_alone' },
    { id: 'task-instructions', value: opts.taskDescription || 'Look at the image' },
    { id: 'emotion-recognition', value: String(opts.emotionRecognition ?? true) },
  ];

  if (opts.aois) {
    components.push({ id: 'aois', value: JSON.stringify(opts.aois) });
  }
  if (opts.shelfCheckbox !== undefined) {
    components.push({ id: 'is-shelf-task', value: String(opts.shelfCheckbox) });
  }

  const config: any = { structure: { components } };
  if (opts.predictionHeatmap) config.predictionHeatmap = opts.predictionHeatmap;
  if (opts.predictionProcessedAt) config.predictionProcessedAt = opts.predictionProcessedAt;
  return config;
}

/** Build a participant eye tracking response row. */
function buildRow(pid: string, opts: {
  fixations?: Array<{ x: number; y: number; duration: number; timestamp?: number }>;
  calibrationRmsePx?: number | null;
  integrityScore?: number;
  calibrationQuality?: string;
  emotions?: Array<{ timestamp: number; emotion: string; confidence: number; actionUnits: Record<string, number> }>;
  microExpressions?: Array<{ emotion: string; durationMs: number; startTimestamp: number; category: string; peakConfidence: number }>;
  zoneMass?: Record<string, number>;
  v3?: any;
  stimulusType?: string;
  gazeTimeline?: Array<{ x: number; y: number; t: number; videoTime?: number }>;
  videoEnded?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
} = {}) {
  return {
    participant_id: pid,
    value: JSON.stringify({
      fixations: opts.fixations ?? [{ x: 100, y: 200, duration: 500, timestamp: 0 }],
      calibrationRmsePx: opts.calibrationRmsePx ?? 80,
      integrityScore: opts.integrityScore ?? 0.8,
      calibrationQuality: opts.calibrationQuality ?? 'good',
      ...(opts.emotions ? { emotions: opts.emotions } : {}),
      ...(opts.microExpressions ? { microExpressions: opts.microExpressions } : {}),
      ...(opts.zoneMass ? { zoneMass: opts.zoneMass } : {}),
      ...(opts.v3 ? { v3: opts.v3 } : {}),
      ...(opts.stimulusType ? { stimulusType: opts.stimulusType } : {}),
      ...(opts.gazeTimeline ? { gazeTimeline: opts.gazeTimeline } : {}),
      ...(opts.videoEnded !== undefined ? { videoEnded: opts.videoEnded } : {}),
      ...(opts.viewportWidth !== undefined ? { viewportWidth: opts.viewportWidth } : {}),
      ...(opts.viewportHeight !== undefined ? { viewportHeight: opts.viewportHeight } : {}),
    }),
    created_at: new Date(),
  };
}

/** Encode a Float64Array to base64 (mirrors backend encodeDensityBase64). */
function encodeF64(data: number[]): string {
  const f64 = new Float64Array(data);
  return Buffer.from(f64.buffer, f64.byteOffset, f64.byteLength).toString('base64');
}

/** Build a V3 participant payload. */
function buildV3Payload(opts: {
  cols?: number;
  rows?: number;
  density?: number[];
  firstAttention?: number[];
  peakTime?: number[];
  aoiMetrics?: Array<{ aoiId: string; label: string; expectedDwellS: number; attentionShare: number; firstAttentionMs: number | null; peakProbability: number }>;
  totalMassS?: number;
  totalDurationS?: number;
  confidence?: number;
  spatialCoverage?: number;
} = {}) {
  const cols = opts.cols ?? 2;
  const rows = opts.rows ?? 2;
  const gridSize = cols * rows;
  const density = opts.density ?? new Array(gridSize).fill(1.0);

  const heatmap: any = {
    cols, rows, cellW: 50, cellH: 50,
    densityBase64: encodeF64(density),
  };
  if (opts.firstAttention) heatmap.firstAttentionBase64 = encodeF64(opts.firstAttention);
  if (opts.peakTime) heatmap.peakTimeBase64 = encodeF64(opts.peakTime);

  return {
    version: 3,
    heatmap,
    aoiMetrics: opts.aoiMetrics ?? [],
    totalMassS: opts.totalMassS ?? density.reduce((a, b) => a + b, 0),
    totalDurationS: opts.totalDurationS ?? 10,
    massError: 0.01,
    confidence: {
      score: opts.confidence ?? 0.9,
      calibrationQuality: 0.95,
      validFrameRatio: 0.98,
      headStability: 0.92,
      effectiveDurationS: opts.totalDurationS ?? 10,
      spatialCoverage: opts.spatialCoverage ?? 0.7,
    },
    ellipses: [],
    pipeline: 'blazegaze-v3',
  };
}

/** Set up sequential mock query returns for getEyeTrackingResults.
 *  Pattern: stage lookup -> modules -> responses (per module)
 */
function setupStandardMocks(opts: {
  stageId?: string;
  modules?: Array<{ id: string; name: string; config: any }>;
  responses?: any[][];
  noStage?: boolean;
}) {
  const calls: any[] = [];

  // Stage query
  if (opts.noStage) {
    calls.push({ rows: [] });
  } else {
    calls.push({ rows: [{ stage_id: opts.stageId || 'stage-1', stage_name: 'Eye Tracking' }] });
  }

  // Module query
  if (!opts.noStage) {
    const mods = opts.modules || [{ id: 'mod-1', name: 'Stimulus 1', config: JSON.stringify(buildETConfig()) }];
    calls.push({ rows: mods.map(m => ({ ...m, config: typeof m.config === 'string' ? m.config : JSON.stringify(m.config) })) });

    // Responses per module
    const resps = opts.responses || [[]];
    for (const r of resps) {
      calls.push({ rows: r });
    }
  }

  for (const c of calls) {
    mockQuery.mockResolvedValueOnce(c);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// getEyeTrackingResults
// ===========================================================================

describe('getEyeTrackingResults', () => {
  // -----------------------------------------------------------------------
  // Basic flow
  // -----------------------------------------------------------------------

  it('returns empty stimuli when no Eye Tracking stage exists', async () => {
    setupStandardMocks({ noStage: true });
    const result = await getEyeTrackingResults('research-1');
    expect(result).toEqual({ stimuli: [] });
  });

  it('returns stimulus with zeroed metrics when no responses exist', async () => {
    setupStandardMocks({ responses: [[]] });
    const result = await getEyeTrackingResults('research-1');

    expect(result.stimuli).toHaveLength(1);
    const s = result.stimuli[0];
    expect(s.moduleId).toBe('mod-1');
    expect(s.uniqueParticipants).toBe(0);
    expect(s.avgDwellTime).toBe(0);
    expect(s.avgFixationCount).toBe(0);
    expect(s.heatmapData).toEqual([]);
    expect(s.fixations).toEqual([]);
    expect(s.totalResponses).toBe(0);
    expect(s.qualitySummary).toEqual({ total: 0, good: 0, fair: 0, low: 0 });
  });

  it('computes correct metrics for a single participant', async () => {
    const row = buildRow('p1', {
      fixations: [
        { x: 10, y: 20, duration: 300, timestamp: 0 },
        { x: 50, y: 60, duration: 200, timestamp: 300 },
        { x: 70, y: 80, duration: 100, timestamp: 500 },
      ],
      calibrationRmsePx: 60,
      integrityScore: 0.9,
    });
    setupStandardMocks({ responses: [[row]] });

    const result = await getEyeTrackingResults('research-1');
    const s = result.stimuli[0];

    expect(s.uniqueParticipants).toBe(1);
    expect(s.avgDwellTime).toBe(600); // (300 + 200 + 100) / 1
    expect(s.avgFixationCount).toBe(3);
    expect(s.totalResponses).toBe(1);
    expect(s.heatmapData).toHaveLength(3);
    expect(s.fixations).toHaveLength(3);
    expect(s.participants).toHaveLength(1);
    expect(s.participants[0].qualityGrade).toBe('good');
  });

  it('aggregates metrics across multiple participants', async () => {
    const rows = [
      buildRow('p1', {
        fixations: [
          { x: 10, y: 20, duration: 400, timestamp: 0 },
          { x: 30, y: 40, duration: 200, timestamp: 400 },
        ],
        calibrationRmsePx: 50,
        integrityScore: 0.9,
      }),
      buildRow('p2', {
        fixations: [
          { x: 50, y: 60, duration: 600, timestamp: 0 },
        ],
        calibrationRmsePx: 70,
        integrityScore: 0.85,
      }),
    ];
    setupStandardMocks({ responses: [rows] });

    const result = await getEyeTrackingResults('research-1');
    const s = result.stimuli[0];

    expect(s.uniqueParticipants).toBe(2);
    // p1 dwell = 600, p2 dwell = 600. avg = 1200/2 = 600
    expect(s.avgDwellTime).toBe(600);
    // p1 fixations = 2, p2 fixations = 1. total = 3. avg = 3/2 = 2 (rounded)
    expect(s.avgFixationCount).toBe(2);
    expect(s.totalResponses).toBe(2);
    expect(s.heatmapData).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // Quality classification
  // -----------------------------------------------------------------------

  describe('quality classification', () => {
    it('classifies as good: RMSE < 140, integrity > 0.6, fixations >= 3', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 80,
        integrityScore: 0.9,
        calibrationQuality: 'good',
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('good');
    });

    it('classifies click-proxy as fair (never good)', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 50,
        integrityScore: 0.95,
        calibrationQuality: 'click-proxy',
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('fair');
    });

    it('classifies as fair when RMSE is between 140 and 200', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 160, // 200 * 0.7 = 140; 160 > 140 => fair
        integrityScore: 0.9,
        calibrationQuality: 'good',
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('fair');
    });

    it('classifies as fair when integrity is between 0.4 and 0.6', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 80,
        integrityScore: 0.5, // 0.4 * 1.5 = 0.6; 0.5 < 0.6 => fair
        calibrationQuality: 'good',
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('fair');
    });

    it('classifies as low when RMSE > 200', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 250,
        integrityScore: 0.9,
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('low');
    });

    it('classifies as low when integrity < 0.4', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
          { x: 30, y: 30, duration: 100, timestamp: 200 },
        ],
        calibrationRmsePx: 80,
        integrityScore: 0.3,
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('low');
    });

    it('classifies as low when fixations < 3', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 10, y: 10, duration: 100, timestamp: 0 },
          { x: 20, y: 20, duration: 100, timestamp: 100 },
        ],
        calibrationRmsePx: 50,
        integrityScore: 0.95,
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].participants[0].qualityGrade).toBe('low');
    });
  });

  // -----------------------------------------------------------------------
  // Quality gate — exclusion / fallback
  // -----------------------------------------------------------------------

  describe('quality gate', () => {
    it('excludes low-quality participants from heatmap and AOI aggregates', async () => {
      const rows = [
        buildRow('p-good', {
          fixations: [
            { x: 10, y: 10, duration: 300, timestamp: 0 },
            { x: 20, y: 20, duration: 200, timestamp: 300 },
            { x: 30, y: 30, duration: 100, timestamp: 500 },
          ],
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
        buildRow('p-low', {
          fixations: [
            { x: 90, y: 90, duration: 999, timestamp: 0 },
          ], // only 1 fixation => low
          calibrationRmsePx: 50,
          integrityScore: 0.9,
        }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const s = result.stimuli[0];

      // p-low excluded from aggregates
      expect(s.heatmapData).toHaveLength(3);
      expect(s.fixations).toHaveLength(4);
      expect(s.uniqueParticipants).toBe(1); // only p-good
      // But both appear in participants list
      expect(s.participants).toHaveLength(2);
      expect(s.qualitySummary).toEqual({ total: 2, good: 1, fair: 0, low: 1 });
    });

    it('keeps all participants when ALL are low quality (fallback)', async () => {
      const rows = [
        buildRow('p1', {
          fixations: [{ x: 10, y: 10, duration: 100, timestamp: 0 }],
          calibrationRmsePx: 250,
          integrityScore: 0.2,
        }),
        buildRow('p2', {
          fixations: [{ x: 20, y: 20, duration: 200, timestamp: 0 }],
          calibrationRmsePx: 300,
          integrityScore: 0.1,
        }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const s = result.stimuli[0];

      // Fallback: keep all because excluding would leave 0
      expect(s.heatmapData).toHaveLength(2);
      expect(s.fixations).toHaveLength(2);
      expect(s.uniqueParticipants).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // AOI metrics
  // -----------------------------------------------------------------------

  describe('AOI metrics', () => {
    const aois = [
      { id: 'aoi-1', label: 'Logo', x: 0, y: 0, width: 10, height: 10 },
      { id: 'aoi-2', label: 'CTA', x: 20, y: 20, width: 10, height: 10 },
    ];

    it('computes high dwellTimePercent for fixation inside AOI', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 50, y: 50, duration: 800, timestamp: 0 },   // inside aoi-1
          { x: 500, y: 500, duration: 200, timestamp: 800 }, // outside both
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const logoAoi = result.stimuli[0].aois.find(a => a.label === 'Logo')!;
      const ctaAoi = result.stimuli[0].aois.find(a => a.label === 'CTA')!;

      expect(logoAoi.dwellTimePercent).toBeGreaterThan(50);
      expect(logoAoi.fixationCount).toBeGreaterThanOrEqual(1);
      expect(logoAoi.participantCount).toBe(1);
      expect(ctaAoi.dwellTimePercent).toBe(0);
      expect(ctaAoi.participantCount).toBe(0);
    });

    it('gives 0% dwell to AOI when all fixations are far outside', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 500, y: 500, duration: 300, timestamp: 0 },
          { x: 600, y: 600, duration: 300, timestamp: 300 },
          { x: 700, y: 700, duration: 300, timestamp: 600 },
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      for (const aoi of result.stimuli[0].aois) {
        expect(aoi.dwellTimePercent).toBe(0);
      }
    });

    it('soft Gaussian: fixation just outside AOI contributes partial weight', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 110, y: 50, duration: 500, timestamp: 0 },
          { x: 250, y: 250, duration: 500, timestamp: 500 }, // inside aoi-2
          { x: 900, y: 900, duration: 500, timestamp: 1000 }, // nowhere
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const logoAoi = result.stimuli[0].aois.find(a => a.label === 'Logo')!;

      // Should have partial contribution (not zero and not full 100%)
      expect(logoAoi.dwellTimePercent).toBeGreaterThan(0);
      expect(logoAoi.fixationCount).toBeGreaterThanOrEqual(1);
    });

    it('computes per-AOI metrics independently', async () => {
      const row = buildRow('p1', {
        fixations: [
          { x: 50, y: 50, duration: 400, timestamp: 0 },     // inside aoi-1
          { x: 250, y: 250, duration: 600, timestamp: 400 },   // inside aoi-2
          { x: 50, y: 50, duration: 200, timestamp: 1000 },    // inside aoi-1 again
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const logoAoi = result.stimuli[0].aois.find(a => a.label === 'Logo')!;
      const ctaAoi = result.stimuli[0].aois.find(a => a.label === 'CTA')!;

      expect(logoAoi.dwellTimePercent).toBe(50); // 600/1200 = 50%
      expect(ctaAoi.dwellTimePercent).toBe(50);   // 600/1200 = 50%
      expect(logoAoi.participantCount).toBe(1);
      expect(ctaAoi.participantCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Sequence analysis
  // -----------------------------------------------------------------------

  describe('sequence analysis', () => {
    it('builds transition matrix A->B = 100% for sequential fixations', async () => {
      const aois = [
        { id: 'aoi-A', label: 'A', x: 0, y: 0, width: 10, height: 10 },
        { id: 'aoi-B', label: 'B', x: 20, y: 0, width: 10, height: 10 },
      ];
      const row = buildRow('p1', {
        fixations: [
          { x: 50, y: 50, duration: 200, timestamp: 0 },     // A
          { x: 250, y: 50, duration: 200, timestamp: 200 },   // B
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const seq = result.stimuli[0].sequenceAnalysis!;

      expect(seq).toBeDefined();
      expect(seq.aoiLabels).toEqual(['A', 'B']);
      expect(seq.transitionMatrix['A']['B']).toBe(100);
      expect(seq.transitionMatrix['A']['A']).toBe(0);
      expect(seq.participantSequences).toHaveLength(1);
      expect(seq.participantSequences[0].sequence).toEqual(['A', 'B']);
    });

    it('deduplicates consecutive same-AOI fixations in sequence', async () => {
      const aois = [
        { id: 'aoi-A', label: 'A', x: 0, y: 0, width: 10, height: 10 },
        { id: 'aoi-B', label: 'B', x: 20, y: 0, width: 10, height: 10 },
      ];
      const row = buildRow('p1', {
        fixations: [
          { x: 50, y: 50, duration: 100, timestamp: 0 },     // A
          { x: 60, y: 60, duration: 100, timestamp: 100 },    // A (same AOI)
          { x: 250, y: 50, duration: 100, timestamp: 200 },   // B
        ],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
        viewportWidth: 1000,
        viewportHeight: 1000,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const seq = result.stimuli[0].sequenceAnalysis!;
      expect(seq.participantSequences[0].sequence).toEqual(['A', 'B']);
    });

    it('skips sequence analysis when fewer than 2 AOIs', async () => {
      const aois = [
        { id: 'aoi-A', label: 'A', x: 0, y: 0, width: 100, height: 100 },
      ];
      const row = buildRow('p1', {
        fixations: [{ x: 50, y: 50, duration: 200, timestamp: 0 }],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].sequenceAnalysis).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Emotion metrics
  // -----------------------------------------------------------------------

  describe('emotion metrics', () => {
    it('returns enabled:false when emotion recognition is disabled', async () => {
      const row = buildRow('p1', { calibrationRmsePx: 60, integrityScore: 0.9 });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: false }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const em = result.stimuli[0].emotions;
      expect(em.enabled).toBe(false);
      expect(em.totalSamples).toBe(0);
      expect(em.perParticipant).toEqual([]);
    });

    it('returns enabled:true with 0 samples when no emotion data in responses', async () => {
      const row = buildRow('p1', { calibrationRmsePx: 60, integrityScore: 0.9 });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const em = result.stimuli[0].emotions;
      expect(em.enabled).toBe(true);
      expect(em.totalSamples).toBe(0);
      expect(em.dominantEmotion).toBe('neutral');
      expect(em.avgConfidence).toBe(0);
    });

    it('computes correct distribution and dominant emotion', async () => {
      const emotions = [
        { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: {} },
        { timestamp: 100, emotion: 'joy', confidence: 0.8, actionUnits: {} },
        { timestamp: 200, emotion: 'surprise', confidence: 0.7, actionUnits: {} },
      ];
      const row = buildRow('p1', {
        emotions,
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const em = result.stimuli[0].emotions;

      expect(em.totalSamples).toBe(3);
      expect(em.dominantEmotion).toBe('joy');
      // joy = 2/3 = 66.67%, surprise = 1/3 = 33.33%
      expect(em.distribution.joy).toBeCloseTo(66.67, 1);
      expect(em.distribution.surprise).toBeCloseTo(33.33, 1);
      expect(em.distribution.sadness).toBe(0);
    });

    it('computes avgConfidence correctly', async () => {
      const emotions = [
        { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: {} },
        { timestamp: 100, emotion: 'joy', confidence: 0.7, actionUnits: {} },
      ];
      const row = buildRow('p1', {
        emotions,
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].emotions.avgConfidence).toBeCloseTo(0.8, 5);
    });

    it('produces perParticipant entries per participant with emotions', async () => {
      const rows = [
        buildRow('p1', {
          emotions: [
            { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: {} },
            { timestamp: 100, emotion: 'anger', confidence: 0.8, actionUnits: {} },
          ],
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
        buildRow('p2', {
          emotions: [
            { timestamp: 0, emotion: 'surprise', confidence: 0.7, actionUnits: {} },
          ],
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
      ];
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [rows],
      });

      const result = await getEyeTrackingResults('research-1');
      const em = result.stimuli[0].emotions;

      expect(em.perParticipant).toHaveLength(2);
      const p1 = em.perParticipant.find(p => p.participantId === 'p1')!;
      expect(p1.sampleCount).toBe(2);
      expect(p1.dominantEmotion).toBe('joy'); // joy=1, anger=1 but joy comes first alphabetically? No — they tie, so first in reduce wins. joy and anger both have 1, but reduce starts with neutral=0 so first to exceed is joy at idx 0.
    });

    it('builds downsampled timeline with 1s buckets', async () => {
      const emotions: Array<{ timestamp: number; emotion: string; confidence: number; actionUnits: Record<string, number> }> = [
        { timestamp: 100, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 0.8 } },
        { timestamp: 500, emotion: 'joy', confidence: 0.7, actionUnits: { AU6: 0.6 } },
        { timestamp: 1200, emotion: 'surprise', confidence: 0.8, actionUnits: { AU1: 0.5 } },
      ];
      const row = buildRow('p1', {
        emotions,
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      const timeline = result.stimuli[0].emotions.timeline;

      // Bucket 0ms: timestamps 100, 500 -> both joy
      // Bucket 1000ms: timestamp 1200 -> surprise
      expect(timeline).toHaveLength(2);
      expect(timeline[0].timestamp).toBe(0);
      expect(timeline[0].emotion).toBe('joy');
      expect(timeline[1].timestamp).toBe(1000);
      expect(timeline[1].emotion).toBe('surprise');
    });

    it('aggregates micro-expressions across participants', async () => {
      // Note: emotion samples are required — without them computeEmotionMetrics
      // returns early (allSamples.length === 0) before reaching micro-expression aggregation.
      const rows = [
        buildRow('p1', {
          emotions: [
            { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: {} },
          ],
          microExpressions: [
            { emotion: 'fear', durationMs: 80, startTimestamp: 500, category: 'micro', peakConfidence: 0.7 },
          ],
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
        buildRow('p2', {
          emotions: [
            { timestamp: 0, emotion: 'neutral', confidence: 0.8, actionUnits: {} },
          ],
          microExpressions: [
            { emotion: 'surprise', durationMs: 200, startTimestamp: 300, category: 'brief', peakConfidence: 0.8 },
          ],
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
      ];
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ emotionRecognition: true }) }],
        responses: [rows],
      });

      const result = await getEyeTrackingResults('research-1');
      const micro = result.stimuli[0].emotions.microExpressions!;

      expect(micro).toBeDefined();
      expect(micro.total).toBe(2);
      expect(micro.microCount).toBe(1);
      expect(micro.briefCount).toBe(1);
      expect(micro.byEmotion).toEqual({ fear: 1, surprise: 1 });
      expect(micro.events).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Config extraction
  // -----------------------------------------------------------------------

  describe('config extraction', () => {
    it('extracts stimulus URL from file-upload component', async () => {
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ stimulusUrl: 'https://example.com/img.jpg' }) }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].stimulusUrl).toBe('https://example.com/img.jpg');
    });

    it('resolves s3Key via getMediaUrl when no url in stimulus', async () => {
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ stimulusS3Key: 'uploads/photo.png' }) }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].stimulusUrl).toBe('/api/media/uploads/photo.png');
    });

    it('detects shelf modality from display-mode component', async () => {
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ modality: 'shelf' }) }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].modality).toBe('shelf');
    });

    it('detects shelf modality from is-shelf-task checkbox fallback', async () => {
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ modality: 'stand_alone', shelfCheckbox: true }) }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].modality).toBe('shelf');
    });

    it('parses AOIs from config', async () => {
      const aois = [
        { id: 'a1', label: 'Logo', x: 10, y: 20, width: 50, height: 60 },
      ];
      const row = buildRow('p1', {
        fixations: [{ x: 35, y: 50, duration: 300, timestamp: 0 }],
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ aois }) }],
        responses: [[row]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].aois).toHaveLength(1);
      expect(result.stimuli[0].aois[0].label).toBe('Logo');
    });

    it('defaults to stand_alone with empty URL for malformed config', async () => {
      const config = { structure: { components: [] } };
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].stimulusUrl).toBe('');
      expect(result.stimuli[0].modality).toBe('stand_alone');
    });

    it('extracts taskDescription from task-instructions component', async () => {
      setupStandardMocks({
        modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ taskDescription: 'Focus on the logo' }) }],
        responses: [[]],
      });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].taskDescription).toBe('Focus on the logo');
    });
  });

  // -----------------------------------------------------------------------
  // V3 heatmap
  // -----------------------------------------------------------------------

  describe('V3 heatmap', () => {
    it('returns undefined v3Heatmap when no V3 data in responses', async () => {
      const row = buildRow('p1', { calibrationRmsePx: 60, integrityScore: 0.9 });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].v3Heatmap).toBeUndefined();
    });

    it('aggregates V3 data from a single participant', async () => {
      const v3 = buildV3Payload({ density: [1.0, 2.0, 3.0, 4.0], confidence: 0.85, spatialCoverage: 0.6 });
      const row = buildRow('p1', {
        v3,
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      const h = result.stimuli[0].v3Heatmap!;

      expect(h).toBeDefined();
      expect(h.cols).toBe(2);
      expect(h.rows).toBe(2);
      expect(h.participantCount).toBe(1);
      expect(h.avgConfidence).toBeCloseTo(0.85, 5);
      expect(h.avgSpatialCoverage).toBeCloseTo(0.6, 5);

      // Decode density to verify values
      const densityBuf = Buffer.from(h.densityBase64, 'base64');
      const density = new Float64Array(densityBuf.buffer, densityBuf.byteOffset, 4);
      expect(density[0]).toBeCloseTo(1.0);
      expect(density[3]).toBeCloseTo(4.0);

      // Normalized: max = 4.0, so cell[3] should be 1.0
      const normBuf = Buffer.from(h.normalizedBase64, 'base64');
      const norm = new Float64Array(normBuf.buffer, normBuf.byteOffset, 4);
      expect(norm[3]).toBeCloseTo(1.0);
      expect(norm[0]).toBeCloseTo(0.25);
    });

    it('sums density grids from two participants and normalizes', async () => {
      const v3a = buildV3Payload({ density: [1.0, 0.0, 0.0, 0.0], confidence: 0.8, spatialCoverage: 0.5 });
      const v3b = buildV3Payload({ density: [0.0, 0.0, 0.0, 3.0], confidence: 0.9, spatialCoverage: 0.7 });

      const rows = [
        buildRow('p1', { v3: v3a, calibrationRmsePx: 60, integrityScore: 0.9 }),
        buildRow('p2', { v3: v3b, calibrationRmsePx: 60, integrityScore: 0.9 }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const h = result.stimuli[0].v3Heatmap!;

      expect(h.participantCount).toBe(2);
      expect(h.avgConfidence).toBeCloseTo(0.85, 5);
      expect(h.avgSpatialCoverage).toBeCloseTo(0.6, 5);

      const densityBuf = Buffer.from(h.densityBase64, 'base64');
      const density = new Float64Array(densityBuf.buffer, densityBuf.byteOffset, 4);
      expect(density[0]).toBeCloseTo(1.0);
      expect(density[3]).toBeCloseTo(3.0);

      const normBuf = Buffer.from(h.normalizedBase64, 'base64');
      const norm = new Float64Array(normBuf.buffer, normBuf.byteOffset, 4);
      // max = 3.0, so cell[0] = 1/3, cell[3] = 1.0
      expect(norm[0]).toBeCloseTo(1 / 3, 4);
      expect(norm[3]).toBeCloseTo(1.0);
    });

    it('skips participant with mismatched grid dimensions', async () => {
      const v3a = buildV3Payload({ cols: 2, rows: 2, density: [1.0, 2.0, 3.0, 4.0] });
      const v3b = buildV3Payload({ cols: 3, rows: 3, density: new Array(9).fill(1.0) });

      const rows = [
        buildRow('p1', { v3: v3a, calibrationRmsePx: 60, integrityScore: 0.9 }),
        buildRow('p2', { v3: v3b, calibrationRmsePx: 60, integrityScore: 0.9 }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const h = result.stimuli[0].v3Heatmap!;

      // Only p1 with 2x2 grid should be included
      expect(h.participantCount).toBe(1);
      expect(h.cols).toBe(2);
      expect(h.rows).toBe(2);
    });

    it('handles temporal data: firstAttention = min, peakTime from highest contributor', async () => {
      const v3a = buildV3Payload({
        density: [2.0, 0.0, 0.0, 0.0],
        firstAttention: [100, 200, 300, 400],
        peakTime: [0.5, 1.0, 1.5, 2.0],
      });
      const v3b = buildV3Payload({
        density: [0.0, 0.0, 0.0, 5.0],
        firstAttention: [50, 300, 100, 500],
        peakTime: [0.1, 0.2, 0.3, 0.4],
      });

      const rows = [
        buildRow('p1', { v3: v3a, calibrationRmsePx: 60, integrityScore: 0.9 }),
        buildRow('p2', { v3: v3b, calibrationRmsePx: 60, integrityScore: 0.9 }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const h = result.stimuli[0].v3Heatmap!;

      expect(h.hasTemporalData).toBe(true);
      expect(h.firstAttentionBase64).toBeDefined();
      expect(h.peakTimeBase64).toBeDefined();

      // First attention = min across participants per cell
      const faBuf = Buffer.from(h.firstAttentionBase64!, 'base64');
      const fa = new Float64Array(faBuf.buffer, faBuf.byteOffset, 4);
      expect(fa[0]).toBeCloseTo(50);  // min(100, 50)
      expect(fa[1]).toBeCloseTo(200); // min(200, 300)

      // Peak time from highest density contributor
      const ptBuf = Buffer.from(h.peakTimeBase64!, 'base64');
      const pt = new Float64Array(ptBuf.buffer, ptBuf.byteOffset, 4);
      expect(pt[0]).toBeCloseTo(0.5); // p1 has density 2.0 > p2 0.0, so p1 peakTime
      expect(pt[3]).toBeCloseTo(0.4); // p2 has density 5.0 > p1 0.0, so p2 peakTime
    });

    it('aggregates AOI metrics across participants', async () => {
      const aoiMetrics = [
        { aoiId: 'a1', label: 'Logo', expectedDwellS: 2.0, attentionShare: 0.4, firstAttentionMs: 500, peakProbability: 0.8 },
      ];
      const v3a = buildV3Payload({ aoiMetrics });
      const v3b = buildV3Payload({
        aoiMetrics: [
          { aoiId: 'a1', label: 'Logo', expectedDwellS: 3.0, attentionShare: 0.6, firstAttentionMs: 200, peakProbability: 0.9 },
        ],
      });

      const rows = [
        buildRow('p1', { v3: v3a, calibrationRmsePx: 60, integrityScore: 0.9 }),
        buildRow('p2', { v3: v3b, calibrationRmsePx: 60, integrityScore: 0.9 }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const h = result.stimuli[0].v3Heatmap!;

      expect(h.aoiMetrics).toHaveLength(1);
      const aoi = h.aoiMetrics[0];
      expect(aoi.aoiId).toBe('a1');
      expect(aoi.totalDwellS).toBeCloseTo(5.0);
      expect(aoi.avgAttentionShare).toBeCloseTo(0.5); // (0.4 + 0.6) / 2
      expect(aoi.earliestFirstAttentionMs).toBe(200); // min(500, 200)
      expect(aoi.participantCount).toBe(2);
    });

    it('includes perParticipant summary in V3 heatmap', async () => {
      const v3 = buildV3Payload({ totalMassS: 5.5, totalDurationS: 12, confidence: 0.88, spatialCoverage: 0.65 });
      const row = buildRow('p1', { v3, calibrationRmsePx: 60, integrityScore: 0.9 });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      const pp = result.stimuli[0].v3Heatmap!.perParticipant;

      expect(pp).toHaveLength(1);
      expect(pp[0].participantId).toBe('p1');
      expect(pp[0].totalDurationS).toBe(12);
      expect(pp[0].totalMassS).toBe(5.5);
      expect(pp[0].confidence).toBeCloseTo(0.88);
      expect(pp[0].spatialCoverage).toBeCloseTo(0.65);
    });
  });

  // -----------------------------------------------------------------------
  // Video stimulus
  // -----------------------------------------------------------------------

  describe('video stimulus', () => {
    it('detects video stimulusType from response data', async () => {
      const row = buildRow('p1', {
        stimulusType: 'video',
        gazeTimeline: [
          { x: 10, y: 20, t: 0, videoTime: 0.5 },
          { x: 30, y: 40, t: 100, videoTime: 1.0 },
        ],
        videoEnded: true,
        calibrationRmsePx: 60,
        integrityScore: 0.9,
      });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      const s = result.stimuli[0];

      expect(s.stimulusType).toBe('video');
      expect(s.gazeTimeline).toHaveLength(2);
      expect(s.gazeTimeline![0].participantId).toBe('p1');
    });

    it('computes videoQuality metrics for video stimuli', async () => {
      const rows = [
        buildRow('p1', {
          stimulusType: 'video',
          gazeTimeline: [
            { x: 10, y: 20, t: 0, videoTime: 0.0 },
            { x: 30, y: 40, t: 100, videoTime: 0.5 },
            { x: 50, y: 60, t: 200, videoTime: 1.0 },
            { x: 70, y: 80, t: 300, videoTime: 2.0 },
          ],
          videoEnded: true,
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
        buildRow('p2', {
          stimulusType: 'video',
          gazeTimeline: [
            { x: 10, y: 20, t: 0, videoTime: 0.0 },
          ],
          videoEnded: false,
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const vq = result.stimuli[0].videoQuality!;

      expect(vq).toBeDefined();
      expect(vq.completionRate).toBe(50); // 1/2
      expect(vq.completed).toBe(1);
      expect(vq.total).toBe(2);
      expect(vq.videoDurationS).toBe(2.0);
      // 500ms bins for 2s video = 4 bins. Occupied: 0, 1, 2, 4 => bins 0,1,2,4 = 4 unique out of 4
      expect(vq.gazeCoverage).toBeGreaterThan(0);
    });

    it('does not set videoQuality for image stimuli', async () => {
      const row = buildRow('p1', { calibrationRmsePx: 60, integrityScore: 0.9 });
      setupStandardMocks({ responses: [[row]] });

      const result = await getEyeTrackingResults('research-1');
      expect(result.stimuli[0].videoQuality).toBeUndefined();
      expect(result.stimuli[0].stimulusType).toBe('image');
    });
  });

  // -----------------------------------------------------------------------
  // ZoneMass aggregation
  // -----------------------------------------------------------------------

  describe('zoneMass aggregation', () => {
    it('aggregates zoneMass from quality-passing responses', async () => {
      const rows = [
        buildRow('p1', {
          fixations: [
            { x: 10, y: 10, duration: 100, timestamp: 0 },
            { x: 20, y: 20, duration: 100, timestamp: 100 },
            { x: 30, y: 30, duration: 100, timestamp: 200 },
          ],
          zoneMass: { 'zone-A': 1.5, 'zone-B': 0.5 },
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
        buildRow('p2', {
          fixations: [
            { x: 10, y: 10, duration: 100, timestamp: 0 },
            { x: 20, y: 20, duration: 100, timestamp: 100 },
            { x: 30, y: 30, duration: 100, timestamp: 200 },
          ],
          zoneMass: { 'zone-A': 2.0, 'zone-C': 1.0 },
          calibrationRmsePx: 60,
          integrityScore: 0.9,
        }),
      ];
      setupStandardMocks({ responses: [rows] });

      const result = await getEyeTrackingResults('research-1');
      const zm = (result.stimuli[0] as any).zoneMass;

      expect(zm['zone-A']).toBeCloseTo(3.5);
      expect(zm['zone-B']).toBeCloseTo(0.5);
      expect(zm['zone-C']).toBeCloseTo(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Prediction heatmap pass-through
  // -----------------------------------------------------------------------

  it('passes through predictionHeatmap from module config', async () => {
    const pred = [{ x: 50, y: 50, value: 0.9 }];
    setupStandardMocks({
      modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ predictionHeatmap: pred, predictionProcessedAt: '2024-01-01' }) }],
      responses: [[]],
    });

    const result = await getEyeTrackingResults('research-1');
    expect(result.stimuli[0].predictionHeatmap).toEqual(pred);
    expect(result.stimuli[0].predictionProcessedAt).toBe('2024-01-01');
  });

  // -----------------------------------------------------------------------
  // Multiple modules
  // -----------------------------------------------------------------------

  it('processes multiple modules within the ET stage', async () => {
    const mod1Config = buildETConfig({ stimulusUrl: '/img1.png' });
    const mod2Config = buildETConfig({ stimulusUrl: '/img2.png' });

    const mod1Response = buildRow('p1', { calibrationRmsePx: 60, integrityScore: 0.9 });
    const mod2Response = buildRow('p1', {
      fixations: [{ x: 50, y: 50, duration: 300, timestamp: 0 }],
      calibrationRmsePx: 60,
      integrityScore: 0.9,
    });

    setupStandardMocks({
      modules: [
        { id: 'mod-1', name: 'Stim 1', config: mod1Config },
        { id: 'mod-2', name: 'Stim 2', config: mod2Config },
      ],
      responses: [[mod1Response], [mod2Response]],
    });

    const result = await getEyeTrackingResults('research-1');
    expect(result.stimuli).toHaveLength(2);
    expect(result.stimuli[0].moduleName).toBe('Stim 1');
    expect(result.stimuli[1].moduleName).toBe('Stim 2');
  });

  // -----------------------------------------------------------------------
  // Shelf modality includes shelf fields
  // -----------------------------------------------------------------------

  it('includes shelfCount and shelfItems for shelf modality', async () => {
    setupStandardMocks({
      modules: [{ id: 'mod-1', name: 'S1', config: buildETConfig({ modality: 'shelf' }) }],
      responses: [[]],
    });

    const result = await getEyeTrackingResults('research-1');
    const s = result.stimuli[0];
    expect(s.modality).toBe('shelf');
    expect(s.shelfCount).toBeDefined();
    expect(s.shelfItems).toBeDefined();
  });
});

// ===========================================================================
// getBenchmarkResults
// ===========================================================================

describe('getBenchmarkResults', () => {
  it('returns empty researches when no stimuli config', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ config: JSON.stringify({}) }] });

    const result = await getBenchmarkResults('bench-1');
    expect(result).toEqual({ researches: [] });
  });

  it('throws when benchmark research not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getBenchmarkResults('nonexistent')).rejects.toThrow('Benchmark research not found');
  });

  it('fetches ET data from referenced researches', async () => {
    // 1. Benchmark config with stimuli referencing target research
    mockQuery.mockResolvedValueOnce({
      rows: [{ config: JSON.stringify({ stimuli: [{ researchId: 'target-1' }] }) }],
    });

    // 2. Name query for target-1
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Target Study' }] });

    // 3. Stage query for target-1
    mockQuery.mockResolvedValueOnce({ rows: [{ stage_id: 'st-1' }] });

    // 4. Modules for target-1
    const config = buildETConfig({
      aois: [{ id: 'a1', label: 'Logo', x: 0, y: 0, width: 100, height: 100 }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'mod-t1', name: 'ET Module', config: JSON.stringify(config) }],
    });

    // 5. Responses for mod-t1
    const row = buildRow('p1', {
      fixations: [{ x: 50, y: 50, duration: 400, timestamp: 0 }],
      calibrationRmsePx: 60,
      integrityScore: 0.9,
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getBenchmarkResults('bench-1');

    expect(result.researches).toHaveLength(1);
    expect(result.researches[0].researchId).toBe('target-1');
    expect(result.researches[0].researchName).toBe('Target Study');
    expect(result.researches[0].modules).toHaveLength(1);
    expect(result.researches[0].modules[0].uniqueParticipants).toBe(1);
    expect(result.researches[0].modules[0].aois).toHaveLength(1);
    expect(result.researches[0].modules[0].aois[0].label).toBe('Logo');
  });

  it('returns empty modules for target research without ET stage', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ config: JSON.stringify({ stimuli: [{ researchId: 'target-no-et' }] }) }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'No ET Study' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no ET stage

    const result = await getBenchmarkResults('bench-1');
    expect(result.researches).toHaveLength(1);
    expect(result.researches[0].modules).toEqual([]);
  });
});

// ===========================================================================
// Fixation coordinate normalization
// ===========================================================================

describe('fixation coordinate normalization', () => {
  /** Helper: set up mock queries for a single-module ET result and return the call. */
  function setupSingleModuleQueries(rows: ReturnType<typeof buildRow>[], aois?: any[]) {
    const config = buildETConfig({ aois: aois ?? [] });
    // stage query
    mockQuery.mockResolvedValueOnce({ rows: [{ stage_id: 'stg-1', stage_name: 'Eye Tracking' }] });
    // module query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'mod-1', name: 'ET Module', config }] });
    // responses query
    mockQuery.mockResolvedValueOnce({ rows });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes pixel coords to 0-100 when viewportWidth and viewportHeight are present', async () => {
    // Fixation at pixel (500, 250) on a 1000x500 viewport => (50%, 50%)
    const row = buildRow('p1', {
      fixations: [{ x: 500, y: 250, duration: 300, timestamp: 0 }],
      viewportWidth: 1000,
      viewportHeight: 500,
    });
    setupSingleModuleQueries([row]);

    const result = await getEyeTrackingResults('r-1');
    const fixation = result.stimuli[0].fixations[0];

    expect(fixation.x).toBeCloseTo(50, 1);
    expect(fixation.y).toBeCloseTo(50, 1);
  });

  it('auto-normalizes when viewport dims are missing but coords exceed 100', async () => {
    // Fixation at (800, 600) with no viewport info => coords > 100, auto-normalize
    const row = buildRow('p1', {
      fixations: [
        { x: 800, y: 600, duration: 200, timestamp: 0 },
        { x: 400, y: 300, duration: 200, timestamp: 100 },
      ],
    });
    setupSingleModuleQueries([row]);

    const result = await getEyeTrackingResults('r-1');
    const fixations = result.stimuli[0].fixations;

    // All coords should be in 0-100 range after normalization
    for (const f of fixations) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(100);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(100);
    }
  });

  it('passes through unchanged when coords are already in 0-100 range', async () => {
    const row = buildRow('p1', {
      fixations: [{ x: 45, y: 60, duration: 300, timestamp: 0 }],
    });
    setupSingleModuleQueries([row]);

    const result = await getEyeTrackingResults('r-1');
    const fixation = result.stimuli[0].fixations[0];

    expect(fixation.x).toBe(45);
    expect(fixation.y).toBe(60);
  });

  it('does not trigger normalization when max coord is exactly 100', async () => {
    // Boundary: exactly 100 should NOT trigger auto-normalization (coords <= 100)
    const row = buildRow('p1', {
      fixations: [
        { x: 100, y: 80, duration: 300, timestamp: 0 },
        { x: 50, y: 100, duration: 300, timestamp: 100 },
      ],
    });
    setupSingleModuleQueries([row]);

    const result = await getEyeTrackingResults('r-1');
    const fixations = result.stimuli[0].fixations;

    // Should pass through unchanged since max coord = 100 (not > 100)
    expect(fixations[0].x).toBe(100);
    expect(fixations[0].y).toBe(80);
    expect(fixations[1].x).toBe(50);
    expect(fixations[1].y).toBe(100);
  });

  it('normalizes correctly with viewportWidth only overriding auto-scale', async () => {
    // viewportWidth=1920, viewportHeight=1080, fixation at (960, 540) => (50%, 50%)
    const row = buildRow('p1', {
      fixations: [{ x: 960, y: 540, duration: 400, timestamp: 0 }],
      viewportWidth: 1920,
      viewportHeight: 1080,
    });
    setupSingleModuleQueries([row]);

    const result = await getEyeTrackingResults('r-1');
    const fixation = result.stimuli[0].fixations[0];

    expect(fixation.x).toBeCloseTo(50, 1);
    expect(fixation.y).toBeCloseTo(50, 1);
  });
});

// ===========================================================================
// TTFF (Time To First Fixation) computation
// ===========================================================================

describe('TTFF (Time To First Fixation)', () => {
  function setupSingleModuleWithAois(rows: ReturnType<typeof buildRow>[], aois: any[]) {
    const config = buildETConfig({ aois });
    mockQuery.mockResolvedValueOnce({ rows: [{ stage_id: 'stg-1', stage_name: 'Eye Tracking' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'mod-1', name: 'ET Module', config }] });
    mockQuery.mockResolvedValueOnce({ rows });
  }

  const aoiCenter = { id: 'aoi-1', label: 'Logo', x: 40, y: 40, width: 20, height: 20 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TTFF is 0 when the first fixation is inside the AOI', async () => {
    // Participant's first (and only) fixation is at (50, 50) -- center of the AOI
    const row = buildRow('p1', {
      fixations: [
        { x: 50, y: 50, duration: 300, timestamp: 1000 },
      ],
    });
    setupSingleModuleWithAois([row], [aoiCenter]);

    const result = await getEyeTrackingResults('r-1');
    const aoi = result.stimuli[0].aois[0];

    // First fixation is in AOI, so TTFF = aoiTime - startTime = 1000 - 1000 = 0
    expect((aoi as Record<string, unknown>).avgTTFF).toBe(0);
  });

  it('TTFF > 0 when participant looked elsewhere first', async () => {
    // Participant looks at (10, 10) first (outside AOI), then at (50, 50) (inside AOI)
    const row = buildRow('p1', {
      fixations: [
        { x: 10, y: 10, duration: 200, timestamp: 1000 },
        { x: 50, y: 50, duration: 300, timestamp: 1500 },
      ],
    });
    setupSingleModuleWithAois([row], [aoiCenter]);

    const result = await getEyeTrackingResults('r-1');
    const aoi = result.stimuli[0].aois[0];

    // TTFF = 1500 - 1000 = 500ms
    expect((aoi as Record<string, unknown>).avgTTFF).toBe(500);
  });

  it('averages TTFF across multiple participants', async () => {
    // P1: first fixation outside at t=0, first AOI fixation at t=200 => TTFF=200
    // P2: first fixation outside at t=0, first AOI fixation at t=800 => TTFF=800
    // Average TTFF = (200 + 800) / 2 = 500
    const row1 = buildRow('p1', {
      fixations: [
        { x: 10, y: 10, duration: 100, timestamp: 0 },
        { x: 50, y: 50, duration: 300, timestamp: 200 },
      ],
    });
    const row2 = buildRow('p2', {
      fixations: [
        { x: 10, y: 10, duration: 100, timestamp: 0 },
        { x: 50, y: 50, duration: 300, timestamp: 800 },
      ],
    });
    setupSingleModuleWithAois([row1, row2], [aoiCenter]);

    const result = await getEyeTrackingResults('r-1');
    const aoi = result.stimuli[0].aois[0];

    expect((aoi as Record<string, unknown>).avgTTFF).toBe(500);
  });

  it('TTFF uses earliest fixation as stimulus start proxy (not absolute zero)', async () => {
    // Participant's first fixation starts at t=5000 (not zero), AOI hit at t=5300
    // TTFF should be 300, not 5300
    const row = buildRow('p1', {
      fixations: [
        { x: 10, y: 10, duration: 100, timestamp: 5000 },
        { x: 50, y: 50, duration: 300, timestamp: 5300 },
      ],
    });
    setupSingleModuleWithAois([row], [aoiCenter]);

    const result = await getEyeTrackingResults('r-1');
    const aoi = result.stimuli[0].aois[0];

    expect((aoi as Record<string, unknown>).avgTTFF).toBe(300);
  });

  it('TTFF is 0 when only fixation is in AOI (no elsewhere gaze)', async () => {
    // Single fixation directly in the AOI
    const row = buildRow('p1', {
      fixations: [
        { x: 45, y: 45, duration: 500, timestamp: 2000 },
      ],
    });
    setupSingleModuleWithAois([row], [aoiCenter]);

    const result = await getEyeTrackingResults('r-1');
    const aoi = result.stimuli[0].aois[0];

    expect((aoi as Record<string, unknown>).avgTTFF).toBe(0);
  });
});
