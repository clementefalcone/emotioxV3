import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string | Record<string, unknown>) => (typeof fallback === 'string' ? fallback : key) }),
}));
vi.mock('../../stores/useParticipantStore', () => ({
    useParticipantStore: (selector?: (state: Record<string, unknown>) => unknown) => {
        const state = { saveResponse: vi.fn(), privacyNotice: null };
        return selector ? selector(state) : state;
    },
}));
vi.mock('../../hooks/useConsentRecorder', () => ({ useConsentRecorder: () => vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../hooks/usePreviewMode', () => ({ usePreviewMode: () => ({ isPreviewMode: false }) }));
vi.mock('../../hooks/useFaceApiEmotions', () => ({
    useFaceApiEmotions: () => ({ start: vi.fn(), stop: vi.fn(), reset: vi.fn(), getSamples: () => [], isLoaded: true }),
}));
vi.mock('../../services/media.service', () => ({ mediaService: { getMediaUrl: vi.fn().mockResolvedValue('https://img/a.png') } }));
vi.mock('../../lib/eyeTracking', () => ({ detectMicroExpressions: () => [] }));

import { EmotionAnalysisRenderer } from './EmotionAnalysisRenderer';

const emotionModule = { id: 'ea-1', name: 'Emotion Analysis', structure: { components: [{ id: 'stimuli', value: JSON.stringify([{ url: 'https://img/a.png' }]) }] } };

describe('EmotionAnalysisRenderer camera', () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };

    beforeEach(() => {
        stopTrack.mockClear();
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn().mockResolvedValue(stream) }, configurable: true });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const reachViewing = async () => {
        const view = render(<EmotionAnalysisRenderer module={emotionModule} onComplete={vi.fn()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm I am 18 or older.' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'I accept and turn on the camera' })); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); });
        return view;
    };

    it('keeps feeding the camera to emotion detection while the stimuli are shown', async () => {
        const { container } = await reachViewing();

        const webcam = container.querySelector('video.hidden') as HTMLVideoElement;
        expect(webcam.srcObject).toBe(stream);
        expect(stopTrack).not.toHaveBeenCalled();
    });

    it('turns the camera off when the participant leaves midway', async () => {
        const { unmount } = await reachViewing();

        unmount();

        expect(stopTrack).toHaveBeenCalledTimes(1);
    });
});
