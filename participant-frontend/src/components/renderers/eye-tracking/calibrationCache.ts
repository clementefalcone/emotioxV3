import type { HybridCalibrationResidual } from '../../../lib/eyeTracking';
import type { GazePredictor } from '../../../lib/eyeTracking/gazePredictor';

const CALIBRATION_TTL_MS = 120_000;

export interface CachedCalibration {
    residuals: HybridCalibrationResidual[];
    rmsePx: number | null;
    predictor: GazePredictor;
}

let lastCalibration: (CachedCalibration & { moduleId: string; savedAt: number }) | null = null;

export const rememberCalibration = (moduleId: string, calibration: CachedCalibration): void => {
    lastCalibration = { ...calibration, moduleId, savedAt: Date.now() };
};

export const recallCalibration = (moduleId: string): CachedCalibration | null => {
    if (!lastCalibration) return null;
    const isSameModule = lastCalibration.moduleId === moduleId;
    const isExpired = Date.now() - lastCalibration.savedAt > CALIBRATION_TTL_MS;
    if (isSameModule || isExpired || !lastCalibration.predictor.isReady()) return null;
    return lastCalibration;
};
