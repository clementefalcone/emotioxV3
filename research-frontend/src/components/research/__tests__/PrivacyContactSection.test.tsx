import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const update = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../../services/research.service', () => ({ researchService: { update } }));
vi.mock('../../../hooks/useResearchQuery', () => ({
    researchKeys: { detail: (id: string) => ['research', id] },
    useResearch: () => ({ data: { id: 'research-1', settings: settings.current } }),
}));
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ error: vi.fn() }) }));

import { PrivacyContactSection } from '../PrivacyContactSection';

const renderSection = () => render(
    <QueryClientProvider client={new QueryClient()}>
        <PrivacyContactSection researchId="research-1" />
    </QueryClientProvider>,
);

describe('PrivacyContactSection', () => {
    beforeEach(() => {
        update.mockClear();
    });

    it('warns while a field is missing and saves a field on blur keeping the other settings', async () => {
        settings.current = { publicResults: true, privacy: { controllerName: 'Acme SpA', contactEmail: '', policyUrl: '' } };
        renderSection();
        expect(screen.getByText(/Completa los tres campos/)).toBeInTheDocument();

        const email = screen.getByPlaceholderText('privacidad@empresa.cl');
        fireEvent.change(email, { target: { value: ' privacidad@acme.cl ' } });
        fireEvent.blur(email);

        await waitFor(() => expect(update).toHaveBeenCalledWith('research-1', {
            settings: { publicResults: true, privacy: { controllerName: 'Acme SpA', contactEmail: 'privacidad@acme.cl', policyUrl: '' } },
        }));
    });

    it('shows no warning when the three fields are filled and does not save an unchanged field', () => {
        settings.current = { privacy: { controllerName: 'Acme SpA', contactEmail: 'privacidad@acme.cl', policyUrl: 'https://acme.cl/privacidad' } };
        renderSection();
        expect(screen.queryByText(/Completa los tres campos/)).not.toBeInTheDocument();
        fireEvent.blur(screen.getByPlaceholderText('Ej: Empresa Cliente SpA'));
        expect(update).not.toHaveBeenCalled();
    });
});
