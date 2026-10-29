import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALIBRATION_REUSE_MS, loadCalibration, saveCalibration } from '../eyeSession';
import { GAZE_FEATURE_DIMENSION } from '../../lib/eyeTracking/constants';

const KEY = '_ecx_eye_cal_test';
const FEATURES = [0.123456789, ...Array.from({ length: GAZE_FEATURE_DIMENSION - 1 }, () => 1)];
const SAMPLES = [{ features: FEATURES, target: [10, 20] as [number, number] }];

describe('eyeSession calibration storage', () => {
    beforeEach(() => {
        const items = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, value); },
        });
    });

    it('reuses a calibration saved less than ten minutes ago', () => {
        saveCalibration(KEY, { samples: SAMPLES, savedAt: 1000 });

        expect(loadCalibration(KEY, 1000 + CALIBRATION_REUSE_MS - 1)).toEqual({
            savedAt: 1000,
            samples: [{ features: [0.12346, ...FEATURES.slice(1)], target: [10, 20] }],
        });
    });

    it('asks for a new calibration once it is ten minutes old or missing', () => {
        saveCalibration(KEY, { samples: SAMPLES, savedAt: 1000 });

        expect(loadCalibration(KEY, 1000 + CALIBRATION_REUSE_MS)).toBeNull();
        expect(loadCalibration('_ecx_eye_cal_other', 1000)).toBeNull();
    });

    it('asks for a new calibration when it was saved with another feature layout', () => {
        saveCalibration(KEY, { samples: [{ features: FEATURES.slice(0, 20), target: [10, 20] }], savedAt: 1000 });

        expect(loadCalibration(KEY, 1001)).toBeNull();
    });
});
