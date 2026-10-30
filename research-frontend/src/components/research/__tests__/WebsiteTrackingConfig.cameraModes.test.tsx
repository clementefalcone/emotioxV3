import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WebsiteTrackingConfig } from '../WebsiteTrackingConfig';
import type { Research } from '../../../services/research.service';

vi.mock('../../../services/tracking.service', () => ({
    getEmbedSnippet: vi.fn().mockResolvedValue('<script></script>'),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    getTrackedPages: vi.fn().mockResolvedValue([]),
    getPageSnapshot: vi.fn(),
}));

import * as trackingService from '../../../services/tracking.service';

const research = {
    id: 'r1',
    settings: { trackingConfig: { emotionsMode: 'optional', gazeMode: 'off' } },
} as unknown as Research;

describe('WebsiteTrackingConfig camera modes', () => {
    it('shows each camera feature as Off / Optional / Required and saves the chosen mode', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <WebsiteTrackingConfig research={research} />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        const emotions = screen.getByRole('group', { name: 'Emotions' });
        expect(emotions.querySelector('[aria-pressed="true"]')?.textContent).toBe('Optional');
        expect(screen.getByRole('group', { name: 'Gaze Tracking' }).querySelector('[aria-pressed="true"]')?.textContent).toBe('Off');

        fireEvent.click(emotions.querySelector('button:nth-child(3)')!);
        expect(screen.getByText(/Nothing is recorded from visitors who decline or whose camera fails/)).toBeInTheDocument();

        await waitFor(() => expect(trackingService.updateConfig).toHaveBeenCalledWith('r1', expect.objectContaining({ emotionsMode: 'required', gazeMode: 'off' })), { timeout: 2500 });
    });
});
