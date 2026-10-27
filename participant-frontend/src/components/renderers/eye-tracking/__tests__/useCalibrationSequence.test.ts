import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HYBRID_IMAGE_CALIBRATION_POINTS } from '../../../../lib/eyeTracking';
import { CALIBRATION_POINT_MS, useCalibrationSequence } from '../useCalibrationSequence';

const AREA = { left: 0, top: 100, width: 1000, height: 500 };

const renderSequence = (gazeState: 'open' | 'closed') => {
    const calibrationArea = { getBoundingClientRect: () => AREA } as HTMLDivElement;
    const gazeStateRef = { current: gazeState };
    const collectCalibrationSamples = vi.fn();
    const onPointRecorded = vi.fn();
    const onSequenceComplete = vi.fn();
    const view = renderHook(() => useCalibrationSequence({
        isActive: true,
        calibrationAreaRef: { current: calibrationArea },
        gazeStateRef,
        collectCalibrationSamples,
        onPointRecorded,
        onSequenceComplete,
    }));
    return { ...view, gazeStateRef, collectCalibrationSamples, onPointRecorded, onSequenceComplete };
};

describe('useCalibrationSequence', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('collects samples at each dot in screen pixels and completes after every point', () => {
        const { result, collectCalibrationSamples, onPointRecorded, onSequenceComplete } = renderSequence('open');
        const [firstX, firstY] = HYBRID_IMAGE_CALIBRATION_POINTS[0];

        act(() => { vi.advanceTimersByTime(500); });
        expect(collectCalibrationSamples).toHaveBeenLastCalledWith([firstX * 10, 100 + firstY * 5]);

        for (let point = 0; point < HYBRID_IMAGE_CALIBRATION_POINTS.length; point++) {
            act(() => { vi.advanceTimersByTime(CALIBRATION_POINT_MS); });
        }

        expect(onPointRecorded).toHaveBeenCalledTimes(HYBRID_IMAGE_CALIBRATION_POINTS.length);
        expect(onSequenceComplete).toHaveBeenCalledTimes(1);
        expect(result.current.interruptionCount).toBe(0);
    });

    it('holds the dot and counts an interruption while the eyes are not visible', () => {
        const { result, gazeStateRef, onPointRecorded } = renderSequence('closed');

        act(() => { vi.advanceTimersByTime(CALIBRATION_POINT_MS * 2); });
        expect(onPointRecorded).not.toHaveBeenCalled();
        expect(result.current.interruptionCount).toBe(2);
        expect(result.current.calibrationIndex).toBe(0);

        gazeStateRef.current = 'open';
        act(() => { vi.advanceTimersByTime(CALIBRATION_POINT_MS); });
        expect(onPointRecorded).toHaveBeenCalledTimes(1);
        expect(result.current.calibrationIndex).toBe(1);
    });
});
