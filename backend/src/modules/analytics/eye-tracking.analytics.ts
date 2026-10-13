import pool from '../../config/database';
import { getMediaUrl } from '../../config/local-storage';

/**
 * Eye Tracking Analytics
 * Aggregates and analyzes eye tracking responses including fixations, AOIs, emotions, and benchmarks
 */

// ==========================================
// EYE TRACKING RESULTS
// ==========================================

type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

interface EmotionSample {
  timestamp: number;
  emotion: EkmanEmotion;
  confidence: number;
  actionUnits: Record<string, number>;
}

interface EmotionAggregation {
  /** Whether emotion recognition was enabled for this stimulus */
  enabled: boolean;
  /** Total emotion samples across all participants */
  totalSamples: number;
  /** Percentage distribution per emotion (0–100) */
  distribution: Record<EkmanEmotion, number>;
  /** Most frequent emotion across all participants */
  dominantEmotion: EkmanEmotion;
  /** Average confidence across all samples */
  avgConfidence: number;
  /** Per-participant dominant emotion + sample count */
  perParticipant: Array<{
    participantId: string;
    dominantEmotion: EkmanEmotion;
    sampleCount: number;
    distribution: Record<EkmanEmotion, number>;
  }>;
  /** Downsampled timeline (1s buckets) aggregated across all participants */
  timeline: EmotionSample[];
  /** Aggregated micro-expression detections across all participants */
  microExpressions?: {
    total: number;
    briefCount: number;
    microCount: number;
    byEmotion: Record<string, number>;
    events: Array<{
      participantId: string;
      emotion: string;
      durationMs: number;
      startTimestamp: number;
      category: 'brief' | 'micro';
      peakConfidence: number;
    }>;
  };
}

interface EyeTrackingStimulus {
  moduleId: string;
  moduleName: string;
  stimulusUrl: string;
  modality: 'stand_alone' | 'shelf';
  shelfCount?: number;
  shelfItems?: number;
  taskDescription: string;
  totalResponses: number;
  uniqueParticipants: number;
  avgDwellTime: number;
  avgFixationCount: number;
  heatmapData: Array<{ x: number; y: number; duration: number }>;
  fixations: Array<{ x: number; y: number; duration: number; participantId: string; timestamp: number }>;
  aois: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    dwellTimePercent: number;
    fixationCount: number;
    avgDuration: number;
    participantCount: number;
    /** Attention-memory gap: high attention + low recall = missed opportunity (Chu 2022) */
    attentionMemoryGap?: number;
    dominantEmotion?: EkmanEmotion;
    emotionDistribution?: Record<EkmanEmotion, number>;
  }>;
  participants: Array<{
    participantId: string;
    calibrationQuality: string;
    calibrationRmsePx: number | null;
    integrityScore: number;
    totalFixations: number;
    totalDwellTime: number;
    qualityGrade: 'good' | 'fair' | 'low';
  }>;
  qualitySummary: {
    total: number;
    good: number;
    fair: number;
    low: number;
  };
  emotions: EmotionAggregation;
  /** TranSalNet saliency prediction data (if run). Points with x%, y%, value 0–1. */
  predictionHeatmap?: Array<{ x: number; y: number; value: number }>;
  predictionProcessedAt?: string;
  stimulusType?: 'image' | 'video';
  gazeTimeline?: Array<{ x: number; y: number; t: number; videoTime?: number; participantId: string }>;
  /** Video-specific quality metrics (only for video stimuli) */
  videoQuality?: {
    /** % of participants who watched the video to completion */
    completionRate: number;
    /** Number of participants who completed vs total */
    completed: number;
    total: number;
    /** % of 500ms time bins that have at least one gaze point (across all participants) */
    gazeCoverage: number;
    /** Video duration in seconds (max videoTime observed) */
    videoDurationS: number;
  };
  sequenceAnalysis?: {
    participantSequences: Array<{ participantId: string; sequence: string[] }>;
    transitionMatrix: Record<string, Record<string, number>>;
    aoiLabels: string[];
  };
  /** V3 probabilistic heatmap (aggregated across participants). */
  v3Heatmap?: V3AggregatedHeatmap;
}

// ---------------------------------------------------------------------------
// V3 probabilistic heatmap types
// ---------------------------------------------------------------------------

interface V3ParticipantPayload {
  version: 3;
  heatmap: {
    cols: number;
    rows: number;
    cellW: number;
    cellH: number;
    densityBase64: string;
    /** Per-cell earliest video time when gaze contributed (video only). */
    firstAttentionBase64?: string;
    /** Per-cell video time of peak density contribution (video only). */
    peakTimeBase64?: string;
  };
  aoiMetrics: Array<{
    aoiId: string;
    label: string;
    expectedDwellS: number;
    attentionShare: number;
    firstAttentionMs: number | null;
    peakProbability: number;
  }>;
  totalMassS: number;
  totalDurationS: number;
  massError: number;
  confidence: {
    score: number;
    calibrationQuality: number;
    validFrameRatio: number;
    headStability: number;
    effectiveDurationS: number;
    spatialCoverage: number;
  };
  ellipses: Array<{
    u: number; v: number;
    sigma1: number; sigma2: number;
    thetaDeg: number;
  }>;
  pipeline: string;
}

