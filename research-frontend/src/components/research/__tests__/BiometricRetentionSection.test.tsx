import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

const update = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../../../services/research.service', () => ({ researchService: { update } }));
vi.mock('../../../hooks/useResearchQuery', () => ({
    researchKeys: { detail: (id: string) => ['research', id] },
    useResearch: () => ({ data: { id: 'research-1', settings: { publicResults: true } } }),
}));
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ error: vi.fn() }) }));

import { BiometricRetentionSection } from '../BiometricRetentionSection';

describe('BiometricRetentionSection', () => {
    it('shows 12 months by default and saves the chosen period without losing other settings', async () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <BiometricRetentionSection researchId="research-1" />
            </QueryClientProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: /12 meses/ }));
        fireEvent.click(screen.getByRole('button', { name: '6 meses' }));
        await waitFor(() => expect(update).toHaveBeenCalledWith('research-1', { settings: { publicResults: true, biometricDataRetentionMonths: 6 } }));
    });
});
