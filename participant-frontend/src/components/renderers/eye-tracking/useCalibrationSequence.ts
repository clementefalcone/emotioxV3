import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { HYBRID_IMAGE_CALIBRATION_POINTS } from '../../../lib/eyeTracking';

export const CALIBRATION_POINT_MS = 2500;
const CALIBRATION_SETTLE_MS = 500;

export interface CalibrationDot {
    rect: DOMRect;
    ipx: number;
    ipy: number;
    x: number;
    y: number;
}

interface CalibrationSequenceOptions {
    isActive: boolean;
    calibrationAreaRef: RefObject<HTMLDivElement | null>;
    gazeStateRef: RefObject<'open' | 'closed'>;
    collectCalibrationSamples: (target: [number, number] | null) => void;
    onPointRecorded: (dot: CalibrationDot) => void;
    onSequenceComplete: () => void;
}

export const locateCalibrationDot = (calibrationArea: HTMLDivElement | null, index: number): CalibrationDot | null => {
    const rect = calibrationArea?.getBoundingClientRect();
    const point = HYBRID_IMAGE_CALIBRATION_POINTS[index];
    if (!rect || rect.width <= 0 || !point) return null;
    const [ipx, ipy] = point;
    return { rect, ipx, ipy, x: rect.left + (ipx / 100) * rect.width, y: rect.top + (ipy / 100) * rect.height };
};

export function useCalibrationSequence(options: CalibrationSequenceOptions) {
    const [calibrationIndex, setCalibrationIndex] = useState(0);
    const [dwellStartedAt, setDwellStartedAt] = useState<number | null>(null);
    const [interruptionCount, setInterruptionCount] = useState(0);
    const optionsRef = useRef(options);
    useLayoutEffect(() => {
        optionsRef.current = options;
    });
    const { isActive } = options;

    useEffect(() => {
        if (!isActive) return;
        let pointTimer = 0;
        let settleTimer = 0;
        const { calibrationAreaRef, gazeStateRef, collectCalibrationSamples } = optionsRef.current;

        const holdPoint = () => {
            setDwellStartedAt(performance.now());
            collectCalibrationSamples(null);
            settleTimer = window.setTimeout(() => {
                const dot = locateCalibrationDot(calibrationAreaRef.current, calibrationIndex);
                if (dot) collectCalibrationSamples([dot.x, dot.y]);
            }, CALIBRATION_SETTLE_MS);
            pointTimer = window.setTimeout(() => {
                const dot = locateCalibrationDot(calibrationAreaRef.current, calibrationIndex);
                const isEyeOpen = gazeStateRef.current === 'open';
                if (!isEyeOpen || !dot) {
                    if (!isEyeOpen) setInterruptionCount(count => count + 1);
                    holdPoint();
                    return;
                }
                setDwellStartedAt(null);
                collectCalibrationSamples(null);
                optionsRef.current.onPointRecorded(dot);
                if (calibrationIndex + 1 < HYBRID_IMAGE_CALIBRATION_POINTS.length) {
                    setCalibrationIndex(calibrationIndex + 1);
                    return;
                }
                optionsRef.current.onSequenceComplete();
            }, CALIBRATION_POINT_MS);
        };

        holdPoint();
        return () => {
            window.clearTimeout(pointTimer);
            window.clearTimeout(settleTimer);
            collectCalibrationSamples(null);
        };
    }, [isActive, calibrationIndex]);

    return { calibrationIndex, dwellStartedAt, interruptionCount, restartSequence: () => setCalibrationIndex(0) };
}
