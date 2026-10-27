import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALIBRATION_REUSE_MS, loadCalibration, saveCalibration } from '../eyeSession';

const KEY = '_ecx_eye_cal_test';
const SAMPLES = [{ features: [0.123456789, 1], target: [10, 20] as [number, number] }];

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
            samples: [{ features: [0.12346, 1], target: [10, 20] }],
        });
    });

    it('asks for a new calibration once it is ten minutes old or missing', () => {
        saveCalibration(KEY, { samples: SAMPLES, savedAt: 1000 });

        expect(loadCalibration(KEY, 1000 + CALIBRATION_REUSE_MS)).toBeNull();
        expect(loadCalibration('_ecx_eye_cal_other', 1000)).toBeNull();
    });
});
