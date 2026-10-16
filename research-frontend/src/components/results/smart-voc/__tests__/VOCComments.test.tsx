import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { TextAnalysis } from '../../../../services/analytics.service';

const buildAnalysis = (themeName: string, supportingQuotes: string[]): TextAnalysis => ({
    sentiment: { summary: 'summary', description: 'description', actionables: [] },
    themes: [{ name: themeName, count: supportingQuotes.length, description: 'd', magnitude: 0.9, sentimentScore: -0.5, supportingQuotes }],
    keywords: [{ word: 'completado', count: 1, sentiment: 'positive', supportingQuotes: ['la tarea estaba completada'] }],
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
        expect(screen.getByText('1 mentions')).toBeTruthy();
        expect(screen.getByText('50%')).toBeTruthy();
        expect(mockGetTextAnalysis).toHaveBeenCalledTimes(1);
    });

    it('lists only the comments the model assigned to a theme under that theme, like Insights Finding', async () => {
        mockGetTextAnalysis.mockResolvedValueOnce(refreshedAnalysis);
        render(
            <VOCComments
                researchId="research-1"
                moduleId="module-1"
                comments={[{ text: 'el texto era pequeño', mood: 'negative' }, { text: 'cambio la edad', mood: 'neutral' }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Themes/ }));
        const themeButton = (await screen.findByText('Confusión en la Interfaz')).closest('button');
        const themeCard = themeButton?.parentElement;
        fireEvent.click(themeButton as HTMLButtonElement);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(themeCard?.textContent).toContain('"el texto era pequeño"');
        expect(themeCard?.textContent).not.toContain('cambio la edad');
    });

    it('counts a keyword from its linked comments and lists them on click, even in another word form', async () => {
        mockGetTextAnalysis.mockResolvedValueOnce(refreshedAnalysis);
        render(
            <VOCComments
                researchId="research-1"
                moduleId="module-1"
                comments={[{ text: 'la tarea estaba completada', mood: 'positive' }, { text: 'cambio la edad', mood: 'neutral' }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Keywords/ }));
        const chip = await screen.findByRole('button', { name: /completado/ });
        expect(chip.textContent).toContain('(1 · 50%)');

        fireEvent.click(chip);

        const panel = screen.getByText(/Comments containing/).closest('.border');
        expect(panel?.textContent).toContain('la tarea estaba completada');
        expect(panel?.textContent).not.toContain('cambio la edad');
        expect(screen.queryByRole('columnheader', { name: 'Count' })).toBeNull();
    });
});