interface V3AggregatedHeatmap {
  /** Grid dimensions (same for all participants — based on stimulus size). */
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Aggregated density as base64 Float64Array (sum of all participants). */
  densityBase64: string;
  /** Normalized [0,1] values for direct heatmap rendering. */
  normalizedBase64: string;
  /** Total mass across all participants (seconds). */
  totalMassS: number;
  /** Number of participants with V3 data. */
  participantCount: number;
  /** Average session confidence score [0,1]. */
  avgConfidence: number;
  /** Average spatial coverage [0,1]. */
  avgSpatialCoverage: number;
  /** Per-AOI aggregated attention metrics. */
  aoiMetrics: Array<{
    aoiId: string;
    label: string;
    /** Sum of expected dwell across all participants (seconds). */
    totalDwellS: number;
    /** Average attention share across participants [0,1]. */
    avgAttentionShare: number;
    /** Earliest first-attention across participants (ms). */
    earliestFirstAttentionMs: number | null;
    /** Number of participants who attended this AOI. */
    participantCount: number;
  }>;
  /** Per-cell earliest first-attention across participants (video only, base64 Float64Array). */
  firstAttentionBase64?: string;
  /** Per-cell peak attention time across participants (video only, base64 Float64Array). */
  peakTimeBase64?: string;
  /** Whether temporal data is available (video stimuli only). */
  hasTemporalData?: boolean;
  /** Per-participant V3 summary (for quality filtering in frontend). */
  perParticipant: Array<{
    participantId: string;
    totalDurationS: number;
    totalMassS: number;
    confidence: number;
    spatialCoverage: number;
  }>;
}

/**
 * Extract Eye Tracking stimulus config from module config.
 * Searches for file-upload components (stimulus image) and other ET-specific fields.
 */
const extractEyeTrackingConfig = (config: any) => {
  const structure = config?.structure ?? config;
  const components: any[] = structure?.components ?? [];

  // Find stimulus image URL — canonical ID: 'stimuli', fallback to known IDs
  let stimulusUrl = '';
  const shelfUrls: string[] = [];
  const fileUploadComp = components.find((c: any) =>
    c.id === 'stimuli' || c.type === 'file-upload' || c.id === 'stimulus-image' || c.id === 'image' || c.id === 'stimulus'
  );
  if (fileUploadComp?.value) {
    try {
      const parsed = typeof fileUploadComp.value === 'string' ? JSON.parse(fileUploadComp.value) : fileUploadComp.value;
      if (Array.isArray(parsed) && parsed.length > 0) {
        stimulusUrl = parsed[0].url || (parsed[0].s3Key ? getMediaUrl(parsed[0].s3Key) : '');
        for (const item of parsed) {
          const url = item.url || (item.s3Key ? getMediaUrl(item.s3Key) : '');
          if (url) shelfUrls.push(url);
        }
      } else if (typeof parsed === 'string') {
        stimulusUrl = parsed;
      }
    } catch {
      stimulusUrl = fileUploadComp.value;
    }
  }

  // Modality — canonical ID: 'display-mode', fallback to legacy IDs
  let modality: 'stand_alone' | 'shelf' = 'stand_alone';
  const modalityComp = components.find((c: any) =>
    c.id === 'display-mode' || c.id === 'modality' || c.id === 'test-mode'
  );
  if (modalityComp?.value) {
    const val = String(modalityComp.value).toLowerCase();
    if (val.includes('shelf') || val === 'shelf') modality = 'shelf';
  }
  // Fallback: checkbox 'is-shelf-task' (value = "true"/"false")
  if (modality === 'stand_alone') {
    const shelfCheckbox = components.find((c: any) => c.id === 'is-shelf-task');
    if (shelfCheckbox?.value === 'true' || shelfCheckbox?.value === true) {
      modality = 'shelf';
    }
  }

  // Task description — canonical ID: 'task-instructions', fallback to legacy IDs
  let taskDescription = '';
  const descComp = components.find((c: any) =>
    c.id === 'task-instructions' || c.id === 'task-description' || c.id === 'question-title' || c.id === 'description'
  );
  if (descComp?.value) {
    taskDescription = descComp.value;
  } else if (descComp?.placeholder?.text) {
    taskDescription = descComp.placeholder.text;
  }

  // AOIs from config (researcher-defined areas of interest)
  const aoiComp = components.find((c: any) => c.id === 'aois' || c.id === 'areas-of-interest');
  let configAois: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }> = [];
  if (aoiComp?.value) {
    try {
      const parsed = typeof aoiComp.value === 'string' ? JSON.parse(aoiComp.value) : aoiComp.value;
      configAois = Array.isArray(parsed) ? parsed : [];
    } catch { /* ignore */ }
  }

  // Shelf config
  const shelfCountComp = components.find((c: any) => c.id === 'shelf-count');
  const shelfCount = shelfCountComp?.value ? parseInt(String(shelfCountComp.value), 10) || 2 : 2;

  const shelfItemsComp = components.find((c: any) => c.id === 'shelf-items');
  const shelfItems = shelfItemsComp?.value ? parseInt(String(shelfItemsComp.value), 10) || 5 : 5;

  // Feature toggles
  const emotionComp = components.find((c: any) => c.id === 'emotion-recognition');
  const hasEmotionRecognition = emotionComp ? String(emotionComp.value) === 'true' : true;

  return { stimulusUrl, shelfUrls, modality, taskDescription, configAois, hasEmotionRecognition, shelfCount, shelfItems };
};

/**
 * Aggregate FACS emotion data from eye tracking responses.
 * Each response may contain `emotions: EmotionSample[]` alongside fixation data.
 */
