import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { TextAnalysis } from '../../../../services/analytics.service';

const buildAnalysis = (themeName: string, supportingQuotes: string[]): TextAnalysis => ({
    sentiment: { summary: 'summary', description: 'description', actionables: [] },
    themes: [{ name: themeName, count: supportingQuotes.length, description: 'd', magnitude: 0.9, sentimentScore: -0.5, supportingQuotes }],
    keywords: [],
});

const savedAnalysis = buildAnalysis('Interacción del Usuario', []);
const refreshedAnalysis = buildAnalysis('Confusión en la Interfaz', ['el texto era pequeño']);

const mockGetTextAnalysis = vi.fn(async () => savedAnalysis);
const mockTriggerTextAnalysis = vi.fn(async () => refreshedAnalysis);
vi.mock('../../../../services/analytics.service', () => ({
    getTextAnalysis: () => mockGetTextAnalysis(),
    triggerTextAnalysis: () => mockTriggerTextAnalysis(),
}));
vi.mock('../../../../services/participants.service', () => ({ participantsService: {} }));
vi.mock('../../../../services/smartVOC.service', () => ({ smartVOCService: {} }));

import { VOCComments } from '../components/VOCComments';

describe('VOCComments refresh analysis', () => {
    it('shows the refreshed themes as soon as the analysis returns, without reloading', async () => {
        render(
            <VOCComments
                researchId="research-1"
                moduleId="module-1"
                comments={[{ text: 'el texto era pequeño', mood: 'negative' }, { text: 'cambio la edad', mood: 'neutral' }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Themes/ }));
        await screen.findByText('Interacción del Usuario');

        fireEvent.click(screen.getAllByRole('button', { name: /Refresh analysis/ })[0]);

        await waitFor(() => expect(screen.getByText('Confusión en la Interfaz')).toBeTruthy());
        expect(screen.queryByText('Interacción del Usuario')).toBeNull();
        expect(screen.getByText('1 mentions (50%)')).toBeTruthy();
        expect(mockGetTextAnalysis).toHaveBeenCalledTimes(1);
    });
});
