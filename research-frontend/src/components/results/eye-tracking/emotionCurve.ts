import type { EkmanEmotion, EyeTrackingStimulus } from '../../../services/analytics.service';

export type ParticipantEmotionSample = EyeTrackingStimulus['emotionSamples'][number];
export type EmotionSeries = EkmanEmotion | 'valence' | 'arousal';
export type EmotionSeriesValues = Record<EmotionSeries, number>;

export const CURVE_EMOTIONS: readonly EkmanEmotion[] = ['joy', 'surprise', 'anger', 'fear', 'disgust', 'sadness', 'neutral'];

export const CURVE_AXIS_WIDTH_PX = 40;

export const SERIES_COLORS: Record<EmotionSeries, string> = {
  valence: '#db2777',
  arousal: '#0f172a',
  joy: '#22c55e',
  surprise: '#f59e0b',
  anger: '#ef4444',
  fear: '#a855f7',
  disgust: '#f97316',
  sadness: '#3b82f6',
  neutral: '#9ca3af',
};

export const formatClock = (timeMs: number): string => {
  const totalSeconds = Math.floor(timeMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

export interface EmotionCurvePoint {
  readonly timeMs: number;
  readonly participantCount: number;
  readonly values: EmotionSeriesValues | null;
}

export interface LeadingEmotion {
  readonly emotion: EkmanEmotion;
  readonly share: number;
  readonly gapToNext: number | null;
}

export interface FaceSegment {
  readonly startMs: number;
  readonly endMs: number;
}

export interface ParticipantFacePresence {
  readonly participantId: string;
  readonly segments: readonly FaceSegment[];
}

const readSeriesValues = (sample: ParticipantEmotionSample): EmotionSeriesValues => {
  const probabilities = Object.fromEntries(CURVE_EMOTIONS.map(emotion => [
    emotion,
    sample.expressions ? sample.expressions[emotion] ?? 0 : Number(emotion === sample.emotion),
  ])) as Record<EkmanEmotion, number>;
  return { ...probabilities, valence: sample.valence, arousal: sample.arousal };
};

const averageSeriesValues = (valuesList: readonly EmotionSeriesValues[]): EmotionSeriesValues => {
  const keys = Object.keys(valuesList[0]) as EmotionSeries[];
  return Object.fromEntries(keys.map(key => [
    key,
    valuesList.reduce((sum, values) => sum + values[key], 0) / valuesList.length,
  ])) as EmotionSeriesValues;
};

export const buildEmotionCurve = (samples: readonly ParticipantEmotionSample[], bucketMs: number): EmotionCurvePoint[] => {
  if (samples.length === 0) return [];
  const bucketCount = Math.floor(Math.max(...samples.map(sample => sample.timestamp)) / bucketMs) + 1;
  const valuesByBucket = Array.from({ length: bucketCount }, () => new Map<string, EmotionSeriesValues[]>());
  for (const sample of samples) {
    const participants = valuesByBucket[Math.floor(sample.timestamp / bucketMs)];
    participants.set(sample.participantId, [...(participants.get(sample.participantId) ?? []), readSeriesValues(sample)]);
  }
  return valuesByBucket.map((participants, index) => ({
    timeMs: index * bucketMs,
    participantCount: participants.size,
    values: participants.size === 0 ? null : averageSeriesValues([...participants.values()].map(averageSeriesValues)),
  }));
};

export const findLeadingEmotion = (
  points: readonly EmotionCurvePoint[],
  emotions: readonly EkmanEmotion[],
  endMs: number,
  windowMs: number,
): LeadingEmotion | null => {
  const windowValues = points
    .filter(point => point.timeMs <= endMs && point.timeMs > endMs - windowMs)
    .flatMap(point => (point.values ? [point.values] : []));
  if (windowValues.length === 0 || emotions.length === 0) return null;
  const ranked = emotions
    .map(emotion => ({ emotion, share: windowValues.reduce((sum, values) => sum + values[emotion], 0) / windowValues.length }))
    .sort((a, b) => b.share - a.share);
  return { ...ranked[0], gapToNext: ranked.length > 1 ? ranked[0].share - ranked[1].share : null };
};

export const buildFacePresence = (samples: readonly ParticipantEmotionSample[], maxGapMs: number): ParticipantFacePresence[] => {
  const timestampsByParticipant = new Map<string, number[]>();
  for (const sample of samples) {
    timestampsByParticipant.set(sample.participantId, [...(timestampsByParticipant.get(sample.participantId) ?? []), sample.timestamp]);
  }
  return [...timestampsByParticipant.entries()].map(([participantId, timestamps]) => {
    const segments: FaceSegment[] = [];
    for (const timestamp of [...timestamps].sort((a, b) => a - b)) {
      const last = segments.at(-1);
      if (last && timestamp - last.endMs <= maxGapMs) segments[segments.length - 1] = { startMs: last.startMs, endMs: timestamp };
      else segments.push({ startMs: timestamp, endMs: timestamp });
    }
    return { participantId, segments };
  });
};
