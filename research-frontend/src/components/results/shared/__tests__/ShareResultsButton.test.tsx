import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareResultsButton } from '../ShareResultsButton';
import type { Research } from '../../../../services/research.service';

vi.mock('../../../../services/research.service', () => ({
    researchService: { update: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { researchService } from '../../../../services/research.service';

const renderButton = (settings: Record<string, unknown>) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const research = { id: 'r1', name: 'Study', status: 'active', research_type_id: 't1', settings } as Research;
    return render(
        <QueryClientProvider client={queryClient}>
            <ShareResultsButton research={research} />
        </QueryClientProvider>,
    );
};

describe('ShareResultsButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    });

    it('turns public results on, keeping the rest of the study config, before copying the link', async () => {
        renderButton({ stimuli: ['s1'] });

        fireEvent.click(screen.getByRole('button', { name: /share/i }));

        expect(await screen.findByText('Copied!')).toBeInTheDocument();
        expect(researchService.update).toHaveBeenCalledWith('r1', { settings: { stimuli: ['s1'], publicResults: true } });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/research/results/r1`);
    });

    it('turns public results off from the lock button', async () => {
        renderButton({ publicResults: true });

        fireEvent.click(screen.getByRole('button', { name: 'Make results private' }));

        await vi.waitFor(() =>
            expect(researchService.update).toHaveBeenCalledWith('r1', { settings: { publicResults: false } }),
        );
    });
});
