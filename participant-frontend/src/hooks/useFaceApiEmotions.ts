import { useState, useRef, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import * as faceapi from '@vladmandic/face-api';
import type { EmotionSample, EkmanEmotion } from '../lib/eyeTracking';
import { createActionUnitEstimator } from '../lib/eyeTracking';

/**
 * face-api.js emotion recognition hook.
 * Runs TinyFaceDetector + FaceExpressionNet on the same webcam stream
 * used by BlazeGaze — no duplicate camera access.
 *
 * Produces EmotionSample[] compatible with the existing FACS pipeline format
 * so backend analytics (computeEmotionMetrics) and research-frontend results
 * work without changes.
 *
 * All processing is client-side — zero images transmitted to server.
 */

/** Map face-api expression keys to our EkmanEmotion labels */
const EXPRESSION_MAP: Record<string, EkmanEmotion> = {
  happy: 'joy',
  sad: 'sadness',
  angry: 'anger',
  surprised: 'surprise',
  disgusted: 'disgust',
  fearful: 'fear',
  neutral: 'neutral',
};

export interface UseFaceApiEmotionsOptions {
  /** The same video ref used by useBlazeGaze */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Whether emotion recognition is enabled for this module */
  enabled?: boolean;
  /** Sampling interval in ms (default 50ms = 20fps) */
  sampleIntervalMs?: number;
}

let modelsLoaded = false;

async function ensureModelsLoaded(): Promise<void> {
  if (modelsLoaded) return;
  const modelPath = `${window.location.origin}${import.meta.env.BASE_URL}models`;
  await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath);
  await faceapi.nets.faceExpressionNet.loadFromUri(modelPath);
  modelsLoaded = true;
}

export function useFaceApiEmotions({
  videoRef,
  enabled = false,
  sampleIntervalMs = 50,
}: UseFaceApiEmotionsOptions) {
  const [isLoaded, setIsLoaded] = useState(false);
  const runningRef = useRef(false);
  const pendingStartRef = useRef(false);
  const lastSampleRef = useRef<number>(0);
  const isDetectingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const samplesRef = useRef<EmotionSample[]>([]);
  const estimateActionUnitsRef = useRef(createActionUnitEstimator());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    ensureModelsLoaded()
      .then(() => {
        if (!cancelled) setIsLoaded(true);
      })
      .catch((err) => {
        console.error('[useFaceApiEmotions] Failed to load models:', err);
      });

    return () => { cancelled = true; };
  }, [enabled]);

  /** Detect expressions from current video frame. */
  const sampleFrame = useCallback(async (): Promise<EmotionSample | null> => {
    const video = videoRef.current;
    if (!video || !isLoaded || video.readyState < 2 || isDetectingRef.current) return null;

    const now = performance.now();
    if (now - lastSampleRef.current < sampleIntervalMs) return null;
    lastSampleRef.current = now;
    isDetectingRef.current = true;

    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 }))
        .withFaceLandmarks()
        .withFaceExpressions();

      if (!detection) return null;

      const expressions = detection.expressions;
      // Find dominant expression
      let bestEmotion: EkmanEmotion = 'neutral';
      let bestScore = 0;
      for (const [key, score] of Object.entries(expressions)) {
        const mapped = EXPRESSION_MAP[key];
        if (mapped && score > bestScore) {
          bestScore = score;
          bestEmotion = mapped;
        }
      }

      // Extract FACS Action Units from 68-point landmarks
      const landmarks68 = detection.landmarks.positions;
      const aus = estimateActionUnitsRef.current(landmarks68) ?? {
        AU1: 0, AU2: 0, AU4: 0, AU6: 0,
        AU12: 0, AU15: 0, AU20: 0, AU25: 0, AU26: 0,
      };

      const sample: EmotionSample = {
        timestamp: Math.round(now - startTimeRef.current),
        emotion: bestEmotion,
        confidence: bestScore,
        actionUnits: aus,
      };

      if (runningRef.current) {
        samplesRef.current.push(sample);
      }

      return sample;
    } catch (err) {
      console.warn('[useFaceApiEmotions] Detection error:', err);
      return null;
    } finally {
      isDetectingRef.current = false;
    }
  }, [videoRef, isLoaded, sampleIntervalMs]);

  const rafIdRef = useRef(0);

  const startSampling = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    samplesRef.current = [];
    lastSampleRef.current = 0;
    estimateActionUnitsRef.current = createActionUnitEstimator();

    const loop = () => {
      if (!runningRef.current) return;
      void sampleFrame();
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
  }, [sampleFrame]);

  const start = useCallback(() => {
    startTimeRef.current = performance.now();
    if (isLoaded) {
      startSampling();
    } else {
      pendingStartRef.current = true;
    }
  }, [isLoaded, startSampling]);

  useEffect(() => {
    if (isLoaded && pendingStartRef.current) {
      pendingStartRef.current = false;
      startSampling();
    }
  }, [isLoaded, startSampling]);

  const stop = useCallback(() => {
    runningRef.current = false;
    pendingStartRef.current = false;
    cancelAnimationFrame(rafIdRef.current);
  }, []);

  /** Get all collected samples. */
  const getSamples = useCallback((): EmotionSample[] => {
    return [...samplesRef.current];
  }, []);

  /** Clear collected samples. */
  const reset = useCallback(() => {
    samplesRef.current = [];
  }, []);

  return {
    isLoaded,
    start,
    stop,
    getSamples,
    reset,
  };
}
