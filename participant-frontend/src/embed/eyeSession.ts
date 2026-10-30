import { GAZE_FEATURE_DIMENSION } from '../lib/eyeTracking/constants';
export const CALIBRATION_REUSE_MS = 600_000;

export interface EyeSession {
    video: HTMLVideoElement;
    readGaze: () => { x: number; y: number } | null;
    isEyeOpen: () => boolean;
    readHeadPose: () => { pitch: number; yaw: number };
    readLandmarks: () => Array<{ x: number; y: number; z: number }> | null;
    calibrationRmsePx: number | null;
    isGazeCalibrated: boolean;
    stop: () => void;
}

export interface EyeStartOptions {
    lang: string;
    storageKey: string;
    hasEmotionRecognition: boolean;
    canSkipCalibration: boolean;
    onReady: (session: EyeSession) => void;
    onDecline: () => void;
    onCameraDenied: () => void;
}

export type CalibratedGaze = Omit<EyeSession, 'stop'>;

export interface CalibrationFlowOptions {
    storageKey: string;
    hasEmotionRecognition: boolean;
    canSkipCalibration: boolean;
    onReady: (gaze: CalibratedGaze) => void;
    onDecline: () => void;
    onCameraDenied: () => void;
}

export interface StoredCalibration {
    samples: Array<{ features: number[]; target: [number, number] }>;
    savedAt: number;
}

const roundSample = (value: number): number => Math.round(value * 1e5) / 1e5;

export const saveCalibration = (storageKey: string, calibration: StoredCalibration): void => {
    const compact = {
        savedAt: calibration.savedAt,
        samples: calibration.samples.map(({ features, target }) => ({ features: features.map(roundSample), target })),
    };
    try {
        localStorage.setItem(storageKey, JSON.stringify(compact));
    } catch {
        return;
    }
};

export const loadCalibration = (storageKey: string, now: number): StoredCalibration | null => {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        return null;
    }
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredCalibration;
    const isFresh = now - stored.savedAt < CALIBRATION_REUSE_MS;
    const hasCurrentFeatures = stored.samples.every(({ features }) => features.length === GAZE_FEATURE_DIMENSION);
    return isFresh && hasCurrentFeatures && stored.samples.length > 0 ? stored : null;
};
