import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordConsent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const saveResponse = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string | Record<string, unknown>) => (typeof fallback === 'string' ? fallback : key) }),
}));
vi.mock('../../stores/useParticipantStore', () => ({
    useParticipantStore: (selector?: (state: Record<string, unknown>) => unknown) => {
        const state = { saveResponse, privacyNotice: null };
        return selector ? selector(state) : state;
    },
}));
vi.mock('../../hooks/useConsentRecorder', () => ({ useConsentRecorder: () => recordConsent }));
vi.mock('../../hooks/usePreviewMode', () => ({ usePreviewMode: () => ({ isPreviewMode: false }) }));
vi.mock('../../hooks/useFaceApiEmotions', () => ({
    useFaceApiEmotions: () => ({ start: vi.fn(), stop: vi.fn(), getSamples: () => [], isLoaded: true }),
}));
vi.mock('../../services/media.service', () => ({ mediaService: { getMediaUrl: vi.fn().mockResolvedValue('https://img/a.png') } }));
vi.mock('../../lib/eyeTracking', () => ({ detectMicroExpressions: () => [] }));

import { EmotionAnalysisRenderer } from './EmotionAnalysisRenderer';

const emotionModule = { id: 'ea-1', name: 'Emotion Analysis', structure: { components: [{ id: 'stimuli', value: JSON.stringify([{ url: 'https://img/a.png' }]) }] } };

describe('EmotionAnalysisRenderer consent', () => {
    beforeEach(() => {
        recordConsent.mockClear();
        saveResponse.mockClear();
    });

    it('records a refusal and skips the activity without camera or saved response', () => {
        const onComplete = vi.fn();
        const getUserMedia = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
        render(<EmotionAnalysisRenderer module={emotionModule} onComplete={onComplete} />);

        fireEvent.click(screen.getByRole('button', { name: 'I do not accept · Skip this activity' }));

        expect(recordConsent).toHaveBeenCalledWith('declined', expect.stringContaining('Purpose: user experience research.'));
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(saveResponse).not.toHaveBeenCalled();
    });

    it('records the acceptance from an explicit accept button before going on', async () => {
        render(<EmotionAnalysisRenderer module={emotionModule} onComplete={vi.fn()} />);

        const acceptButton = screen.getByRole('button', { name: 'I accept and turn on the camera' }) as HTMLButtonElement;
        expect(acceptButton.disabled).toBe(true);
        fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm I am 18 or older.' }));
        await act(async () => { fireEvent.click(acceptButton); });

        expect(recordConsent).toHaveBeenCalledWith('accepted', expect.stringContaining('Emotions and gaze are biometric data'));
        expect(screen.queryByRole('button', { name: 'I accept and turn on the camera' })).toBeNull();
    });
});
