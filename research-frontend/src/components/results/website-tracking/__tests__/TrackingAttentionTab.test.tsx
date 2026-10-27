/**
 * Tests for TrackingAttentionTab component.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackingAttentionTab } from '../TrackingAttentionTab';

vi.mock('../../../../services/tracking.service', () => ({
    getTrackingGaze: vi.fn(),
    getTrackingConfig: vi.fn(),
}));

import * as trackingService from '../../../../services/tracking.service';

const mockGazeData = {
    totalSessions: 8,
    totalSamples: 2500,
    quadrantDistribution: {
        'top-left': 5,
        'top-center': 20,
        'top-right': 10,
        'center-left': 8,
        'center': 30,
        'center-right': 12,
        'bottom-left': 3,
        'bottom-center': 7,
        'bottom-right': 5,
    },
    dominantQuadrant: 'center' as const,
    attentionDistribution: {
        engaged: 65,
        distracted: 25,
        away: 10,
    },
    avgAttentionScore: 0.75,
    timeline: [
        { timestampS: 0, quadrant: 'center' as const, attention: 'engaged' as const, score: 0.8 },
        { timestampS: 1, quadrant: 'top-center' as const, attention: 'engaged' as const, score: 0.7 },
        { timestampS: 2, quadrant: 'center' as const, attention: 'distracted' as const, score: 0.4 },
    ],
    perSession: [
        {
            sessionId: 's1',
            visitorId: 'v1',
            pageUrl: 'https://example.com/',
            dominantQuadrant: 'center' as const,
            avgScore: 0.82,
            sampleCount: 1500,
        },
        {
            sessionId: 's2',
            visitorId: 'v2',
            pageUrl: 'https://example.com/about',
            dominantQuadrant: 'top-center' as const,
            avgScore: 0.55,
            sampleCount: 1000,
        },
    ],
};

const EMPTY_DATA = { ...mockGazeData, totalSamples: 0 };

const renderComponent = (props: { researchId: string; selectedPageUrl?: string }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <TrackingAttentionTab {...props} />
        </QueryClientProvider>
    );
};

describe('TrackingAttentionTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(trackingService.getTrackingConfig).mockResolvedValue({ captureGaze: false } as Awaited<ReturnType<typeof trackingService.getTrackingConfig>>);
    });

    it('renders loading state with pulse skeletons', () => {
        vi.mocked(trackingService.getTrackingGaze).mockReturnValue(new Promise(() => {}));
        renderComponent({ researchId: 'r1' });
        const pulseElements = document.querySelectorAll('.animate-pulse');
        expect(pulseElements.length).toBeGreaterThanOrEqual(3);
    });

    it('shows empty state when no gaze data (totalSamples = 0)', async () => {
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue({
            ...mockGazeData,
            totalSamples: 0,
        });
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('No attention data collected yet')).toBeInTheDocument();
        });
        expect(await screen.findByText('Enable "Gaze Tracking" in tracking config')).toBeInTheDocument();
    });

    it('explains that capture is on but no visitor finished the camera step', async () => {
        vi.mocked(trackingService.getTrackingConfig).mockResolvedValue({ captureGaze: true } as Awaited<ReturnType<typeof trackingService.getTrackingConfig>>);
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue(EMPTY_DATA);
        renderComponent({ researchId: 'r1' });

        expect(await screen.findByText('Capture is on — no visitor has accepted the camera and finished calibration yet')).toBeInTheDocument();
    });

    it('renders 3x3 quadrant grid with percentage labels', async () => {
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue(mockGazeData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('Gaze Zone Distribution')).toBeInTheDocument();
        });

        // All 9 quadrant labels should be present
        const quadrantLabels = ['TL', 'TC', 'TR', 'CL', 'C', 'CR', 'BL', 'BC', 'BR'];
        for (const label of quadrantLabels) {
            expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
        }

        // Center should show 30%
        expect(screen.getAllByText('30%').length).toBeGreaterThanOrEqual(1);
    });

    it('shows attention score in summary cards', async () => {
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue(mockGazeData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            // avgAttentionScore 0.75 => 75%
            expect(screen.getByText('75%')).toBeInTheDocument();
            expect(screen.getByText('Attention')).toBeInTheDocument();
            // Focus Zone = C (center)
            expect(screen.getByText('Focus Zone')).toBeInTheDocument();
        });
    });

    it('shows attention state distribution bars (engaged/distracted/away)', async () => {
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue(mockGazeData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('Attention State')).toBeInTheDocument();
        });

        expect(screen.getByText('engaged')).toBeInTheDocument();
        expect(screen.getByText('distracted')).toBeInTheDocument();
        expect(screen.getByText('away')).toBeInTheDocument();

        // Check percentages: 65%, 25%, 10%
        expect(screen.getAllByText('65%').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('25%').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('10%').length).toBeGreaterThanOrEqual(1);
    });

    it('renders session list with page URLs and scores', async () => {
        vi.mocked(trackingService.getTrackingGaze).mockResolvedValue(mockGazeData);
        renderComponent({ researchId: 'r1' });

        await waitFor(() => {
            expect(screen.getByText('Sessions with Attention Data (2)')).toBeInTheDocument();
        });

        expect(screen.getByText('https://example.com/')).toBeInTheDocument();
        expect(screen.getByText('https://example.com/about')).toBeInTheDocument();
        expect(screen.getByText('82%')).toBeInTheDocument();
        expect(screen.getByText('55%')).toBeInTheDocument();
        expect(screen.getByText('1500 samples')).toBeInTheDocument();
        expect(screen.getByText('1000 samples')).toBeInTheDocument();
    });
});