const computeEmotionMetrics = (
  responses: any[],
  hasEmotionRecognition: boolean,
): EmotionAggregation => {
  const emptyDistribution = (): Record<EkmanEmotion, number> => ({
    joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0,
  });

  if (!hasEmotionRecognition) {
    return {
      enabled: false,
      totalSamples: 0,
      distribution: emptyDistribution(),
      dominantEmotion: 'neutral',
      avgConfidence: 0,
      perParticipant: [],
      timeline: [],
    };
  }

  const allSamples: EmotionSample[] = [];
  const perParticipantSamples = new Map<string, EmotionSample[]>();

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const emotions: EmotionSample[] = parsed?.emotions ?? [];
      if (emotions.length === 0) continue;

      const pid = row.participant_id;
      allSamples.push(...emotions);
      perParticipantSamples.set(pid, emotions);
    } catch { /* skip malformed */ }
  }

  if (allSamples.length === 0) {
    return {
      enabled: true,
      totalSamples: 0,
      distribution: emptyDistribution(),
      dominantEmotion: 'neutral',
      avgConfidence: 0,
      perParticipant: [],
      timeline: [],
    };
  }

  // Global distribution
  const counts = emptyDistribution();
  let totalConfidence = 0;
  for (const s of allSamples) {
    counts[s.emotion]++;
    totalConfidence += s.confidence;
  }
  const total = allSamples.length;
  const distribution = emptyDistribution();
  for (const [emotion, count] of Object.entries(counts)) {
    distribution[emotion as EkmanEmotion] = Math.round((count / total) * 10000) / 100;
  }

  const dominantEmotion = (Object.entries(counts) as [EkmanEmotion, number][])
    .reduce((best, [e, c]) => c > best[1] ? [e, c] : best, ['neutral' as EkmanEmotion, 0])[0];

  // Per-participant
  const perParticipant = Array.from(perParticipantSamples.entries()).map(([pid, samples]) => {
    const pCounts = emptyDistribution();
    for (const s of samples) pCounts[s.emotion]++;
    const pTotal = samples.length;
    const pDist = emptyDistribution();
    for (const [e, c] of Object.entries(pCounts)) {
      pDist[e as EkmanEmotion] = Math.round((c / pTotal) * 10000) / 100;
    }
    const pDominant = (Object.entries(pCounts) as [EkmanEmotion, number][])
      .reduce((best, [e, c]) => c > best[1] ? [e, c] : best, ['neutral' as EkmanEmotion, 0])[0];

    return { participantId: pid, dominantEmotion: pDominant, sampleCount: pTotal, distribution: pDist };
  });

  // Downsampled timeline (1s buckets across all participants)
  const bucketMs = 1000;
  const buckets = new Map<number, EmotionSample[]>();
  for (const s of allSamples) {
    const key = Math.floor(s.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(s);
  }

  const timeline: EmotionSample[] = [];
  for (const [ts, bucket] of Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])) {
    const bCounts: Record<string, number> = {};
    for (const s of bucket) bCounts[s.emotion] = (bCounts[s.emotion] || 0) + 1;
    const bDominant = Object.entries(bCounts).sort((a, b) => b[1] - a[1])[0][0] as EkmanEmotion;
    const bConf = bucket.reduce((sum, s) => sum + s.confidence, 0) / bucket.length;
    const avgAUs: Record<string, number> = {};
    for (const s of bucket) {
      for (const [k, v] of Object.entries(s.actionUnits)) {
        avgAUs[k] = (avgAUs[k] || 0) + v;
      }
    }
    for (const k of Object.keys(avgAUs)) avgAUs[k] /= bucket.length;

    timeline.push({ timestamp: ts, emotion: bDominant, confidence: bConf, actionUnits: avgAUs });
  }

  // Micro-expression aggregation from stored detections
  let microExpressionsAgg: EmotionAggregation['microExpressions'];
  const allMicroEvents: EmotionAggregation['microExpressions'] extends undefined ? never : NonNullable<EmotionAggregation['microExpressions']>['events'] = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const micros = parsed?.microExpressions;
      if (Array.isArray(micros)) {
        for (const m of micros) {
          allMicroEvents.push({
            participantId: row.participant_id,
            emotion: m.emotion,
            durationMs: m.durationMs,
            startTimestamp: m.startTimestamp,
            category: m.category,
            peakConfidence: m.peakConfidence,
          });
        }
      }
    } catch { /* skip */ }
  }

  if (allMicroEvents.length > 0) {
    const byEmotion: Record<string, number> = {};
    let briefCount = 0;
    let microCount = 0;
    for (const e of allMicroEvents) {
      byEmotion[e.emotion] = (byEmotion[e.emotion] || 0) + 1;
      if (e.category === 'brief') briefCount++;
      else microCount++;
    }
    microExpressionsAgg = {
      total: allMicroEvents.length,
      briefCount,
      microCount,
      byEmotion,
      events: allMicroEvents,
    };
  }

  return {
    enabled: true,
    totalSamples: total,
    distribution,
    dominantEmotion,
    avgConfidence: totalConfidence / total,
    perParticipant,
    timeline,
    microExpressions: microExpressionsAgg,
  };
};

/**
 * Compute Eye Tracking analytics from gaze response data.
 * Expected response format: component_id = 'eye-tracking-data'
 * value = { fixations: [{ x, y, duration, timestamp }], calibrationQuality, integrityScore, emotions?: EmotionSample[] }
 */
/**
 * Quality gate thresholds for eye tracking data.
 * Participants below these thresholds are flagged as low quality
 * and excluded from aggregate metrics (heatmap, AOI, zones).
 */
const ET_QUALITY_THRESHOLDS = {
  /** Max acceptable calibration RMSE (px). Above = low quality. */
  maxCalibrationRmsePx: 200,
  /** Min integrity score (0-1). Below = low quality. */
  minIntegrityScore: 0.4,
  /** Min fixation count. Below = insufficient data. */
  minFixationCount: 3,
};

type QualityGrade = 'good' | 'fair' | 'low';

/** Classify participant tracking quality from calibration + data metrics. */
function classifyQuality(
  calibrationRmsePx: number | null,
  integrityScore: number,
  fixationCount: number,
  calibrationQuality?: string,
): QualityGrade {
  // Click-proxy (mobile/tablet) data is capped at 'fair' — never 'good'
  const isClickProxy = calibrationQuality === 'click-proxy';

  if (fixationCount < ET_QUALITY_THRESHOLDS.minFixationCount) return 'low';
  if (integrityScore < ET_QUALITY_THRESHOLDS.minIntegrityScore) return 'low';
  if (calibrationRmsePx !== null && calibrationRmsePx > ET_QUALITY_THRESHOLDS.maxCalibrationRmsePx) return 'low';

  if (isClickProxy) return 'fair';

  // Fair: borderline values
  if (calibrationRmsePx !== null && calibrationRmsePx > ET_QUALITY_THRESHOLDS.maxCalibrationRmsePx * 0.7) return 'fair';
  if (integrityScore < ET_QUALITY_THRESHOLDS.minIntegrityScore * 1.5) return 'fair';
  return 'good';
}

