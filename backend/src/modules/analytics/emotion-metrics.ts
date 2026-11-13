export type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

export interface EmotionSample {
  timestamp: number;
  emotion: EkmanEmotion;
  confidence: number;
  actionUnits?: Record<string, number>;
  expressions?: Partial<Record<EkmanEmotion, number>>;
}

// Russell's circumplex approximation
const VA_MAP: Record<EkmanEmotion, { v: number; a: number }> = {
  neutral:  { v:  0.0, a:  0.0 },
  joy:      { v:  0.8, a:  0.5 },
  sadness:  { v: -0.6, a: -0.4 },
  anger:    { v: -0.7, a:  0.7 },
  surprise: { v:  0.2, a:  0.8 },
  fear:     { v: -0.8, a:  0.6 },
  disgust:  { v: -0.7, a:  0.2 },
};

/**
 * Compute Valence/Arousal from emotion samples.
 * When `expressions` vector is present (v0.91+), uses all 7 probabilities
 * for a weighted V/A — continuous positioning instead of 7 fixed lookup points.
 * Falls back to dominant-emotion lookup for pre-v0.91 data.
 */
export function computeVA(samples: EmotionSample[]): { valence: number; arousal: number } {
  if (samples.length === 0) return { valence: 0, arousal: 0 };
  let v = 0, a = 0, w = 0;
  for (const s of samples) {
    const expr = s.expressions;
    if (expr && typeof expr === 'object') {
      for (const emotion of Object.keys(VA_MAP) as EkmanEmotion[]) {
        const prob = expr[emotion];
        if (typeof prob !== 'number' || prob <= 0) continue;
        const va = VA_MAP[emotion];
        if (!va) continue;
        v += va.v * prob;
        a += va.a * prob;
        w += prob;
      }
    } else {
      const va = VA_MAP[s.emotion];
      if (!va) continue;
      v += va.v * s.confidence;
      a += va.a * s.confidence;
      w += s.confidence;
    }
  }
  return w > 0 ? { valence: v / w, arousal: a / w } : { valence: 0, arousal: 0 };
}

export interface MicroExpression {
  emotion: EkmanEmotion;
  durationMs: number;
  startTimestamp: number;
  endTimestamp: number;
  peakConfidence: number;
  category: 'brief' | 'micro';
}

export interface ParticipantEmotions {
  participantId: string;
  samples: EmotionSample[];
  microExpressions: MicroExpression[];
}

