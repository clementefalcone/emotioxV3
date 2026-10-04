import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageSnapshotHeatmap } from '../PageSnapshotHeatmap';

vi.mock('../../../../services/tracking.service', () => ({
    getPageSnapshot: vi.fn().mockResolvedValue('<html><body><img src="x" onerror="alert(1)"></body></html>'),
    getClickHeatmap: vi.fn().mockResolvedValue({ clicks: [] }),
    getAttentionHeatmap: vi.fn().mockResolvedValue({ points: [] }),
    getScrollDepth: vi.fn().mockResolvedValue({ depths: [] }),
}));

describe('PageSnapshotHeatmap', () => {
    it('renders a visitor-supplied snapshot in an iframe that cannot run scripts', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const { container } = render(
            <QueryClientProvider client={queryClient}>
                <PageSnapshotHeatmap researchId="r1" pageUrl="https://example.com/" heatmapType="click" />
            </QueryClientProvider>,
        );

        const iframe = await waitFor(() => {
            const element = container.querySelector('iframe');
            expect(element).not.toBeNull();
            return element;
        });

        expect(iframe?.getAttribute('sandbox')).toBe('allow-same-origin');
    });
});
