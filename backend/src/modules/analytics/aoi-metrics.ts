import type { EkmanEmotion, EmotionSample } from './emotion-metrics';

export interface AoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AoiFixation {
  participantId: string;
  x: number;
  y: number;
  duration: number;
  timestamp: number;
}

export interface AoiMetrics {
  dwellTimePercent: number;
  fixationCount: number;
  avgDuration: number;
  participantCount: number;
  avgTTFF: number;
  noticeRate: number;
  dominantEmotion?: EkmanEmotion;
  emotionDistribution?: Record<EkmanEmotion, number>;
}

const SOFT_AOI_MIN_WEIGHT = 0.15;
const NOTICED_WEIGHT = 0.5;
const EMOTION_WINDOW_MS = 100;

export const softAoiWeight = (fx: number, fy: number, aoi: AoiRect): number => {
  if (fx >= aoi.x && fx <= aoi.x + aoi.width && fy >= aoi.y && fy <= aoi.y + aoi.height) return 1.0;
  const sigmaX = aoi.width * 0.35;
  const sigmaY = aoi.height * 0.35;
  if (sigmaX <= 0 || sigmaY <= 0) return 0;
  const distX = Math.max(0, Math.abs(fx - (aoi.x + aoi.width / 2)) - aoi.width / 2) / sigmaX;
  const distY = Math.max(0, Math.abs(fy - (aoi.y + aoi.height / 2)) - aoi.height / 2) / sigmaY;
  return Math.exp(-(distX * distX + distY * distY) / 2);
};

const earliestByParticipant = (fixations: AoiFixation[]): Map<string, number> => {
  const earliest = new Map<string, number>();
  for (const fixation of fixations) {
    const current = earliest.get(fixation.participantId);
    if (current === undefined || fixation.timestamp < current) earliest.set(fixation.participantId, fixation.timestamp);
  }
  return earliest;
};

const emotionsDuringFixations = (
  fixations: AoiFixation[],
  emotionsByParticipant: Map<string, EmotionSample[]>,
): Pick<AoiMetrics, 'dominantEmotion' | 'emotionDistribution'> => {
  const counts: Record<EkmanEmotion, number> = { joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0 };
  let total = 0;
  for (const fixation of fixations) {
    for (const emotion of emotionsByParticipant.get(fixation.participantId) ?? []) {
      if (emotion.timestamp >= fixation.timestamp - EMOTION_WINDOW_MS && emotion.timestamp <= fixation.timestamp + fixation.duration + EMOTION_WINDOW_MS) {
        counts[emotion.emotion]++;
        total++;
      }
    }
  }
  if (total === 0) return {};
  const emotionDistribution = {} as Record<EkmanEmotion, number>;
  let dominantEmotion: EkmanEmotion = 'neutral';
  let bestCount = 0;
  for (const [emotion, count] of Object.entries(counts) as [EkmanEmotion, number][]) {
    emotionDistribution[emotion] = Math.round((count / total) * 10000) / 100;
    if (count > bestCount) {
      bestCount = count;
      dominantEmotion = emotion;
    }
  }
  return { dominantEmotion, emotionDistribution };
};

const sharedWeight = (fixation: AoiFixation, rect: AoiRect, allRects: readonly AoiRect[]): number => {
  const weightFor = (candidate: AoiRect) => {
    const weight = softAoiWeight(fixation.x, fixation.y, candidate);
    return weight >= SOFT_AOI_MIN_WEIGHT ? weight : 0;
  };
  const totalWeight = allRects.reduce((sum, candidate) => sum + weightFor(candidate), 0);
  return weightFor(rect) / Math.max(1, totalWeight);
};

export const computeAoiMetrics = ({ fixations, rectFor, allRectsFor, emotionsByParticipant }: {
  fixations: AoiFixation[];
  rectFor: (fixation: AoiFixation) => AoiRect | undefined;
  allRectsFor: (fixation: AoiFixation) => readonly AoiRect[];
  emotionsByParticipant: Map<string, EmotionSample[]>;
}): AoiMetrics => {
  const totalDwellTime = fixations.reduce((sum, fixation) => sum + fixation.duration, 0);
  const totalParticipants = new Set(fixations.map((fixation) => fixation.participantId)).size;
  const candidates = fixations.flatMap((fixation) => {
    const rect = rectFor(fixation);
    const proximity = rect ? softAoiWeight(fixation.x, fixation.y, rect) : 0;
    return rect && proximity >= SOFT_AOI_MIN_WEIGHT ? [{ fixation, rect, proximity }] : [];
  });
  const weighted = candidates.map(({ fixation, rect }) => ({ fixation, weight: sharedWeight(fixation, rect, allRectsFor(fixation)) }));
  const noticed = candidates.filter(({ proximity }) => proximity >= NOTICED_WEIGHT).map(({ fixation }) => fixation);
  const noticedParticipants = new Set(noticed.map((fixation) => fixation.participantId));

  const startByParticipant = earliestByParticipant(fixations);
  const ttffValues = Array.from(earliestByParticipant(noticed).entries())
    .map(([participantId, firstSeen]) => Math.max(0, firstSeen - (startByParticipant.get(participantId) ?? firstSeen)));

  const dwellTime = weighted.reduce((sum, { fixation, weight }) => sum + fixation.duration * weight, 0);
  const fixationCount = Math.round(weighted.reduce((sum, { weight }) => sum + weight, 0));

  return {
    dwellTimePercent: totalDwellTime > 0 ? Math.round((dwellTime / totalDwellTime) * 100) : 0,
    fixationCount,
    avgDuration: fixationCount > 0 ? Math.round(dwellTime / fixationCount) : 0,
    participantCount: noticedParticipants.size,
    avgTTFF: ttffValues.length > 0 ? Math.round(ttffValues.reduce((a, b) => a + b, 0) / ttffValues.length) : 0,
    noticeRate: totalParticipants > 0 ? Math.round((noticedParticipants.size / totalParticipants) * 100) : 0,
    ...emotionsDuringFixations(noticed, emotionsByParticipant),
  };
};
