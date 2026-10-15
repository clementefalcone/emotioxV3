import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackingZonesEditor } from '../TrackingZonesEditor';
import type { TrackingZone } from '../../../services/tracking.service';

vi.mock('../../../services/tracking.service', () => ({
    getTrackedPages: vi.fn(),
    getPageSnapshot: vi.fn(),
}));

import * as trackingService from '../../../services/tracking.service';

const zones: TrackingZone[] = [
    { id: 'z1', label: 'Buy button', pageUrl: 'https://shop.example.com/pricing', selector: '#buy' },
    { id: 'z2', label: 'Hero', pageUrl: 'https://shop.example.com/', selector: '#hero' },
];

const renderEditor = (onChange = vi.fn(), currentZones = zones) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
        <QueryClientProvider client={queryClient}>
            <TrackingZonesEditor researchId="r1" zones={currentZones} onChange={onChange} />
        </QueryClientProvider>,
    );
    return onChange;
};

describe('TrackingZonesEditor', () => {
    beforeEach(() => {
        vi.mocked(trackingService.getTrackedPages).mockResolvedValue([
            { id: 'p1', pageUrl: 'https://shop.example.com/pricing', pageTitle: 'Pricing', screenshotS3Key: null, screenshotDevices: null, hasSnapshot: true, viewportWidth: null, viewportHeight: null },
        ] as Awaited<ReturnType<typeof trackingService.getTrackedPages>>);
    });

    it('lists each zone with its page and removes one', () => {
        const onChange = renderEditor();
        expect(screen.getByText('Buy button')).toBeInTheDocument();
        expect(screen.getByText('/pricing')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Remove zone Hero'));

        expect(onChange).toHaveBeenCalledWith([zones[0]]);
    });

    it('explains how to get a snapshot when the chosen page has none', async () => {
        vi.mocked(trackingService.getPageSnapshot).mockResolvedValue(null);
        renderEditor(vi.fn(), []);

        fireEvent.click(await screen.findByText('Add zone on page…'));
        fireEvent.click(await screen.findByText('Pricing'));

        await waitFor(() => expect(screen.getByText(/no captured snapshot yet/)).toBeInTheDocument());
    });

    it('shows the page to click on, and keeps "Add zone" disabled until an element and a name are chosen', async () => {
        vi.mocked(trackingService.getPageSnapshot).mockResolvedValue('<html><head></head><body><button id="buy">Buy</button></body></html>');
        renderEditor(vi.fn(), []);

        fireEvent.click(await screen.findByText('Add zone on page…'));
        fireEvent.click(await screen.findByText('Pricing'));

        expect(await screen.findByTitle('Page snapshot')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add zone/ })).toBeDisabled();
    });
});
