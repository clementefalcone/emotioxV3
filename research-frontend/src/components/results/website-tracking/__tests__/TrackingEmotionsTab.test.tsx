/**
 * Tests for TrackingEmotionsTab component.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackingEmotionsTab } from '../TrackingEmotionsTab';

vi.mock('../../../../services/tracking.service', () => ({
    getTrackingEmotions: vi.fn(),
    getTrackingConfig: vi.fn(),
}));

import * as trackingService from '../../../../services/tracking.service';

const distribution = { neutral: 35, joy: 25, sadness: 10, anger: 5, surprise: 15, fear: 5, disgust: 5 };
const actionUnits = { AU1: 0.1, AU2: 0.1, AU4: 0.2, AU6: 0.5, AU12: 0.6, AU15: 0.1, AU20: 0.3, AU25: 0.2, AU26: 0.1 };

const mockEmotionData = {
    totalSessions: 12,
    emotions: {
        enabled: true,
        totalSamples: 3400,
        distribution,
        dominantEmotion: 'neutral' as const,
        avgConfidence: 0.72,
        perParticipant: [
            { participantId: 'visitor-a', dominantEmotion: 'joy' as const, sampleCount: 2000, distribution },
            { participantId: 'visitor-b', dominantEmotion: 'neutral' as const, sampleCount: 1400, distribution },
        ],
        timeline: [
            { timestamp: 0, emotion: 'neutral' as const, confidence: 0.8, actionUnits },
            { timestamp: 1000, emotion: 'joy' as const, confidence: 0.7, actionUnits },
        ],
        microExpressions: {
            total: 1, briefCount: 0, microCount: 1, byEmotion: { disgust: 1 },
            events: [{ participantId: 'visitor-a', emotion: 'disgust', durationMs: 250, startTimestamp: 1000, category: 'micro' as const, peakConfidence: 0.7 }],
        },
    },
    perSession: [
        {
            sessionId: 's1',
            visitorId: 'v1',
            pageUrl: 'https://example.com/',
            dominantEmotion: 'joy' as const,
            sampleCount: 200,
        },
        {
            sessionId: 's2',
            visitorId: 'v2',
            pageUrl: 'https://example.com/pricing',
            dominantEmotion: 'neutral' as const,
            sampleCount: 150,
        },
    ],
    valenceArousal: [
        { timestampS: 0, valence: 0.3, arousal: 0.5 },
        { timestampS: 1, valence: 0.5, arousal: 0.4 },
    ],
};

const EMPTY_DATA = { ...mockEmotionData, emotions: { ...mockEmotionData.emotions, totalSamples: 0 } };

const renderComponent = (props: { researchId: string; selectedPageUrl?: string }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <TrackingEmotionsTab {...props} />
        </QueryClientProvider>
    );
};

describe('TrackingEmotionsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(trackingService.getTrackingConfig).mockResolvedValue({ emotionsMode: 'off' } as Awaited<ReturnType<typeof trackingService.getTrackingConfig>>);
    });

    it('renders loading state with pulse skeletons', () => {
        vi.mocked(trackingService.getTrackingEmotions).mockReturnValue(new Promise(() => {}));
        renderComponent({ researchId: 'r1' });
        const pulseElements = document.querySelectorAll('.animate-pulse');
        expect(pulseElements.length).toBeGreaterThanOrEqual(3);
    });

    it('shows empty state when no emotion data (totalSamples = 0)', async () => {
        vi.mocked(trackingService.getTrackingEmotions).mockResolvedValue({
            ...mockEmotionData,
            emotions: { ...mockEmotionData.emotions, totalSamples: 0 },
        });
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('No emotion data collected yet')).toBeInTheDocument();
        });
        expect(await screen.findByText('Set "Emotions" to Optional or Required in tracking config')).toBeInTheDocument();
    });

    it('explains that capture is on but no visitor finished the camera step', async () => {
        vi.mocked(trackingService.getTrackingConfig).mockResolvedValue({ emotionsMode: 'optional' } as Awaited<ReturnType<typeof trackingService.getTrackingConfig>>);
        vi.mocked(trackingService.getTrackingEmotions).mockResolvedValue(EMPTY_DATA);
        renderComponent({ researchId: 'r1' });

        expect(await screen.findByText('Capture is on — no visitor has accepted the camera and finished calibration yet')).toBeInTheDocument();
    });

    it('shows the Eye Tracking emotion panels: EmScore, moods, action units, micro-expressions and participants', async () => {
        vi.mocked(trackingService.getTrackingEmotions).mockResolvedValue(mockEmotionData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('EmScore')).toBeInTheDocument();
        });
        expect(screen.getByText('Distribución de emociones')).toBeInTheDocument();
        expect(screen.getByText('Frustración')).toBeInTheDocument();
        expect(screen.getByText('Average Action Unit Activation')).toBeInTheDocument();
        expect(screen.getByText('Micro-Expressions')).toBeInTheDocument();
        expect(screen.getByText('Per Participant')).toBeInTheDocument();
        expect(screen.getByText('visitor-a')).toBeInTheDocument();
        expect(screen.getByText(/72% confianza promedio/)).toBeInTheDocument();
    });

    it('renders circumplex canvas element', async () => {
        vi.mocked(trackingService.getTrackingEmotions).mockResolvedValue(mockEmotionData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('Affect Space')).toBeInTheDocument();
        });

        const canvasElements = document.querySelectorAll('canvas');
        expect(canvasElements.length).toBeGreaterThanOrEqual(1);
    });

    it('shows session list with page URLs and sample counts', async () => {
        vi.mocked(trackingService.getTrackingEmotions).mockResolvedValue(mockEmotionData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('Sessions with Emotions (2)')).toBeInTheDocument();
        });

        expect(screen.getByText('https://example.com/')).toBeInTheDocument();
        expect(screen.getByText('https://example.com/pricing')).toBeInTheDocument();
        expect(screen.getByText('200 samples')).toBeInTheDocument();
        expect(screen.getByText('150 samples')).toBeInTheDocument();
    });
});
