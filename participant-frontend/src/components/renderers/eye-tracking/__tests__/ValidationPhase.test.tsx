import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ValidationPhase } from '../ValidationPhase';
import { HYBRID_REJECT_RMSE_THRESHOLD_PX } from '../../../../lib/eyeTracking';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const renderFailedValidation = (recalibrationCount: number) => {
    const onRecalibrate = vi.fn();
    const onSkipValidation = vi.fn();
    const onRejectSession = vi.fn();
    const view = render(
        <ValidationPhase
            validationIndex={0}
            validationRmse={HYBRID_REJECT_RMSE_THRESHOLD_PX + 50}
            dwellStartedAt={null}
            dwellDurationMs={800}
            recalibrationCount={recalibrationCount}
            resolvedUrl=""
            imgRef={{ current: null }}
            onValidationDwellComplete={vi.fn()}
            onRecalibrate={onRecalibrate}
            onSkipValidation={onSkipValidation}
            onRejectSession={onRejectSession}
            onImageLoad={vi.fn()}
            shelfConfig={null}
        />
    );
    return { ...view, onRecalibrate, onSkipValidation, onRejectSession };
};

describe('ValidationPhase failed calibration', () => {
    it('asks to try again without showing pixel errors', () => {
        const { container, getByText, onRecalibrate } = renderFailedValidation(0);

        expect(container.textContent).not.toMatch(/px/);
        fireEvent.click(getByText('Try again'));
        expect(onRecalibrate).toHaveBeenCalledOnce();
    });

    it('offers to continue or skip the activity after repeated failures', () => {
        const { container, getByText, onSkipValidation, onRejectSession } = renderFailedValidation(2);

        expect(container.textContent).not.toMatch(/px/);
        fireEvent.click(getByText('Continue anyway'));
        fireEvent.click(getByText('Skip this activity'));
        expect(onSkipValidation).toHaveBeenCalledOnce();
        expect(onRejectSession).toHaveBeenCalledOnce();
    });
});