const computeEyeTrackingMetrics = (
  responses: any[],
  configAois: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>,
  hasEmotionRecognition: boolean,
) => {
  type Fixation = { x: number; y: number; duration: number; participantId: string; timestamp: number };
  const allFixationsRaw: Fixation[] = [];
  const participantMap = new Map<string, {
    calibrationQuality: string;
    calibrationRmsePx: number | null;
    integrityScore: number;
    totalFixations: number;
    totalDwellTime: number;
    qualityGrade: QualityGrade;
  }>();
  // Emotion samples per participant (for Emotion × AOI correlation)
  const emotionsByParticipant = new Map<string, EmotionSample[]>();

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const fixations: Array<{ x: number; y: number; duration: number; timestamp?: number }> = parsed?.fixations ?? [];
      const pid = row.participant_id;
      const vpW: number | undefined = parsed?.viewportWidth;
      const vpH: number | undefined = parsed?.viewportHeight;

      // Detect if fixations are in viewport pixels (legacy: no viewportWidth saved)
      // Heuristic: if max coord > 100, they're viewport pixels, not percentages
      let maxCoord = 0;
      for (const f of fixations) maxCoord = Math.max(maxCoord, f.x, f.y);
      const needsNormalization = vpW && vpH ? true : maxCoord > 100;
      const scaleX = vpW ? vpW : (needsNormalization ? maxCoord * 1.05 : 1);
      const scaleY = vpH ? vpH : (needsNormalization ? maxCoord * 1.05 : 1);

      let totalDwell = 0;
      for (const f of fixations) {
        const nx = needsNormalization ? (f.x / scaleX) * 100 : f.x;
        const ny = needsNormalization ? (f.y / scaleY) * 100 : f.y;
        allFixationsRaw.push({ x: nx, y: ny, duration: f.duration, participantId: pid, timestamp: f.timestamp ?? 0 });
        totalDwell += f.duration;
      }

      // Collect emotion samples for AOI correlation
      const emotions: EmotionSample[] = parsed?.emotions ?? [];
      if (emotions.length > 0) {
        emotionsByParticipant.set(pid, emotions);
      }

      const rmsePx = typeof parsed?.calibrationRmsePx === 'number' ? parsed.calibrationRmsePx : null;
      const integrity = typeof parsed?.integrityScore === 'number' ? parsed.integrityScore
        : typeof parsed?.integrityScore === 'string' ? parseFloat(parsed.integrityScore) || 0
        : 0;
      const calQuality = parsed?.calibrationQuality ?? 'unknown';
      const grade = classifyQuality(rmsePx, integrity, fixations.length, calQuality);

      participantMap.set(pid, {
        calibrationQuality: calQuality,
        calibrationRmsePx: rmsePx,
        integrityScore: integrity,
        totalFixations: fixations.length,
        totalDwellTime: totalDwell,
        qualityGrade: grade,
      });
    } catch { /* skip malformed */ }
  }

  // Quality gate: exclude low-quality participants from aggregate metrics
  // Fallback: if excluding low-quality would leave 0 participants, keep all data
  const lowQualityPidsCandidates = new Set(
    Array.from(participantMap.entries())
      .filter(([, data]) => data.qualityGrade === 'low')
      .map(([pid]) => pid)
  );
  const wouldHaveParticipants = participantMap.size - lowQualityPidsCandidates.size > 0;
  const lowQualityPids = wouldHaveParticipants ? lowQualityPidsCandidates : new Set<string>();
  const allFixations = allFixationsRaw.filter(f => !lowQualityPids.has(f.participantId));

  // Heatmap data: aggregate fixation positions with duration as weight
  const heatmapData = allFixations.map(f => ({ x: f.x, y: f.y, duration: f.duration }));

  // Zone-based heatmap: aggregate zoneMass from quality-passing responses only
  const aggregatedZoneMass: Record<string, number> = {};
  for (const row of responses) {
    try {
      if (lowQualityPids.has(row.participant_id)) continue;
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (parsed?.zoneMass && typeof parsed.zoneMass === 'object') {
        for (const [zoneId, mass] of Object.entries(parsed.zoneMass)) {
          aggregatedZoneMass[zoneId] = (aggregatedZoneMass[zoneId] || 0) + (mass as number);
        }
      }
    } catch { /* skip */ }
  }

  // Total dwell time across all fixations
  const totalDwellTime = allFixations.reduce((sum, f) => sum + f.duration, 0);

  // Compute AOI metrics with soft Gaussian contribution (robust to webcam jitter).
  // Fixations near AOI borders contribute proportionally instead of binary in/out.
  const totalParticipants = new Set(allFixations.map(f => f.participantId)).size;

  /**
   * Soft AOI weight: Gaussian contribution based on distance to AOI center.
   * Inside AOI → ~1.0. Near border outside → 0.3-0.8. Far away → ~0.
   * σ = half of AOI's larger dimension (captures ~95% of nearby fixations).
   */
  const softAoiWeight = (fx: number, fy: number, aoi: { x: number; y: number; width: number; height: number }): number => {
    const cx = aoi.x + aoi.width / 2;
    const cy = aoi.y + aoi.height / 2;
    const dx = fx - cx;
    const dy = fy - cy;

    // Check if fully inside — weight 1.0
    if (fx >= aoi.x && fx <= aoi.x + aoi.width && fy >= aoi.y && fy <= aoi.y + aoi.height) {
      return 1.0;
    }

    // Distance to nearest edge (0 = on edge, positive = outside)
    const distX = Math.max(0, Math.abs(dx) - aoi.width / 2);
    const distY = Math.max(0, Math.abs(dy) - aoi.height / 2);
    const edgeDist = Math.sqrt(distX * distX + distY * distY);

    // σ = half of larger dimension — soft falloff outside the box
    const sigma = Math.max(aoi.width, aoi.height) * 0.35;
    if (sigma <= 0) return 0;
    return Math.exp(-(edgeDist * edgeDist) / (2 * sigma * sigma));
  };

  /** Min weight to consider a fixation as contributing to an AOI. */
  const SOFT_AOI_MIN_WEIGHT = 0.15;

  const aois = configAois.map(aoi => {
    // Compute soft weights for all fixations relative to this AOI
    const weightedFixations = allFixations
      .map(f => ({ ...f, aoiWeight: softAoiWeight(f.x, f.y, aoi) }))
      .filter(f => f.aoiWeight >= SOFT_AOI_MIN_WEIGHT);

    const aoiDwellTime = weightedFixations.reduce((sum, f) => sum + f.duration * f.aoiWeight, 0);
    // Participants who "noticed" the AOI: at least one fixation with weight >= 0.5
    const noticedParticipants = new Set(
      weightedFixations.filter(f => f.aoiWeight >= 0.5).map(f => f.participantId)
    );

    // TTFF: Time To First Fixation — relative to participant's first fixation (stimulus start proxy)
    const participantStartTime = new Map<string, number>();
    for (const f of allFixations) {
      const existing = participantStartTime.get(f.participantId);
      if (existing === undefined || f.timestamp < existing) {
        participantStartTime.set(f.participantId, f.timestamp);
      }
    }

    const firstAoiFixationByParticipant = new Map<string, number>();
    for (const f of weightedFixations) {
      if (f.aoiWeight < 0.5) continue;
      const existing = firstAoiFixationByParticipant.get(f.participantId);
      if (existing === undefined || f.timestamp < existing) {
        firstAoiFixationByParticipant.set(f.participantId, f.timestamp);
      }
    }
    const ttffValues: number[] = [];
    for (const [pid, aoiTime] of firstAoiFixationByParticipant) {
      const startTime = participantStartTime.get(pid) ?? aoiTime;
      ttffValues.push(Math.max(0, aoiTime - startTime));
    }
    const avgTTFF = ttffValues.length > 0
      ? Math.round(ttffValues.reduce((a, b) => a + b, 0) / ttffValues.length)
      : 0;

    // Notice rate: % of total participants with significant fixation in AOI
    const noticeRate = totalParticipants > 0
      ? Math.round((noticedParticipants.size / totalParticipants) * 100)
      : 0;

    // Effective fixation count: sum of weights (fractional fixations)
    const effectiveFixationCount = Math.round(
      weightedFixations.reduce((sum, f) => sum + f.aoiWeight, 0)
    );

    // Emotion × AOI: find dominant emotion while looking at this AOI
    // Use weighted fixations (weight >= 0.5) for emotion matching
    const aoiEmotionCounts: Record<EkmanEmotion, number> = {
      joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0,
    };
    let aoiEmotionTotal = 0;
    for (const pid of noticedParticipants) {
      const pEmotions = emotionsByParticipant.get(pid);
      if (!pEmotions || pEmotions.length === 0) continue;
      const pFixationsInAOI = weightedFixations.filter(f => f.participantId === pid && f.aoiWeight >= 0.5);
      for (const fix of pFixationsInAOI) {
        const fixStart = fix.timestamp;
        const fixEnd = fix.timestamp + fix.duration;
        for (const em of pEmotions) {
          if (em.timestamp >= fixStart - 100 && em.timestamp <= fixEnd + 100) {
            aoiEmotionCounts[em.emotion]++;
            aoiEmotionTotal++;
          }
        }
      }
    }

    let aoiDominantEmotion: EkmanEmotion | undefined;
    const aoiEmotionDistribution: Record<EkmanEmotion, number> | undefined = aoiEmotionTotal > 0
      ? (() => {
          const dist = {} as Record<EkmanEmotion, number>;
          let bestEmotion: EkmanEmotion = 'neutral';
          let bestCount = 0;
          for (const [emotion, count] of Object.entries(aoiEmotionCounts) as [EkmanEmotion, number][]) {
            dist[emotion] = Math.round((count / aoiEmotionTotal) * 10000) / 100;
            if (count > bestCount) { bestCount = count; bestEmotion = emotion; }
          }
          aoiDominantEmotion = bestEmotion;
          return dist;
        })()
      : undefined;

    return {
      ...aoi,
      dwellTimePercent: totalDwellTime > 0 ? Math.round((aoiDwellTime / totalDwellTime) * 100) : 0,
      fixationCount: effectiveFixationCount,
      avgDuration: effectiveFixationCount > 0
        ? Math.round(aoiDwellTime / effectiveFixationCount)
        : 0,
      participantCount: noticedParticipants.size,
      avgTTFF,
      noticeRate,
      /** Dominant emotion while looking at this AOI */
      dominantEmotion: aoiDominantEmotion,
      /** Emotion distribution while looking at this AOI */
      emotionDistribution: aoiEmotionDistribution,
    };
  });

  const uniqueParticipants = new Set(allFixations.map(f => f.participantId));
  const avgDwellTime = uniqueParticipants.size > 0
    ? Math.round(totalDwellTime / uniqueParticipants.size)
    : 0;
  const avgFixationCount = uniqueParticipants.size > 0
    ? Math.round(allFixations.length / uniqueParticipants.size)
    : 0;

  const participants = Array.from(participantMap.entries()).map(([pid, data]) => ({
    participantId: pid,
    ...data,
  }));

  const qualitySummary = {
    total: participantMap.size,
    good: Array.from(participantMap.values()).filter(p => p.qualityGrade === 'good').length,
    fair: Array.from(participantMap.values()).filter(p => p.qualityGrade === 'fair').length,
    low: lowQualityPids.size,
  };

  const emotions = computeEmotionMetrics(responses, hasEmotionRecognition);

  // Sequence analysis: AOI visit order per participant + transition matrix
  let sequenceAnalysis: {
    participantSequences: Array<{ participantId: string; sequence: string[] }>;
    transitionMatrix: Record<string, Record<string, number>>;
    aoiLabels: string[];
  } | undefined;

  if (configAois.length >= 2 && allFixations.length > 0) {
    const aoiLabels = configAois.map(a => a.label || a.id);
    const aoiLookup = configAois.map(a => ({
      id: a.id, label: a.label || a.id,
      x: a.x, y: a.y, w: a.width, h: a.height,
    }));

    const findAOI = (fx: number, fy: number): string | null => {
      for (const a of aoiLookup) {
        if (fx >= a.x && fx <= a.x + a.w && fy >= a.y && fy <= a.y + a.h) return a.label;
      }
      return null;
    };

    // Build per-participant AOI visit sequences (deduplicate consecutive same-AOI)
    const byParticipant = new Map<string, Array<{ aoi: string; timestamp: number }>>();
    for (const f of allFixations) {
      const aoiLabel = findAOI(f.x, f.y);
      if (!aoiLabel) continue;
      if (!byParticipant.has(f.participantId)) byParticipant.set(f.participantId, []);
      byParticipant.get(f.participantId)!.push({ aoi: aoiLabel, timestamp: f.timestamp });
    }

    const participantSequences: Array<{ participantId: string; sequence: string[] }> = [];
    const transitionCounts: Record<string, Record<string, number>> = {};
    // Initialize matrix
    for (const label of aoiLabels) {
      transitionCounts[label] = {};
      for (const label2 of aoiLabels) transitionCounts[label][label2] = 0;
    }

    for (const [pid, visits] of byParticipant) {
      // Sort by timestamp, deduplicate consecutive
      visits.sort((a, b) => a.timestamp - b.timestamp);
      const seq: string[] = [];
      for (const v of visits) {
        if (seq.length === 0 || seq[seq.length - 1] !== v.aoi) seq.push(v.aoi);
      }
      participantSequences.push({ participantId: pid, sequence: seq });

      // Count transitions
      for (let i = 0; i < seq.length - 1; i++) {
        const from = seq[i];
        const to = seq[i + 1];
        if (transitionCounts[from] && transitionCounts[from][to] !== undefined) {
          transitionCounts[from][to]++;
        }
      }
    }

    // Normalize transitions to probabilities (row-sum = 100%)
    const transitionMatrix: Record<string, Record<string, number>> = {};
    for (const from of aoiLabels) {
      const rowSum = Object.values(transitionCounts[from]).reduce((a, b) => a + b, 0);
      transitionMatrix[from] = {};
      for (const to of aoiLabels) {
        transitionMatrix[from][to] = rowSum > 0
          ? Math.round((transitionCounts[from][to] / rowSum) * 100)
          : 0;
      }
    }

    sequenceAnalysis = { participantSequences, transitionMatrix, aoiLabels };
  }

  return {
    uniqueParticipants: uniqueParticipants.size,
    avgDwellTime,
    avgFixationCount,
    heatmapData,
    zoneMass: aggregatedZoneMass,
    fixations: allFixationsRaw,
    aois,
    participants,
    qualitySummary,
    emotions,
    sequenceAnalysis,
  };
};

