import { describe, expect, it } from 'vitest';
import type { EkmanEmotion } from '../../../../services/analytics.service';
import { buildEmotionCurve, buildFacePresence, findLeadingEmotion, fitEmotionAxisMax, type ParticipantEmotionSample } from '../emotionCurve';

const NO_EXPRESSIONS: Record<EkmanEmotion, number> = { joy: 0, surprise: 0, anger: 0, fear: 0, disgust: 0, sadness: 0, neutral: 0 };

const sample = (
  participantId: string,
  timestamp: number,
  expressions: Partial<Record<EkmanEmotion, number>>,
  valenceArousal: { valence: number; arousal: number } = { valence: 0, arousal: 0 },
): ParticipantEmotionSample => ({ participantId, timestamp, emotion: 'neutral', confidence: 1, ...valenceArousal, expressions: { ...NO_EXPRESSIONS, ...expressions } });

describe('buildEmotionCurve', () => {
  it('averages each participant inside a bucket first, so a fast camera does not outweigh a slow one', () => {
    const curve = buildEmotionCurve([
      sample('p1', 0, { joy: 1 }, { valence: 0.8, arousal: 0.4 }),
      sample('p1', 100, { joy: 1 }, { valence: 0.8, arousal: 0.4 }),
      sample('p1', 200, { joy: 1 }, { valence: 0.8, arousal: 0.4 }),
      sample('p2', 50, { anger: 1 }, { valence: -0.6, arousal: 0.8 }),
    ], 250);

    expect(curve).toHaveLength(1);
    expect(curve[0].participantCount).toBe(2);
    expect(curve[0].values?.joy).toBeCloseTo(0.5);
    expect(curve[0].values?.anger).toBeCloseTo(0.5);
    expect(curve[0].values?.valence).toBeCloseTo(0.1);
    expect(curve[0].values?.arousal).toBeCloseTo(0.6);
  });

  it('leaves a gap where no face was detected so the line does not invent data', () => {
    const curve = buildEmotionCurve([sample('p1', 0, { joy: 1 }), sample('p1', 600, { joy: 1 })], 250);

    expect(curve.map(point => [point.timeMs, point.values === null])).toEqual([[0, false], [250, true], [500, false]]);
  });

  it('treats a response without probabilities as fully its dominant emotion', () => {
    const [point] = buildEmotionCurve([{ participantId: 'p1', timestamp: 0, emotion: 'fear', confidence: 0.6, valence: -0.8, arousal: 0.6 }], 250);

    expect(point.values).toMatchObject({ fear: 1, joy: 0, neutral: 0, valence: -0.8, arousal: 0.6 });
  });

  it('returns nothing without samples', () => {
    expect(buildEmotionCurve([], 250)).toEqual([]);
  });
});

describe('findLeadingEmotion', () => {
  const curve = buildEmotionCurve([
    sample('p1', 0, { joy: 0.9, anger: 0.1 }),
    sample('p1', 1000, { anger: 0.8, joy: 0.2 }),
    sample('p1', 1500, { anger: 0.6, joy: 0.3, neutral: 0.1 }),
  ], 500);

  it('ranks the emotions shown over the window that ends at the marker and measures the lead', () => {
    const leading = findLeadingEmotion(curve, ['joy', 'anger'], 1500, 1000);

    expect(leading?.emotion).toBe('anger');
    expect(leading?.share).toBeCloseTo(0.7);
    expect(leading?.gapToNext).toBeCloseTo(0.45);
  });

  it('only competes among the emotions on screen', () => {
    expect(findLeadingEmotion(curve, ['joy'], 1500, 1000)).toMatchObject({ emotion: 'joy', gapToNext: null });
  });

  it('says nothing when the window has no face data or no emotion is shown', () => {
    expect(findLeadingEmotion(curve, ['joy', 'anger'], 600, 100)).toBeNull();
    expect(findLeadingEmotion(curve, [], 1500, 1000)).toBeNull();
  });
});

describe('buildFacePresence', () => {
  it('joins detections closer than the gap into one segment per stretch of visible face', () => {
    const presence = buildFacePresence([
      sample('p1', 0, {}),
      sample('p1', 200, {}),
      sample('p1', 1500, {}),
      sample('p2', 300, {}),
    ], 500);

    expect(presence).toEqual([
      { participantId: 'p1', segments: [{ startMs: 0, endMs: 200 }, { startMs: 1500, endMs: 1500 }] },
      { participantId: 'p2', segments: [{ startMs: 300, endMs: 300 }] },
    ]);
  });
});

describe('fitEmotionAxisMax', () => {
  it('zooms the emotion axis to the next 5% above the highest visible value', () => {
    expect(fitEmotionAxisMax(23.4)).toBe(25);
    expect(fitEmotionAxisMax(25)).toBe(25);
    expect(fitEmotionAxisMax(93)).toBe(95);
  });

  it('keeps at least 5% and never passes 100%', () => {
    expect(fitEmotionAxisMax(0)).toBe(5);
    expect(fitEmotionAxisMax(1.2)).toBe(5);
    expect(fitEmotionAxisMax(140)).toBe(100);
  });
});
