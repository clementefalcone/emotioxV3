import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackingZonesPanel } from '../TrackingZonesPanel';

vi.mock('../../../../services/tracking.service', () => ({
    getTrackingZones: vi.fn(),
}));

import * as trackingService from '../../../../services/tracking.service';

const renderPanel = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <TrackingZonesPanel researchId="r1" />
        </QueryClientProvider>,
    );
};

describe('TrackingZonesPanel', () => {
    it('shows each zone with the Eye Tracking AOI metrics and the emotion felt on it', async () => {
        vi.mocked(trackingService.getTrackingZones).mockResolvedValue([{
            id: 'cta', label: 'Buy button', pageUrl: 'https://shop.example.com/pricing', selector: '#buy',
            visits: 4, dwellTimePercent: 37, fixationCount: 9, avgDuration: 420, participantCount: 3,
            avgTTFF: 1500, noticeRate: 75, dominantEmotion: 'joy',
            emotionDistribution: { joy: 80, neutral: 20, sadness: 0, anger: 0, surprise: 0, fear: 0, disgust: 0 },
        }]);
        renderPanel();

        expect(await screen.findByText('Buy button')).toBeInTheDocument();
        expect(screen.getByText('/pricing · 4 visits')).toBeInTheDocument();
        expect(screen.getByText('37%')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('1.5s')).toBeInTheDocument();
        expect(screen.getByText('Joy')).toBeInTheDocument();
    });

    it('renders nothing when the researcher has not marked zones', async () => {
        vi.mocked(trackingService.getTrackingZones).mockResolvedValue([]);
        const { container } = renderPanel();
        await vi.waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
        expect(container).toBeEmptyDOMElement();
    });
});