// ---------------------------------------------------------------------------
// V3 heatmap extraction & aggregation
// ---------------------------------------------------------------------------

/**
 * Decode base64 Float64Array density grid.
 */
function decodeDensityBase64(b64: string, expectedLength: number): Float64Array | null {
  try {
    const binary = Buffer.from(b64, 'base64');
    if (binary.byteLength !== expectedLength * 8) return null;
    return new Float64Array(binary.buffer, binary.byteOffset, expectedLength);
  } catch {
    return null;
  }
}

/**
 * Encode Float64Array to base64.
 */
function encodeDensityBase64(data: Float64Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
}

/**
 * Extract and aggregate V3 probabilistic heatmap data from eye-tracking responses.
 * Sums density grids across participants (grids share dimensions from stimulus size).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractV3Heatmap(responses: any[]): V3AggregatedHeatmap | undefined {
  const v3Payloads: Array<{ participantId: string; payload: V3ParticipantPayload }> = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const v3 = parsed?.v3;
      if (!v3 || v3.version !== 3 || !v3.heatmap?.densityBase64) continue;
      v3Payloads.push({ participantId: row.participant_id, payload: v3 });
    } catch { /* skip malformed */ }
  }

  if (v3Payloads.length === 0) return undefined;

  // Use first payload's grid dimensions as reference
  const ref = v3Payloads[0].payload.heatmap;
  const gridSize = ref.cols * ref.rows;

  // Sum all density grids + aggregate temporal data (min first-attention, weighted-avg peak)
  const sumGrid = new Float64Array(gridSize);
  const aggFirstAttention = new Float64Array(gridSize).fill(Infinity);
  const aggPeakTime = new Float64Array(gridSize);
  const aggPeakWeight = new Float64Array(gridSize);
  let hasTemporalData = false;
  const perParticipant: V3AggregatedHeatmap['perParticipant'] = [];
  let totalConfidence = 0;
  let totalCoverage = 0;

  for (const { participantId, payload } of v3Payloads) {
    // Only aggregate grids with matching dimensions
    if (payload.heatmap.cols !== ref.cols || payload.heatmap.rows !== ref.rows) continue;

    const grid = decodeDensityBase64(payload.heatmap.densityBase64, gridSize);
    if (!grid) continue;

    for (let i = 0; i < gridSize; i++) sumGrid[i] += grid[i];

    // Temporal: min first-attention, peak from participant with highest contribution
    if (payload.heatmap.firstAttentionBase64) {
      const fa = decodeDensityBase64(payload.heatmap.firstAttentionBase64, gridSize);
      if (fa) {
        hasTemporalData = true;
        for (let i = 0; i < gridSize; i++) {
          if (fa[i] < aggFirstAttention[i]) aggFirstAttention[i] = fa[i];
        }
      }
    }
    if (payload.heatmap.peakTimeBase64) {
      const pt = decodeDensityBase64(payload.heatmap.peakTimeBase64, gridSize);
      if (pt && grid) {
        for (let i = 0; i < gridSize; i++) {
          // Keep peak time from the participant with highest density at that cell
          if (grid[i] > aggPeakWeight[i]) {
            aggPeakWeight[i] = grid[i];
            aggPeakTime[i] = pt[i];
          }
        }
      }
    }

    totalConfidence += payload.confidence.score;
    totalCoverage += payload.confidence.spatialCoverage;

    perParticipant.push({
      participantId,
      totalDurationS: payload.totalDurationS,
      totalMassS: payload.totalMassS,
      confidence: payload.confidence.score,
      spatialCoverage: payload.confidence.spatialCoverage,
    });
  }

  if (perParticipant.length === 0) return undefined;

  // Normalized grid [0,1] for rendering
  let maxVal = 0;
  for (let i = 0; i < gridSize; i++) if (sumGrid[i] > maxVal) maxVal = sumGrid[i];
  const normGrid = new Float64Array(gridSize);
  if (maxVal > 0) {
    for (let i = 0; i < gridSize; i++) normGrid[i] = sumGrid[i] / maxVal;
  }

  // Aggregate AOI metrics across participants
  const aoiAgg = new Map<string, {
    label: string;
    totalDwellS: number;
    attentionShareSum: number;
    earliestFirstMs: number | null;
    count: number;
  }>();

  for (const { payload } of v3Payloads) {
    for (const aoi of payload.aoiMetrics) {
      const existing = aoiAgg.get(aoi.aoiId) ?? {
        label: aoi.label,
        totalDwellS: 0,
        attentionShareSum: 0,
        earliestFirstMs: null,
        count: 0,
      };
      existing.totalDwellS += aoi.expectedDwellS;
      existing.attentionShareSum += aoi.attentionShare;
      if (aoi.firstAttentionMs !== null) {
        existing.earliestFirstMs = existing.earliestFirstMs === null
          ? aoi.firstAttentionMs
          : Math.min(existing.earliestFirstMs, aoi.firstAttentionMs);
      }
      if (aoi.expectedDwellS > 0) existing.count++;
      aoiAgg.set(aoi.aoiId, existing);
    }
  }

  const n = perParticipant.length;
  const totalMassS = sumGrid.reduce((s, v) => s + v, 0);

  return {
    cols: ref.cols,
    rows: ref.rows,
    cellW: ref.cellW,
    cellH: ref.cellH,
    densityBase64: encodeDensityBase64(sumGrid),
    normalizedBase64: encodeDensityBase64(normGrid),
    totalMassS,
    participantCount: n,
    avgConfidence: totalConfidence / n,
    avgSpatialCoverage: totalCoverage / n,
    aoiMetrics: Array.from(aoiAgg.entries()).map(([aoiId, a]) => ({
      aoiId,
      label: a.label,
      totalDwellS: a.totalDwellS,
      avgAttentionShare: n > 0 ? a.attentionShareSum / n : 0,
      earliestFirstAttentionMs: a.earliestFirstMs,
      participantCount: a.count,
    })),
    perParticipant,
    ...(hasTemporalData ? {
      hasTemporalData: true,
      firstAttentionBase64: encodeDensityBase64(aggFirstAttention),
      peakTimeBase64: encodeDensityBase64(aggPeakTime),
    } : {}),
  };
}

