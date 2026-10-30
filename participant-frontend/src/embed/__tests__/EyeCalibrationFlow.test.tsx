import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

vi.mock('../../hooks/useMediaPipeGaze', () => ({
    useMediaPipeGaze: () => ({
        isLoaded: true,
        gazeState: 'open',
        gazePosRef: { current: { x: 10, y: 20 } },
        headPoseRef: { current: { pitch: 0, yaw: 0 } },
        lastLandmarksRef: { current: null },
        start: vi.fn(),
        collectCalibrationSamples: vi.fn(),
        trainRidge: vi.fn().mockResolvedValue(undefined),
    }),
}));
vi.mock('../../components/renderers/eye-tracking/ConsentPhase', () => ({
    ConsentPhase: ({ onAccept }: { onAccept: () => Promise<boolean> }) => <button onClick={() => { void onAccept(); }}>accept</button>,
}));
vi.mock('../../components/renderers/eye-tracking/FacePositionPhase', () => ({
    FacePositionPhase: () => <div data-testid="face-phase" />,
}));

import { EyeCalibrationFlow } from '../EyeCalibrationFlow';

const renderFlow = (canSkipCalibration: boolean) => {
    const onReady = vi.fn();
    render(
        <EyeCalibrationFlow
            options={{ storageKey: 'k', hasEmotionRecognition: true, canSkipCalibration, onReady, onDecline: vi.fn(), onCameraDenied: vi.fn() }}
            storedCalibration={null}
        />,
    );
    return onReady;
};

const acceptCamera = async () => {
    await act(async () => { fireEvent.click(screen.getByText('accept')); });
    expect(screen.getByTestId('face-phase')).toBeTruthy();
};

describe('EyeCalibrationFlow skip calibration', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) } });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });

    it('hands over a camera session without gaze when the visitor skips calibration', async () => {
        const onReady = renderFlow(true);
        await acceptCamera();

        fireEvent.click(screen.getByText('Skip calibration (emotions only)'));

        const session = onReady.mock.calls[0][0];
        expect(session.isGazeCalibrated).toBe(false);
        expect(session.readGaze()).toBeNull();
        expect(session.calibrationRmsePx).toBeNull();
        expect(session.video).toBeInstanceOf(HTMLVideoElement);
    });

    it('offers no skip when gaze is required', async () => {
        renderFlow(false);
        await acceptCamera();

        expect(screen.queryByText('Skip calibration (emotions only)')).toBeNull();
    });
});