export interface EmotionAggregation {
  enabled: boolean;
  totalSamples: number;
  distribution: Record<EkmanEmotion, number>;
  dominantEmotion: EkmanEmotion;
  avgConfidence: number;
  perParticipant: Array<{
    participantId: string;
    dominantEmotion: EkmanEmotion;
    sampleCount: number;
    distribution: Record<EkmanEmotion, number>;
  }>;
  timeline: Array<Required<Omit<EmotionSample, 'expressions'>>>;
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

const TIMELINE_BUCKET_MS = 1000;
const MICRO_MIN_CONFIDENCE = 0.4;
const MICRO_MAX_DURATION_MS = 500;
const MICRO_BRIEF_THRESHOLD_MS = 200;
const MICRO_BASELINE_WINDOW = 20;

const emptyDistribution = (): Record<EkmanEmotion, number> => ({
  joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0,
});

export const emptyEmotionAggregation = (enabled: boolean): EmotionAggregation => ({
  enabled,
  totalSamples: 0,
  distribution: emptyDistribution(),
  dominantEmotion: 'neutral',
  avgConfidence: 0,
  perParticipant: [],
  timeline: [],
});

const countEmotions = (samples: EmotionSample[]): Record<EkmanEmotion, number> => {
  const counts = emptyDistribution();
  for (const sample of samples) counts[sample.emotion]++;
  return counts;
};

const toPercentages = (counts: Record<EkmanEmotion, number>, total: number): Record<EkmanEmotion, number> => {
  const distribution = emptyDistribution();
  for (const [emotion, count] of Object.entries(counts)) {
    distribution[emotion as EkmanEmotion] = Math.round((count / total) * 10000) / 100;
  }
  return distribution;
};

const mostFrequent = (counts: Record<EkmanEmotion, number>): EkmanEmotion =>
  (Object.entries(counts) as [EkmanEmotion, number][])
    .reduce((best, [emotion, count]) => count > best[1] ? [emotion, count] : best, ['neutral' as EkmanEmotion, 0])[0];

const buildTimeline = (samples: EmotionSample[]): Array<Required<Omit<EmotionSample, 'expressions'>>> => {
  const buckets = new Map<number, EmotionSample[]>();
  for (const sample of samples) {
    const key = Math.floor(sample.timestamp / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS;
    buckets.set(key, [...(buckets.get(key) ?? []), sample]);
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([timestamp, bucket]) => {
    const bucketCounts: Record<string, number> = {};
    for (const sample of bucket) bucketCounts[sample.emotion] = (bucketCounts[sample.emotion] || 0) + 1;
    const emotion = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0][0] as EkmanEmotion;
    const actionUnits: Record<string, number> = {};
    for (const sample of bucket) {
      for (const [unit, value] of Object.entries(sample.actionUnits ?? {})) actionUnits[unit] = (actionUnits[unit] || 0) + value;
    }
    for (const unit of Object.keys(actionUnits)) actionUnits[unit] /= bucket.length;
    return { timestamp, emotion, confidence: bucket.reduce((sum, sample) => sum + sample.confidence, 0) / bucket.length, actionUnits };
  });
};

const aggregateMicroExpressions = (participants: ParticipantEmotions[]): EmotionAggregation['microExpressions'] => {
  const events = participants.flatMap(({ participantId, microExpressions }) => microExpressions.map((micro) => ({
    participantId,
    emotion: micro.emotion,
    durationMs: micro.durationMs,
    startTimestamp: micro.startTimestamp,
    category: micro.category,
    peakConfidence: micro.peakConfidence,
  })));
  if (events.length === 0) return undefined;
  const byEmotion: Record<string, number> = {};
  for (const event of events) byEmotion[event.emotion] = (byEmotion[event.emotion] || 0) + 1;
  const briefCount = events.filter((event) => event.category === 'brief').length;
  return { total: events.length, briefCount, microCount: events.length - briefCount, byEmotion, events };
};

export const aggregateEmotions = (participants: ParticipantEmotions[]): EmotionAggregation => {
  const allSamples = participants.flatMap((participant) => participant.samples);
  if (allSamples.length === 0) return emptyEmotionAggregation(true);

  const samplesByParticipant = new Map<string, EmotionSample[]>();
  for (const { participantId, samples } of participants) {
    if (samples.length === 0) continue;
    samplesByParticipant.set(participantId, [...(samplesByParticipant.get(participantId) ?? []), ...samples]);
  }

  const counts = countEmotions(allSamples);
  return {
    enabled: true,
    totalSamples: allSamples.length,
    distribution: toPercentages(counts, allSamples.length),
    dominantEmotion: mostFrequent(counts),
    avgConfidence: allSamples.reduce((sum, sample) => sum + sample.confidence, 0) / allSamples.length,
    perParticipant: Array.from(samplesByParticipant.entries()).map(([participantId, samples]) => {
      const participantCounts = countEmotions(samples);
      return {
        participantId,
        dominantEmotion: mostFrequent(participantCounts),
        sampleCount: samples.length,
        distribution: toPercentages(participantCounts, samples.length),
      };
    }),
    timeline: buildTimeline(allSamples),
    microExpressions: aggregateMicroExpressions(participants),
  };
};

const localBaseline = (samples: EmotionSample[], index: number): EkmanEmotion => {
  const window = samples.slice(Math.max(0, index - MICRO_BASELINE_WINDOW), Math.min(samples.length, index + MICRO_BASELINE_WINDOW));
  const counts: Partial<Record<EkmanEmotion, number>> = {};
  for (const sample of window) counts[sample.emotion] = (counts[sample.emotion] || 0) + 1;
  let best: EkmanEmotion = 'neutral';
  let bestCount = 0;
  for (const [emotion, count] of Object.entries(counts) as [EkmanEmotion, number][]) {
    if (count > bestCount) {
      bestCount = count;
      best = emotion;
    }
  }
  return best;
};

export const detectMicroExpressions = (samples: EmotionSample[]): MicroExpression[] => {
  if (samples.length < 3) return [];
  const results: MicroExpression[] = [];
  let transient: { start: number; emotion: EkmanEmotion; peak: number } | null = null;

  const startsTransient = (sample: EmotionSample, index: number) =>
    sample.emotion !== localBaseline(samples, index) && sample.confidence >= MICRO_MIN_CONFIDENCE;

  samples.forEach((sample, index) => {
    if (!transient) {
      if (startsTransient(sample, index)) transient = { start: index, emotion: sample.emotion, peak: sample.confidence };
      return;
    }
    if (sample.emotion === transient.emotion) {
      transient.peak = Math.max(transient.peak, sample.confidence);
      return;
    }
    const startTimestamp = samples[transient.start].timestamp;
    const endTimestamp = samples[index - 1].timestamp;
    const durationMs = endTimestamp - startTimestamp;
    if (durationMs > 0 && durationMs <= MICRO_MAX_DURATION_MS && transient.peak >= MICRO_MIN_CONFIDENCE) {
      results.push({
        emotion: transient.emotion,
        durationMs,
        startTimestamp,
        endTimestamp,
        peakConfidence: transient.peak,
        category: durationMs < MICRO_BRIEF_THRESHOLD_MS ? 'brief' : 'micro',
      });
    }
    transient = startsTransient(sample, index) ? { start: index, emotion: sample.emotion, peak: sample.confidence } : null;
  });

  return results;
};