export const getEyeTrackingResults = async (researchId: string, filterStageId?: string) => {
  let stageIds: string[];
  if (filterStageId) {
    stageIds = [filterStageId];
  } else {
    const stageQuery = `
      SELECT s.id as stage_id
      FROM stages s
      WHERE s.research_id = ?
        AND LOWER(s.name) = 'eye tracking'
    `;
    const stageResult = await pool.query(stageQuery, [researchId]);
    if (stageResult.rows.length === 0) {
      return { stimuli: [] };
    }
    stageIds = stageResult.rows.map((r: Record<string, unknown>) => r.stage_id as string);
  }

  const moduleQuery = `
    SELECT id, name, config FROM modules
    WHERE research_id = ? AND stage_id IN (${stageIds.map(() => '?').join(',')})
    ORDER BY order_index
  `;
  const moduleResult = await pool.query(moduleQuery, [researchId, ...stageIds]);

  const stimuli: EyeTrackingStimulus[] = [];

  for (const mod of moduleResult.rows) {
    let config: any = {};
    try {
      config = typeof mod.config === 'string' ? JSON.parse(mod.config) : mod.config;
    } catch { /* ignore */ }

    const { stimulusUrl, shelfUrls, modality, taskDescription, configAois, hasEmotionRecognition, shelfCount, shelfItems } = extractEyeTrackingConfig(config);

    // 3. Get responses for this module (component_id = 'eye-tracking-data')
    const responsesQuery = `
      SELECT r.value, r.participant_id, r.created_at
      FROM responses r
      WHERE r.research_id = ? AND r.module_id = ? AND r.component_id = 'eye-tracking-data'
      ORDER BY r.created_at ASC
    `;
    const responsesResult = await pool.query(responsesQuery, [researchId, mod.id]);

    const metrics = computeEyeTrackingMetrics(responsesResult.rows, configAois, hasEmotionRecognition);

    // V3 probabilistic heatmap (aggregated across participants)
    const v3Heatmap = extractV3Heatmap(responsesResult.rows);

    // TranSalNet prediction data (stored in module config by attention-prediction controller)
    const predictionHeatmap = config.predictionHeatmap as Array<{ x: number; y: number; value: number }> | undefined;
    const predictionProcessedAt = config.predictionProcessedAt as string | undefined;

    // Extract stimulus type, gaze timeline, and video quality from responses
    let stimulusType: 'image' | 'video' = 'image';
    const gazeTimeline: Array<{ x: number; y: number; t: number; videoTime?: number; participantId: string }> = [];
    let videoCompleted = 0;
    let videoTotal = 0;
    for (const row of responsesResult.rows) {
      try {
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (parsed?.stimulusType === 'video') {
          stimulusType = 'video';
          videoTotal++;
          if (parsed.videoEnded === true) videoCompleted++;
        }
        if (parsed?.gazeTimeline && Array.isArray(parsed.gazeTimeline)) {
          for (const pt of parsed.gazeTimeline) {
            gazeTimeline.push({ ...pt, participantId: row.participant_id });
          }
        }
      } catch { /* skip */ }
    }

    // Compute video-specific quality metrics
    let videoQuality: EyeTrackingStimulus['videoQuality'];
    if (stimulusType === 'video' && gazeTimeline.length > 0) {
      const maxVideoTime = gazeTimeline.reduce((m, p) => Math.max(m, p.videoTime ?? 0), 0);
      // Bin gaze points into 500ms buckets — coverage = % of bins with data
      const binSize = 0.5;
      const totalBins = Math.max(1, Math.ceil(maxVideoTime / binSize));
      const occupiedBins = new Set<number>();
      for (const pt of gazeTimeline) {
        if (pt.videoTime != null) occupiedBins.add(Math.floor(pt.videoTime / binSize));
      }
      videoQuality = {
        completionRate: videoTotal > 0 ? Math.round((videoCompleted / videoTotal) * 100) : 0,
        completed: videoCompleted,
        total: videoTotal,
        gazeCoverage: Math.round((occupiedBins.size / totalBins) * 100),
        videoDurationS: Math.round(maxVideoTime * 10) / 10,
      };
    }

    stimuli.push({
      moduleId: mod.id,
      moduleName: mod.name,
      stimulusUrl,
      modality,
      ...(modality === 'shelf' && { shelfCount, shelfItems, shelfUrls }),
      taskDescription,
      totalResponses: responsesResult.rows.length,
      ...metrics,
      predictionHeatmap: predictionHeatmap?.length ? predictionHeatmap : undefined,
      predictionProcessedAt,
      stimulusType,
      gazeTimeline: gazeTimeline.length > 0 ? gazeTimeline : undefined,
      videoQuality,
      v3Heatmap,
    });
  }

  return { stimuli };
};

