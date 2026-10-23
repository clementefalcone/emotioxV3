import type React from 'react';
import type { ModuleConfig } from '../../../types/module';
import { getComponentText } from '../../../utils/moduleComponent';
import {
    HYBRID_IMAGE_CALIBRATION_POINTS,
} from '../../../lib/eyeTracking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EyeTrackingRendererProps {
    module: ModuleConfig;
    onComplete?: () => void;
}

export interface Fixation {
    x: number;
    y: number;
    duration: number;
    timestamp: number;
}

export interface ShelfConfig {
    shelfCount: number;
    columns: string[];
    containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Phases:
 * consent → face → preparing → calibration → viewing → complete
 * If validation fails, loops back to calibration (re-calibrate).
 * face: live guide circle driven by MediaPipe landmarks; continues only when the face is centered.
 */
export type ETPhase = 'consent' | 'face' | 'preparing' | 'calibration' | 'viewing' | 'complete';

export const TOTAL_STEPS = 3;

/**
 * Gaze engine selection.
 * 'mediapipe' — MediaPipe FaceLandmarker + Ridge Regression (30fps, lower RMSE).
 * 'blazegaze' — WebEyeTrack CNN (legacy fallback).
 *
 * Benchmark results (isolated, fake camera, same GT):
 *   MediaPipe: 30.9fps, RMSE 367px, jitter 14.5px
 *   BlazeGaze: 1.7fps,  RMSE 498px, jitter 148px
 */
export type GazeEngine = 'mediapipe' | 'blazegaze';
export const GAZE_ENGINE: GazeEngine = 'mediapipe';

/** V3 probabilistic heatmap alongside V2 zone events. */
export const V3_HEATMAP_ENABLED = true;

/** One-Euro params — adaptive layer on top of Kalman. Smooth at rest, responsive on saccade. */
export const EYE_TRACKING_ONE_EURO_MIN_CUTOFF = 0.8;
export const EYE_TRACKING_ONE_EURO_BETA = 0.005;

export const HYBRID_CALIB_POINT_COUNT = HYBRID_IMAGE_CALIBRATION_POINTS.length;

// Gaze collection polling interval (ms)
export const GAZE_POLL_MS = 50;

// ---------------------------------------------------------------------------
// Device detection
// ---------------------------------------------------------------------------

export function getDeviceType(): 'desktop' | 'tablet' | 'mobile' {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('ipad') || (ua.includes('tablet') && !ua.includes('mobile'))) return 'tablet';
    if (/android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
    return 'desktop';
}

// ---------------------------------------------------------------------------
// Config extraction (mirrors backend)
// ---------------------------------------------------------------------------

export const extractConfig = (module: ModuleConfig) => {
    const components = module.structure?.components || [];

    // Stimulus URLs — canonical ID: 'stimuli', fallback to any file-upload
    let stimulusUrl = '';
    let stimulusUrls: string[] = [];
    const fileUploadComp = components.find(c =>
        c.id === 'stimuli' || c.type === 'file-upload' || c.id === 'stimulus-image' || c.id === 'image' || c.id === 'stimulus'
    );
    if (fileUploadComp) {
        const raw = getComponentText(fileUploadComp);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    stimulusUrls = parsed
                        .map((item: { s3Key?: string; url?: string }) => item.s3Key || item.url || '')
                        .filter(Boolean);
                    stimulusUrl = stimulusUrls[0] || '';
                } else if (typeof parsed === 'string') {
                    stimulusUrl = parsed;
                    stimulusUrls = [parsed];
                }
            } catch {
                stimulusUrl = raw;
                stimulusUrls = [raw];
            }
        }
    }

    // Task description — canonical ID: 'task-instructions'
    let taskDescription = '';
    const descComp = components.find(c =>
        c.id === 'task-instructions' || c.id === 'task-description' || c.id === 'question-title' || c.id === 'description'
    );
    if (descComp) {
        taskDescription = getComponentText(descComp) || descComp.placeholder?.text || '';
    }

    // Viewing duration — canonical ID: 'priming-time' (value in seconds, convert to ms)
    let viewingDuration = 10000;
    const durationComp = components.find(c =>
        c.id === 'priming-time' || c.id === 'viewing-duration' || c.id === 'duration' || c.id === 'exposure-time'
    );
    if (durationComp) {
        const raw = getComponentText(durationComp);
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) {
            // priming-time stores seconds (5, 10, 15, 20, 30); legacy stores ms
            viewingDuration = parsed <= 60 ? parsed * 1000 : parsed;
        }
    }

    // Display mode — canonical ID: 'display-mode', auto-detect fallback: >1 image = shelf
    let displayMode: 'stand_alone' | 'shelf' = 'stand_alone';
    const modeComp = components.find(c => c.id === 'display-mode');
    if (modeComp) {
        const val = getComponentText(modeComp).toLowerCase();
        if (val === 'shelf') displayMode = 'shelf';
    }
    if (displayMode === 'stand_alone' && stimulusUrls.length > 1) {
        displayMode = 'shelf';
    }

    // Shelf config — canonical IDs: 'shelf-count', 'shelf-items', 'randomize-stimuli'
    const shelfCountComp = components.find(c => c.id === 'shelf-count');
    const shelfCount = shelfCountComp ? parseInt(getComponentText(shelfCountComp), 10) || 2 : 2;

    const shelfItemsComp = components.find(c => c.id === 'shelf-items');
    const shelfItems = shelfItemsComp ? parseInt(getComponentText(shelfItemsComp), 10) || 5 : 5;

    const randomizeComp = components.find(c => c.id === 'randomize-stimuli');
    const randomizeStimuli = randomizeComp ? getComponentText(randomizeComp) === 'true' : false;

    const shelfRepetitionsComp = components.find(c => c.id === 'shelf-repetitions');
    const shelfRepetitions = shelfRepetitionsComp ? parseInt(getComponentText(shelfRepetitionsComp), 10) || 1 : 1;

    // Feature toggles
    const emotionRecognition = components.find(c => c.id === 'emotion-recognition');
    const hasEmotionRecognition = emotionRecognition ? getComponentText(emotionRecognition) === 'true' : true;

    const attentionMeasurement = components.find(c => c.id === 'attention-measurement');
    const hasAttentionMeasurement = attentionMeasurement ? getComponentText(attentionMeasurement) === 'true' : true;

    // Detect video stimulus (shelf mode is always images)
    const isVideo = displayMode !== 'shelf' && (/\.(mp4|webm|ogg)$/i.test(stimulusUrl) || stimulusUrl.includes('video/'));

    let hasUploadError = false;
    if (!stimulusUrl && fileUploadComp) {
        const raw = getComponentText(fileUploadComp);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.some((f: { status?: string }) => f.status === 'error')) {
                    hasUploadError = true;
                }
            } catch { /* ignore */ }
        }
    }

    return { stimulusUrl, stimulusUrls, taskDescription, viewingDuration, displayMode, shelfCount, shelfItems, shelfRepetitions, randomizeStimuli, hasEmotionRecognition, hasAttentionMeasurement, isVideo, hasUploadError };
};
