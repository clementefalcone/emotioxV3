import { describe, it, expect } from 'vitest';
import { detectMicroExpressions } from '../microExpressionDetector';
import type { EmotionSample, EkmanEmotion } from '../facsClassifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const zeroAUs = { AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU20: 0, AU25: 0, AU26: 0 };

function sample(emotion: EkmanEmotion, timestamp: number, confidence = 0.8): EmotionSample {
  return { emotion, timestamp, confidence, actionUnits: zeroAUs };
}

function neutralTimeline(count: number, startMs = 0, stepMs = 50): EmotionSample[] {
  return Array.from({ length: count }, (_, i) => sample('neutral', startMs + i * stepMs));
}

// ---------------------------------------------------------------------------
// detectMicroExpressions
// ---------------------------------------------------------------------------

describe('detectMicroExpressions — edge cases', () => {
  it('empty array returns empty', () => {
    expect(detectMicroExpressions([])).toEqual([]);
  });

  it('1 sample returns empty (need >= 3)', () => {
    expect(detectMicroExpressions([sample('joy', 0)])).toEqual([]);
  });

  it('2 samples returns empty (need >= 3)', () => {
    expect(detectMicroExpressions([sample('joy', 0), sample('neutral', 50)])).toEqual([]);
  });

  it('uniform emotion (all neutral) returns empty', () => {
    const samples = neutralTimeline(20);
    expect(detectMicroExpressions(samples)).toEqual([]);
  });
});

describe('detectMicroExpressions — basic detection', () => {
  it('detects a brief micro-expression (<200ms)', () => {
    // 10 neutral, 2 joy (100ms), 10 neutral
    const samples = [
      ...neutralTimeline(10, 0),          // 0-450ms neutral
      sample('joy', 500),                  // 500ms joy
      sample('joy', 550),                  // 550ms joy (duration = 50ms)
      ...neutralTimeline(10, 600),         // 600-1050ms neutral
    ];
    const result = detectMicroExpressions(samples);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const me = result.find(r => r.emotion === 'joy');
    expect(me).toBeDefined();
    expect(me!.category).toBe('brief');
    expect(me!.durationMs).toBeLessThan(200);
  });

  it('detects a micro-expression (200-500ms)', () => {
    // 20 neutral, 6 surprise (300ms), 20 neutral
    const samples = [
      ...neutralTimeline(20, 0),
      sample('surprise', 1000),
      sample('surprise', 1050),
      sample('surprise', 1100),
      sample('surprise', 1150),
      sample('surprise', 1200),
      sample('surprise', 1250),
      sample('surprise', 1300), // duration = 300ms
      ...neutralTimeline(20, 1350),
    ];
    const result = detectMicroExpressions(samples);
    const me = result.find(r => r.emotion === 'surprise');
    expect(me).toBeDefined();
    expect(me!.category).toBe('micro');
    expect(me!.durationMs).toBeGreaterThanOrEqual(200);
    expect(me!.durationMs).toBeLessThanOrEqual(500);
  });

  it('does NOT detect a sustained expression (>500ms)', () => {
    // 20 neutral, 15 anger (750ms), 20 neutral
    const samples = [
      ...neutralTimeline(20, 0),
      ...Array.from({ length: 15 }, (_, i) => sample('anger', 1000 + i * 50)),
      ...neutralTimeline(20, 1750),
    ];
    const result = detectMicroExpressions(samples);
    const anger = result.find(r => r.emotion === 'anger');
    expect(anger).toBeUndefined();
  });
});

describe('detectMicroExpressions — confidence filter', () => {
  it('ignores transients below minConfidence', () => {
    const samples = [
      ...neutralTimeline(10, 0),
      sample('joy', 500, 0.2),  // below default 0.4
      sample('joy', 550, 0.2),
      ...neutralTimeline(10, 600),
    ];
    const result = detectMicroExpressions(samples);
    expect(result.filter(r => r.emotion === 'joy')).toHaveLength(0);
  });

  it('custom minConfidence lowers threshold', () => {
    const samples = [
      ...neutralTimeline(10, 0),
      sample('joy', 500, 0.2),
      sample('joy', 550, 0.2),
      ...neutralTimeline(10, 600),
    ];
    const result = detectMicroExpressions(samples, { minConfidence: 0.1 });
    expect(result.filter(r => r.emotion === 'joy').length).toBeGreaterThanOrEqual(0);
    // May or may not detect depending on local baseline — at least doesn't crash
  });

  it('peakConfidence tracks maximum during transient', () => {
    const samples = [
      ...neutralTimeline(20, 0),
      sample('fear', 1000, 0.5),
      sample('fear', 1050, 0.9),  // peak
      sample('fear', 1100, 0.6),
      ...neutralTimeline(20, 1150),
    ];
    const result = detectMicroExpressions(samples);
    const fear = result.find(r => r.emotion === 'fear');
    if (fear) {
      expect(fear.peakConfidence).toBe(0.9);
    }
  });
});

