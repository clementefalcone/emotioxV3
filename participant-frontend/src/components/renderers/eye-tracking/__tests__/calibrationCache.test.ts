import { describe, it, expect, vi, afterEach } from 'vitest';
import { recallCalibration, rememberCalibration } from '../calibrationCache';
import type { GazePredictor } from '../../../../lib/eyeTracking/gazePredictor';

const predictor = (isReady: boolean) => ({ isReady: () => isReady }) as unknown as GazePredictor;

describe('calibrationCache', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('hands the trained predictor to the next module', () => {
        const trained = predictor(true);
        rememberCalibration('module-1', { residuals: [], rmsePx: 40, predictor: trained });

        expect(recallCalibration('module-2')?.predictor).toBe(trained);
    });

    it('never reuses a calibration for the module that produced it', () => {
        rememberCalibration('module-1', { residuals: [], rmsePx: 40, predictor: predictor(true) });

        expect(recallCalibration('module-1')).toBeNull();
    });

    it('rejects an untrained predictor and an expired calibration', () => {
        rememberCalibration('module-1', { residuals: [], rmsePx: 40, predictor: predictor(false) });
        expect(recallCalibration('module-2')).toBeNull();

        vi.useFakeTimers();
        rememberCalibration('module-1', { residuals: [], rmsePx: 40, predictor: predictor(true) });
        vi.advanceTimersByTime(120_001);
        expect(recallCalibration('module-2')).toBeNull();
    });
});