// ==========================================
// CLIENT'S BENCHMARK RESULTS
// ==========================================

interface BenchmarkAOI {
  id: string;
  label: string;
  dwellTimePercent: number;
  fixationCount: number;
  avgDuration: number;
  participantCount: number;
}

interface BenchmarkResearchResult {
  researchId: string;
  researchName: string;
  modules: Array<{
    moduleId: string;
    moduleName: string;
    stimulusUrl: string;
    uniqueParticipants: number;
    totalResponses: number;
    aois: BenchmarkAOI[];
  }>;
}

/**
 * Get benchmark comparison data for a Client's Benchmark research.
 * Reads selected research IDs from config.stimuli, fetches Eye Tracking
 * AOI metrics (% Attention + fixation count) from each.
 */
export const getBenchmarkResults = async (researchId: string) => {
  // 1. Get the benchmark research config to find selected research IDs
  const configQuery = `SELECT config FROM researches WHERE id = ?`;
  const configResult = await pool.query(configQuery, [researchId]);
  if (configResult.rows.length === 0) {
    throw new Error('Benchmark research not found');
  }

  let config: any = {};
  try {
    config = typeof configResult.rows[0].config === 'string'
      ? JSON.parse(configResult.rows[0].config)
      : configResult.rows[0].config;
  } catch { /* ignore */ }

  const stimuli: Array<{ researchId: string }> = config?.stimuli || [];
  const selectedResearchIds = stimuli.map(s => s.researchId).filter(Boolean);

  if (selectedResearchIds.length === 0) {
    return { researches: [] };
  }

  const researches: BenchmarkResearchResult[] = [];

  for (const targetResearchId of selectedResearchIds) {
    // Get research name
    const nameQuery = `SELECT name FROM researches WHERE id = ?`;
    const nameResult = await pool.query(nameQuery, [targetResearchId]);
    const researchName = nameResult.rows[0]?.name || 'Unknown Research';

    // Find Eye Tracking stage
    const stageQuery = `
      SELECT s.id as stage_id
      FROM stages s
      WHERE s.research_id = ? AND LOWER(s.name) = 'eye tracking'
    `;
    const stageResult = await pool.query(stageQuery, [targetResearchId]);
    if (stageResult.rows.length === 0) {
      researches.push({ researchId: targetResearchId, researchName, modules: [] });
      continue;
    }
    const benchStageIds = stageResult.rows.map((r: Record<string, unknown>) => r.stage_id as string);

    const moduleQuery = `
      SELECT id, name, config FROM modules
      WHERE research_id = ? AND stage_id IN (${benchStageIds.map(() => '?').join(',')})
      ORDER BY order_index
    `;
    const moduleResult = await pool.query(moduleQuery, [targetResearchId, ...benchStageIds]);

    const modules: BenchmarkResearchResult['modules'] = [];

    for (const mod of moduleResult.rows) {
      let modConfig: any = {};
      try {
        modConfig = typeof mod.config === 'string' ? JSON.parse(mod.config) : mod.config;
      } catch { /* ignore */ }

      const { stimulusUrl, configAois } = extractEyeTrackingConfig(modConfig);

      // Get responses
      const responsesQuery = `
        SELECT r.value, r.participant_id
        FROM responses r
        WHERE r.research_id = ? AND r.module_id = ? AND r.component_id = 'eye-tracking-data'
        ORDER BY r.created_at ASC
      `;
      const responsesResult = await pool.query(responsesQuery, [targetResearchId, mod.id]);

      const metrics = computeEyeTrackingMetrics(responsesResult.rows, configAois, false);

      modules.push({
        moduleId: mod.id,
        moduleName: mod.name,
        stimulusUrl,
        uniqueParticipants: metrics.uniqueParticipants,
        totalResponses: responsesResult.rows.length,
        aois: metrics.aois.map(aoi => ({
          id: aoi.id,
          label: aoi.label,
          dwellTimePercent: aoi.dwellTimePercent,
          fixationCount: aoi.fixationCount,
          avgDuration: aoi.avgDuration,
          participantCount: aoi.participantCount,
        })),
      });
    }

    researches.push({ researchId: targetResearchId, researchName, modules });
  }

  return { researches };
};
