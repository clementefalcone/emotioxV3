import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HYBRID_IMAGE_CALIBRATION_POINTS } from '../../../../lib/eyeTracking';
import { CalibrationPhase } from '../CalibrationPhase';

const renderPhase = (calibrationIndex: number) => {
    const calibrationAreaRef = React.createRef<HTMLDivElement>();
    render(
        <CalibrationPhase
            calibrationIndex={calibrationIndex}
            dwellStartedAt={null}
            dwellDurationMs={2500}
            calibrationAreaRef={calibrationAreaRef}
            isFaceInZone
            interruptionCount={0}
        />,
    );
    return calibrationAreaRef;
};

const indexWhereDotIs = (isUpperHalf: boolean) =>
    HYBRID_IMAGE_CALIBRATION_POINTS.findIndex(([, y]) => (isUpperHalf ? y < 50 : y >= 50));

describe('CalibrationPhase', () => {
    it('calibrates over the whole screen, where the stimulus is centered later', () => {
        const calibrationAreaRef = renderPhase(0);
        expect(calibrationAreaRef.current).toBe(screen.getByTestId('calibration-area'));
        expect(calibrationAreaRef.current?.className).toContain('absolute inset-0');
    });

    it('moves the instructions to the bottom while the dot is in the upper half', () => {
        renderPhase(indexWhereDotIs(true));
        expect(screen.getByTestId('calibration-header').className).toContain('bottom-0');
    });

    it('keeps the instructions at the top while the dot is in the lower half', () => {
        renderPhase(indexWhereDotIs(false));
        expect(screen.getByTestId('calibration-header').className).toContain('top-0');
    });
});