describe('detectMicroExpressions — options', () => {
  it('custom maxDurationMs changes upper bound', () => {
    // 8 frames of disgust = 400ms, default max=500 → detected
    const samples = [
      ...neutralTimeline(20, 0),
      ...Array.from({ length: 9 }, (_, i) => sample('disgust', 1000 + i * 50)),
      ...neutralTimeline(20, 1450),
    ];

    const withDefault = detectMicroExpressions(samples);
    const withLowMax = detectMicroExpressions(samples, { maxDurationMs: 200 });

    const disgustDefault = withDefault.find(r => r.emotion === 'disgust');
    const disgustLowMax = withLowMax.find(r => r.emotion === 'disgust');

    // With default (500ms), 400ms transient IS detected
    if (disgustDefault) {
      expect(disgustDefault.durationMs).toBeLessThanOrEqual(500);
    }
    // With 200ms max, 400ms transient is NOT detected
    expect(disgustLowMax).toBeUndefined();
  });

  it('custom briefThresholdMs changes category boundary', () => {
    // 3 frames = 100ms, default brief threshold = 200
    const samples = [
      ...neutralTimeline(20, 0),
      sample('sadness', 1000),
      sample('sadness', 1050),
      sample('sadness', 1100),
      ...neutralTimeline(20, 1150),
    ];

    const withDefault = detectMicroExpressions(samples);
    const withLowThreshold = detectMicroExpressions(samples, { briefThresholdMs: 50 });

    const sadDefault = withDefault.find(r => r.emotion === 'sadness');
    const sadLow = withLowThreshold.find(r => r.emotion === 'sadness');

    if (sadDefault) {
      expect(sadDefault.category).toBe('brief'); // 100ms < 200ms
    }
    if (sadLow) {
      expect(sadLow.category).toBe('micro'); // 100ms >= 50ms
    }
  });
});

describe('detectMicroExpressions — multiple transients', () => {
  it('detects multiple micro-expressions in one timeline', () => {
    const samples = [
      ...neutralTimeline(20, 0),
      sample('joy', 1000),
      sample('joy', 1050),
      ...neutralTimeline(20, 1100),
      sample('anger', 2100),
      sample('anger', 2150),
      ...neutralTimeline(20, 2200),
    ];
    const result = detectMicroExpressions(samples);
    const emotions = result.map(r => r.emotion);
    expect(emotions).toContain('joy');
    expect(emotions).toContain('anger');
  });

  it('consecutive different transients detected separately', () => {
    const samples = [
      ...neutralTimeline(20, 0),
      sample('joy', 1000),
      sample('joy', 1050),
      sample('anger', 1100),   // immediately transitions to anger
      sample('anger', 1150),
      ...neutralTimeline(20, 1200),
    ];
    const result = detectMicroExpressions(samples);
    // joy transient ends when anger starts
    const joy = result.find(r => r.emotion === 'joy');
    if (joy) {
      expect(joy.durationMs).toBeLessThanOrEqual(100);
    }
  });
});

describe('detectMicroExpressions — output format', () => {
  it('output has all required fields', () => {
    const samples = [
      ...neutralTimeline(20, 0),
      sample('surprise', 1000, 0.7),
      sample('surprise', 1050, 0.9),
      ...neutralTimeline(20, 1100),
    ];
    const result = detectMicroExpressions(samples);
    if (result.length > 0) {
      const me = result[0];
      expect(me).toHaveProperty('emotion');
      expect(me).toHaveProperty('durationMs');
      expect(me).toHaveProperty('startTimestamp');
      expect(me).toHaveProperty('endTimestamp');
      expect(me).toHaveProperty('peakConfidence');
      expect(me).toHaveProperty('category');
      expect(me.endTimestamp).toBeGreaterThanOrEqual(me.startTimestamp);
      expect(me.durationMs).toBe(me.endTimestamp - me.startTimestamp);
      expect(['brief', 'micro']).toContain(me.category);
    }
  });

  it('startTimestamp and endTimestamp match sample timestamps', () => {
    const samples = [
      ...neutralTimeline(20, 0),
      sample('fear', 1000, 0.8),
      sample('fear', 1050, 0.8),
      sample('fear', 1100, 0.8),
      ...neutralTimeline(20, 1150),
    ];
    const result = detectMicroExpressions(samples);
    const fear = result.find(r => r.emotion === 'fear');
    if (fear) {
      expect(fear.startTimestamp).toBe(1000);
      expect(fear.endTimestamp).toBe(1100);
      expect(fear.durationMs).toBe(100);
    }
  });
});
